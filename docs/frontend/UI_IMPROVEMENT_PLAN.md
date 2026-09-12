# UI Improvement Plan — Arcanium

Derived from `UI_AUDIT.md`. Waves 1–2 are addressed in this pass; Waves 3–4
are recorded but not started (see Definition of Done — this prompt does not
require exhausting every wave).

> Updated after `00_frontend_quality_gate.md`'s own execution
> (`docs/frontend/FRONTEND_QUALITY_GATE.md`) surfaced two further findings:
> Finding A (logout, BLOCKER, fixed during that pass — see Wave 1.5 below)
> and Finding B (`--arc-text-dim` misuse app-wide, HIGH, added to Wave 3 as
> Required, not fixed yet — see below).

## Wave 1.5 — Found and fixed during the quality-gate pass

| Item | Component/route | Problem | Change | Benefit | Regression risk | Validation |
|---|---|---|---|---|---|---|
| Logout returned 400 Bad Request (`FRONTEND_QUALITY_GATE.md` Finding A) | `compose/identity/keycloak/setup_keycloak.sh` (identity provisioning, not `arcanium/ui`) | Keycloak client never registered a `post.logout.redirect.uris` attribute, so RP-initiated logout was rejected outright | Added the attribute (idempotent, applies on both fresh-create and re-run) | Logout — a core, always-visible workflow — now actually works | Low — additive attribute on one client, no application code touched | Live re-test of the exact failing click sequence (login → persona menu → Sign out) confirmed a real session-destroying logout; `scenarios/11_security_foundation/test_negative_auth.sh` re-run (29/29) since this touches identity-provider config |

## Wave 1 — Clear defects and inconsistencies (this pass)

| Item | Component/route | Problem | Change | Benefit | Regression risk | Validation |
|---|---|---|---|---|---|---|
| Topbar overlap/clipping | `app/layouts/default.vue` (all routes) | `.page-title` overflowed instead of truncating; no breakpoint below 1180px | Added `overflow:hidden;text-overflow:ellipsis` to `.page-title`; new `@media (max-width:640px)` hiding search trigger + cluster label text + "pending" word | Title, cluster status, and pending count all remain legible and un-clipped on phone widths | Low — CSS-only, scoped by a new breakpoint below all existing ones | Playwright re-screenshot at 390×844 on `/` and `/keys`; desktop/laptop re-screenshot confirmed pixel-identical (breakpoint doesn't engage above 640px) |
| Lifecycle-coverage grid unresponsive | `app/assets/css/main.css` (`.arc-kml`, dashboard only) | Fixed 6-column grid, no breakpoint, unlike every sibling grid | 3-column at ≤900px (flow-rail connector hidden, all corners rounded), 1-column at ≤560px | No off-screen content at phone width | Low — CSS-only, isolated selector used on one page | Playwright re-screenshot at 390×844 on `/` |
| Login note contrast/size | `app/pages/login.vue` | 10.5px text on `--arc-text-dim` (documented large/bold-only token) | `--arc-text-muted` (AA-body-safe, already used one line above), 12px | Meets the project's own documented AA rule | Low — one selector, one page | Visual re-check (`.artifacts/login-check.png`); token already proven elsewhere on the same page |
| Build-context hygiene | `scripts/ui-rebuild.sh` | New Playwright/Impeccable/Taste working directories (`.playwright-cli/`, `.artifacts/`, `.claude/`, `.agents/`) would otherwise be tarred into every future container build | Added to the script's existing `--exclude` list | Smaller, faster, cleaner rebuilds going forward | None — additive exclusion only | `ui-rebuild.sh` run and verified (see `UI_TOOLCHAIN_REPORT.md`) |

## Wave 2 — Design-system normalization

Nothing required. The existing token system in `main.css` was already
well-normalized (single source of truth, documented contrast targets,
consistent radius/shadow scale) — this pass formalized it into
`docs/frontend/config/DESIGN.md` rather than needing to fix
inconsistencies. No changes made under this wave.

## Wave 3 — UX improvements (not started — Required + Recommended)

- **`--arc-text-dim` app-wide contrast fix (Required)**
  (`FRONTEND_QUALITY_GATE.md` Finding B). 28 CSS rules across 20+ files
  use `--arc-text-dim` (documented large/bold-only, ~4.3:1) on small
  (9.5–13px) body-adjacent text — footnotes, breadcrumb separators,
  timestamps, request IDs, hints. Real, systemic, pre-existing violation
  of the project's own contrast rule; not fixed in this pass given its
  true blast radius (20+ files). Needs its own dedicated pass: promote
  each instance to `--arc-text-muted` (or `--arc-text-secondary` where
  the surrounding text already uses that), then a full before/after
  screenshot sweep across every affected route at all three viewports —
  the same discipline used for Wave 1's fixes, just at 20x the file
  count, which is why it wasn't attempted as a rushed blanket
  find-replace here.
- **Hydration-mismatch fix on first unauthenticated load**
  (`UI_AUDIT.md` Finding 4). Requires a dedicated pass: reproduce with
  Vue/Nuxt SSR debug logging enabled, understand exactly why the SSR
  payload and the client's first paint disagree on route, and fix without
  repeating the CPU/OOM regression this same file caused previously. Do
  not bundle with unrelated work; give it its own full regression cycle
  (fitness, negative-auth, smoke) given the auth-critical nature of the
  file.
- **`width`-based transitions** (`UI_AUDIT.md` Finding 7) — convert the
  sidebar-collapse and progress-fill transitions to `transform`/no-layout-
  thrash equivalents, if/when either component is touched for other
  reasons. Not worth a standalone change at this priority.

## Wave 4 — Optional visual refinement (not started — Optional)

- None identified. The application's existing visual language
  (`DESIGN.md`) was found to be coherent, deliberate, and consistent
  across all 14 routes audited; no refinement was judged to have a
  measured benefit proportionate to its risk. Per the mission's own
  instruction, Wave 4 is not started "merely because it exists."

## What was deliberately NOT changed (see `UI_AUDIT.md` for full reasoning)

- `side-tab` node-status borders (Finding 5) — legitimate semantic use,
  not slop.
- Inter as the sole sans font (Finding 6) — existing, consistent choice.
- The dark-navy/cyan palette generally (`DESIGN.md`) — Arcanium's own
  established brand identity, not a generic "AI palette."
- `design-taste-frontend`'s marketing/landing-page rule set (Finding 8) —
  explicitly out of scope for a dashboard, per the skill's own stated
  boundaries.
