SHELL := /bin/sh

.DEFAULT_GOAL := help

STACKS     := vault infra hsm arcanium observability workloads kms-sim
PROJECT_ROOT := $(shell pwd)

.PHONY: help check status storage ps images volumes compose-config \
	network $(addsuffix -up,$(STACKS)) $(addsuffix -down,$(STACKS)) \
	$(addsuffix -logs,$(STACKS)) arcanium-build \
	tf-kmip kmip-provision \
	tf-suppliers supplier-provision supplier-test \
	docsign-build cli-install \
	approval-provision external-supplier-build

help: ## Show available commands
	@awk 'BEGIN {FS = ":.*## "; printf "Arcanium (Podman)\n\n"} /^[a-zA-Z0-9_-]+:.*## / {printf "  %-24s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

check: ## Verify the Podman machine and Compose provider
	@./scripts/podman-check.sh

status: check ## Show Arcanium containers and the shared network
	@printf '\nArcanium containers\n'
	@podman ps -a --filter label=io.podman.compose.project --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
	@printf '\nShared network\n'
	@podman network inspect arcanium >/dev/null 2>&1 && echo 'arcanium: present' || echo 'arcanium: not created'

storage: ## Report Podman machine, image, container and volume storage
	@./scripts/podman-storage.sh

ps: ## List all containers
	@podman ps -a

images: ## List local images
	@podman images

volumes: ## List named volumes
	@podman volume ls

network: ## Create the shared Arcanium networks if absent
	@podman network exists arcanium || podman network create arcanium
	@podman network exists arcanium-vault-internal || podman network create arcanium-vault-internal
	@podman network exists arcanium-control || podman network create arcanium-control

compose-config: ## Validate all compose.yaml files currently present
	@found=0; \
	for stack in $(STACKS); do \
		if [ -f "compose/$$stack/compose.yaml" ]; then \
			found=1; ./scripts/compose.sh "$$stack" config --quiet || exit $$?; \
		fi; \
	done; \
	if [ "$$found" -eq 0 ]; then echo 'No compose.yaml files exist yet.'; fi

define STACK_TARGETS

$(1)-up: ## Start the $(1) stack
	@./scripts/compose.sh "$(1)" config --quiet
	@$(MAKE) --no-print-directory network
	@./scripts/compose.sh "$(1)" up -d

$(1)-down: ## Stop the $(1) stack
	@./scripts/compose.sh "$(1)" down

$(1)-logs: ## Follow $(1) logs
	@./scripts/compose.sh "$(1)" logs -f
endef

$(foreach stack,$(filter-out vault arcanium workloads,$(STACKS)),$(eval $(call STACK_TARGETS,$(stack))))

workloads-build: docsign-build external-supplier-build ## Build all workload container images
	@podman build --platform linux/amd64 --format docker \
	  -t arcanium-payments-api:local \
	  -f workloads/payments-api/Containerfile workloads/payments-api/
	@podman build --platform linux/amd64 --format docker \
	  -t arcanium-pki-client:local \
	  -f workloads/pki-client/Containerfile workloads/pki-client/
	@podman build --platform linux/amd64 --format docker \
	  -t arcanium-kmip-client:local \
	  -f workloads/kmip-client/Containerfile workloads/kmip-client/

docsign-build: ## Build the document-signing workload container image
	@podman build --platform linux/amd64 --format docker \
	  -t arcanium-document-signing:local \
	  -f workloads/document-signing/Containerfile workloads/document-signing/

external-supplier-build: ## Build the external-supplier (Control Group demo) container image
	@podman build --platform linux/amd64 --format docker \
	  -t arcanium-external-supplier:local \
	  -f workloads/external-supplier/Containerfile workloads/external-supplier/

workloads-up: workloads-build ## Build images and start the workloads stack
	@$(MAKE) --no-print-directory network
	@set -a; [ -f .env.workloads ] && . ./.env.workloads; set +a; \
	  ./scripts/compose.sh workloads up -d

workloads-down: ## Stop the workloads stack
	@./scripts/compose.sh workloads down

workloads-logs: ## Follow workloads logs
	@./scripts/compose.sh workloads logs -f

