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

import logging
import os
import signal
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

from kmip.core.enums import (AttributeType, CryptographicAlgorithm,
                             CryptographicUsageMask, ObjectType, ResultStatus,
                             RevocationReasonCode)
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

current_uid = None
shutdown_requested = False
_connected = False

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
            body = b'{"status":"ok"}' if _connected else b'{"status":"starting"}'
            code = 200
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

    _start_health_server()

    log.info(f"[kmip-client] connecting to {KMIP_HOST}:{KMIP_PORT} via mTLS...")

    client = make_client()
    client.open()
    _connected = True
    log.info(f"[kmip-client] Connected to {KMIP_HOST}:{KMIP_PORT} via mTLS")

    try:
        # Initial key lifecycle
        current_uid = create_key(client)
        activate_key(client, current_uid)
        get_attribute_list(client, current_uid)

        log.info(f"[kmip-client] table_space_1 encrypted with key {current_uid}")

        locate_keys(client)

        next_rotation = time.monotonic() + ROTATION_INTERVAL

        while not shutdown_requested:
            time.sleep(1)

            if time.monotonic() >= next_rotation:
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
    main()
