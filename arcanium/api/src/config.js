// config.js — load and validate all environment variables at module load time.
// Any missing required variable causes an immediate throw so the process exits
// with a clear message rather than failing deep inside a request handler.

function required(name) {
  const val = process.env[name];
  if (!val)
    throw new Error(`[config] Missing required environment variable: ${name}`);
  return val;
}

function optional(name, fallback) {
  return process.env[name] || fallback;
}

const config = {
  port: Number(optional("PORT", "3001")),
  nodeEnv: optional("NODE_ENV", "production"),

  vault: {
    addr: optional("VAULT_ADDR", "https://vault-1:8200").replace(/\/$/, ""),
    cacert: required("VAULT_CACERT"),
    roleId: required("VAULT_ROLE_ID"),
    secretId: required("VAULT_SECRET_ID"),
    // Prompt 15.6 — "sync" runs the provisioner in the request; "queue" enqueues
    // a pending job for arcanium-worker to execute.
    provisionMode: optional("PROVISION_MODE", "sync"),

    // Prompt 14.2 — token used by the provisioner for cross-namespace writes
    // (creating child namespaces requires acting inside the parent namespace,
    // which the root-scoped AppRole token cannot do). POC: a root/periodic token.
    // Production: a delegated namespace-admin identity. When unset, provisioning
    // is limited to the root namespace.
    provisionerToken: optional("VAULT_PROVISIONER_TOKEN", ""),
  },

  // Prompt 14.1 — read-only client for vault-hsm (Managed Key custody).
  // Optional: when unset, the API simply does not enrich HSM-backed keys.
  hsm: {
    addr: optional("VAULT_HSM_ADDR", "").replace(/\/$/, ""),
    roleId: optional("ARCANIUM_HSM_ROLE_ID", ""),
    secretId: optional("ARCANIUM_HSM_SECRET_ID", ""),
    get enabled() {
      return Boolean(this.addr && this.roleId && this.secretId);
    },
  },

  postgres: {
    host: optional("POSTGRES_HOST", "postgres"),
    port: Number(optional("POSTGRES_PORT", "5432")),
    db: required("POSTGRES_DB"),
  },

  // Prompt 14.5 — human authentication. Default OFF: the stack stays open until
  // ARCANIUM_AUTH_ENABLED=true. Identity is authoritative in Vault (userpass);
  // persona scoping in Arcanium is defense-in-depth, not the security boundary.
  auth: {
    enabled: optional("ARCANIUM_AUTH_ENABLED", "false") === "true",
    // demo persona switch for presentations
    demoSwitch: optional("ARCANIUM_DEMO_PERSONA_SWITCH", "false") === "true",
    // username -> persona (POC map; production derives this from Vault identity groups)
    personaByUser: {
      ciso: "ciso",
      architect: "architect",
      operator: "operator",
      auditor: "auditor",
      "pepsi-admin": "supplier-admin",
      "cocacola-admin": "supplier-admin",
    },
  },
};

export default config;
