// routes/platform.js — Prompt 14.3 / 14.4 — Vault entitlement reporting.
// The UI and the maturity engine use this to represent licence-gated
// capabilities honestly (available / not licensed) instead of guessing.

import { Router } from "express";
import { vaultRequest, getProvisionerToken } from "../vault.js";

export const platformRouter = Router();

let cache = null;
let cacheAt = 0;

async function readFeatures() {
  if (cache && Date.now() - cacheAt < 60000) return cache;
  try {
    const res = await vaultRequest(
      "GET",
      "sys/license/status",
      null,
      getProvisionerToken(),
    );
    const auto = res?.data?.autoloaded ?? {};
    const features = auto.features ?? auto.license?.features ?? [];
    cache = {
      features,
      expiration: auto.expiration_time ?? auto.license?.expiration_time ?? null,
      capabilities: {
        managed_keys: features.includes("HSM"),
        sentinel: features.includes("Sentinel"),
        key_management_engine: features.includes(
          "Key Management Secrets Engine",
        ),
        control_groups: features.includes("Control Groups"),
        kmip: features.includes("KMIP"),
        namespaces: features.includes("Namespaces"),
      },
      source: "vault:sys/license/status",
      checkedAt: new Date().toISOString(),
    };
    cacheAt = Date.now();
  } catch {
    cache = {
      features: [],
      capabilities: {},
      source: "unavailable",
      error:
        "Could not read sys/license/status (no provisioner token or permission).",
      checkedAt: new Date().toISOString(),
    };
    cacheAt = Date.now();
  }
  return cache;
}

// GET /api/v1/platform/entitlements
platformRouter.get("/entitlements", async (_req, res, next) => {
  try {
    res.json(await readFeatures());
  } catch (err) {
    next(err);
  }
});

export { readFeatures };
