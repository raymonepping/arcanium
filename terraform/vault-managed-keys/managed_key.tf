# PKCS#11 managed key — references the `kms_library "pkcs11" { name = "softhsm-proxy" }`
# stanza in vault-hsm/config-hsm.hcl. `allow_generate_key = true` makes Vault
# generate the RSA key pair inside SoftHSM on first use; it never leaves the token.
resource "vault_managed_keys" "docsign" {
  pkcs11 {
    name               = "docsign-hsm"
    library            = "softhsm-proxy"
    key_label          = "docsign-hsm-rsa"
    key_bits           = "4096"
    mechanism          = "0x0001" # CKM_RSA_PKCS
    pin                = var.softhsm_pin
    slot               = var.softhsm_slot
    allow_generate_key = true
    allow_store_key    = false
    any_mount          = false
  }
}
