// teams/registry.js — Prompt 27, Deliverable 2/3.
//
// The resolution helpers authorize() callsites and list-filtering routes
// need on top of the plain teams table CRUD in routes/teams.js. Kept
// separate from routes/teams.js so non-route code (authorize callsites,
// resolveReadScope) can import it without pulling in Express routing.

import { query } from "../db.js";

// Given a supplier_id, return the name of the team it belongs to, or null
// if it isn't assigned to any team (or has no supplier — a platform-
// category application). A supplier can belong to at most one team in this
// model (supplier_ids arrays are not expected to overlap across teams;
// first match wins if they ever do, rather than erroring).
export async function resolveTeamForSupplier(supplierId) {
  if (!supplierId) return null;
  const { rows } = await query(
    "SELECT name FROM teams WHERE supplier_ids @> ARRAY[$1]::uuid[] LIMIT 1",
    [supplierId],
  );
  return rows[0]?.name ?? null;
}

// Given a team name, return the supplier_ids it covers — null means "every
// supplier" (an audit team scoped by team, not by tenant), a real array
// (possibly empty) means exactly those suppliers. Returns undefined if the
// team name doesn't exist at all (distinct from "exists but covers none").
export async function resolveSupplierIdsForTeam(teamName) {
  const { rows } = await query(
    "SELECT supplier_ids FROM teams WHERE name = $1",
    [teamName],
  );
  if (!rows.length) return undefined;
  return rows[0].supplier_ids; // null or uuid[]
}
