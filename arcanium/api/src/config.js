// config.js — load and validate all environment variables at module load time.
// Any missing required variable causes an immediate throw so the process exits
// with a clear message rather than failing deep inside a request handler.

function required(name) {
  const val = process.env[name]
  if (!val) throw new Error(`[config] Missing required environment variable: ${name}`)
  return val
}

function optional(name, fallback) {
  return process.env[name] || fallback
}

const config = {
  port:           Number(optional('PORT', '3001')),
  nodeEnv:        optional('NODE_ENV', 'production'),

  vault: {
    addr:     optional('VAULT_ADDR', 'https://vault-1:8200').replace(/\/$/, ''),
    cacert:   required('VAULT_CACERT'),
    roleId:   required('VAULT_ROLE_ID'),
    secretId: required('VAULT_SECRET_ID'),
  },

  postgres: {
    host: optional('POSTGRES_HOST', 'postgres'),
    port: Number(optional('POSTGRES_PORT', '5432')),
    db:   required('POSTGRES_DB'),
  },
}

export default config
