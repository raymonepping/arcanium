// routes/keymgmt.js — Prompt 14.3 + 15.5 — external key distribution (Key Management engine).
//
// The Key Management secrets engine generates a Vault-owned key and distributes a
// copy to an external cloud KMS (AWS KMS / Azure Key Vault / GCP Cloud KMS),
// managing its lifecycle there (create → rotate → remove).
//
// The operator will NOT connect a real cloud account (input, 2026-09-10). So the
// distribution *lifecycle* is exercised against an emulated KMS — LocalStack's
// `kms` service (compose/kms-sim/) — reached through the awskms provider with an
// `endpoint` override. Anything distributed there is labelled `emulated: true`
// and never presented as a real cloud KMS. When compose/kms-sim is down the
// provider is shown as unreachable — never a fabricated success.

import { Router } from "express";
import { vaultRequest, getProvisionerToken } from "../vault.js";
import { readFeatures } from "./platform.js";
import { cryptoOp } from "../telemetry/metrics.js";
import { authorize } from "../auth/authorize.js";

export const keymgmtRouter = Router();

const MOUNT = "keymgmt";
const KEY_RE = /^[a-zA-Z0-9_.-]{1,128}$/;

// The emulated KMS endpoint the awskms provider is pointed at. A provider whose
// name or stored endpoint matches this host is flagged `emulated`.
const KMS_SIM_URL =
  process.env.KMS_SIM_URL || "http://arcanium-localstack:4566";
const KMS_SIM_HOST = (() => {
  try {
    return new URL(KMS_SIM_URL).host;
  } catch {
    return "arcanium-localstack:4566";
  }
})();

async function vx(method, path, body) {
  return vaultRequest(method, path, body ?? null, getProvisionerToken());
}

