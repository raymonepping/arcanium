SHELL := /bin/sh

.DEFAULT_GOAL := help

STACKS := vault infra hsm arcanium observability workloads

.PHONY: help check status storage ps images volumes compose-config \
	network $(addsuffix -up,$(STACKS)) $(addsuffix -down,$(STACKS)) \
	$(addsuffix -logs,$(STACKS))

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

compose-config: ## Validate all compose.yaml files currently present
	@found=0; \
	for stack in $(STACKS); do \
		if [ -f "compose/$$stack/compose.yaml" ]; then \
			found=1; ./scripts/compose.sh "$$stack" config --quiet || exit $$?; \
		fi; \
	done; \
	if [ "$$found" -eq 0 ]; then echo 'No compose.yaml files exist yet.'; fi

define STACK_TARGETS

$(1)-up:
	@./scripts/compose.sh "$(1)" config --quiet
	@$(MAKE) --no-print-directory network
	@./scripts/compose.sh "$(1)" up -d

$(1)-down:
	@./scripts/compose.sh "$(1)" down

$(1)-logs:
	@./scripts/compose.sh "$(1)" logs -f
endef

$(foreach stack,$(filter-out vault,$(STACKS)),$(eval $(call STACK_TARGETS,$(stack))))

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
