# Arcanium CLI

A thin command-line client for the Arcanium API. It does not replace direct Vault administration.

## Run

```sh
cd arcanium/cli
npm ci
node src/index.js --help
```

Optional global registration from the repository root:

```sh
make cli-install
arcanium --help
```

`ARCANIUM_API` selects the API base URL; default is `http://localhost:3001`.

The entrypoint registers health, suppliers, applications, keys, approvals, jobs, onboarding and integration command groups. Use each command's `--help` for current flags and arguments. Commands that provision, rotate, resolve or delete perform real API mutations.

See [API contracts](../../docs/api.md) and [usage](../../docs/usage.md). An approval CLI command records or coordinates the documented workflow; its name alone does not prove Vault Control Group authorization occurred.
