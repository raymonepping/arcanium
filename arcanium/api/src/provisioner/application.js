// provisioner/application.js — Prompt 14.2
// POST /api/v1/applications/:id/provision — workload identity + least-privilege
// policy + application Transit key. Runs in the root namespace (root-level apps)
// unless the application is bound to a supplier, in which case the supplier's
// namespace is used.

import { vaultRequest, vaultRequestNs, getProvisionerToken } from "../vault.js";
import { query } from "../db.js";
import { runSteps } from "./steps.js";

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

  const steps = [
    {
      name: `transit key ${keyName} (${keyType})`,
      run: async () => {
        const body = { type: keyType };
        if (rotationDays) body.auto_rotate_period = `${rotationDays * 24}h`;
        await req("POST", `transit/keys/${keyName}`, body);
        return keyName;
      },
      undo: async () => {
        await req("POST", `transit/keys/${keyName}/config`, {
          deletion_allowed: true,
        }).catch(() => {});
        await req("DELETE", `transit/keys/${keyName}`).catch(() => {});
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
            run: async () => {
              await query(
                `INSERT INTO crypto_profiles (application_id, type, vault_path)
                 VALUES ($1,'pki',$2)
                 ON CONFLICT (application_id, vault_path) DO NOTHING`,
                [app.id, `pki-int/roles/${pkiRole}`],
              );
              return "pki profile recorded";
            },
          },
        ]
      : []),
    {
      name: `record crypto profile`,
      run: async () => {
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
    },
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
