SHELL := /bin/sh

.DEFAULT_GOAL := help

STACKS     := vault infra hsm arcanium observability workloads
PROJECT_ROOT := $(shell pwd)

.PHONY: help check status storage ps images volumes compose-config \
	network $(addsuffix -up,$(STACKS)) $(addsuffix -down,$(STACKS)) \
	$(addsuffix -logs,$(STACKS)) arcanium-build

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

$(foreach stack,$(filter-out vault arcanium,$(STACKS)),$(eval $(call STACK_TARGETS,$(stack))))

arcanium-build: ## Build the arcanium-api container image
	@podman build --platform linux/amd64 --format docker \
	  -t arcanium-api:local \
	  -f arcanium/api/Containerfile arcanium/api/

arcanium-up: arcanium-build ## Build arcanium-api image then start the arcanium stack
	@$(MAKE) --no-print-directory network
	@./scripts/compose.sh arcanium up -d

arcanium-down: ## Stop the arcanium stack
	@./scripts/compose.sh arcanium down

arcanium-logs: ## Follow arcanium logs
	@./scripts/compose.sh arcanium logs -f

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

tf-all: tf-platform tf-transit tf-pki tf-database ## Apply all Terraform modules in order