async function kmsSimReachable() {
  try {
    const r = await fetch(`${KMS_SIM_URL}/_localstack/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!r.ok) return false;
    const body = await r.json().catch(() => ({}));
    return ["available", "running"].includes(body?.services?.kms);
  } catch {
    return false;
  }
}

function isEmulatedProvider(name, meta) {
  if (name === "localstack" || name === "kms-sim") return true;
  const ep = meta?.credentials?.endpoint || meta?.endpoint || "";
  return typeof ep === "string" && ep.includes(KMS_SIM_HOST);
}

// Vault's keymgmt read for a distributed key round-trips to the KMS provider —
// when the (emulated) KMS is down that call blocks on a TCP timeout. Cap it so
// GET /api/v1/keymgmt always answers promptly with an honest "unreachable".
function raceTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("kms-read-timeout")), ms),
    ),
  ]).catch(() => null);
}

// GET /api/v1/keymgmt
keymgmtRouter.get("/", async (_req, res, next) => {
  try {
    const ent = await readFeatures();
    if (!ent.capabilities?.key_management_engine) {
      return res.json({
        available: false,
        reason:
          "ADP Key Management (Key Management Secrets Engine) is not in the Vault licence features.",
        pattern: "Vault → external cloud KMS",
      });
    }

    // Is the engine mounted?
    let mounted = false;
    try {
      const mounts = await vx("GET", "sys/mounts");
      mounted = Boolean(mounts?.data?.[`${MOUNT}/`] || mounts?.[`${MOUNT}/`]);
    } catch {
      mounted = false;
    }
    if (!mounted) {
      return res.json({
        available: true,
        engine: "not mounted",
        hint: "Run `make tf-keymgmt` (terraform/vault-keymgmt/) to mount the engine and create a key.",
        keys: [],
        providers: [],
      });
    }

    const keyList =
      (await vx("LIST", `${MOUNT}/key`).catch(() => ({})))?.data?.keys ?? [];
    const providerNames =
      (await vx("LIST", `${MOUNT}/kms`).catch(() => ({})))?.data?.keys ?? [];

    const simUp = providerNames.length ? await kmsSimReachable() : false;
    const providers = [];
    for (const pn of providerNames) {
      const meta =
        (
          await vx("GET", `${MOUNT}/kms/${encodeURIComponent(pn)}`).catch(
            () => ({}),
          )
        )?.data ?? {};
      const emulated = isEmulatedProvider(pn, meta);
      providers.push({
        name: pn,
        provider: meta.provider ?? "awskms",
        key_collection: meta.key_collection ?? null,
        emulated,
        reachable: emulated ? simUp : null, // real providers are not probed
        label: emulated
          ? "emulated · LocalStack"
          : (meta.provider ?? "cloud KMS"),
      });
    }

    const keys = [];
    for (const name of keyList) {
      const meta =
        (
          await vx("GET", `${MOUNT}/key/${encodeURIComponent(name)}`).catch(
            () => ({}),
          )
        )?.data ?? {};

      const distributed_to = [];
      for (const p of providers) {
        const unreachable = p.emulated && p.reachable === false;
        const d = await raceTimeout(
          vx(
            "GET",
            `${MOUNT}/kms/${encodeURIComponent(p.name)}/key/${encodeURIComponent(name)}`,
          ),
          unreachable ? 2500 : 8000,
        );
        if (!d?.data) continue; // not distributed here, or can't be confirmed now
        distributed_to.push({
          name: p.name,
          provider: p.provider,
          emulated: p.emulated,
          reachable: p.reachable,
          remote_name: d.data.name ?? null,
          protection: d.data.protection ?? null,
          purpose: d.data.purpose ?? null,
          versions: Object.keys(d.data.versions ?? {}).length,
          distribution_time: d.data.distribution_time ?? null,
          status: unreachable ? "unreachable" : "in-sync",
        });
      }

      keys.push({
        name,
        type: meta.type,
        latest_version: meta.latest_version,
        deletion_allowed: meta.deletion_allowed,
        distributed_to,
      });
    }

    const anyEmulated = providers.some((p) => p.emulated);
    res.json({
      available: true,
      engine: "mounted",
      keys,
      providers,
      emulated: anyEmulated,
      note: providers.length
        ? anyEmulated
          ? "Distribution targets an EMULATED KMS (LocalStack). This exercises the full distribute → rotate → remove lifecycle with no cloud account; nothing leaves the machine. A real cloud KMS is a credentials change away."
          : null
        : "No cloud KMS provider configured. Start compose/kms-sim (`make kms-sim-up`) then `make tf-keymgmt` for the emulated demo, or set real provider credentials.",
    });
  } catch (err) {
    next(err);
  }
});

// Prompt 18 — routed through the central authorize() matrix. Both call
// sites below are 'rotate' actions (key distribution rotate/sync) —
// architect and operator, not ciso/auditor/supplier-admin.
function requireOperator(req, res) {
  const decision = authorize({ identity: req.identity, action: "rotate" });
  if (decision.decision !== "ALLOW") {
    res
      .status(403)
      .json({ error: "forbidden", action: "rotate", reason: decision.reason });
    return false;
  }
  return true;
}

// POST /api/v1/keymgmt/:name/rotate — rotate the Vault-owned key. The engine
// auto-distributes the new version to every KMS the key already lives in.
keymgmtRouter.post("/:name/rotate", async (req, res, next) => {
  try {
    const { name } = req.params;
    if (!KEY_RE.test(name))
      return res.status(400).json({ error: "invalid key name" });
    if (!requireOperator(req, res)) return;

    await vx("POST", `${MOUNT}/key/${encodeURIComponent(name)}/rotate`, {});
    const meta =
      (
        await vx("GET", `${MOUNT}/key/${encodeURIComponent(name)}`).catch(
          () => ({}),
        )
      )?.data ?? {};
    cryptoOp("rotate", `keymgmt/${name}`);
    res.json({
      key: name,
      latest_version: meta.latest_version ?? null,
      note: "New key version created. Distributed copies pick it up on sync.",
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/keymgmt/:name/sync — (re-)push the key to a distribution target.
// Body: { provider: "localstack", purpose?: "encrypt,decrypt", protection?: "hsm" }
keymgmtRouter.post("/:name/sync", async (req, res, next) => {
  try {
    const { name } = req.params;
    if (!KEY_RE.test(name))
      return res.status(400).json({ error: "invalid key name" });
    if (!requireOperator(req, res)) return;

    const provider = (req.body ?? {}).provider;
    if (!provider || !KEY_RE.test(provider))
      return res.status(400).json({ error: "provider is required" });

    const purpose = (req.body ?? {}).purpose || "encrypt,decrypt";
    const protection = (req.body ?? {}).protection || "hsm";
    const path = `${MOUNT}/kms/${encodeURIComponent(provider)}/key/${encodeURIComponent(name)}`;

    // A bare write re-syncs an existing distribution; a first distribute needs
    // purpose + protection.
    const existing = await vx("GET", path).catch(() => null);
    await vx("POST", path, existing?.data ? {} : { purpose, protection });

    const status = await vx("GET", path).catch(() => null);
    cryptoOp("distribute", `keymgmt/${name}`);
    res.json({
      key: name,
      provider,
      distributed: Boolean(status?.data),
      remote_name: status?.data?.name ?? null,
      versions: Object.keys(status?.data?.versions ?? {}).length,
      distribution_time: status?.data?.distribution_time ?? null,
    });
  } catch (err) {
    if (err?.status === 400)
      return res.status(400).json({ error: err.message });
    next(err);
  }
});
