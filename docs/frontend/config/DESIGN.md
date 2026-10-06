# DESIGN.md — Arcanium

The project's visual contract. Values below are the ones in production in
`arcanium/ui/app/assets/css/main.css` (tokens) and `app/layouts/default.vue`
(shell).

See `PRODUCT.md` in this same folder for who the product is for and why.

## World: daylight glass, black ink, strong signal colours

Arcanium shares one visual family with its sibling demos, **Project Durin**
and **Editors Factory**. It is a cryptographic-governance console set in a
daylight office: frosted glass panes over a pale, window-lit ground, with
black ink for text and primary actions. Against that calm, businesslike
base, Arcanium keeps its own **strong semantic colours** (action blue,
governance amber, healthy green, critical red), so state reads at a glance
from across the room.

- **Material:** glass (`backdrop-filter: blur(22px) saturate(150%)`, an
  inset white top highlight, a soft offset shadow). Glass is the material
  of every panel, not a decoration on some of them.
- **Ground:** `body` paints the building behind the glass: three soft
  daylight radials plus aluminium mullions every 180px. Panes blur it, so
  the glass reads as glass.
- **The ink island:** each page's `.arc-hero` band is the page's one dark
  pane (ink glass). `.arc-hero` re-scopes the text/glass/status tokens, so
  anything placed inside it inverts without per-page overrides.
- **Ink primaries:** `.primary-button` / `.arc-btn--primary` are solid
  black ink. Blue is reserved for identity, links and "approve".

**History:** until 2026-10-06 Arcanium was dark navy (`#001233`) with cyan
accents. The light re-theme was a deliberate product decision to align
with Durin / Editors Factory. It was not driven by a linter. Do not revert
it to dark on generic "AI palette" grounds, and do not re-darken individual
pages.

## Product character

A **command-center for cryptographic governance**: serious, dense and
evidence-driven, read in a bright office. It should feel like an
operations console for people whose job is proving controls actually
work. Confidence comes from real numbers and real state transitions on
screen, not from decoration.

## Audience

Platform/security engineers operating Vault Enterprise day-to-day, plus
auditors and evaluators reviewing governance evidence. See `PRODUCT.md`.

## Design principles

- Clarity before decoration.
- Information hierarchy before visual effects.
- Predictable interaction: the same card/list/dialog pattern behaves the
  same way everywhere in the app.
- Accessible contrast is non-negotiable for meaning-bearing text (see
  Color below).
- Restrained motion: reduced-motion is honoured globally.
- Responsive by default, optimised for desktop/laptop operational use
  first; phone width is "must remain usable", not the primary target.

## Typography

- **Sans (UI/body):** Hanken Grotesk Variable (self-hosted via
  `@fontsource-variable`, same as Durin) at a 14px base, line-height 1.6.
- **Mono:** JetBrains Mono Variable, always via `var(--font-mono)`, never
  a raw `monospace` / `ui-monospace` stack (those fall back to Courier).
  Only for identifiers and technical values: key names, accessors,
  namespaces, versions. Never for prose.
- **Numerals:** tables, KPI tiles and card values use `tabular-nums`.
- **Headings:** page titles in the topbar 15px/700; hero titles 22px/750,
  negative tracking (≥ -0.03em).
- **Body floor:** 12px for any real body/paragraph text.

## Color

All colour comes from tokens in `main.css` `:root`. Components never
hardcode `rgba()` hue literals. Tints are mixed from a hue token:

```css
background: color-mix(in srgb, var(--arc-hue-amber) 14%, transparent);
```