arcanium-build: arcanium-ui-build ## Build arcanium-api and arcanium-ui container images
	@podman build --platform linux/amd64 --format docker \
	  -t arcanium-api:local \
	  -f arcanium/api/Containerfile arcanium/api/

arcanium-ui-build: ## Build the arcanium-ui container image
	@podman build --platform linux/amd64 --format docker \
	  -t arcanium-ui:local \
	  -f arcanium/ui/Containerfile arcanium/ui/

arcanium-up: arcanium-build ## Build arcanium images then start the arcanium stack
	@$(MAKE) --no-print-directory network
	@./scripts/compose.sh arcanium up -d

arcanium-down: ## Stop the arcanium stack
	@./scripts/compose.sh arcanium down

arcanium-ui-restart: ## Rebuild arcanium-ui image and restart the container (fast iteration)
	@./scripts/ui-rebuild.sh

arcanium-ui-restart-logs: ## Rebuild arcanium-ui, restart, then tail logs
	@./scripts/ui-rebuild.sh --logs

arcanium-logs: ## Follow arcanium logs
	@./scripts/compose.sh arcanium logs -f

arcanium-ui-logs: ## Follow arcanium-ui logs only
	@podman logs -f arcanium-ui

.PHONY: vault-prepare vault-bootstrap vault-status vault-backup
vault-prepare: ## Prepare the copied licenses and generate local TLS
	@./scripts/vault-prepare.sh

vault-bootstrap: ## Start and bootstrap vault-s and the three-node cluster
	@./scripts/vault-bootstrap.sh

vault-up: vault-bootstrap ## Start Vault, unseal vault-s and verify the cluster

vault-down: ## Stop Vault containers while retaining all named volumes
	@./scripts/compose.sh vault down

vault-logs: ## Follow Vault logs
	@./scripts/compose.sh vault logs -f

vault-status: ## Check sealing and the three Raft peers
	@./scripts/vault-status.sh

verify: ## Run full stack verification — smoke-tests all API routes + workload health
	@./scripts/verify-stack.sh

vault-backup: ## Save and inspect both Raft snapshots outside the Podman VM
	@./scripts/vault-backup.sh

.PHONY: hsm-bootstrap
hsm-bootstrap: ## Build vault-hsm image, start softhsm-server, resolve slot, start vault-hsm
	@podman build --platform linux/amd64 -t arcanium-vault-hsm:local \
	  -f vault-hsm/Containerfile vault-hsm/
	@$(MAKE) --no-print-directory network
	@./scripts/compose.sh hsm up -d softhsm-server
	@echo 'Waiting for softhsm-server to be healthy...'
	@for i in $$(seq 1 20); do \
	  hs=$$(podman inspect arcanium-softhsm_server --format "{{.State.Health.Status}}" 2>/dev/null); \
	  [ "$$hs" = "healthy" ] && break; sleep 3; done
	@./scripts/hsm-resolve-slot.sh
	@./scripts/compose.sh hsm up -d vault-hsm

.PHONY: hsm-init
hsm-init: ## Initialise vault-hsm, capture root token to .secrets/vault/vault-hsm-init.json
	@test -f .secrets/vault/vault-hsm-init.json && \
	  echo "vault-hsm already initialised (.secrets/vault/vault-hsm-init.json exists)" || \
	  podman exec -e VAULT_ADDR=https://127.0.0.1:8200 -e VAULT_SKIP_VERIFY=1 arcanium-vault_hsm \
	    vault operator init -recovery-shares=1 -recovery-threshold=1 -format=json \
	    > .secrets/vault/vault-hsm-init.json && chmod 600 .secrets/vault/vault-hsm-init.json
	@echo "  ✓ vault-hsm initialised"

.PHONY: hsm-managed-keys
hsm-managed-keys: ## Prompt 14.1 — provision the SoftHSM Managed Key + document-signing-key on vault-hsm
	@./scripts/vault-hsm-bootstrap.sh

.PHONY: tf-managed-keys
tf-managed-keys: ## Apply terraform/vault-managed-keys (Managed Key desired state; needs vault-hsm VAULT_TOKEN)
	@cd terraform/vault-managed-keys && terraform init -input=false && \
	  terraform apply -auto-approve \
	    -var "softhsm_slot=$$(tr -d '[:space:]' < ../../.secrets/hsm/slot-id)" \
	    -var "softhsm_pin=$$(grep -E '^SOFTHSM_USER_PIN=' ../../.env | cut -d= -f2)"

