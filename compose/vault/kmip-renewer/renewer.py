#!/usr/bin/env python3
"""compose/vault/kmip-renewer/renewer.py

Sidecar that keeps the kmip-client mTLS certificate valid.

Vault's KMIP engine caps client certs at 7 days (terraform/vault-kmip:
default_tls_client_ttl). The legacy-db cert used to be issued once by
scenarios/03_kmip/provision.sh; it expired on 2026-09-22 and
arcanium-kmip-client restart-looped for two weeks. This sidecar:

  1. authenticates as AppRole `kmip-renewer` (policy: generate + revoke
     legacy-db credentials, nothing else — terraform/vault-kmip/kmip_renewer.tf)
  2. reads the real notAfter from /kmip/client.pem (any issuer: this sidecar,
     provision.sh or `make kmip-renew`)
  3. inside RENEW_BEFORE_SECONDS of expiry (or with no cert at all) issues a
     new credential, swaps client.pem/client.key/ca.pem atomically, and
     revokes the previous serial
  4. revokes its own token after each renewal (least privilege, same as
     vault-rotator)

kmip-client watches the same directory (read-only) and reconnects on the new
cert without a restart. Stdlib only — the image is plain python:3.12-slim.

`renewer.py --check` is the container healthcheck: exits 0 while the cert on
disk is valid for at least CHECK_INTERVAL_SECONDS more.
"""

import datetime
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request

VAULT_ADDR = os.environ.get("VAULT_ADDR", "https://vault-1:8200").rstrip("/")
VAULT_CACERT = os.environ.get("VAULT_CACERT", "/vault/tls/ca-chain.pem")
ROLE_ID = os.environ.get("KMIP_RENEWER_ROLE_ID", "")
SECRET_ID = os.environ.get("KMIP_RENEWER_SECRET_ID", "")
KMIP_ROLE_PATH = os.environ.get("KMIP_ROLE_PATH", "kmip/scope/arcanium/role/legacy-db")
CERT_DIR = os.environ.get("KMIP_CERT_DIR", "/kmip")
RENEW_BEFORE = int(
    os.environ.get("RENEW_BEFORE_SECONDS", "172800")
)  # 48h of a 7-day TTL
CHECK_INTERVAL = int(os.environ.get("CHECK_INTERVAL_SECONDS", "3600"))  # 1h
RETRY_SECONDS = 60

CERT = os.path.join(CERT_DIR, "client.pem")
KEY = os.path.join(CERT_DIR, "client.key")
CA = os.path.join(CERT_DIR, "ca.pem")
STATUS = os.path.join(CERT_DIR, "renewer-status.json")


def log(msg):
    ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"[kmip-renewer] {ts} {msg}", flush=True)


# ── Certificate inspection (minimal DER walk — no openssl/cryptography) ─────
def _der_tlv(buf, i):
    tag = buf[i]
    length = buf[i + 1]
    i += 2
    if length & 0x80:
        n = length & 0x7F
        length = int.from_bytes(buf[i : i + n], "big")
        i += n
    return tag, i, i + length  # tag, value start, value end


def _der_children(buf, start, end):
    out, i = [], start
    while i < end:
        tag, vs, ve = _der_tlv(buf, i)
        out.append((tag, vs, ve))
        i = ve
    return out


def _der_time(tag, raw):
    s = raw.decode()
    fmt = (
        "%y%m%d%H%M%SZ" if tag == 0x17 else "%Y%m%d%H%M%SZ"
    )  # UTCTime / GeneralizedTime
    return datetime.datetime.strptime(s, fmt).replace(tzinfo=datetime.timezone.utc)


def cert_info(path=CERT):
    """Return (serial 'aa:bb:..', notAfter datetime) for the first cert in a PEM, or None."""
    import base64

    try:
        with open(path) as fh:
            pem = fh.read()
        b64 = pem.split("-----BEGIN CERTIFICATE-----")[1].split(
            "-----END CERTIFICATE-----"
        )[0]
        der = base64.b64decode("".join(b64.split()))
        _, cs, ce = _der_tlv(der, 0)  # Certificate
        _, ts, te = _der_children(der, cs, ce)[0]  # tbsCertificate
        fields = _der_children(der, ts, te)
        if fields[0][0] == 0xA0:  # explicit [0] version
            fields = fields[1:]
        _, ss, se = fields[0]  # serialNumber
        serial_bytes = der[ss:se].lstrip(b"\x00") or b"\x00"
        serial = ":".join(f"{b:02x}" for b in serial_bytes)
        _, vs, ve = fields[3]  # validity
        not_after_tag, nas, nae = _der_children(der, vs, ve)[1]
        return serial, _der_time(not_after_tag, der[nas:nae])
    except (OSError, IndexError, ValueError):
        return None


