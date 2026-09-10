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
  port:    Number(optional('PORT', '3003')),
  nodeEnv: optional('NODE_ENV', 'production'),

  vault: {
    addr:     optional('VAULT_ADDR', 'https://vault-1:8200').replace(/\/$/, ''),
    cacert:   required('VAULT_CACERT'),
    roleId:   required('VAULT_ROLE_ID'),
    secretId: required('VAULT_SECRET_ID'),
  },

  pki: {
    mount:    optional('PKI_MOUNT', 'pki-int'),
    role:     optional('PKI_ROLE', 'arcanium-services'),
    cn:       optional('CERT_CN', 'pki-client.arcanium.local'),
  },

  demo: {
    shortTtl: process.env.DEMO_SHORT_TTL === 'true',
  },
}

export default config
