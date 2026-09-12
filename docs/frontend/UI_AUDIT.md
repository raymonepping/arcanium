# UI Audit — Arcanium

Three perspectives, aggregated before any decision: **Playwright**
(direct observation of the real, rendered application), **Impeccable**
(`impeccable detect`, both a static pass over `app/` and a live-browser
pass against `http://localhost:3000`), and **Taste**
(`design-taste-frontend` skill, read and applied as a second design
perspective, filtered against its own stated scope — see Finding 8).

Severity key: `P0` broken functionality/severe accessibility, `P1` clear
usability issue, `P2` visual inconsistency, `P3` optional refinement, `P4`
subjective stylistic preference.

---

## Finding 1 — Topbar overlap/clipping below ~640px

- **Source:** Playwright (live, 390×844, every route)
- **Severity:** P1
- **Affected:** `app/layouts/default.vue` (`.arc-topbar`, `.page-title`,
  `.pending-pill`) — shared across all 19 routes.
- **Evidence:** `.artifacts/ui-baseline/mobile/index.png`,
  `.artifacts/ui-baseline/mobile/keys.png` (before); confirmed identical
  pattern on both routes, meaning it is the shared layout, not a
  page-specific bug.
- **Impact:** The page title visually overlapped the search trigger, and
  the pending-approvals count was clipped at the viewport edge, on every
  route below ~640px wide.
- **Root cause:** `.page-title` had `white-space: nowrap` with no
  `overflow`/`text-overflow`, so it visually overflowed its flex-shrunk
  box instead of truncating. The topbar had exactly one responsive step
  (`@media max-width: 1180px`, hides secondary text labels) and nothing
  below that for true mobile widths.
- **Decision:** Fix. **Applied** (Wave 1) — see `UI_IMPROVEMENT_PLAN.md`.
  Re-verified: `.artifacts/ui-after/mobile/index.png`,
  `.artifacts/ui-after/mobile/keys.png`.

## Finding 2 — Cryptographic Lifecycle Coverage grid did not respond below 900px

- **Source:** Playwright (live, 390×844)
- **Severity:** P1
- **Affected:** `app/assets/css/main.css` (`.arc-kml`), used only by
  `app/pages/index.vue`.
- **Evidence:** `.artifacts/ui-baseline/mobile/index.png` (columns 4–6
  entirely off-screen, no wrap).
- **Root cause:** Every other grid on the same page (`.arc-kpi-strip`,
  `.arc-grid-2/3`, `.story-doors`) had a responsive breakpoint; this
  6-column grid did not — an omission, not a deliberate design choice.
- **Decision:** Fix. **Applied** (Wave 1). Below 900px it now drops the
  horizontal "flow rail" connector visual (which assumes six same-row
  neighbors) rather than let it wrap into a broken multi-row shape — each
  stage becomes its own fully-rounded card at 3 columns (900px) and 1
  column (560px). Re-verified: `.artifacts/ui-after/mobile/index.png`.

## Finding 3 — Login page: sub-AA-floor text size/color on `.login-note`

- **Source:** Impeccable (live-browser pass, `http://localhost:3000/`,
  unauthenticated → `/login`) + independent confirmation in the
  project's own source.
- **Severity:** P1 (accessibility)
- **Affected:** `app/pages/login.vue` (`.login-note`).
- **Evidence:** Impeccable live pass reported `tiny-text` (10.5px, below
  its 12px floor) and `low-contrast` findings on this exact paragraph.
  Independently, `app/assets/css/main.css`'s own token-block comment
  documents `--arc-text-dim` as **"~4.3:1 (AA large/bold, labels)"** —
  i.e. rated for large/bold text only — while `.login-note` used it at
  10.5px, non-bold, paragraph text. This is a real, self-documented
  violation of the project's own accessibility rule ("Never define a
  meaning-bearing colour below AA for its text size"), independent of
  Impeccable's own numeric contrast measurement (which we treat with
  caution here — see note below).