.PHONY: check-entitlements
check-entitlements: ## Print the Vault Enterprise licence features
	@./scripts/vault-check-entitlement.sh

.PHONY: tf-keymgmt
tf-keymgmt: ## Prompt 14.3 — mount the Key Management engine + create the distributed key
	@./scripts/vault-check-entitlement.sh "Key Management Secrets Engine" || \
	  { echo "Skipping: not licensed for the Key Management Secrets Engine"; exit 0; }
	@emu=false; \
	  if podman inspect arcanium-localstack --format '{{.State.Health.Status}}' 2>/dev/null | grep -q healthy; then \
	    emu=true; echo "  kms-sim is up — distributing to the emulated LocalStack KMS"; \
	  else echo "  kms-sim is down — engine + key only (run 'make kms-sim-up' first for the distribution demo)"; fi; \
	  cd terraform/vault-keymgmt && terraform init -input=false && \
	    terraform apply -auto-approve -var "kmse_emulated=$$emu"

.PHONY: tf-sentinel
tf-sentinel: ## Prompt 14.4 — apply Sentinel EGP/RGP policies
	@./scripts/vault-check-entitlement.sh "Sentinel" || \
	  { echo "Skipping: not licensed for Sentinel"; exit 0; }
	@export VAULT_TOKEN=$$(jq -r .root_token $(PROJECT_ROOT)/.secrets/vault/cluster-init.json) && \
	  export VAULT_CACERT=$(PROJECT_ROOT)/vault-tls/ca-chain.pem && \
	  export VAULT_ADDR=https://127.0.0.1:18200 && \
	  cd terraform/vault-sentinel && terraform init -input=false && terraform apply -auto-approve

.PHONY: tf-database
tf-database: ## Apply Vault Database secrets engine config (requires VAULT_TOKEN)
	@mkdir -p .secrets/terraform
	@cd terraform/vault-database && terraform init -input=false && \
	  terraform apply -input=false -auto-approve \
	    -var="vault_cacert=$(PROJECT_ROOT)/vault-tls/ca-chain.pem" \
	    -var="postgres_user=$$(grep ^POSTGRES_USER $(PROJECT_ROOT)/.env | cut -d= -f2)" \
	    -var="postgres_password=$$(grep ^POSTGRES_PASSWORD $(PROJECT_ROOT)/.env | cut -d= -f2)" \
	    -var="postgres_db=$$(grep ^POSTGRES_DB $(PROJECT_ROOT)/.env | cut -d= -f2)"

# ── Terraform — Vault platform baseline ──────────────────────────────────────
# STACK overrides the default module directory, e.g.: make tf-plan STACK=vault-pki
TF_STACK ?= vault-platform

.PHONY: tf-init tf-plan tf-apply tf-destroy
.PHONY: tf-platform tf-transit tf-pki

tf-init: ## terraform init for STACK (default: vault-platform)
	@mkdir -p .secrets/terraform
	@cd terraform/$(TF_STACK) && terraform init -input=false

tf-plan: ## terraform plan for STACK (default: vault-platform)
	@mkdir -p .secrets/terraform
	@cd terraform/$(TF_STACK) && terraform plan \
	    -var="vault_cacert=$(PROJECT_ROOT)/vault-tls/ca-chain.pem"

tf-apply: ## terraform apply for STACK (default: vault-platform)
	@mkdir -p .secrets/terraform
	@cd terraform/$(TF_STACK) && terraform init -input=false && \
	  terraform apply -input=false -auto-approve \
	    -var="vault_cacert=$(PROJECT_ROOT)/vault-tls/ca-chain.pem"

tf-destroy: ## terraform destroy for STACK (default: vault-platform)
	@cd terraform/$(TF_STACK) && \
	  terraform destroy -input=false -auto-approve \
	    -var="vault_cacert=$(PROJECT_ROOT)/vault-tls/ca-chain.pem"

tf-platform: ## Apply vault-platform (auth, policies, namespaces, audit)
	@$(MAKE) --no-print-directory tf-apply TF_STACK=vault-platform

