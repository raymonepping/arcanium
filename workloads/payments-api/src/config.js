// config.js — fail-fast env var validation at module load.

function required(name) {
  const val = process.env[name]
  if (!val) throw new Error(`[config] Missing required env var: ${name}`)
  return val
}

function optional(name, fallback) {
  return process.env[name] || fallback
}

const config = {
  port:    Number(optional('PORT', '3002')),
  nodeEnv: optional('NODE_ENV', 'production'),

  vault: {
    addr:       optional('VAULT_ADDR', 'https://vault-1:8200').replace(/\/$/, ''),
    cacert:     required('VAULT_CACERT'),
    roleId:     required('VAULT_ROLE_ID'),
    secretId:   required('VAULT_SECRET_ID'),
    transitKey: required('VAULT_TRANSIT_KEY'),
  },

  demo: {
    fastRotation: process.env.DEMO_FAST_ROTATION === 'true',
  },
}

export default config
