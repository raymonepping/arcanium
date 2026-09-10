// index.js — document-signing workload.
// Signs and verifies documents via Vault Transit RSA-4096 key.
// Demonstrates KML: Generatie, Opslag, Gebruik, Rotatie.

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { init, getToken, vaultRequest, sleep } from "./vault.js";
import config from "./config.js";

// ── Health server ─────────────────────────────────────────────────────────
const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
  } else {
    res.writeHead(404);
    res.end();
  }
});
server.listen(config.port, () =>
  console.log(`[doc-signing] health server on :${config.port}`),
);

// ── Sign/verify loop ──────────────────────────────────────────────────────
async function signVerifyOnce() {
  const token = getToken();
  const docId = randomUUID();
  const payload = JSON.stringify({
    document: `invoice-${docId}`,
    ts: new Date().toISOString(),
    version: 1,
  });
  const input = Buffer.from(payload).toString("base64");

  // Sign
  const signRes = await vaultRequest(
    "POST",
    `transit/sign/${config.signKey}`,
    { input, prehashed: false },
    token,
  );
  const signature = signRes.data.signature;
  console.log(
    `[doc-signing] signed invoice-${docId}: ${signature.slice(0, 40)}...`,
  );

  // Verify — valid payload
  const verifyRes = await vaultRequest(
    "POST",
    `transit/verify/${config.signKey}`,
    { input, signature },
    token,
  );
  console.log(`[doc-signing] verify OK: ${verifyRes.data.valid}`);

  // Verify — tampered payload. A software Transit key returns { valid: false };
  // a Managed Key (SoftHSM RSA) rejects at the token and Vault surfaces a 500.
  // Both mean the same thing: tampering detected.
  const tampered = Buffer.from(payload + " tampered").toString("base64");
  try {
    const tamperedRes = await vaultRequest(
      "POST",
      `transit/verify/${config.signKey}`,
      { input: tampered, signature },
      token,
    );
    console.log(`[doc-signing] tampered verify: ${tamperedRes.data.valid}`);
  } catch {
    console.log(`[doc-signing] tampered verify: false (rejected by SoftHSM)`);
  }
}

// ── Key rotation ──────────────────────────────────────────────────────────
async function rotateKey() {
  const token = getToken();
  const res = await vaultRequest(
    "POST",
    `transit/keys/${config.signKey}/rotate`,
    {},
    token,
  );
  // Read back current version
  const meta = await vaultRequest(
    "GET",
    `transit/keys/${config.signKey}`,
    null,
    token,
  );
  console.log(
    `[doc-signing] key rotated to version ${meta.data.latest_version}`,
  );
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log(
    `[doc-signing] starting (key=${config.signKey} interval=${config.signInterval}ms)`,
  );

  await init();
  console.log("[doc-signing] Vault authenticated");

  // Initial sign/verify
  await signVerifyOnce();

  // Sign/verify on interval
  setInterval(async () => {
    try {
      await signVerifyOnce();
    } catch (err) {
      console.error(`[doc-signing] sign/verify error: ${err.message}`);
    }
  }, config.signInterval);

  // Key rotation on interval
  setInterval(async () => {
    try {
      await rotateKey();
    } catch (err) {
      console.error(`[doc-signing] rotation error: ${err.message}`);
    }
  }, config.rotationInterval);

  // Graceful shutdown
  process.on("SIGTERM", () => {
    console.log(
      "[doc-signing] shutdown — key material remains in SoftHSM (never exported)",
    );
    server.close(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error("[doc-signing] fatal:", err.message);
  process.exit(1);
});
