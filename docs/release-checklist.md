# Release checklist

## Review the final source

- [ ] Confirm scope and preserve unrelated repository changes.
- [ ] Coordinate concurrent editors; ensure deployed source matches the reviewed revision.
- [ ] Update package versions/lockfiles and migration documentation as needed.
- [ ] Update README, architecture, usage and affected component/API guides.
- [ ] Check local Markdown links and remove stale feature claims.
- [ ] Inspect the diff for credentials, private material and accidental generated files.

## Validate

- [ ] UI strict TypeScript check and production build pass on supported Node 24.
- [ ] Targeted API tests cover changed routes/validation.
- [ ] Browser navigation, loading/error states, keyboard access and mobile layout work.
- [ ] Pagination shows ten records, accurate counts and correct filter resets.
- [ ] Healthy standby nodes are not marked failed; unavailable measurements remain explicit.
- [ ] Supplier and approval confirmations describe actual backend effects.
- [ ] Maturity basis matches the deployed evaluator.
- [ ] Quiet Compose validation passes.
- [ ] UI/API images build from the intended source and report expected health.
- [ ] Any live mutation test used disposable records and recorded cleanup.
- [ ] Optional features are described as active only when configured and verified.

## Release

- [ ] Review and merge through the project's normal approval process.
- [ ] Update CHANGELOG and select the intended version.
- [ ] Tag/publish only when explicitly authorized.
- [ ] Record the source revision, checks performed and remaining limitations.
- [ ] Verify any release workflow actually exists and passes; do not assume a local helper is available.
