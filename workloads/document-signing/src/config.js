// config.js — environment variable validation for document-signing workload.
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
  signKey: process.env.VAULT_TRANSIT_SIGN_KEY ?? "document-signing-key",
  signInterval: parseInt(process.env.SIGN_INTERVAL_SECONDS ?? "60", 10) * 1000,
  fastRotation: process.env.DEMO_FAST_ROTATION === "true",
  rotationInterval:
    process.env.DEMO_FAST_ROTATION === "true"
      ? 5 * 60 * 1000
      : 24 * 60 * 60 * 1000,
  port: parseInt(process.env.PORT ?? "3004", 10),
};
