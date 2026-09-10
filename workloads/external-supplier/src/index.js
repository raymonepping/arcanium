// index.js — external-supplier workload.
// Demonstrates Vault Enterprise Control Groups (four-eyes on Transit encrypt).
//
// Flow per cycle:
//  1. POST transit/encrypt/<key> → Vault returns wrap_info (accessor + token)
//  2. Register accessor in Arcanium API (POST /api/v1/approvals)
//  3. Poll Arcanium API until status === 'approved'
//  4. POST sys/wrapping/unwrap with wrapping token → get ciphertext
//  5. Log success, sleep CYCLE_INTERVAL_MS, repeat

import { createServer, request as httpRequest } from "node:http";
import { init, getToken, vaultRequest, sleep } from "./vault.js";
import config from "./config.js";

// ── Health server ────────────────────────────────────────────────────────────
const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
  } else {
    res.writeHead(404);
    res.end();
  }
});
server.listen(3005, () =>
  console.log("[external-supplier] health server on :3005"),
);

// ── Arcanium API client (plain HTTP — internal network, no TLS needed) ───────
function arcaniumRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, config.arcaniumApi);
    const data = body ? JSON.stringify(body) : null;
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname + url.search,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString();
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const err = new Error(
              `Arcanium ${method} ${path} → ${res.statusCode}: ${text}`,
            );
            err.arcaniumStatus = res.statusCode;
            return reject(err);
          }
          try {
            resolve(JSON.parse(text));
          } catch {
            resolve(text);
          }
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// ── Prompt 15.4 — report liveness to the integration channel registry ────────
async function heartbeat() {
  try {
    await arcaniumRequest(
      "POST",
      "/api/v1/integrations/external-supplier/heartbeat",
    );
  } catch {
    /* registry optional — never block the workload */
  }
}

// Prompt 16.4 — how many of our own pending requests before we stop making more.
// A blocked-on-approval workload is healthy; it should not flood the queue.
const MAX_OWN_PENDING = 3;

async function ownPendingCount() {
  try {
    const list = await arcaniumRequest("GET", "/api/v1/approvals?all=true");
    return Array.isArray(list)
      ? list.filter(
          (r) => r.requester === "external-supplier" && r.status === "pending",
        ).length
      : 0;
  } catch {
    return 0;
  }
}

