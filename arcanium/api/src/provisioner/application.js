// provisioner/application.js — Prompt 14.2
// POST /api/v1/applications/:id/provision — workload identity + least-privilege
// policy + application Transit key. Runs in the root namespace (root-level apps)
// unless the application is bound to a supplier, in which case the supplier's
// namespace is used.

import { vaultRequest, vaultRequestNs, getProvisionerToken } from "../vault.js";
import { query } from "../db.js";
import { runSteps } from "./steps.js";
import { upsertDesiredState } from "../reconciliation/desiredState.js";

const KEY_TYPES = new Set(["aes256-gcm96", "rsa-4096", "ecdsa-p256"]);

export async function provisionApplication(job, app, opts = {}) {
  const capabilities =
    Array.isArray(opts.capabilities) && opts.capabilities.length
      ? opts.capabilities
      : ["encrypt"];
  const keyType = KEY_TYPES.has(opts.key_type) ? opts.key_type : "aes256-gcm96";
  const rotationDays = Number.isFinite(opts.rotation_days)
    ? opts.rotation_days
    : null;

  // Namespace: supplier's if bound, else root.
  let ns = null;
  if (app.supplier_id) {
    const { rows } = await query(
      "SELECT vault_namespace FROM suppliers WHERE id=$1",
      [app.supplier_id],
    );
    ns = rows[0]?.vault_namespace?.replace(/^\/+|\/+$/g, "") ?? null;
  }
  const req = (m, p, b) =>
    ns
      ? vaultRequestNs(m, p, b, getProvisionerToken(), ns)
      : vaultRequest(m, p, b, getProvisionerToken());

  const keyName = `${app.name}-key`;
  const policyName = `${app.name}-workload`;
  const roleName = `${app.name}-workload`;

  // Prompt 15.1 — TLS/X.509 requirement adds a PKI role (root-namespace pki-int).
  const wantsTls = opts.tls === true;
  const pkiRole = `${app.name}-tls`;

  const capPaths = [];
  if (capabilities.includes("encrypt"))
    capPaths.push(
      `path "transit/encrypt/${keyName}" { capabilities = ["update"] }`,
    );
  if (capabilities.includes("decrypt"))
    capPaths.push(
      `path "transit/decrypt/${keyName}" { capabilities = ["update"] }`,
    );
  if (capabilities.includes("sign"))
    capPaths.push(
      `path "transit/sign/${keyName}" { capabilities = ["update"] }`,
    );
  if (capabilities.includes("verify"))
    capPaths.push(
      `path "transit/verify/${keyName}" { capabilities = ["update"] }`,
    );
  capPaths.push(`path "transit/keys/${keyName}" { capabilities = ["read"] }`);
  if (wantsTls)
    capPaths.push(
      `path "pki-int/issue/${pkiRole}" { capabilities = ["update"] }`,
    );

  // Prompt 37 — closure state shared between a step's own run() and undo(),
  // so a rollback can tell "this run inserted a fresh row" (delete it) apart
  // from "this run updated a pre-existing row" (restore its prior values) —
  // never blindly delete/overwrite something that predates this attempt.
  let pkiProfileInserted = false;
  let cryptoProfilePrior = null;
  let desiredStatePrior = null;

  const steps = [
    {
      name: `transit key ${keyName} (${keyType})`,
      run: async () => {
        const body = { type: keyType };
        if (rotationDays) body.auto_rotate_period = `${rotationDays * 24}h`;
        await req("POST", `transit/keys/${keyName}`, body);
        // Prompt 21 — found live via reconciliation evidence: Vault's key
        // CREATE endpoint only applies auto_rotate_period on a brand-new
        // key; re-provisioning an EXISTING key (e.g. to change rotation
        // policy) silently no-ops on that field, leaving Vault's actual
        // config out of sync with the desired_state Prompt 20 just seeded —
        // real, correctly-detected drift, not a false positive. Always also
        // write /config explicitly so re-provisioning actually converges.
        if (rotationDays) {
          await req("POST", `transit/keys/${keyName}/config`, {
            auto_rotate_period: `${rotationDays * 24}h`,
          });
        }
        return keyName;
      },
      // Prompt 37 — previously force-set deletion_allowed=true
      // unconditionally, then DELETEd, both swallowed with .catch(() =>
      // {}). If the DELETE then failed (Sentinel EGP, Control Group, a
      // transient error), the key survived permanently downgraded to
      // delete-unprotected with zero visibility — the same class of bug
      // Prompt 36 already fixed in approval-execution.js's own destroy
      // path. Read live state first; only flip the flag if it isn't
      // already true; restore it if the delete fails; let a genuine
      // rollback failure surface (steps.js's own rollback-failed logging
      // already handles that honestly) rather than silently swallowing
      // it.
      undo: async () => {
        let wasAlreadyDeletable = false;
        try {
          const meta = await req("GET", `transit/keys/${keyName}`);
          wasAlreadyDeletable = meta?.data?.deletion_allowed === true;
        } catch {
          return; // key isn't even readable — nothing to roll back
        }
        if (!wasAlreadyDeletable) {
          await req("POST", `transit/keys/${keyName}/config`, {
            deletion_allowed: true,
          });
        }
        try {
          await req("DELETE", `transit/keys/${keyName}`);
        } catch (err) {
          if (!wasAlreadyDeletable) {
            await req("POST", `transit/keys/${keyName}/config`, {
              deletion_allowed: false,
            }).catch(() => {});
          }
          throw err;
        }
      },
    },
    {
      name: `policy ${policyName}`,
      run: () =>
        req("POST", `sys/policies/acl/${policyName}`, {
          policy: capPaths.join("\n"),
        }),
      undo: () =>
        req("DELETE", `sys/policies/acl/${policyName}`).catch(() => {}),
    },
    {
      name: `approle ${roleName}`,
      run: () =>
        req("POST", `auth/approle/role/${roleName}`, {
          // "automation" is the Sentinel marker (rotation-from-automation EGP) —
          // a provisioned workload identity may rotate its own key, a human may not.
          token_policies: `${policyName},automation`,
          token_ttl: "1h",
          token_max_ttl: "4h",
        }),
      undo: () =>
        req("DELETE", `auth/approle/role/${roleName}`).catch(() => {}),
    },
    ...(wantsTls
      ? [
          {
            name: `PKI role ${pkiRole}`,
            run: () =>
              // PKI is a root-namespace mount; always use the root client.
              vaultRequest(
                "POST",
                `pki-int/roles/${pkiRole}`,
                {
                  allowed_domains: `${app.name}.arcanium.local`,
                  allow_subdomains: true,
                  max_ttl: "720h",
                  key_type: "rsa",
                  key_bits: 2048,
                },
                getProvisionerToken(),
              ),
            undo: () =>
              vaultRequest(
                "DELETE",
                `pki-int/roles/${pkiRole}`,
                null,
                getProvisionerToken(),
              ).catch(() => {}),
          },
          {
            name: `record PKI profile`,
            // Prompt 37 — this INSERT (ON CONFLICT DO NOTHING) had no
            // undo at all: if a LATER step failed, runSteps() would roll
            // back the Vault key/policy/approle above, but this row
            // would survive — a registry/Vault split-brain (a
            // crypto_profiles row for a PKI role that no longer exists).
            // Only ever deletes the row THIS run inserted — a
            // pre-existing row (a re-provision) is never touched, since
            // DO NOTHING means this run changed nothing about it.
            run: async () => {
              const { rowCount } = await query(
                `INSERT INTO crypto_profiles (application_id, type, vault_path)
                 VALUES ($1,'pki',$2)
                 ON CONFLICT (application_id, vault_path) DO NOTHING`,
                [app.id, `pki-int/roles/${pkiRole}`],
              );
              pkiProfileInserted = rowCount > 0;
              return "pki profile recorded";
            },
            undo: async () => {
              if (!pkiProfileInserted) return; // pre-existing row — not this run's to remove
              await query(
                `DELETE FROM crypto_profiles WHERE application_id = $1 AND vault_path = $2`,
                [app.id, `pki-int/roles/${pkiRole}`],
              ).catch(() => {});
            },
          },
        ]
      : []),
    {
      name: `record crypto profile`,
      // Prompt 37 — same registry/Vault split-brain gap as above, but
      // this one is ON CONFLICT DO UPDATE (a re-provision legitimately
      // updates custody/rotation_days on an existing row) — undo must
      // restore the PRIOR values on an update, not just delete, or a
      // failed re-provision would erase real prior custody/rotation
      // data that had nothing to do with this attempt.
      run: async () => {
        const { rows: existing } = await query(
          `SELECT custody, rotation_days FROM crypto_profiles
            WHERE application_id = $1 AND vault_path = $2`,
          [app.id, `transit/keys/${keyName}`],
        );
        cryptoProfilePrior = existing[0] ?? null;
        await query(
          `INSERT INTO crypto_profiles (application_id, type, vault_path, custody, rotation_days)
           VALUES ($1,'transit',$2,$3,$4)
           ON CONFLICT (application_id, vault_path) DO UPDATE
             SET custody = EXCLUDED.custody, rotation_days = EXCLUDED.rotation_days`,
          [
            app.id,
            `transit/keys/${keyName}`,
            opts.custody ?? "vault",
            rotationDays,
          ],
        );
        return "crypto_profiles updated";
      },
      undo: async () => {
        if (cryptoProfilePrior) {
          await query(
            `UPDATE crypto_profiles SET custody = $3, rotation_days = $4
              WHERE application_id = $1 AND vault_path = $2`,
            [
              app.id,
              `transit/keys/${keyName}`,
              cryptoProfilePrior.custody,
              cryptoProfilePrior.rotation_days,
            ],
          ).catch(() => {});
        } else {
          await query(
            `DELETE FROM crypto_profiles WHERE application_id = $1 AND vault_path = $2`,
            [app.id, `transit/keys/${keyName}`],
          ).catch(() => {});
        }
      },
    },
    // Prompt 20 — seeds desired_state (rotation_period) from the same
    // rotation_days the operator already declared for the Transit key
    // itself, so reconciliation has a real desired value to compare Vault
    // against from provisioning day one, not just for applications
    // deliberately configured after the fact. No-ops on a re-provision with
    // the same rotation_days (upsertDesiredState never manufactures fake
    // intent-change history for an unchanged value).
    ...(rotationDays
      ? [
          {
            name: `record desired state (rotation_period)`,
            // Prompt 37 — same split-brain gap: no undo meant a later
            // step's failure left this desired_state row live (feeding
            // real reconciliation drift checks) for a Vault key that had
            // just been rolled back out of existence. Restores the
            // prior desired_value on a re-provision, deletes it if this
            // run created it fresh — a best-effort rollback, not a
            // full replay of upsertDesiredState()'s own version/history
            // semantics (this is undoing a FAILED attempt, not recording
            // a normal edit).
            run: async () => {
              const { rows: existing } = await query(
                `SELECT desired_value FROM desired_state
                  WHERE application_id = $1 AND key_name = $2 AND requirement = 'rotation_period'`,
                [app.id, keyName],
              );
              desiredStatePrior = existing[0] ?? null;
              await upsertDesiredState({
                applicationId: app.id,
                keyName,
                requirement: "rotation_period",
                desiredValue: { days: rotationDays },
                source: "onboarding",
                changedBy: opts.identity?.user ?? "arcanium",
                changedGroups: opts.identity?.groups ?? [],
                changedReason: "set at provisioning time",
              });
              return `desired rotation_period = ${rotationDays}d`;
            },
            undo: async () => {
              if (desiredStatePrior) {
                await query(
                  `UPDATE desired_state SET desired_value = $3
                    WHERE application_id = $1 AND key_name = $2 AND requirement = 'rotation_period'`,
                  [
                    app.id,
                    keyName,
                    JSON.stringify(desiredStatePrior.desired_value),
                  ],
                ).catch(() => {});
              } else {
                await query(
                  `DELETE FROM desired_state
                    WHERE application_id = $1 AND key_name = $2 AND requirement = 'rotation_period'`,
                  [app.id, keyName],
                ).catch(() => {});
              }
            },
          },
        ]
      : []),
    {
      name: `issue role_id`,
      run: async () => {
        const rid = await req("GET", `auth/approle/role/${roleName}/role-id`);
        return {
          role_id: rid?.data?.role_id,
          key: keyName,
          policy: policyName,
          namespace: ns ?? "root",
        };
      },
    },
  ];

  return runSteps(job, steps);
}
