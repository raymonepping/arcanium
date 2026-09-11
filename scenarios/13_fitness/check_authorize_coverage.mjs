#!/usr/bin/env node
// scenarios/13_fitness/check_authorize_coverage.mjs — Prompt 22, Deliverable 4.
//
// "Every mutating route in arcanium/api/src/routes/*.js calls authorize()."
// A route is considered covered if its handler slice (from its own
// registration line to the next route/function boundary) calls authorize()
// directly, OR calls a local helper function that itself calls authorize()
// somewhere in its own body (e.g. keymgmt.js's requireOperator()) — a
// grep-based heuristic, not a real AST walk, but matched against this
// codebase's actual, consistent style (one xRouter.method(...) call per
// route, always at column 0, one route per registration).
//
// Exit 0 + prints "OK" lines if every mutating route is covered.
// Exit 1 + prints "GAP" lines (file:line route) for anything uncovered —
// a real finding, never silently narrowed away.

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTES_DIR = join(__dirname, "../../arcanium/api/src/routes");

const ROUTE_RE = /^(\w+)\.(get|post|patch|put|delete)\(\s*"([^"]*)"/;
const FUNC_RE = /^(?:async\s+)?function\s+(\w+)\s*\(/;
const MUTATING = new Set(["post", "patch", "put", "delete"]);

let gaps = [];
let checked = 0;

for (const file of readdirSync(ROUTES_DIR).sort()) {
  if (!file.endsWith(".js")) continue;
  const path = join(ROUTES_DIR, file);
  const lines = readFileSync(path, "utf8").split("\n");

  // Pass 1 — find every "function NAME(" declaration's line, and every
  // route registration's line, as segment boundaries (sorted).
  const funcStarts = []; // { name, line }
  const routeStarts = []; // { method, routePath, line }
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

  // Which local helper functions themselves reach authorize()?
  const authorizingHelpers = new Set();
  for (const f of funcStarts) {
    if (sliceFrom(f.line).includes("authorize(")) authorizingHelpers.add(f.name);
  }

  for (const r of routeStarts) {
    if (!MUTATING.has(r.method)) continue;
    checked++;
    const slice = sliceFrom(r.line);
    const callsAuthorizeDirectly = slice.includes("authorize(");
    const callsKnownHelper = [...authorizingHelpers].some((h) =>
      new RegExp(`\\b${h}\\s*\\(`).test(slice),
    );
    if (!callsAuthorizeDirectly && !callsKnownHelper) {
      gaps.push(`${file}:${r.line + 1} ${r.method.toUpperCase()} ${r.routePath}`);
    }
  }
}

console.log(`checked ${checked} mutating route(s) across arcanium/api/src/routes/*.js`);
if (gaps.length) {
  console.log(`GAP: ${gaps.length} mutating route(s) never reach authorize():`);
  for (const g of gaps) console.log(`  - ${g}`);
  process.exit(1);
} else {
  console.log("OK: every mutating route reaches authorize(), directly or via a local helper");
  process.exit(0);
}
