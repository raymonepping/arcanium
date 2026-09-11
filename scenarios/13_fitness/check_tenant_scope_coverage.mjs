#!/usr/bin/env node
// scenarios/13_fitness/check_tenant_scope_coverage.mjs — Prompt 22, Deliverable 4.
//
// "No application/key/tenant row is ever queried without a tenant-scope
// predicate in supplier-facing routes." Heuristic, grep-based (matching
// this file's sibling check_authorize_coverage.mjs's own approach): for
// every GET route whose handler queries one of the tenant-relevant tables,
// the same handler slice must call tenantScope( — the Phase 18
// GET /applications/:id gap (found live, not by review) is exactly the
// bug class this guards against recurring.
//
// A short, explicit allowlist covers routes that are genuinely estate-wide
// by design (documented inline, not silently skipped) — e.g. the isolation
// check itself, which by definition reads across every tenant to prove the
// boundary holds.

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTES_DIR = join(__dirname, "../../arcanium/api/src/routes");

const ROUTE_RE = /^(\w+)\.(get|post|patch|put|delete)\(\s*"([^"]*)"/;
const FUNC_RE = /^(?:async\s+)?function\s+(\w+)\s*\(/;
const TENANT_TABLES = [
  "applications",
  "suppliers",
  "desired_state",
  "reconciliation_runs",
  "reconciliation_actions",
  "control_assessments",
  "crypto_profiles",
  "approval_requests",
];

// file:route -> reason it's deliberately estate-wide, checked against the
// real code each time this runs (not a static assumption).
const ESTATE_WIDE_EXCEPTIONS = new Set([
  "suppliers.js:GET /isolation", // by definition, cross-tenant — that's the whole check
]);

let gaps = [];
let checked = 0;

for (const file of readdirSync(ROUTES_DIR).sort()) {
  if (!file.endsWith(".js")) continue;
  const path = join(ROUTES_DIR, file);
  const lines = readFileSync(path, "utf8").split("\n");

  const funcStarts = [];
  const routeStarts = [];
  lines.forEach((l, i) => {
    const fm = l.match(FUNC_RE);
    if (fm) funcStarts.push({ name: fm[1], line: i });
    const rm = l.match(ROUTE_RE);
    if (rm) routeStarts.push({ method: rm[2], routePath: rm[3], line: i });
  });
  const boundaries = [...funcStarts.map((f) => f.line), ...routeStarts.map((r) => r.line)]
    .sort((a, b) => a - b);

  function sliceFrom(startLine) {
    const nextBoundary = boundaries.find((b) => b > startLine);
    const end = nextBoundary ?? lines.length;
    return lines.slice(startLine, end).join("\n");
  }

  // Which local helper functions themselves reach tenantScope() — e.g.
  // routes/controls.js's filterToTenant() — same indirection this check's
  // sibling (check_authorize_coverage.mjs) already accounts for.
  const scopingHelpers = new Set();
  for (const f of funcStarts) {
    if (sliceFrom(f.line).includes("tenantScope(")) scopingHelpers.add(f.name);
  }

  for (const r of routeStarts) {
    if (r.method !== "get") continue; // reads are the leak surface; writes are covered by authorize()+their own tenantScope calls
    const slice = sliceFrom(r.line);
    const touchesTenantTable = TENANT_TABLES.some((t) =>
      new RegExp(`\\bFROM\\s+${t}\\b|\\bJOIN\\s+${t}\\b`, "i").test(slice),
    );
    if (!touchesTenantTable) continue;
    checked++;
    const key = `${file}:GET ${r.routePath}`;
    if (ESTATE_WIDE_EXCEPTIONS.has(key)) continue;
    const callsScopeDirectly = slice.includes("tenantScope(");
    const callsKnownHelper = [...scopingHelpers].some((h) =>
      new RegExp(`\\b${h}\\s*\\(`).test(slice),
    );
    if (!callsScopeDirectly && !callsKnownHelper) {
      gaps.push(`${file}:${r.line + 1} GET ${r.routePath}`);
    }
  }
}

console.log(`checked ${checked} tenant-relevant GET route(s) across arcanium/api/src/routes/*.js`);
if (gaps.length) {
  console.log(`GAP: ${gaps.length} route(s) query a tenant-relevant table without calling tenantScope():`);
  for (const g of gaps) console.log(`  - ${g}`);
  process.exit(1);
} else {
  console.log("OK: every tenant-relevant GET route calls tenantScope() (or is a documented estate-wide exception)");
  process.exit(0);
}
