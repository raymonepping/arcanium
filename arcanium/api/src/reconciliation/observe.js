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
    return {
      value: { days: seconds / SECONDS_PER_DAY },
      status: "OK",
      observed_at,
      source: "vault-live",
    };
  } catch (err) {
    // Vault unreachable, key deleted underneath us, namespace boundary
    // denial, etc. — all collapse to UNKNOWN, never a guessed status.
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
