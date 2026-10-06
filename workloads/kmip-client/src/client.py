"""
Arcanium KMIP client — legacy database consumer demo.

Demonstrates the full KML lifecycle via KMIP against Vault Enterprise:
  Generatie   — Create AES-256 symmetric key
  Opslag      — Key held by Vault, never exported to client
  Gebruik     — Simulated tablespace encryption reference
  Rotatie     — New key created, old key deactivated then destroyed
  Vernietiging — Key destroyed on SIGTERM

Environment variables:
  KMIP_HOST              Vault KMIP listener hostname (default: vault-1)
  KMIP_PORT              KMIP listener port (default: 5696)
  KMIP_CERT              Path to mTLS client certificate PEM
  KMIP_KEY               Path to mTLS client private key
  KMIP_CA                Path to KMIP CA certificate PEM
  DEMO_FAST_ROTATION     "true" = rotate every 2 minutes; default = 30 minutes
"""

import datetime
import json
import logging
import os
import signal
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

from cryptography import x509  # ships with PyKMIP
from kmip.core.enums import (
    AttributeType,
    CryptographicAlgorithm,
    CryptographicUsageMask,
    ObjectType,
    ResultStatus,
    RevocationReasonCode,
)
from kmip.core.factories.attributes import AttributeFactory
from kmip.services.kmip_client import KMIPProxy

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)
log = logging.getLogger("kmip-client")

KMIP_HOST = os.environ.get("KMIP_HOST", "vault-1")
KMIP_PORT = int(os.environ.get("KMIP_PORT", "5696"))
KMIP_CERT = os.environ.get("KMIP_CERT", "/kmip/client.pem")
KMIP_KEY = os.environ.get("KMIP_KEY", "/kmip/client.key")
KMIP_CA = os.environ.get("KMIP_CA", "/kmip/ca.pem")
DEMO_FAST = os.environ.get("DEMO_FAST_ROTATION", "false").lower() == "true"

ROTATION_INTERVAL = 120 if DEMO_FAST else 1800  # seconds

# The mTLS client cert comes from Vault's KMIP engine with a 7-day TTL
# (terraform/vault-kmip: default_tls_client_ttl) and is renewed automatically
# by arcanium-kmip_renewer (compose/vault) — `make kmip-renew` is the manual
# fallback. Until 2026-10-06 an expired cert made Vault reset
# the first request, this process crashed, and the container restart-looped
# for two weeks with health stuck at "starting". Now expiry is checked up
# front, reported on /health, and the client waits for a renewed cert.
CERT_WARN_SECONDS = 24 * 3600
CERT_WAIT_SECONDS = 60
CERT_RELOAD_CHECK_SECONDS = (
    30  # arcanium-kmip_renewer swaps the cert ~48h before expiry
)

current_uid = None
shutdown_requested = False
_connected = False
_status = "starting"  # starting | ok | expiring | cert_expired | cert_missing | error

PORT = int(os.environ.get("PORT", "3007"))


def handle_sigterm(signum, frame):
    global shutdown_requested
    shutdown_requested = True


signal.signal(signal.SIGTERM, handle_sigterm)
signal.signal(signal.SIGINT, handle_sigterm)


# ── Minimal health server ────────────────────────────────────────────────────
class _HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            info = {"status": _status}
            not_after = _cert_not_after()
            if not_after:
                info["cert_expires_at"] = not_after.isoformat()
                info["cert_seconds_left"] = int(_seconds_left(not_after))
            body = json.dumps(info).encode()
            # 503 makes the container healthcheck fail visibly instead of
            # hiding an unusable credential behind "starting".
            code = 503 if _status in ("cert_expired", "cert_missing", "error") else 200
        else:
            body = b"not found"
            code = 404
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):  # silence access logs
        pass


