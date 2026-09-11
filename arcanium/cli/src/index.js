#!/usr/bin/env node
// src/index.js — Arcanium CLI entry point.
import { program } from "commander";
import { registerHealth } from "./commands/health.js";
import { registerSuppliers } from "./commands/suppliers.js";
import { registerApplications } from "./commands/applications.js";
import { registerKeys } from "./commands/keys.js";
import { registerApprovals } from "./commands/approvals.js";
import { registerJobs } from "./commands/jobs.js";
import { registerOnboard } from "./commands/onboard.js";
import { registerIntegrations } from "./commands/integrations.js";
import { registerReconciliation } from "./commands/reconciliation.js";
import { registerControls, registerMaturity } from "./commands/controls.js";

program
  .name("arcanium")
  .description(
    "Arcanium CLI — manage the Arcanium cryptographic lifecycle platform",
  )
  .version("1.0.0");

registerHealth(program);
registerSuppliers(program);
registerApplications(program);
registerKeys(program);
registerApprovals(program);
registerJobs(program);
registerOnboard(program);
registerIntegrations(program);
registerReconciliation(program);
registerControls(program);
registerMaturity(program);

program.parseAsync(process.argv).catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
