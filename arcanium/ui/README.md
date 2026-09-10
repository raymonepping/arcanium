# Arcanium UI

Standalone Nuxt 4 / Vue 3 / TypeScript frontend in `app/`. The UI is the management experience for Arcanium; Vault UI remains independent.

## Development

Use Node 24 with a version compatible with the locked Nuxt release.

```sh
cd arcanium/ui
npm ci
npm run dev
```

The default API upstream is `http://localhost:3001`. Override the server-only `NUXT_ARCANIUM_API_INTERNAL` when needed. Browser requests use `/gateway`; never place Vault credentials in public Nuxt configuration.

```sh
npm run typecheck
npm run build
```

A successful build does not prove live API or Vault behavior. Validate the relevant routes in a browser against either explicit test fixtures or the intended API deployment.

## Structure

| Path | Responsibility |
| --- | --- |
| `app/app.vue` | Nuxt root |
| `app/layouts/default.vue` | Sidebar, command bar, shared health and footer |
| `app/pages/` | Dashboard, resource views, governance and assurance |
| `app/components/` | Reusable dialogs, pagination and visual components |
| `app/composables/` | Typed API access, shared health and polling |
| `app/types/` | API models |
| `app/utils/` | Pure display/assessment helpers |
| `app/assets/css/` | Semantic palette and CSS/Tailwind styling |
| `server/routes/gateway/` | Fixed-upstream transport boundary |
| `Containerfile` | Node 24 build/runtime stages |

## Design contract

Use ink/graphite surfaces, blue interaction and restrained amber governance signals. Maintain clear status text, keyboard focus, contrast and reduced-motion support. Health and node role are separate: active and standby nodes can both be healthy.

Supplier forms must describe the actual API effect, including namespace provisioning or deletion where implemented. Approval drawers must not imply database decisions authorize Vault. Evidence counts and maturity percentages must state their scope.

Pagination uses ten rows and resets when filters change. Preserve accessible labels, loading/empty/error states and readable mobile overflow. Avoid decorative charts that have no supporting data.

## Container rebuild

From the repository root:

```sh
./scripts/ui-rebuild.sh
```

The script streams a source archive to Podman, uses the lockfile, recreates the UI service and waits for health. Optional `--logs` follows logs after success. API changes require an API rebuild too.

If the deployed page differs from the source, compare build inputs before editing. Old build layers can contain a different UI revision; do not assume the newest local file was used in a successful image.

## API integration changes

Update types and the shared client when a contract changes. Update the gateway allowlist and session forwarding deliberately. Do not scatter raw Vault or external service calls through components. Backend route errors should become safe user-facing messages.

The broader platform can evolve independently of the UI. Optional authentication, server-side maturity, evidence ingestion and observability must be integrated against their actual response contracts; do not silently replace backend semantics with optimistic frontend estimates.
