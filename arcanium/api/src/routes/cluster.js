// routes/cluster.js — per-node Vault health topology for the UI.
// Queries each Vault node's /v1/sys/health directly (server-side only).
// The UI never calls Vault — it calls /api/v1/cluster through the gateway.

import { Router } from "express";
import { request as httpsRequest } from "node:https";
import { readFileSync } from "node:fs";
import config from "../config.js";

export const clusterRouter = Router();

const NODES = [
  { name: "vault-s", host: "vault-s", port: 8200, role: "seal-provider" },
  { name: "vault-1", host: "vault-1", port: 8200, role: "cluster-member" },
  { name: "vault-2", host: "vault-2", port: 8200, role: "cluster-member" },
  { name: "vault-3", host: "vault-3", port: 8200, role: "cluster-member" },
  {
    name: "vault-hsm",
    host: "vault-hsm",
    port: 8200,
    role: "autounseal-provider",
  },
];

function fetchNodeHealth(host, port) {
  return new Promise((resolve) => {
    let ca;
    try {
      ca = readFileSync(config.vault.cacert);
    } catch {
      resolve({ ok: false });
      return;
    }
    const req = httpsRequest(
      {
        hostname: host,
        port,
        path: "/v1/sys/health",
        method: "GET",
        ca,
        // 200 = active leader, 429 = standby, 472 = perf standby, 503 = sealed
        // We set standbyok=false so standbys return 429 — we read the body regardless
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try {
            resolve({
              ok: true,
              statusCode: res.statusCode,
              body: JSON.parse(raw),
            });
          } catch {
            resolve({ ok: false });
          }
        });
      },
    );
    req.setTimeout(3000, () => {
      req.destroy();
      resolve({ ok: false });
    });
    req.on("error", () => resolve({ ok: false }));
    req.end();
  });
}

// GET /api/v1/cluster
clusterRouter.get("/", async (_req, res) => {
  const results = await Promise.all(
    NODES.map(async (node) => {
      const result = await fetchNodeHealth(node.host, node.port);
      if (!result.ok) {
        return {
          name: node.name,
          role: node.role,
          reachable: false,
          health: null,
        };
      }
      const h = result.body;
      return {
        name: node.name,
        role: node.role,
        reachable: true,
        status_code: result.statusCode,
        health: {
          initialized: h.initialized === true,
          sealed: h.sealed !== false,
          standby: h.standby === true,
          performance_standby: h.performance_standby === true,
          replication_performance_mode:
            h.replication_performance_mode ?? "disabled",
          replication_dr_mode: h.replication_dr_mode ?? "disabled",
          version: h.version ?? "unknown",
          cluster_name: h.cluster_name,
          cluster_id: h.cluster_id,
          ha_enabled: h.ha_enabled,
          last_wal: h.last_wal,
          server_time_utc: h.server_time_utc,
        },
      };
    }),
  );
  res.json(results);
});
