# compose/arcanium/vault-agent/config.hcl — Prompt 30, Deliverable 1.
#
# Owns exactly two things for the arcanium-api identity: (1) AppRole
# auto-auth + token renewal (replaces vault.js's own login()/
# scheduleTokenRefresh(), Prompt 30 Deliverable 2), and (2) rendering the
# dynamic database/creds/arcanium-api-role credential to a file on its own
# schedule (replaces fetchDbCredentials()/scheduleDbCredsRotation()).
#
# Deliberately does NOT proxy/cache other Vault API calls (Transit, PKI,
# Control Group) — those keep going straight from arcanium-api to Vault,
# using the token this file renders, exactly as documented in this
# prompt's own Non-goals.

pid_file = "/tmp/pidfile"

vault {
  address = "https://vault-1:8200"
  ca_cert = "/vault/tls/ca-chain.pem"
}

auto_auth {
  method "approle" {
    mount_path = "auth/approle"
    config = {
      role_id_file_path                   = "/tmp/role-id"
      secret_id_file_path                 = "/tmp/secret-id"
      # This AppRole's secret_id is unlimited-use (terraform/vault-platform/
      # auth.tf's arcanium_api role sets no secret_id_num_uses/secret_id_ttl
      # restriction) — safe to re-read on every re-auth, including after an
      # Agent restart, so the file must not be deleted after first use.
      remove_secret_id_file_after_reading = false
    }
  }

  sink "file" {
    config = {
      path = "/vault/secrets/token"
      # Found live: this stanza's `mode` config did not behave as
      # documented — a bare 0640 silently produced 0600 (owner-only), and
      # a quoted "0640"/"0644" hard-errored ("could not parse 'mode' as
      # integer"). Rather than fight that, the container's own `user:` is
      # set to match arcanium-api/worker's UID (see compose.yaml) so the
      # default owner-only 0600 already grants read access — no mode
      # override needed at all.
    }
  }
}

template {
  destination = "/vault/secrets/db-creds.json"
  # error_on_missing_key left at its default (false is not valid here —
  # Agent's template stanza just fails the render on a missing key, which
  # is the correct behavior: never write a partial/malformed credentials
  # file).
  contents = <<EOF
{{ with secret "database/creds/arcanium-api-role" }}
{"username":"{{ .Data.username }}","password":"{{ .Data.password }}","lease_id":"{{ .LeaseID }}","lease_duration":{{ .LeaseDuration }}}
{{ end }}
EOF
}
