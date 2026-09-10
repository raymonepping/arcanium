# Contributing

## Workflow

1. Work on a focused branch and inspect existing changes before editing.
2. Read the [architecture](docs/architecture.md) and the relevant [component guide](docs/index.md).
3. Keep API business logic in Express and Vault integration out of the browser.
4. Add targeted checks for changed behavior; distinguish fixture tests from live validation.
5. Update documentation when routes, configuration, scoring or operational commands change.
6. Open a reviewable pull request describing the problem, resulting behavior and validation.

Coordinate when multiple tools edit the same workspace. Do not overwrite another tool's source changes or rebuild a mixed revision without reviewing it.

## Validation

```sh
cd ui
npm ci
npm run typecheck
npm run build
```

Run API tests from `arcanium/api` with `npm test`. Check what a test actually covers; some existing health tests reproduce endpoint behavior rather than loading the production router. `make verify` and scenario scripts perform live mutations and are not substitutes for isolated regression tests.

Use Node 24 for local frontend validation. Keep lockfiles aligned with package changes. Use the [release checklist](docs/release-checklist.md) for delivery.

## Commits and review

Use concise commit messages such as `fix: distinguish healthy Vault standbys` or `docs: explain provisioning job recovery`. Preserve unrelated staged and unstaged changes. Do not commit, merge, publish or announce on another contributor's behalf without authorization.

## Secrets

Keep configuration credentials, license strings, private keys, Terraform state and Vault initialization output out of commits and screenshots. Verify the repository's actual hook/CI configuration rather than assuming a secret scanner is installed. Report sensitive findings privately through the project's established maintainer channel.
