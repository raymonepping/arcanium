// evidence/ingest.js — Prompt 15.3
// Tails the Vault audit log and writes normalised evidence rows. Metadata only —
// audit path, actor, operation, outcome, tenant. Never bodies, never secrets.
//
// Feature-flagged: EVIDENCE_INGEST_ENABLED=true and the audit file mounted at
// AUDIT_LOG_PATH (default /vault/audit/vault-audit.log).

import { open, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { query } from "../db.js";

const ENABLED = process.env.EVIDENCE_INGEST_ENABLED === "true";
const AUDIT_PATH = process.env.AUDIT_LOG_PATH || "/vault/audit/vault-audit.log";

// Vault audit request.path → { operation, resource_type, resource_id }
function classify(op, path) {
  const p = String(path || "");
  let m;
  if ((m = p.match(/^transit\/(encrypt|decrypt|sign|verify|hmac)\/(.+)$/)))
    return { operation: m[1], resource_type: "key", resource_id: m[2] };
  if ((m = p.match(/^transit\/keys\/([^/]+)\/rotate$/)))
    return { operation: "rotate", resource_type: "key", resource_id: m[1] };
  if ((m = p.match(/^transit\/keys\/([^/]+)$/)) && op === "delete")
    return { operation: "destroy", resource_type: "key", resource_id: m[1] };
  if ((m = p.match(/^pki(-int)?\/issue\/(.+)$/)))
    return {
      operation: "issue",
      resource_type: "certificate",
      resource_id: m[2],
    };
  if ((m = p.match(/^sys\/namespaces\/(.+)$/)))
    return {
      operation: op === "delete" ? "namespace-delete" : "namespace-create",
      resource_type: "namespace",
      resource_id: m[1],
    };
  return null;
}

function actorFrom(auth) {
  if (!auth) return null;
  return (
    auth.display_name ||
    auth.metadata?.role_name ||
    auth.entity_id?.slice(0, 12) ||
    "token"
  );
}
function sourceFrom(auth) {
  const pols = (auth?.policies || []).join(" ");
  const name =
    (auth?.display_name || "") + " " + (auth?.metadata?.role_name || "");
  if (/external|supplier|partner/i.test(pols + name)) return "external";
  if (
    /approle|jwt|kubernetes|cert/i.test(auth?.token_type ? name : "") ||
    /workload|automation|arcanium|payments|pki|document|kmip/i.test(
      pols + name,
    ) ||
    auth?.display_name === "approle"
  )
    return "local";
  return "manual";
}

let supplierCache = null;
let supplierCacheAt = 0;
async function namespaceToSupplier(ns) {
  if (!ns || ns === "root/") return null;
  if (!supplierCache || Date.now() - supplierCacheAt > 60000) {
    const { rows } = await query("SELECT id, vault_namespace FROM suppliers");
    supplierCache = rows;
    supplierCacheAt = Date.now();
  }
  const clean = ns.replace(/\/$/, "");
  return supplierCache.find((s) => s.vault_namespace === clean)?.id ?? null;
}

/** Read new bytes from the audit log, parse response entries, insert evidence. */
export async function ingestAuditLog() {
  if (!ENABLED) return { ingested: 0, skipped: "disabled" };

  let size;
  try {
    size = (await stat(AUDIT_PATH)).size;
  } catch {
    return { ingested: 0, skipped: "no audit file" };
  }

  const { rows: cur } = await query(
    "SELECT offset_bytes FROM ingest_cursor WHERE path = $1",
    [AUDIT_PATH],
  );
  let offset = Number(cur[0]?.offset_bytes ?? 0); // node-pg returns BIGINT as string
  if (!Number.isFinite(offset) || offset > size) offset = 0; // log rotated

  if (offset >= size) return { ingested: 0 };

  const fh = await open(AUDIT_PATH, "r");
  const buf = Buffer.alloc(size - offset);
  await fh.read(buf, 0, buf.length, offset);
  await fh.close();

  const lines = buf.toString("utf8").split("\n");
  // The last element may be a partial line — leave it for next pass.
  const partialLen = Buffer.byteLength(lines.pop() ?? "", "utf8");
  let ingested = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type !== "response") continue; // one row per completed op
    const c = classify(e.request?.operation, e.request?.path);
    if (!c) continue;

    const ns = e.request?.namespace?.path || "root/";
    const supplierId = await namespaceToSupplier(ns);
    const outcome = e.error ? "error" : "ok";
    const ts = e.time || new Date().toISOString();
    const actor = actorFrom(e.auth);
    const source = sourceFrom(e.auth);
    const dedupe = createHash("sha256")
      .update(`${ts}|${e.request?.id}|${c.operation}|${c.resource_id}`)
      .digest("hex")
      .slice(0, 40);

    try {
      const r = await query(
        `INSERT INTO evidence
           (ts, actor, source, operation, resource_type, resource_id, namespace, supplier_id, outcome, origin, dedupe_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'audit-log',$10)
         ON CONFLICT (dedupe_key) DO NOTHING`,
        [
          ts,
          actor,
          source,
          c.operation,
          c.resource_type,
          c.resource_id,
          ns.replace(/\/$/, ""),
          supplierId,
          outcome,
          dedupe,
        ],
      );
      if (r.rowCount) ingested++;
    } catch {
      /* skip malformed row */
    }
  }

  await query(
    `INSERT INTO ingest_cursor (path, offset_bytes, updated_at)
     VALUES ($1,$2,now())
     ON CONFLICT (path) DO UPDATE SET offset_bytes = EXCLUDED.offset_bytes, updated_at = now()`,
    [AUDIT_PATH, size - partialLen],
  );

  return { ingested };
}