def seconds_left(not_after):
    return (not_after - datetime.datetime.now(datetime.timezone.utc)).total_seconds()


# ── Vault HTTP API ──────────────────────────────────────────────────────────
_ctx = ssl.create_default_context(cafile=VAULT_CACERT)


def vault(method, path, token=None, body=None):
    req = urllib.request.Request(
        f"{VAULT_ADDR}/v1/{path}",
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Content-Type": "application/json",
            **({"X-Vault-Token": token} if token else {}),
        },
    )
    with urllib.request.urlopen(req, context=_ctx, timeout=30) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else {}


def login():
    return vault(
        "POST", "auth/approle/login", body={"role_id": ROLE_ID, "secret_id": SECRET_ID}
    )["auth"]["client_token"]


def _write_atomic(path, data, mode):
    tmp = f"{path}.tmp"
    with open(tmp, "w") as fh:
        fh.write(data)
    os.chmod(tmp, mode)
    os.replace(tmp, path)


def write_status(**fields):
    info = cert_info()
    if info:
        fields.update(serial=info[0], not_after=info[1].isoformat())
    fields["checked_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    try:
        _write_atomic(STATUS, json.dumps(fields, indent=1) + "\n", 0o644)
    except OSError as exc:
        log(f"could not write {STATUS}: {exc}")


def renew(old_serial):
    token = login()
    try:
        data = vault(
            "POST", f"{KMIP_ROLE_PATH}/credential/generate", token, {"format": "pem"}
        )["data"]
        # Key before cert: kmip-client reloads when client.pem changes, so the
        # matching key must already be in place when it does.
        _write_atomic(CA, "\n".join(data["ca_chain"]) + "\n", 0o644)
        _write_atomic(KEY, data["private_key"].rstrip("\n") + "\n", 0o600)
        _write_atomic(CERT, data["certificate"].rstrip("\n") + "\n", 0o644)
        new = cert_info()
        log(
            f"issued new client certificate serial={new[0]} not_after={new[1].isoformat()}"
        )
        if old_serial:
            try:
                vault(
                    "POST",
                    f"{KMIP_ROLE_PATH}/credential/revoke",
                    token,
                    {"serial_number": old_serial},
                )
                log(f"revoked previous credential serial={old_serial}")
            except urllib.error.HTTPError as exc:
                # Already expired/revoked/unknown (e.g. issued before a Vault
                # re-init) — nothing left to clean up.
                log(
                    f"previous credential serial={old_serial} not revoked (HTTP {exc.code}) — fine"
                )
    finally:
        try:
            vault("POST", "auth/token/revoke-self", token)
        except (urllib.error.URLError, OSError):
            pass


def check_once():
    info = cert_info()
    if info is None:
        log(f"no readable client certificate at {CERT} — issuing")
        renew(None)
        return
    serial, not_after = info
    left = seconds_left(not_after)
    if left <= RENEW_BEFORE:
        state = "EXPIRED" if left <= 0 else f"expires in {int(left // 3600)}h"
        log(
            f"client certificate serial={serial} {state} ({not_after.isoformat()}) — renewing"
        )
        renew(serial)
    else:
        log(
            f"client certificate valid until {not_after.isoformat()} "
            f"({left / 86400:.1f} days); renews inside the last {RENEW_BEFORE // 3600}h"
        )


def healthcheck():
    info = cert_info()
    ok = info is not None and seconds_left(info[1]) > 0
    sys.exit(0 if ok else 1)


def main():
    if not ROLE_ID or not SECRET_ID:
        log(
            "KMIP_RENEWER_ROLE_ID / KMIP_RENEWER_SECRET_ID missing — run `make workload-credentials-issue`"
        )
        sys.exit(1)
    log(
        f"starting (vault={VAULT_ADDR} role={KMIP_ROLE_PATH} renew_before={RENEW_BEFORE}s interval={CHECK_INTERVAL}s)"
    )
    while True:
        try:
            vault("GET", "sys/health?standbyok=true&perfstandbyok=true")
            check_once()
            write_status(state="ok")
            time.sleep(CHECK_INTERVAL)
        except (urllib.error.URLError, OSError, KeyError, ValueError) as exc:
            log(
                f"WARNING: renewal check failed ({type(exc).__name__}: {exc}); retrying in {RETRY_SECONDS}s"
            )
            write_status(state="error", error=f"{type(exc).__name__}: {exc}")
            time.sleep(RETRY_SECONDS)


if __name__ == "__main__":
    if "--check" in sys.argv:
        healthcheck()
    main()
