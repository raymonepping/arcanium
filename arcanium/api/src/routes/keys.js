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
import { query } from "../db.js";

export const keysRouter = Router();

// Prompt 27, Deliverable 3 — these routes operate on a bare Vault key name,
// with no application_id in the URL, so resolving the owning application's
// tenant/environment needs a join through crypto_profiles (vault_path's
// trailing segment is the key name). Found live while wiring this in: these
// three routes previously passed NO tenant at all — meaning a
// supplier-admin's 'limited' verdict on rotate/destroy_request could never
// succeed even for their own tenant's key (the same missing-tenant-param
// bug already fixed elsewhere in Prompts 18/19). Resolving it here fixes
// that gap as a direct byproduct of adding the env lookup this prompt
// requires, not a separate, deferred fix.
async function ownerOfKey(name) {
  const { rows } = await query(
    `SELECT s.vault_namespace, a.environment
       FROM crypto_profiles cp
       JOIN applications a ON a.id = cp.application_id
       LEFT JOIN suppliers s ON s.id = a.supplier_id
      WHERE cp.vault_path LIKE '%/' || $1
      LIMIT 1`,
    [name],
  );
  return rows[0] ?? null; // null = key exists in Vault but isn't tracked by any crypto_profile
}

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

// The only kind of "key material" this API ever exposes: the PUBLIC half
// of an asymmetric key's latest version — never a symmetric key (no public
// half exists) and never a private/symmetric key byte, regardless of
// `exportable`. Every key in this deployment is created with
// exportable=false (see terraform/*/transit.tf, keys.tf); this function
// does not depend on that flag at all — it only ever returns what Vault's
// own metadata read already includes, the same way GET /api/v1/pki/ca-chain
// already exposes public CA material.
//
// Deliberately NOT a check against meta.type — found live, the hard way:
// an HSM-backed Managed Key reports type: "managed_key", not "rsa-4096"
// (the underlying algorithm is only visible nested under _managedKey), so
// an rsa-/ecdsa-/ed25519 type-string allowlist silently excludes exactly
// the one key (document-signing-key) this feature was built for. Vault's
// own response shape is the real, more robust signal: a symmetric key's
// `keys.<version>` entry is a bare creation-time number (not an object at
// all — `{"1": 1789290060}`); an asymmetric OR managed key's is an object
// with a real public_key PEM string. Checking for that string's actual
// presence is correct by construction for every current and future key
// type, not a list this code has to keep in sync with Vault's own types.
export function publicKeyOf(meta) {
  const version = String(meta?.latest_version ?? "");
  const pem = meta?.keys?.[version]?.public_key;
  return typeof pem === "string" && pem.trim() ? pem : null;
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
    // Prompt 31 — the public half of an asymmetric key only; null for
    // every symmetric key (aes256-gcm96), which has no public half at
    // all. See publicKeyOf()'s own header comment for what this
    // deliberately never includes.
    has_public_key: publicKeyOf(meta) !== null,
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

// Resolves ONE key's metadata with the same precedence as GET /api/v1/keys
// (the list route, above): vault-hsm wins on a name collision.
//
// Prompt 31 — found live, the hard way: GET /:name previously tried the
// primary cluster FIRST and only consulted vault-hsm on outright failure,
// which is backwards for document-signing-key specifically — a legacy,
// unused RSA-4096 Transit key of that same name still exists on the
// primary cluster (superseded by Prompt 14.1, deliberately left in place,
// deletion_allowed=false — see terraform/vault-workloads/transit.tf's own
// comment), so the primary-cluster lookup always SUCCEEDED and the real,
// in-use HSM-backed Managed Key was never consulted at all. The detail
// page showed "Vault Transit (software)" custody for a key that is
// actually SoftHSM-backed — a real, live governance-accuracy bug, not
// hypothetical: confirmed by comparing the two calls' actual public keys,
// which are genuinely different key material. Fixed by trying vault-hsm
// first, matching the list route's own already-correct "HSM wins"
// precedence — one resolution order, not two independently-drifting ones.
export async function resolveKeyMeta(name) {
  try {
    const meta = await getHsmTransitKey(name);
    return {
      ...meta,
      custody: custodyOf(meta),
      hsm_backed: true,
      managed_key_name: meta._managedKey?.name ?? null,
    };
  } catch (hsmErr) {
    try {
      const meta = await getTransitKey(name);
      return { ...meta, custody: custodyOf(meta) };
    } catch (primaryErr) {
      if (primaryErr.vaultStatus === 404 && hsmErr.vaultStatus === 404) {
        const e = new Error("key not found");
        e.status = 404;
        throw e;
      }
      throw primaryErr;
    }
  }
}

// GET /api/v1/keys/:name
keysRouter.get("/:name", async (req, res, next) => {
  try {
    const meta = await resolveKeyMeta(req.params.name);
    res.json(meta);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/keys/:name/public-key — Prompt 31.
//
// The only "download key material" this API will ever offer: the PUBLIC
// half of an asymmetric key, as a real file download. Never the private
// key, never a symmetric key's bytes — publicKeyOf() enforces that
// regardless of what's asked for; a symmetric key (or an asymmetric key
// with no public_key present) is a 404 here, not an empty/error response
// that could be mistaken for "this key just happens to have no key".
keysRouter.get("/:name/public-key", async (req, res, next) => {
  const { name } = req.params;
  if (!KEY_NAME_RE.test(name))
    return res.status(400).json({ error: "invalid key name" });

  let meta;
  try {
    meta = await resolveKeyMeta(name);
  } catch (err) {
    return next(err);
  }

  const pem = publicKeyOf(meta);
  if (!pem) {
    const e = new Error(
      "no public key available — this key is symmetric, or has no exported public component",
    );
    e.status = 404;
    return next(e);
  }
  res
    .set("Content-Type", "application/x-pem-file")
    .set("Content-Disposition", `attachment; filename="${name}-public.pem"`)
    .send(pem);
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
    const owner = await ownerOfKey(name);
    const decision = authorize({
      identity: req.identity,
      action: "rotate",
      tenant: owner?.vault_namespace ?? null,
      env: owner?.environment ?? null,
    });
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
    const owner = await ownerOfKey(name);
    const decision = authorize({
      identity: req.identity,
      action: "rewrap",
      tenant: owner?.vault_namespace ?? null,
      env: owner?.environment ?? null,
    });
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
    const owner = await ownerOfKey(name);
    const decision = authorize({
      identity: req.identity,
      action: "destroy_request",
      tenant: owner?.vault_namespace ?? null,
      env: owner?.environment ?? null,
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
