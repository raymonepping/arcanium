import { apiGet, apiPost, apiPatch } from "../client.js";

export function registerReconciliation(program) {
  const cmd = program
    .command("reconciliation")
    .description("Desired state vs Vault observed state (Prompt 20)");

  cmd
    .command("list")
    .description(
      "List desired-state rows with their latest reconciliation status",
    )
    .option(
      "--status <status>",
      "Filter by observation_status (compliant|drifted|unknown)",
    )
    .option(
      "--disposition <disposition>",
      "Filter by disposition (open|exception_accepted|reconciled)",
    )
    .action(async (opts) => {
      const qs = new URLSearchParams();
      if (opts.status) qs.set("status", opts.status);
      if (opts.disposition) qs.set("disposition", opts.disposition);
      const q = qs.toString();
      const data = await apiGet(`/api/v1/reconciliation${q ? `?${q}` : ""}`);
      console.log(JSON.stringify(data, null, 2));
    });

  cmd
    .command("show <run-id>")
    .description(
      "Show one reconciliation run in full (desired-state history + actions)",
    )
    .action(async (runId) => {
      const data = await apiGet(`/api/v1/reconciliation/${runId}`);
      console.log(JSON.stringify(data, null, 2));
    });

  cmd
    .command("run")
    .description(
      "Trigger an on-demand reconciliation sweep (all visible applications, or one)",
    )
    .option(
      "--desired-state-id <id>",
      "Run against a single desired_state row only",
    )
    .action(async (opts) => {
      const body = opts.desiredStateId
        ? { desired_state_id: opts.desiredStateId }
        : {};
      const data = await apiPost("/api/v1/reconciliation/run", body);
      console.log(JSON.stringify(data, null, 2));
    });

  cmd
    .command("reconcile <run-id>")
    .description(
      "Correct drift: write the desired value back to Vault and re-observe",
    )
    .action(async (runId) => {
      const data = await apiPost(`/api/v1/reconciliation/${runId}/reconcile`);
      console.log(JSON.stringify(data, null, 2));
    });

  cmd
    .command("accept-exception <run-id>")
    .description(
      "Accept a drift as a governed, time-boxed exception (does not touch Vault)",
    )
    .requiredOption("--reason <reason>", "Why this drift is being accepted")
    .requiredOption(
      "--expires <date>",
      "ISO date/time the exception expires (required — no open-ended exceptions)",
    )
    .action(async (runId, opts) => {
      const data = await apiPost(
        `/api/v1/reconciliation/${runId}/accept-exception`,
        {
          reason: opts.reason,
          expires_at: opts.expires,
        },
      );
      console.log(JSON.stringify(data, null, 2));
    });

  cmd
    .command("set-desired <desired-state-id>")
    .description(
      "Edit the desired value itself (e.g. change desired rotation from 30 to 90 days)",
    )
    .requiredOption(
      "--days <n>",
      "New desired rotation_period, in days",
      Number,
    )
    .option("--reason <reason>", "Why the intent changed")
    .action(async (id, opts) => {
      const data = await apiPatch(
        `/api/v1/reconciliation/desired-state/${id}`,
        {
          desired_value: { days: opts.days },
          reason: opts.reason,
        },
      );
      console.log(JSON.stringify(data, null, 2));
    });
}
