// provisioner/dispatch.js — Prompt 15.6
// Executes a provisioning_jobs row. Used both by the route handlers (sync mode)
// and by src/worker.js (queue mode). Reconstructs the provisioner call from the
// job's target + params.

import { query } from "../db.js";
import { provisionSupplier, deprovisionSupplier } from "./supplier.js";
import { provisionApplication } from "./application.js";
import { rotateKey } from "./key.js";

export async function dispatchJob(job) {
  const params = job.params ?? {};

  if (job.target_type === "supplier") {
    const { rows } = await query(
      "SELECT id, name, vault_namespace, sla_tier FROM suppliers WHERE id = $1",
      [job.target_id],
    );
    if (!rows.length && job.action === "provision") {
      job.status = "failed";
      job.error = "supplier row disappeared before the job ran";
      return job;
    }
    const supplier = rows[0] ?? {
      id: job.target_id,
      name: job.target_name,
      vault_namespace: params.vault_namespace,
      sla_tier: params.sla_tier,
    };
    return job.action === "deprovision"
      ? deprovisionSupplier(job, supplier, { force: params.force === true })
      : provisionSupplier(job, supplier);
  }

  if (job.target_type === "application") {
    const { rows } = await query(
      "SELECT id, name, supplier_id FROM applications WHERE id = $1",
      [job.target_id],
    );
    if (!rows.length) {
      job.status = "failed";
      job.error = "application row not found";
      return job;
    }
    return provisionApplication(job, rows[0], params);
  }

  if (job.target_type === "key" && job.action === "rotate") {
    return rotateKey(job, job.target_id);
  }

  job.status = "failed";
  job.error = `no dispatcher for ${job.target_type}/${job.action}`;
  return job;
}
