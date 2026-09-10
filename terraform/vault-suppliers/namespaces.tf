# Create the parent "suppliers" namespace first.
resource "vault_namespace" "suppliers" {
  path = "suppliers"
}

# Child namespaces — each supplier gets a fully isolated namespace.
resource "vault_namespace" "pepsi" {
  namespace  = vault_namespace.suppliers.path
  path       = "pepsi"
  depends_on = [vault_namespace.suppliers]
}

resource "vault_namespace" "cocacola" {
  namespace  = vault_namespace.suppliers.path
  path       = "cocacola"
  depends_on = [vault_namespace.suppliers]
}
