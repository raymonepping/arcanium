# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Copied primary Vault configuration and transit auto-unseal policy from vault_reference.
- Four-node Podman Vault stack, isolated TLS, bootstrap/status and Raft snapshot scripts.
- Podman runtime preflight, storage reporting and stack Compose wrapper.
- Canonical Compose stack layout and Podman-oriented Make targets.
### Changed
- Made Podman the canonical local and CI image runtime.
### Deprecated
### Removed
### Fixed
### Security
