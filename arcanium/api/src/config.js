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

  // Prompt 18 — human authentication. Default OFF: the stack stays open until
  // ARCANIUM_AUTH_ENABLED=true. Identity is authoritative in Keycloak (OIDC,
  // LDAP-federated); persona/tenant scope derive from OIDC `groups` claims
  // (auth/authorize.js groupsToIdentity()), never from a username lookup —
  // the Prompt 14.5 personaByUser map is retired (input/35/36).
  auth: {
    enabled: optional("ARCANIUM_AUTH_ENABLED", "false") === "true",
    // demo persona switch for presentations
    demoSwitch: optional("ARCANIUM_DEMO_PERSONA_SWITCH", "false") === "true",
  },

  // Prompt 23 — interactive API explorer via Scalar. Default OFF.
  // Two independent conditions are required to mount it (index.js): this flag
  // must be true AND NODE_ENV must not be 'production'. compose/arcanium/
  // compose.yaml hardcodes NODE_ENV=production unconditionally, so the flag
  // is the real opt-in gate locally; NODE_ENV is a hard safety net for real
  // deployments. Same pattern as ARCANIUM_AUTH_ENABLED/ARCANIUM_DEMO_PERSONA_SWITCH.
  apiExplorerEnabled:
    optional("ARCANIUM_API_EXPLORER_ENABLED", "false") === "true",
  // /api-docs is deliberately served by a separate container (arcanium-api-dev,
  // compose/arcanium/compose.yaml) outside the Nuxt gateway's origin — it is a
  // direct backend-developer tool, not a proxied UI route. auth/index.js's
  // callback needs this to send the browser back to the right origin after
  // login when it was sent there for /api-docs specifically (see the comment
  // there — this is a narrow, allowlisted exception, not a general redirect
  // target).
  apiExplorerPublicUrl: optional(
    "ARCANIUM_API_EXPLORER_PUBLIC_URL",
    "http://localhost:3050",
  ).replace(/\/$/, ""),

  // Prompt 18 — OIDC (Keycloak, LDAP-federated). Express is the confidential
  // client end-to-end; the browser never sees an OIDC or Vault token.
  // Deliberately dual-hostname (input/36): `internalUrl` is what THIS
  // process uses for every server-to-server call (token exchange, JWKS,
  // userinfo, end-session) over the container network; `publicUrl` is only
  // used to build the browser-facing authorization-endpoint redirect.
  // `issuer` must equal what Keycloak actually stamps into tokens
  // (KC_HOSTNAME) — see compose/identity/compose.yaml.
  oidc: {
    issuer: optional("ARCANIUM_OIDC_ISSUER", ""),
    internalUrl: optional("ARCANIUM_OIDC_INTERNAL_URL", "").replace(/\/$/, ""),
    publicUrl: optional("ARCANIUM_OIDC_PUBLIC_URL", "").replace(/\/$/, ""),
    clientId: optional("ARCANIUM_OIDC_CLIENT_ID", "arcanium-api"),
    clientSecret: optional("ARCANIUM_OIDC_CLIENT_SECRET", ""),
    // Must exactly match the redirect URI registered on the Keycloak client.
    callbackUrl: optional("ARCANIUM_API_CALLBACK_URL", ""),
    baseUrl: optional("ARCANIUM_BASE_URL", "http://localhost:3000"),
    get enabled() {
      return Boolean(
        this.issuer &&
          this.internalUrl &&
          this.publicUrl &&
          this.clientSecret &&
          this.callbackUrl,
      );
    },
  },

  // Prompt 24 — one number, used by both routes/jobs.js's ?status=stuck
  // filter and telemetry/slo.js's "Stuck job age" SLO, so a job counts as
  // stuck the same way in both places rather than two independently
  // tunable thresholds that could silently drift apart.
  stuckJobThresholdMinutes: Number(
    optional("ARCANIUM_STUCK_JOB_THRESHOLD_MINUTES", "10"),
  ),
};

export default config;