```text
hues (tint source) --arc-hue-blue #0369a1 · -cyan #0e7490 · -green #137333
                   -amber #c2620a · -orange #c2410c · -red #c81e1e
                   -slate #64748b · -indigo #4f5bd5 · -violet #6d28d9

ground             --arc-bg-canvas       #e9eef3 (+ body daylight gradient)
glass pane         --arc-glass / --arc-bg-card   rgba(255,255,255,0.58)
shell (rail, bars) --arc-bg-shell        rgba(255,255,255,0.72)
inset well         --arc-well            rgba(255,255,255,0.55)
hover wash         --arc-hover           rgba(15,26,42,0.05)
scrim              --arc-scrim           rgba(15,26,42,0.28)
ink                --arc-ink             #0f1a2a

text-primary       --arc-text-primary    #0f1a2a  16.4:1 glass / 14.7:1 ground
text-secondary     --arc-text-secondary  #2f3d50  10.4 / 9.3
text-muted         --arc-text-muted      #475569   7.1 / 6.4
text-dim           --arc-text-dim        #56657a   5.6 / 5.0  (AA body, use for "not yet" states)

action fill        --arc-action-primary  #0369a1  (fills, focus ring)
action text/link   --arc-action-bright   #025a8c  6.9:1
focus ring         --arc-focus           #0369a1
healthy            --arc-healthy         #0f652b  6.8:1
governance/pending --arc-governance / --arc-pending  #a14a06  5.6:1
warning            --arc-warning         #b93d0b
critical           --arc-critical        #b01818  6.6:1
info               --arc-info            #0b5f73  6.8:1
```

Status text tokens also hold ≥ 4.5:1 on their own 10–15% tint (axe
`color-contrast` passes on every route). That is why they sit a step
darker than their `--arc-hue-*` source.

Inside `.arc-hero` (ink island) the same token names resolve to light
values (`#f3f6f9` text, `#7dd3fc` blue, `#fbbf24` amber, `#4ade80` green),
all ≥ 7:1 on the ink pane.

**Rule (kept from the dark era):** *never define a meaning-bearing colour
below AA for its text size.* Do not dim meaning-bearing text with
`opacity` on light glass. Opacity 0.4 drops `--arc-text-muted` to ~2:1.
Use `--arc-text-dim` instead (see the onboarding preview).

## Spacing

No single numeric scale is centrally declared; observed practice is
predominantly **multiples of 4px** (4/6/8/10/12/14/16/20/24), with 16–24px
as the standard card padding and 12–16px as the standard grid/flex gap.
Preserve this rhythm; do not introduce arbitrary spacing values.

## Radius

`--arc-radius: 12px` (standard cards, buttons, inputs), `--arc-radius-lg:
16px` (larger surfaces — dialogs, the login card). Pills (badges, chips,
persona/status indicators) use `border-radius: 100px`. This is a two-tier
scale (12/16 + pill) — do not introduce a third arbitrary radius value.

## Shadows

`--arc-shadow-md` (panes) and `--arc-shadow-lg` (dialogs, menus, hovered
tiles): a 1px contact shadow plus a long, soft, offset-down ink shadow
(`rgba(15,26,42,…)`). Glass panes add an inset white top highlight. No
coloured glow as elevation. The pulsing live dot is the one status glow.

## Components

