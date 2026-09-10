# Security model

Arcanium is a local demonstration of cryptographic lifecycle management. The implemented controls illustrate an architecture; they are not a blanket production-security or compliance claim.

## Trust boundaries

Vault enforces key custody and workload policy. Namespace isolation must be tested with the relevant identities. A supplier card, application category or UI persona is not an isolation boundary.

The UI talks to Arcanium API through same-origin transport and must not receive Vault tokens or join the Vault-internal network. The API and optional worker hold the service identities needed for their operations. PostgreSQL stores metadata, evidence and sessions, not private key custody.

## Identities

- Workloads use their configured AppRole, certificate or other Vault identities.
- The API authenticates with AppRole and obtains dynamic database credentials.
- Optional human login validates credentials against Vault userpass and establishes an Arcanium session.
- Optional runtime provisioner credentials can be highly privileged. Restrict their scope and treat local root-token use as a lab shortcut.
- Presentation persona switching must remain explicitly controlled; it is not production role assignment.

Human auth is disabled by default. When enabling it, verify authorization for every mutation and every tenant-scoped read, including nested supplier routes. Do not equate a successful login with complete route-level enforcement.

## Governance and evidence

An approval record can express a human decision without executing a cryptographic operation or authorizing a Vault Control Group. Keep those states distinct in the UI, documentation and demos.

Audit ingestion stores normalized metadata instead of full crypto request/response bodies. Source classification may be derived from policy/role names or caller-provided fields. It is not cryptographic attestation of origin. Record retention, ingest completeness and tamper resistance need separate verification.

Maturity scores use selected implementation signals. They are not proof of regulatory compliance or comprehensive policy effectiveness.

## Local secret material

Keep `.env`, `.env.workloads`, `.secrets/`, Terraform state, Vault initialization files, private TLS keys, HSM PINs, proxy PSKs and licenses out of version control and shared logs. Protect backup copies independently from the VM.

Bootstrap uses simplified recovery settings for a lab. SoftHSM uses software-backed tokens. Neither should be presented as production multi-person recovery custody or certified hardware assurance.

## Safe development and demonstrations

Use read-only health checks for routine diagnosis. Provisioning, deletion, key rotation, rewrap, approval resolution, full verification and failure scenarios change state. Review target namespace, key, tenant and job before running them.

TLS validation remains enabled for application-to-Vault communication. A failing certificate should be repaired through trust/certificate configuration, not hidden behind an insecure UI probe.
