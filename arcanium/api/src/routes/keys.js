// routes/keys.js — Transit key inventory and creation.

import { Router } from "express";
import {
  listTransitKeys,
  getTransitKey,
  createTransitKey,
  listHsmTransitKeys,
  getHsmTransitKey,
} from "../vault.js";
import { createJob, runOrQueue } from "../provisioner/steps.js";
import {
  rotateKey,
  rewrapCiphertext,
  requestKeyDestroy,
} from "../provisioner/key.js";
import { authorize } from "../auth/authorize.js";

export const keysRouter = Router();

const KEY_NAME_RE = /^[a-z0-9_-]{1,128}$/i;

// Derive a human custody label without inferring from the key name.
// Exported for reuse by aggregation/intent.js (Prompt 25) — one custody
// derivation, not a second copy.
export function custodyOf(meta) {
  if (meta?._managedKey || meta?.type === "managed_key")
    return "SoftHSM (PKCS#11 Managed Key)";
  if (meta?.exportable === true) return "Vault Transit · exportable";
  return "Vault Transit (software)";
}

function projectKey(name, meta) {
  return {
    name,
    type: meta.type,
    versions: meta.latest_version,
    latest_version: meta.latest_version,
    exportable: meta.exportable,
    deletion_allowed: meta.deletion_allowed,
    auto_rotate_period: meta.auto_rotate_period,
    supports_encryption: meta.supports_encryption,
    supports_decryption: meta.supports_decryption,
    supports_signing: meta.supports_signing,
    supports_derivation: meta.supports_derivation,
    min_decryption_version: meta.min_decryption_version,
    min_encryption_version: meta.min_encryption_version,
    custody: custodyOf(meta),
    hsm_backed: Boolean(meta._managedKey || meta.type === "managed_key"),
    managed_key_name: meta._managedKey?.name ?? null,
  };
}

const ALLOWED_TYPES = new Set([
  "aes256-gcm96",
  "rsa-2048",
  "rsa-4096",
  "ecdsa-p256",
]);
const NAME_RE = /^[a-z0-9_-]{1,128}$/i;

// GET /api/v1/keys
// Merges the primary cluster's transit keys with vault-hsm's Managed Keys.
// On a name collision the HSM-backed key wins (higher custody assurance).
keysRouter.get("/", async (_req, res, next) => {
  try {
    const [names, hsmNames] = await Promise.all([
      listTransitKeys(),
      listHsmTransitKeys(),
    ]);
    const byName = new Map();

    for (const name of names) {
      try {
        byName.set(name, projectKey(name, await getTransitKey(name)));
      } catch {
        byName.set(name, {
          name,
          type: "unknown",
          versions: null,
          min_decryption_version: null,
          custody: "Unavailable",
        });
      }
    }
    for (const name of hsmNames) {
      try {
        byName.set(name, projectKey(name, await getHsmTransitKey(name)));
      } catch {
        /* keep whatever the primary cluster had, if any */
      }
    }
    res.json([...byName.values()]);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/keys/:name
keysRouter.get("/:name", async (req, res, next) => {
  const { name } = req.params;
  try {
    const meta = await getTransitKey(name);
    return res.json({ ...meta, custody: custodyOf(meta) });
  } catch (primaryErr) {
    // Not on the primary cluster — try vault-hsm (Managed Key custody).
    try {
      const meta = await getHsmTransitKey(name);
      return res.json({
        ...meta,
        custody: custodyOf(meta),
        hsm_backed: true,
        managed_key_name: meta._managedKey?.name ?? null,
      });
    } catch {
      if (primaryErr.vaultStatus === 404) {
        const e = new Error("key not found");
        e.status = 404;
        return next(e);
      }
      return next(primaryErr);
    }
  }
});

// POST /api/v1/keys
// Prompt 22, Deliverable 4 — found live by the architecture fitness test's
// authorize()-coverage check: this route had no role check at all. Creates
// a bare root-namespace Transit key outside the application/provisioning
// flow, so it's estate-wide 'provision' with no tenant — a supplier-admin
// (whose 'provision' is 'limited' and always denies without a tenant) is
// correctly denied; the tenant-scoped path for a supplier-admin's own
// application keys is POST /applications/:id/provision, not this route.
keysRouter.post("/", async (req, res, next) => {
  try {
    const decision = authorize({ identity: req.identity, action: "provision" });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "provision",
        reason: decision.reason,
      });
    const { name, type = "aes256-gcm96" } = req.body ?? {};
    if (!name)
      return res.status(400).json({ error: "name is required", field: "name" });
    if (!NAME_RE.test(name))
      return res.status(400).json({ error: "invalid key name", field: "name" });
    if (!ALLOWED_TYPES.has(type))
      return res.status(400).json({
        error: `type must be one of: ${[...ALLOWED_TYPES].join(", ")}`,
        field: "type",
      });

    const result = await createTransitKey(name, type);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/keys/:name/rotate — Prompt 14.2
keysRouter.post("/:name/rotate", async (req, res, next) => {
  try {
    const { name } = req.params;
    if (!KEY_NAME_RE.test(name))
      return res.status(400).json({ error: "invalid key name" });
    const decision = authorize({ identity: req.identity, action: "rotate" });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "rotate",
        reason: decision.reason,
      });
    const job = await createJob({
      target_type: "key",
      target_id: name,
      target_name: name,
      action: "rotate",
      requested_by: req.identity?.user ?? "arcanium",
      request_id: req.requestId,
    });
    const finished = await runOrQueue(job, (j) => rotateKey(j, name));
    res
      .status(
        finished.queued ? 202 : finished.status === "succeeded" ? 200 : 502,
      )
      .json({ provisioning_job: finished });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/keys/:name/rewrap — Prompt 14.2 — CIPHERTEXT ONLY, operator-gated.
keysRouter.post("/:name/rewrap", async (req, res, next) => {
  try {
    const { name } = req.params;
    if (!KEY_NAME_RE.test(name))
      return res.status(400).json({ error: "invalid key name" });
    // Rewrap is operator-only per the Phase 18 authorization matrix — NOT
    // architect (the previous inline check incorrectly allowed both; that
    // was a real gap, not a stylistic difference — see
    // scenarios/11_security_foundation/test_negative_auth.sh).
    const decision = authorize({ identity: req.identity, action: "rewrap" });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "rewrap",
        reason: decision.reason,
      });
    const ciphertext = (req.body ?? {}).ciphertext;
    const rewrapped = await rewrapCiphertext(name, ciphertext);
    res.json({ ciphertext: rewrapped });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// POST /api/v1/keys/:name/destroy — Prompt 14.2 — governance-gated, returns 202.
keysRouter.post("/:name/destroy", async (req, res, next) => {
  try {
    const { name } = req.params;
    if (!KEY_NAME_RE.test(name))
      return res.status(400).json({ error: "invalid key name" });
    const decision = authorize({
      identity: req.identity,
      action: "destroy_request",
    });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "destroy_request",
        reason: decision.reason,
      });
    const approval = await requestKeyDestroy(
      name,
      req.identity?.user ?? "arcanium-operator",
    );
    res.status(202).json({
      approval,
      message:
        "Destroy request recorded. The key is deleted only after the approval is resolved (and the Vault Control Group authorized where the key's namespace policy requires it). This does not itself authorize a Vault operation.",
    });
  } catch (err) {
    if (err.status === 409) return res.status(409).json({ error: err.message });
    next(err);
  }
});