- **Note on Impeccable's exact reported ratios (1.1:1–1.2:1):** manual
  WCAG relative-luminance calculation for `--arc-text-dim` (`#7c8698`)
  against the flat `--arc-bg-canvas` (`#001233`) yields roughly 4.9:1 —
  much better than Impeccable's live-measured figure. The gap is most
  plausibly explained by `backdrop-filter: blur()` on `.login-card`
  rendering differently in Impeccable's own headless-capture path than in
  a normal browser (a known class of false positive for pixel-sampling
  contrast tools against glassmorphism). We do **not** treat the exact
  1.1:1 figure as reliable, but the underlying finding — sub-floor text
  size on a token rated for large/bold-only use — is confirmed
  independently and stands regardless.
- **Decision:** Fix. **Applied** — `.login-note` moved to
  `--arc-text-muted` (~6.4:1, the project's own documented AA-body-safe
  token, already used one line above for `.login-sub`) and 12px (the
  accessible floor). No new color introduced.

## Finding 4 — Hydration mismatch on first unauthenticated page load

- **Source:** Playwright (live, console capture, unauthenticated first
  visit to `/`)
- **Severity:** P1 (real, reproducible defect; self-correcting; no
  functional or data-exposure impact — see below)
- **Affected:** `app/middleware/auth.global.ts` (server + client auth
  redirect) interacting with SSR hydration.
- **Evidence:** Reproduced twice, independently.
  `Hydration completed but contains mismatches.` logged at ~80ms after
  navigation; the resolved page URL correctly becomes `/login?next=/`,
  but the mounted title/content is momentarily `Dashboard · Arcanium`
  before Vue's mismatch-recovery re-patches the DOM to the actual
  (login) route.
- **Root cause (as far as evidence allows without a deep framework-level
  investigation):** `auth.global.ts` performs the auth check and
  server-side `navigateTo()` redirect independently on server and client
  (`import.meta.server` branch vs. the client `$fetch` branch below it).
  For a genuinely unauthenticated first visit, the most likely explanation
  is a race between the SSR-rendered payload (built for the originally
  requested route before the server-side redirect resolves) and the
  client's own hydration attaching to that payload before its own
  client-side auth check/redirect has run.
- **Impact:** A very brief (sub-100ms) flash of dashboard *chrome* only
  (navigation, empty shell) — never real protected data, since the actual
  API calls the dashboard would need also return 401 in this state. The
  page self-corrects to the login form. No security exposure identified;
  a real console error and a real, if minor, first-paint correctness bug.
- **Decision: NOT fixed this pass.** `auth.global.ts`'s own code comments
  document a past production incident (sustained SSR 401 loop causing CPU
  pegging and OOM crashes) from a previous change to this exact file. Per
  the "smallest justified fix" / "do not perform broad refactoring"
  principle and this file's demonstrated fragility, this is recorded as
  **Required** future work for a dedicated, focused pass with its own
  full regression cycle — not bundled into this general design-toolchain
  pass. See `UI_IMPROVEMENT_PLAN.md`.

## Finding 5 — `side-tab` accent borders on Vault cluster node cards

- **Source:** Impeccable (static pass, `app/assets/css/main.css:902-905`)
- **Severity:** P4 (disagreement — tool flags a pattern that is, in this
  specific use, semantically correct)
- **Affected:** `.arc-node-card--healthy/--active/--sealed/--offline`.
- **Evidence:** Impeccable's `side-tab` rule: *"Thick colored border on
  one side of a card — the most recognizable tell of AI-generated UIs."*
  Direct inspection shows these are Vault cluster **node-state**
  indicators (healthy/active/sealed/offline) — a legitimate,
  purposeful, semantic left-border color-code, not a decorative
  accent applied without meaning.
- **Decision: Disagree, no change.** Per the decision-precedence order
  (product correctness and existing design consistency outrank generic
  tool guidance), this is a correct, intentional use of the pattern for
  state signaling, not slop. Tools advise; the product decides.

## Finding 6 — `overused-font` (Inter)

- **Source:** Impeccable (static pass, `main.css:82`)
- **Severity:** P4
- **Decision: No change.** Inter is used consistently as the sole sans
  font across the entire application (existing design consistency);
  replacing it would be a large, unjustified change for a purely
  aesthetic preference against a widely-used, highly-legible,
  professional typeface. Matches the design-toolchain prompt's own
  explicit instruction not to replace an existing choice "simply because
  another one is preferred."

