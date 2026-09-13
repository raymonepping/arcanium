// reconciliation/observe.js — Prompt 20.
//
// Observed state is ALWAYS a live read from Vault at reconciliation time —
// never assumed from the desired-state row itself, never cached without an
// explicit displayed age. On any failure to reach/parse Vault, the result is
// `status: 'UNKNOWN'` — never silently treated as COMPLIANT or DRIFTED
// (input/03 §8, input/32).

import { vaultRequest, vaultRequestNs, getProvisionerToken } from "../vault.js";

const SECONDS_PER_DAY = 86400;

/**
 * Live-reads a Transit key's `auto_rotate_period` (Vault returns this in
 * seconds) and normalizes it to the same `{ days }` shape desired_state
 * stores, so the two are directly diffable/displayable without a second
 * conversion step at the call site.
 *
 * @param {string} vaultPath  e.g. 'transit/keys/payments-api-key' (from
 *   crypto_profiles.vault_path — the one place Arcanium already records
 *   which Transit key backs an application, Prompt 14.2).
 * @param {string|null} namespace  supplier's vault_namespace, or null for
 *   root-namespace applications.
 */
export async function observeRotationPeriod(vaultPath, namespace = null) {
  const observed_at = new Date().toISOString();
  if (!vaultPath) {
    return {
      value: null,
      status: "UNKNOWN",
      detail: "no Transit key on record for this application (crypto_profiles)",
      observed_at,
      source: "vault-live",
    };
  }
  try {
    const res = namespace
      ? await vaultRequestNs(
          "GET",
          vaultPath,
          null,
          getProvisionerToken(),
          namespace,
        )
      : await vaultRequest("GET", vaultPath, null, getProvisionerToken());
    const seconds = Number(res?.data?.auto_rotate_period ?? 0);
    // Prompt 38 — previously reported only the CONFIGURED period, never
    // whether the key has actually rotated recently. Vault's own
    // auto-rotation is real and server-side, but nothing here would
    // ever notice if it silently stopped, or if the configured value
    // weren't actually in effect despite reading back correctly.
    // latest_version_creation_time lets compareRotationPeriod() (diff.js)
    // check the real age of the current version against the desired
    // period, not just whether the config field matches.
    // Found live while verifying this fix: Vault's own per-version entry
    // shape differs by key type — a symmetric key's (aes256-gcm96) is a
    // bare creation-time epoch NUMBER (seconds), never an object at all;
    // only an asymmetric/managed key's is `{ creation_time, ... }`. The
    // same quirk publicKeyOf() (routes/keys.js) and the key detail
    // page's versionList already have to handle for the same reason.
    const latestVersion = String(res?.data?.latest_version ?? "");
    const latestVersionEntry = res?.data?.keys?.[latestVersion];
    const latestVersionCreationTime =
      typeof latestVersionEntry === "number"
        ? new Date(latestVersionEntry * 1000).toISOString()
        : (latestVersionEntry?.creation_time ?? null);
    return {
      value: {
        days: seconds / SECONDS_PER_DAY,
        latest_version_creation_time: latestVersionCreationTime,
      },
      status: "OK",
      observed_at,
      source: "vault-live",
    };
  } catch (err) {
    // Prompt 38 — a 404 (key destroyed) previously fell through to
    // UNKNOWN here, indistinguishable from "Vault unreachable" — unlike
    // observeExpiryDate(), which already treats a 404 as a real,
    // positively-observed outcome. A destroyed key has no rotation
    // obligation left to violate; report that as a known fact
    // (compareRotationPeriod treats active:false as COMPLIANT), not a
    // permanent UNKNOWN limbo.
    if (err.vaultStatus === 404) {
      return {
        value: { days: null, active: false },
        status: "OK",
        observed_at,
        source: "vault-live",
      };
    }
    // Vault unreachable, namespace boundary denial, etc. — collapse to
    // UNKNOWN, never a guessed status.
    return {
      value: null,
      status: "UNKNOWN",
      detail: err.message,
      observed_at,
      source: "vault-live",
    };
  }
}

/**
 * Prompt 28, Deliverable 5 — live-reads whether a Transit key still exists
 * (Vault has no separate "active" flag; a destroyed key is simply gone).
 * A 404 specifically means "destroyed" (a real, known outcome — never
 * treated as UNKNOWN, unlike an actual Vault-unreachable/auth failure).
 *
 * @param {string} vaultPath  e.g. 'transit/keys/payments-api-key'
 * @param {string|null} namespace  supplier's vault_namespace, or null for root.
 */
export async function observeExpiryDate(vaultPath, namespace = null) {
  const observed_at = new Date().toISOString();
  if (!vaultPath) {
    return {
      value: null,
      status: "UNKNOWN",
      detail: "no Transit key on record for this application (crypto_profiles)",
      observed_at,
      source: "vault-live",
    };
  }
  try {
    if (namespace) {
      await vaultRequestNs(
        "GET",
        vaultPath,
        null,
        getProvisionerToken(),
        namespace,
      );
    } else {
      await vaultRequest("GET", vaultPath, null, getProvisionerToken());
    }
    return {
      value: { active: true, observed_date: observed_at.slice(0, 10) },
      status: "OK",
      observed_at,
      source: "vault-live",
    };
  } catch (err) {
    if (err.vaultStatus === 404) {
      // Destroyed — a real, positively-observed outcome, not an unreachable read.
      return {
        value: { active: false, observed_date: observed_at.slice(0, 10) },
        status: "OK",
        observed_at,
        source: "vault-live",
      };
    }
    return {
      value: null,
      status: "UNKNOWN",
      detail: err.message,
      observed_at,
      source: "vault-live",
    };
  }
}

/**
 * Writes the desired rotation period back to Vault (the "reconcile" side
 * effect) — POST transit/keys/:name/config, same duration-string convention
 * provisioner/application.js already uses at key-creation time.
 */
export async function applyRotationPeriod(vaultPath, days, namespace = null) {
  const body = { auto_rotate_period: `${Number(days) * 24}h` };
  if (namespace) {
    await vaultRequestNs(
      "POST",
      `${vaultPath}/config`,
      body,
      getProvisionerToken(),
      namespace,
    );
  } else {
    await vaultRequest(
      "POST",
      `${vaultPath}/config`,
      body,
      getProvisionerToken(),
    );
  }
}
