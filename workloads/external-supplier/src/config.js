// config.js — environment variable validation for external-supplier workload.
const required = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`[config] missing required env var: ${name}`);
  return v;
};

export default {
  vault: {
    addr: required("VAULT_ADDR"),
    cacert: required("VAULT_CACERT"),
    roleId: required("VAULT_ROLE_ID"),
    secretId: required("VAULT_SECRET_ID"),
  },
  arcaniumApi: process.env.ARCANIUM_API ?? "http://arcanium-api:3001",
  arcaniumAppId: required("ARCANIUM_APP_ID"),
  transitKey: process.env.TRANSIT_KEY ?? "external-supplier-key",
  cycleIntervalMs: parseInt(process.env.CYCLE_INTERVAL_MS ?? "120000", 10),
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS ?? "5000", 10),
};
