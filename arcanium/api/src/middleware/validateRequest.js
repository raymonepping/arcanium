// middleware/validateRequest.js — Prompt 22, Deliverable 2.
//
// Request validation derived from openapi/arcanium.yaml's own requestBody
// schemas — not a fourth hand-typed copy of "what a valid POST body looks
// like" alongside the route's own field checks, the OpenAPI contract, and
// the CLI's request shapes. The contract is authoritative; this middleware
// reads it, dereferences its `$ref`s, and compiles it with ajv.
//
// Deliberately NOT wired into every route (Non-goals: "not adopting a
// fully generated server — routes still hand-written Express"). Wired into
// a representative, security-relevant sample (see index.js) as a real,
// working proof that validation traces back to the one contract — not
// exhaustively everywhere.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";
import Ajv from "ajv";

const __dirname = dirname(fileURLToPath(import.meta.url));
// The repo-root openapi/arcanium.yaml is the source of truth; this reads
// arcanium/api/openapi/arcanium.yaml, a build-context-local mirror kept in
// sync by `make openapi-generate` (Containerfile can't COPY outside its own
// build context, arcanium/api/ — see the Containerfile's own comment).
const OPENAPI_PATH = join(__dirname, "../../openapi/arcanium.yaml");

let spec = null;
const ajv = new Ajv({ allErrors: true, strict: false });

function loadSpec() {
  if (!spec) {
    spec = load(readFileSync(OPENAPI_PATH, "utf8"));
  }
  return spec;
}

// Resolves `{ $ref: "#/components/schemas/X" }` (and nested refs within X)
// by inlining the referenced schema — openapi/arcanium.yaml only ever
// refs its own components/schemas, never an external file, so this small
// walker is simpler and more predictable than wiring up ajv's own $id/$ref
// registry for a single-document contract.
function deref(node, schemas, seen) {
  if (Array.isArray(node)) return node.map((n) => deref(n, schemas, seen));
  if (node && typeof node === "object") {
    if (typeof node.$ref === "string") {
      const m = node.$ref.match(/^#\/components\/schemas\/(.+)$/);
      if (m && schemas[m[1]]) {
        if (seen.has(m[1])) return {}; // defensive cycle break
        return deref(schemas[m[1]], schemas, new Set(seen).add(m[1]));
      }
      return node;
    }
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = deref(v, schemas, seen);
    return out;
  }
  return node;
}

const compiled = new Map();

/**
 * Express middleware: validates req.body against the requestBody schema
 * openapi/arcanium.yaml declares for `method path` (e.g. "post
 * /api/v1/reconciliation/{run_id}/accept-exception"). 400s with per-field
 * ajv errors on failure — the same shape the direct-API 400 responses
 * already use, extended with `details`.
 */
export function validateRequestBody(path, method) {
  const key = `${method.toLowerCase()} ${path}`;
  return (req, res, next) => {
    try {
      if (!compiled.has(key)) {
        const doc = loadSpec();
        const op = doc.paths?.[path]?.[method.toLowerCase()];
        const rawSchema =
          op?.requestBody?.content?.["application/json"]?.schema;
        if (!rawSchema) {
          throw new Error(
            `no requestBody schema for "${key}" in openapi/arcanium.yaml — contract and route have drifted`,
          );
        }
        const schema = deref(
          rawSchema,
          doc.components?.schemas ?? {},
          new Set(),
        );
        compiled.set(key, ajv.compile(schema));
      }
      const validate = compiled.get(key);
      if (!validate(req.body ?? {})) {
        return res.status(400).json({
          error: "request failed schema validation",
          details: validate.errors,
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
