terraform {
  backend "local" {
    path = "../../.secrets/terraform/bootstrap.tfstate"
  }
}

# This module has no provider resources — it is documentation-only.
# Run the modules in this order:
#   1. vault-platform  (auth, policies, namespaces, audit)
#   2. vault-transit   (transit engine + demo keys)
#   3. vault-pki       (root CA + intermediate CA + roles)
#   4. vault-database  (dynamic DB credentials — already applied in prompt 01)
