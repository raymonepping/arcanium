import { apiGet } from "../client.js";

export function registerJobs(program) {
  const cmd = program.command("jobs").description("Provisioning jobs");

  cmd
    .command("list")
    .description("List provisioning jobs")
    .option(
      "--status <status>",
      "pending | running | succeeded | failed | rolled_back",
    )
    .action(async (opts) => {
      const q = opts.status ? `?status=${opts.status}` : "";
      const data = await apiGet(`/api/v1/jobs${q}`);
      for (const j of data) {
        console.log(
          `${j.status.padEnd(11)} ${j.action.padEnd(12)} ${j.target_type}/${j.target_name || j.target_id.slice(0, 8)}  ${j.created_at}`,
        );
      }
    });

  cmd
    .command("show <id>")
    .description("Show one job with its ordered steps")
    .action(async (id) => {
      const j = await apiGet(`/api/v1/jobs/${id}`);
      console.log(
        `${j.action} ${j.target_type}/${j.target_name}  → ${j.status}`,
      );
      for (const s of j.steps || []) {
        console.log(
          `  ${String(s.status).padEnd(10)} ${s.step}${s.detail ? "  " + (typeof s.detail === "string" ? s.detail : JSON.stringify(s.detail)) : ""}`,
        );
      }
      if (j.error) console.log(`  error: ${j.error}`);
    });
}