def _start_health_server():
    srv = HTTPServer(("0.0.0.0", PORT), _HealthHandler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    log.info(f"[kmip-client] health server on :{PORT}")


def _cert_not_after():
    try:
        with open(KMIP_CERT, "rb") as fh:
            cert = x509.load_pem_x509_certificate(fh.read())
        return cert.not_valid_after_utc
    except (OSError, ValueError):
        return None


def _seconds_left(not_after) -> float:
    return (not_after - datetime.datetime.now(datetime.timezone.utc)).total_seconds()


def wait_for_valid_cert():
    """Block until KMIP_CERT exists and is unexpired. The cert directory is a
    read-only bind mount, so a host-side `make kmip-renew` is picked up here
    without restarting the container."""
    global _status
    announced = None
    while not shutdown_requested:
        not_after = _cert_not_after()
        if not_after is None:
            state = "cert_missing"
            msg = f"no readable client certificate at {KMIP_CERT}"
        elif _seconds_left(not_after) <= 0:
            state = "cert_expired"
            msg = f"client certificate expired at {not_after.isoformat()}"
        else:
            left = _seconds_left(not_after)
            if left < CERT_WARN_SECONDS:
                log.warning(
                    f"[kmip-client] client certificate expires in {int(left // 3600)}h "
                    f"({not_after.isoformat()}) — run `make kmip-renew`"
                )
            return not_after
        _status = state
        if announced != state:
            log.error(
                f"[kmip-client] {msg} — Vault will reject the mTLS handshake. "
                f"Run `make kmip-renew` on the host; waiting for a valid cert "
                f"(re-checking every {CERT_WAIT_SECONDS}s)."
            )
            announced = state
        time.sleep(CERT_WAIT_SECONDS)
    return None


def _cert_mtime():
    try:
        return os.stat(KMIP_CERT).st_mtime
    except OSError:
        return None


def make_client():
    # PyKMIP 0.11.0 on Python 3.12: omit ssl_version to let the library
    # select a compatible TLS context automatically.
    return KMIPProxy(
        host=KMIP_HOST,
        port=KMIP_PORT,
        certfile=KMIP_CERT,
        keyfile=KMIP_KEY,
        ca_certs=KMIP_CA,
    )


def create_key(client) -> str:
    """Create a 256-bit AES symmetric key and return its UID."""
    factory = AttributeFactory()
    attrs = [
        factory.create_attribute(
            AttributeType.CRYPTOGRAPHIC_ALGORITHM, CryptographicAlgorithm.AES
        ),
        factory.create_attribute(AttributeType.CRYPTOGRAPHIC_LENGTH, 256),
        factory.create_attribute(
            AttributeType.CRYPTOGRAPHIC_USAGE_MASK,
            [CryptographicUsageMask.ENCRYPT, CryptographicUsageMask.DECRYPT],
        ),
    ]
    from kmip.core.objects import TemplateAttribute

    template = TemplateAttribute(attributes=attrs)
    result = client.create(
        object_type=ObjectType.SYMMETRIC_KEY,
        template_attribute=template,
    )
    if result.result_status.value != ResultStatus.SUCCESS:
        raise RuntimeError(f"KMIP Create failed: {result.result_reason}")
    uid = result.uuid
    log.info(f"[kmip-client] Created symmetric key: {uid}")
    return uid


def activate_key(client, uid: str):
    result = client.activate(uuid=uid)
    if result.result_status.value != ResultStatus.SUCCESS:
        raise RuntimeError(f"KMIP Activate failed: {result.result_reason}")
    log.info(f"[kmip-client] Key state: Pre-Active → Active  uid={uid}")


def get_attribute_list(client, uid: str):
    result = client.get_attribute_list(uid=uid)
    if result.result_status.value != ResultStatus.SUCCESS:
        log.warning(
            f"[kmip-client] GetAttributeList skipped: {result.result_reason}  uid={uid}"
        )
        return
    attrs = result.names if result.names else []
    log.info(f"[kmip-client] Key attributes: {attrs}  uid={uid}")


def revoke_key(client, uid: str):
    """Deactivate (revoke) a key — required before destroy."""
    result = client.revoke(
        revocation_reason=RevocationReasonCode.KEY_COMPROMISE,
        uuid=uid,
    )
    if result.result_status.value != ResultStatus.SUCCESS:
        raise RuntimeError(f"KMIP Revoke failed: {result.result_reason}")
    log.info(f"[kmip-client] old key deactivated  uid={uid}")


def destroy_key(client, uid: str):
    result = client.destroy(uuid=uid)
    if result.result_status.value != ResultStatus.SUCCESS:
        raise RuntimeError(f"KMIP Destroy failed: {result.result_reason}")
    log.info(f"[kmip-client] key destroyed  uid={uid}")


def locate_keys(client) -> int:
    result = client.locate()
    if result.result_status.value != ResultStatus.SUCCESS:
        raise RuntimeError(f"KMIP Locate failed: {result.result_reason}")
    uids = result.uuids if result.uuids else []
    log.info(f"[kmip-client] keys in scope: {len(uids)}")
    return len(uids)


def main():
    global current_uid, _connected

    global _status
    _start_health_server()

    not_after = wait_for_valid_cert()
    if not_after is None:  # shutdown requested while waiting
        return
    log.info(f"[kmip-client] client certificate valid until {not_after.isoformat()}")

    log.info(f"[kmip-client] connecting to {KMIP_HOST}:{KMIP_PORT} via mTLS...")

    client = make_client()
    client.open()
    _connected = True
    _status = "ok"
    log.info(f"[kmip-client] Connected to {KMIP_HOST}:{KMIP_PORT} via mTLS")

    try:
        # Initial key lifecycle
        current_uid = create_key(client)
        activate_key(client, current_uid)
        get_attribute_list(client, current_uid)

        log.info(f"[kmip-client] table_space_1 encrypted with key {current_uid}")

        locate_keys(client)

        next_rotation = time.monotonic() + ROTATION_INTERVAL
        cert_mtime = _cert_mtime()
        next_cert_check = time.monotonic() + CERT_RELOAD_CHECK_SECONDS

        while not shutdown_requested:
            time.sleep(1)

            # Hot reload: the renewer sidecar replaces client.pem/key on the
            # shared mount. Vault only checks the cert at handshake, so open a
            # new session on the new cert; the active key UID carries over.
            if time.monotonic() >= next_cert_check:
                next_cert_check = time.monotonic() + CERT_RELOAD_CHECK_SECONDS
                mtime = _cert_mtime()
                if mtime and mtime != cert_mtime:
                    new_not_after = _cert_not_after()
                    if new_not_after and _seconds_left(new_not_after) > 0:
                        log.info(
                            f"[kmip-client] renewed client certificate detected "
                            f"(valid until {new_not_after.isoformat()}) — reconnecting"
                        )
                        client.close()
                        client = make_client()
                        client.open()
                        not_after = new_not_after
                        _status = "ok"
                        log.info(
                            f"[kmip-client] reconnected to {KMIP_HOST}:{KMIP_PORT} on the renewed certificate"
                        )
                    cert_mtime = mtime

            if time.monotonic() >= next_rotation:
                left = _seconds_left(not_after)
                if left < CERT_WARN_SECONDS:
                    _status = "expiring"
                    log.warning(
                        f"[kmip-client] client certificate expires in {int(max(left, 0) // 3600)}h "
                        f"— run `make kmip-renew` (the next connection will be rejected after expiry)"
                    )
                old_uid = current_uid
                log.info(f"[kmip-client] rotating key  old={old_uid}")
                new_uid = create_key(client)
                activate_key(client, new_uid)
                revoke_key(client, old_uid)
                destroy_key(client, old_uid)
                current_uid = new_uid
                log.info(f"[kmip-client] key rotated  uid={new_uid}")
                locate_keys(client)
                next_rotation = time.monotonic() + ROTATION_INTERVAL

    finally:
        # Graceful shutdown: destroy active key (KML Vernietiging)
        if current_uid:
            log.info(
                f"[kmip-client] SIGTERM received — destroying key  uid={current_uid}"
            )
            try:
                revoke_key(client, current_uid)
                destroy_key(client, current_uid)
            except Exception as exc:
                log.warning(f"[kmip-client] shutdown destroy failed: {exc}")
        client.close()

    log.info("[kmip-client] exited cleanly")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Don't hot-loop the container: say what failed, point at the likely
        # cause, and back off before the restart policy brings us back.
        _status = "error"
        hint = ""
        not_after = _cert_not_after()
        if not_after and _seconds_left(not_after) <= 0:
            hint = " (client certificate is expired — run `make kmip-renew`)"
        log.error(
            f"[kmip-client] fatal: {type(exc).__name__}: {exc}{hint}; exiting in 30s"
        )
        time.sleep(30)
        raise SystemExit(1)
