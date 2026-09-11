import { apiGet } from "../client.js";

export function registerControls(program) {
  const cmd = program
    .command("controls")
    .description("Evidence-v2 control assessments (Prompt 21)");

  cmd
    .command("list")
    .description("List every control's latest rolled-up status")
    .option("--status <status>", "Filter by status (pass|fail|unknown|n/a)")
    .action(async (opts) => {
      const data = await apiGet("/api/v1/controls");
      const filtered = opts.status
        ? data.filter(
            (c) => c.status.toLowerCase() === opts.status.toLowerCase(),
          )
        : data;
      console.log(JSON.stringify(filtered, null, 2));
    });

  cmd
    .command("show <control-id>")
    .description("Show one control's definition and per-scope assessments")
    .option(
      "--scope <scope>",
      "Filter to one scope (e.g. suppliers/pepsi/payments-api)",
    )
    .action(async (controlId, opts) => {
      const data = await apiGet(`/api/v1/controls/${controlId}`);
      if (opts.scope && Array.isArray(data.assessments)) {
        data.assessments = data.assessments.filter(
          (a) => a.scope === opts.scope,
        );
      }
      console.log(JSON.stringify(data, null, 2));
    });
}

export function registerMaturity(program) {
  program
    .command("maturity")
    .description("Gated maturity report — maturity level, coverage, confidence")
    .action(async () => {
      const r = await apiGet("/api/v1/maturity");
      console.log(`Maturity:   Level ${r.maturity} (${r.levelName})`);
      if (r.levelCapReason) console.log(`            ${r.levelCapReason}`);
      console.log(`Coverage:   ${r.coverage}%`);
      console.log(`Confidence: ${r.confidence}`);
      console.log();
      console.log(
        (r.controls ?? [])
          .map((c) => `  [${c.status.padEnd(7)}] ${c.id}  ${c.requirement}`)
          .join("\n"),
      );
    });
}
