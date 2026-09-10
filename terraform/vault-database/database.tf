# Enable the Database secrets engine
resource "vault_mount" "database" {
  path = "database"
  type = "database"
}

# Configure the PostgreSQL connection
# Vault stores the management credentials internally — the app never sees them.
# The connection_url uses Vault's template syntax so the password is never
# written to Terraform state in plaintext.
resource "vault_database_secret_backend_connection" "postgres" {
  backend       = vault_mount.database.path
  name          = "arcanium-postgres"
  allowed_roles = ["arcanium-api-role"]

  postgresql {
    connection_url = "postgresql://{{username}}:{{password}}@${var.postgres_host}:${var.postgres_port}/${var.postgres_db}?sslmode=disable"
    username       = var.postgres_user
    password       = var.postgres_password
  }
}

# Dynamic credential role for the Arcanium API
# Vault generates a unique username + password per request, valid for 1h.
# On lease expiry Vault automatically revokes the role from PostgreSQL.
resource "vault_database_secret_backend_role" "arcanium_api" {
  backend = vault_mount.database.path
  name    = "arcanium-api-role"
  db_name = vault_database_secret_backend_connection.postgres.name

  creation_statements = [
    "CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}';",
    "GRANT ${var.postgres_user} TO \"{{name}}\";",
    "GRANT CREATE ON SCHEMA public TO \"{{name}}\";",
    "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO \"{{name}}\";",
    "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO \"{{name}}\";",
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO \"{{name}}\";",
  ]

  revocation_statements = [
    "DROP ROLE IF EXISTS \"{{name}}\";",
  ]

  default_ttl = "3600"   # 1 hour
  max_ttl     = "86400"  # 24 hours
}