## Finding 7 — `layout-transition` (animating `width`)

- **Source:** Impeccable (static + live pass; `default.vue:468`,
  `maturity.vue:288`, both a progress/sidebar-width transition)
- **Severity:** P3
- **Decision: Documented, not fixed this pass.** A real, minor
  performance nit (layout-thrashing properties, `transform`/`opacity`
  are cheaper to animate) but low actual impact here: two isolated,
  low-frequency interactions (sidebar collapse, a progress-bar fill), not
  a scroll-linked or continuously-animating property. Converting a
  width-based fill bar to a `transform: scaleX()` implementation is a
  small structural change, not a 1-line fix, and the measured benefit for
  this specific low-frequency interaction is marginal. Recorded as
  **Recommended**, not **Required** — see `UI_IMPROVEMENT_PLAN.md`.

## Finding 8 — `design-taste-frontend`'s own scope explicitly excludes this product type

- **Source:** Taste (`.agents/skills/design-taste-frontend/SKILL.md`)
- **Severity:** N/A (methodology finding, not a UI defect)
- **Evidence:** The skill's own header: *"Landing pages, portfolios, and
  redesigns. Not dashboards, not data tables, not multi-step product
  UI."* Arcanium is exactly a dashboard / data-table / multi-step
  governance product — the category the skill explicitly excludes. Its
  specific numeric rules (React/Next.js/Tailwind-v4/Motion/GSAP stack
  assumptions, hero-viewport-fit, eyebrow-label caps, bento-grid cell
  counts, marquee limits, sticky-scroll patterns) do not transfer to a
  Vue/Nuxt SSR operational console and were **not** applied.
- **What was genuinely used from Taste** (its framework-agnostic
  principles, which do transfer): Color Consistency Lock, Shape
  Consistency Lock, and the button/form contrast-check discipline
  (Sections 4.2/4.4/4.5 of the skill) — cross-checked against Arcanium's
  actual screenshots. Result: Arcanium already satisfies all three
  (one locked accent + semantic-status palette, one two-tier radius
  scale, and a legible primary CTA on the login page). No new findings
  from this cross-check beyond what Playwright/Impeccable already
  surfaced.
- **Decision:** Record the scope mismatch explicitly rather than force
  the skill's marketing-page rules onto an admin console, or silently
  skip a "Taste review" the quality-gate prompt requires. This satisfies
  the requirement (a second design perspective was genuinely applied)
  honestly.

## Finding 9 — IBM Bob skill support (tooling/process finding)

- **Source:** `skills` installer (`npx skills add ...`) output.
- **Severity:** N/A (tooling capability finding, required by the
  "Agent support" reporting requirement — see `UI_TOOLCHAIN_REPORT.md`).
- **Evidence:** The installer's own target list explicitly named "IBM
  Bob" alongside Claude Code/Codex/Gemini CLI/GitHub Copilot as a
  supported symlink target, then reported `skipped: IBM Bob, Continue
  (project directory not found)` — i.e. Bob **is** a recognized
  skill-directory convention this tool knows how to install into, but
  this specific repository has no project-scoped Bob directory yet for
  it to attach to.
- **Decision:** Recorded verbatim in `UI_TOOLCHAIN_REPORT.md`'s Agent
  support section as `Partial` for Bob — not fabricated as `Native`
  (no project directory exists to prove it), not dismissed as
  `Unsupported` (the tool's own evidence says otherwise).

---

## Summary table

| # | Finding | Severity | Decision |
|---|---|---|---|
| 1 | Topbar overlap/clipping <640px | P1 | Fixed |
| 2 | Lifecycle-coverage grid unresponsive <900px | P1 | Fixed |
| 3 | Login note sub-floor text size/color | P1 | Fixed |
| 4 | Hydration mismatch, first unauth. load | P1 | Documented, deferred (fragile file) |
| 5 | `side-tab` node-status borders | P4 | Disagree — legitimate use |
| 6 | Inter font | P4 | No change |
| 7 | `width` transitions (2 places) | P3 | Documented, deferred |
| 8 | Taste scope mismatch (dashboard vs. landing page) | — | Documented methodology decision |
| 9 | IBM Bob skill support | — | Documented tooling finding |