tf-transit: ## Apply vault-transit (transit engine + demo keys)
	@$(MAKE) --no-print-directory tf-apply TF_STACK=vault-transit

tf-pki: ## Apply vault-pki (root CA + intermediate CA + PKI roles)
	@$(MAKE) --no-print-directory tf-apply TF_STACK=vault-pki

tf-workloads: ## Apply vault-workloads (payments-api key, AppRole roles, policies)
	@$(MAKE) --no-print-directory tf-apply TF_STACK=vault-workloads

tf-kmip: ## Apply vault-kmip Terraform module (KMIP engine, scope, role)
	@mkdir -p .secrets/terraform
	@cd terraform/vault-kmip && terraform init -input=false && \
	  terraform apply -input=false -auto-approve \
	    -var="vault_cacert=$(PROJECT_ROOT)/vault-tls/ca-chain.pem"

kmip-provision: ## Generate mTLS client certificate for kmip-client
	@./scenarios/03_kmip/provision.sh

tf-suppliers: ## Apply vault-suppliers (namespaces, isolation policies, transit keys per supplier)
	@mkdir -p .secrets/terraform
	@cd terraform/vault-suppliers && terraform init -input=false && \
	  terraform apply -input=false -auto-approve \
	    -var="vault_cacert=$(PROJECT_ROOT)/vault-tls/ca-chain.pem"

supplier-provision: ## Provision KMIP/Transit certs and AppRole creds for supplier tenants
	@./scenarios/06_supplier_isolation/provision.sh

supplier-test: ## Run the full 2×2 supplier isolation test matrix
	@./scenarios/06_supplier_isolation/test_positive.sh
	@./scenarios/06_supplier_isolation/test_negative.sh
	@./scenarios/06_supplier_isolation/test_list_isolation.sh

approval-provision: ## Register external-supplier app + generate external-supplier/approver-1 creds
	@chmod +x scenarios/05_approval/provision.sh
	@./scenarios/05_approval/provision.sh

cli-install: ## Install the Arcanium CLI globally via npm link
	@cd arcanium/cli && npm install && npm link

tf-all: tf-platform tf-transit tf-pki tf-database tf-workloads tf-kmip tf-suppliers ## Apply all Terraform modules in order

.PHONY: verify onboarding
onboarding: ## Run the onboarding scenario (register apps, provision creds, write .env.workloads)
	@./scenarios/01_onboarding/run.sh

# ── Failure & Resilience Scenarios (Prompt 11) ──────────────────────────────
.PHONY: scenario-failure-node scenario-failure-leader scenario-quorum-loss scenario-seal-unseal

scenario-failure-node: ## Demo: single node failure and recovery (vault-2 stops, cluster stays up)
	@chmod +x scenarios/07_failure/01_node_failure.sh
	@./scenarios/07_failure/01_node_failure.sh

scenario-failure-leader: ## Demo: active Raft leader failover (new leader elected)
	@chmod +x scenarios/07_failure/02_leader_failover.sh
	@./scenarios/07_failure/02_leader_failover.sh

scenario-quorum-loss: ## Demo (educational, interactive): quorum loss — Vault goes unavailable, auto-restores
	@chmod +x scenarios/07_failure/03_quorum_loss.sh
	@./scenarios/07_failure/03_quorum_loss.sh

scenario-seal-unseal: ## Demo: seal vault-s (transit provider), unseal with Shamir key
	@chmod +x scenarios/07_failure/04_seal_unseal.sh
	@./scenarios/07_failure/04_seal_unseal.sh

# ── Evidence Collection & Maturity Report (Prompt 12) ───────────────────────
.PHONY: evidence-collect maturity-report

evidence-collect: ## Run 5-minute evidence collection then print maturity report
	@chmod +x scenarios/08_evidence/collect.sh
	@./scenarios/08_evidence/collect.sh

maturity-report: ## Open the Arcanium maturity report in the browser
	@open http://localhost:3000/maturity

# ── Prompt 17 — Maturity Level 5 ────────────────────────────────────────────
.PHONY: scenario-automation-depth

scenario-automation-depth: ## Prompt 17 — Prove rotation-from-automation EGP blocks human tokens
	@chmod +x scenarios/09_sentinel/test_automation_depth.sh
	@./scenarios/09_sentinel/test_automation_depth.sh
