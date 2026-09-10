// provisioner/supplier.js — Prompt 14.2
// Turns a supplier registry row into a real Vault Enterprise tenant:
//   namespace + approle + namespace-scoped policy + transit mount + rate-limit quota.

import { vaultRequest, vaultRequestNs, getProvisionerToken } from "../vault.js";
import { runSteps } from "./steps.js";

function nsReq(method, path, body, ns) {
  return vaultRequestNs(method, path, body, getProvisionerToken(), ns);
}

const RATE_BY_TIER = { premium: 500, standard: 100 };

export function supplierProvisionSteps(supplier) {
  const ns = supplier.vault_namespace.replace(/^\/+|\/+$/g, "");
  const parts = ns.split("/");
  const leaf = parts.pop();
  const parent = parts.join("/"); // "" when top-level, "suppliers" for suppliers/acme
  const policyName = `${leaf}-tenant`;
  const rate = RATE_BY_TIER[supplier.sla_tier] ?? 100;

  return [
    {
      name: `create namespace ${ns}`,
      run: async () => {
        // Nested namespaces are created relative to their parent.
        await vaultRequestNs(
          "POST",
          `sys/namespaces/${leaf}`,
          {},
          getProvisionerToken(),
          parent || undefined,
        );
        return ns;
      },
      undo: async () => {
        await vaultRequestNs(
          "DELETE",
          `sys/namespaces/${leaf}`,
          null,
          getProvisionerToken(),
          parent || undefined,
        ).catch(() => {});
      },
    },
    {
      name: `enable approle in ${ns}`,
      run: () => nsReq("POST", "sys/auth/approle", { type: "approle" }, ns),
      undo: () => nsReq("DELETE", "sys/auth/approle", null, ns).catch(() => {}),
    },
    {
      name: `enable transit in ${ns}`,
      run: () => nsReq("POST", "sys/mounts/transit", { type: "transit" }, ns),
      undo: () =>
        nsReq("DELETE", "sys/mounts/transit", null, ns).catch(() => {}),
    },
    {
      name: `write policy ${policyName}`,
      run: () =>
        nsReq(
          "POST",
          `sys/policies/acl/${policyName}`,
          {
            policy: [
              `path "transit/*"      { capabilities = ["create","read","update","list"] }`,
              `path "sys/mounts"     { capabilities = ["read"] }`,
            ].join("\n"),
          },
          ns,
        ),
      undo: () =>
        nsReq("DELETE", `sys/policies/acl/${policyName}`, null, ns).catch(
          () => {},
        ),
    },
    {
      name: `create approle ${leaf}-app`,
      run: () =>
        nsReq(
          "POST",
          `auth/approle/role/${leaf}-app`,
          { token_policies: policyName, token_ttl: "1h", token_max_ttl: "4h" },
          ns,
        ),
    },
    {
      name: `rate-limit quota ${rate} req/s`,
      run: () =>
        vaultRequest(
          "POST",
          `sys/quotas/rate-limit/${leaf}-sla`,
          { path: `${ns}/`, rate },
          getProvisionerToken(),
        ),
      undo: () =>
        vaultRequest(
          "DELETE",
          `sys/quotas/rate-limit/${leaf}-sla`,
          null,
          getProvisionerToken(),
        ).catch(() => {}),
    },
  ];
}

export async function provisionSupplier(job, supplier) {
  return runSteps(job, supplierProvisionSteps(supplier));
}

export async function deprovisionSupplier(
  job,
  supplier,
  { force = false } = {},
) {
  const ns = supplier.vault_namespace.replace(/^\/+|\/+$/g, "");
  const parts = ns.split("/");
  const leaf = parts.pop();
  const parent = parts.join("/");
  return runSteps(job, [
    {
      name: `check ${ns} is empty`,
      run: async () => {
        if (force) return "forced";
        try {
          const r = await vaultRequestNs(
            "LIST",
            "transit/keys",
            null,
            getProvisionerToken(),
            ns,
          );
          const keys = r?.data?.keys ?? [];
          if (keys.length)
            throw new Error(
              `namespace holds ${keys.length} transit key(s); pass force=true`,
            );
        } catch (e) {
          if (e.vaultStatus === 404) return "no transit mount";
          throw e;
        }
        return "empty";
      },
    },
    {
      name: `delete quota`,
      run: () =>
        vaultRequest(
          "DELETE",
          `sys/quotas/rate-limit/${leaf}-sla`,
          null,
          getProvisionerToken(),
        ).catch(() => {}),
    },
    {
      name: `delete namespace ${ns}`,
      run: () =>
        vaultRequestNs(
          "DELETE",
          `sys/namespaces/${leaf}`,
          null,
          getProvisionerToken(),
          parent || undefined,
        ),
    },
  ]);
}