- **Buttons:** `.primary-button` is solid black ink (one primary action per
  view, e.g. login's "Sign in"). `.secondary-button` is a white glass
  button with a hairline inset ring. Approve actions are blue-tinted;
  destructive actions are red-tinted.
- **Inputs:** label-above pattern. `.filter-bar`/`.form-field` inputs are
  white wells with an inset ink hairline, turning solid white with a 2px
  blue inset ring on focus, plus visible `:focus-visible` rings (`--arc-focus`, enforced even where the
  mouse-hover outline is intentionally suppressed — see `main.css`
  comment referencing this exact accessibility fix).
- **Cards:** `.dash-card` / `.arc-node-card` / key-inventory cards — one
  consistent card shell (surface color + border + radius + padding) reused
  across dashboard, keys, cluster, teams.
- **Navigation:** fixed frosted left rail (collapsible). The active item is
  a raised white chip with ink text and a blue icon, never a coloured left
  border. Sticky floating glass topbar
  (search trigger, cluster-health pill, pending-approvals pill, persona
  menu). One navigation pattern, not a per-page bespoke nav.
- **Tables/lists:** card-per-row lists (keys, suppliers) rather than dense
  HTML tables — appropriate for this content's field count and mobile
  behaviour.
- **Dialogs:** `ManagementDialog.vue` — a single shared dialog component,
  reused rather than one-off modals per action.
- **Alerts/notices:** `.inline-notice` (error/info variants).
- **Badges:** pill badges for tier/status (`PREMIUM`, `STANDARD`,
  `DEMONSTRATED`, environment tags).

Only components that exist or are genuinely needed are documented here —
this list is not aspirational.

## Responsive behaviour

- **Desktop (1440×900) / Laptop (1280×800):** full sidebar + topbar, all
  grids at their full column count.
- **≤1180px:** topbar sheds secondary text labels (env badge, Vault-UI
  link label, persona label) to make room, icons remain.
- **≤900px:** sidebar collapses (icon rail or hidden, per
  `default.vue`/`main.css`), multi-column grids (`.arc-grid-2/3`,
  `.arc-kpi-strip`, the cryptographic-lifecycle rail) drop to fewer
  columns.
- **≤640px (mobile):** topbar hides the search trigger entirely and drops
  secondary status text (cluster label, "pending" word) to fit the
  viewport without clipping or overlap — added this pass, see
  `UI_AUDIT.md`.
- **≤560px:** the remaining multi-column grids fully stack to one column.

Every breakpoint must leave the topbar's page title, cluster/pending
status, and primary navigation legible and un-clipped — this was a real,
confirmed defect below 640px before this pass (see `UI_AUDIT.md`) and is
now the enforced minimum bar for any future topbar change.

## Motion

- Global `prefers-reduced-motion: reduce` support (zeroes all
  animation/transition durations) — already implemented, must never
  regress.
- Motion in production use is limited to: sidebar collapse width
  transition, a live-pulse dot on healthy cluster status, hover-state
  color/border transitions, and dropdown/menu open transitions. No
  scroll-hijacking, no decorative looping animation, no motion without a
  state it is communicating.
- Prohibited: adding an animation library (Motion/GSAP/etc.) for effects
  achievable in CSS; motion that fires on page load purely for spectacle;
  motion that cannot be disabled by `prefers-reduced-motion`.

## Accessibility

- Keyboard navigation and a `.skip-link` ("Skip to content") are already
  implemented — preserve.
- `*:focus-visible` shows a visible ring app-wide; several inputs
  deliberately suppress the *mouse*-hover outline but must keep the
  keyboard-visible one (`main.css`, documented inline).
- Semantic markup: real `<nav>`, `<main id="main-content">`, heading
  levels — preserve existing structure when editing a page.
- Contrast: enforce the AA table under Color above. `--arc-text-dim` is
  large/bold-only; never pair it with body-sized (<14px) text.
- Touch targets: nav items, pills, and cards already meet a reasonable
  tap-target size on the mobile screenshots reviewed this pass; keep new
  interactive elements at a comparable size (~34px+ effective height).
- ARIA only where semantic HTML is insufficient (e.g. `role="status"` on
  the live cluster-health indicator).

## Anti-patterns

Explicitly avoided, and to be reverted on sight if introduced:

- Gradients beyond the established ones: the body daylight ground, the
  ink hero, and the 3px accent rule under KPI tiles.
- Cards nested within cards without a real hierarchy reason.
- Decorative icon tiles with no informational purpose.
- Excessive or gratuitous animation (see Motion above).
- Low-contrast text for anything meaning-bearing (see Color above).
- Inconsistent spacing — stick to the 4px-multiple rhythm.
- Arbitrary new component variants when an existing card/badge/button
  pattern already covers the case.
- Glass as an ornament on a few surfaces. Glass is the material of every
  pane; one recipe (blur 22px, saturate 150%, inset highlight), no
  per-page variants.
- Coloured `border-left` rails thicker than 1px on rows, cards or alerts
  (pending approval rows use an amber row wash instead).
- Hardcoded `rgba()` hue literals in components. Mix from `--arc-hue-*`.
- A second dark pane on a page. The hero is the only ink island.
- A fixed multi-column grid with no responsive fallback (the exact defect
  found and fixed this pass — see `UI_AUDIT.md`).
- Introducing a marketing-landing-page design vocabulary (hero sections
  with word-count limits, bento grids, scroll-hijacking, eyebrow labels
  on every section) — this is an operational dashboard, not a landing
  page; see `UI_AUDIT.md`'s note on `design-taste-frontend`'s own stated
  scope exclusion of dashboards.