// ── One approval cycle ────────────────────────────────────────────────────────
async function runCycle() {
  const pending = await ownPendingCount();
  if (pending >= MAX_OWN_PENDING) {
    console.log(
      `[external-supplier] ${pending} of our approval requests still pending (≥ ${MAX_OWN_PENDING}) — idling, not creating more`,
    );
    return;
  }
  const token = getToken();
  const payload = Buffer.from(
    JSON.stringify({ message: "invoice-data", ts: Date.now() }),
  ).toString("base64");

  // Step 1: attempt encrypt.
  // If Vault Enterprise Control Groups are licensed, Vault returns wrap_info.
  // If Control Groups are not available (standard Ent license), the encrypt
  // succeeds directly — we still demonstrate the Arcanium approval flow.
  let encRes;
  try {
    encRes = await vaultRequest(
      "POST",
      `transit/encrypt/${config.transitKey}`,
      { plaintext: payload },
      token,
    );
  } catch (err) {
    // 400 "control group feature not enabled" — Vault accepted the policy but
    // can't enforce the CG gate. Fall through to Arcanium-only approval demo.
    if (err.vaultStatus === 400 && err.message.includes("control group")) {
      console.warn(
        `[external-supplier] Control Group not licensed — running Arcanium-only approval flow`,
      );
      encRes = { _cgUnavailable: true };
    } else {
      console.error(
        `[external-supplier] encrypt attempt failed: ${err.message}`,
      );
      return;
    }
  }

  let wrappingToken = null;
  let accessor = null;
  let ciphertextDirect = null;

  if (encRes._cgUnavailable) {
    // Vault CG not available: generate a synthetic accessor for the demo record
    accessor = `demo-${Date.now()}`;
    console.log(
      `[external-supplier] Arcanium governance flow (no Vault CG gate) — accessor: ${accessor}`,
    );
  } else if (encRes.wrap_info) {
    // Vault CG gate active — classic wrap_info path
    wrappingToken = encRes.wrap_info.token;
    accessor = encRes.wrap_info.accessor;
    console.log(
      `[external-supplier] Vault Control Group gate — accessor: ${accessor}`,
    );
  } else {
    // Direct encrypt (policy has no CG block) — still demonstrate Arcanium approval
    ciphertextDirect = encRes.data?.ciphertext;
    accessor = `direct-${Date.now()}`;
    console.log(
      `[external-supplier] Direct encrypt (no CG policy) — demonstrating Arcanium approval flow`,
    );
  }

  // Step 2: register approval request in Arcanium API
  let record;
  try {
    record = await arcaniumRequest("POST", "/api/v1/approvals", {
      app_id: config.arcaniumAppId,
      key_name: config.transitKey,
      action: "encrypt",
      requester: "external-supplier",
      accessor,
    });
    console.log(
      `[external-supplier] Registered approval request id=${record.id}`,
    );
  } catch (err) {
    if (err.arcaniumStatus === 409) {
      // Already registered — look up existing record
      const list = await arcaniumRequest("GET", "/api/v1/approvals");
      record = list.find((r) => r.accessor === accessor);
      if (!record) {
        console.error("[external-supplier] Could not find pending record");
        return;
      }
      console.log(
        `[external-supplier] Found existing pending record id=${record.id}`,
      );
    } else {
      console.error(
        `[external-supplier] Failed to register approval: ${err.message}`,
      );
      return;
    }
  }

  // Step 3: poll Arcanium API for approval
  console.log(`[external-supplier] Awaiting approval (id=${record.id})...`);
  const deadline = Date.now() + 25 * 60 * 1000; // 25 min
  while (Date.now() < deadline) {
    await sleep(config.pollIntervalMs);
    const list = await arcaniumRequest(
      "GET",
      "/api/v1/approvals?all=true",
    ).catch(() => []);
    const current = list.find((r) => r.id === record.id);
    if (!current) {
      console.warn("[external-supplier] Record disappeared");
      return;
    }

    if (current.status === "rejected") {
      console.log(`[external-supplier] Approval denied — aborting cycle`);
      return;
    }

    if (current.status === "approved") {
      // Step 4: unwrap if we have a Vault CG token, otherwise use direct ciphertext
      if (wrappingToken) {
        try {
          const unwrapped = await vaultRequest(
            "POST",
            "sys/wrapping/unwrap",
            null,
            wrappingToken,
          );
          const ct = unwrapped.data?.ciphertext ?? JSON.stringify(unwrapped);
          console.log(
            `[external-supplier] Approval granted. Vault CG unwrapped: ${ct.slice(0, 60)}...`,
          );
        } catch (err) {
          console.error(`[external-supplier] Unwrap failed: ${err.message}`);
        }
      } else if (ciphertextDirect) {
        console.log(
          `[external-supplier] Approval granted. Ciphertext: ${ciphertextDirect.slice(0, 60)}...`,
        );
      } else {
        // CG unavailable — re-encrypt now that approval is recorded
        try {
          const retryRes = await vaultRequest(
            "POST",
            `transit/encrypt/${config.transitKey}`,
            { plaintext: payload },
            token,
          );
          const ct = retryRes.data?.ciphertext ?? "(unavailable)";
          console.log(
            `[external-supplier] Approval granted (Arcanium flow). Encrypted: ${ct.slice(0, 60)}...`,
          );
        } catch (err) {
          console.log(
            `[external-supplier] Approval granted (Arcanium flow). Post-approval encrypt: ${err.message}`,
          );
        }
      }
      return;
    }
  }
  console.warn(
    `[external-supplier] Approval timeout after 25 min — abandoning accessor ${accessor}`,
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[external-supplier] starting (key=${config.transitKey})`);
  await init();
  console.log("[external-supplier] Vault authenticated");

  // Serialize cycles — only one cycle runs at a time.
  // setInterval fires every CYCLE_INTERVAL_MS but skips if a cycle is still running,
  // preventing an ever-growing backlog of pending approval records.
  let cycleRunning = false;

  async function runCycleSafe() {
    if (cycleRunning) {
      console.log(
        "[external-supplier] previous cycle still running — skipping interval tick",
      );
      return;
    }
    cycleRunning = true;
    try {
      await runCycle();
    } catch (err) {
      console.error(`[external-supplier] cycle error: ${err.message}`);
    } finally {
      cycleRunning = false;
    }
  }

  // Prompt 16.4 — the heartbeat is INDEPENDENT of the work cycle. A cycle can
  // block for a long time awaiting a four-eyes approval; that must not make the
  // integration channel look "degraded". Report liveness every 30s regardless.
  heartbeat();
  setInterval(heartbeat, 30_000);

  // Run first cycle immediately, then on interval
  await runCycleSafe();

  setInterval(runCycleSafe, config.cycleIntervalMs);

  process.on("SIGTERM", () => {
    console.log("[external-supplier] shutdown");
    server.close(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error("[external-supplier] fatal:", err.message);
  process.exit(1);
});
