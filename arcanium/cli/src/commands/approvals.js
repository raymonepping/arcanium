import { apiGet, apiPost } from "../client.js";

export function registerApprovals(program) {
  const cmd = program
    .command("approvals")
    .description("Manage approval requests (four-eyes)");

  cmd
    .command("list")
    .description("List pending approval requests")
    .action(async () => {
      const data = await apiGet("/api/v1/approvals");
      console.log(JSON.stringify(data, null, 2));
    });

  cmd
    .command("approve <accessor>")
    .description("Approve a pending Control Group request (source=manual)")
    .action(async (accessor) => {
      // source=manual: human operator via CLI
      const data = await apiPost(`/api/v1/approvals/${accessor}/authorize`, {
        source: "manual",
      });
      console.log(`Approved accessor: ${accessor}`);
      if (data) console.log(JSON.stringify(data, null, 2));
    });

  cmd
    .command("deny <accessor>")
    .description("Deny a pending Control Group request (source=manual)")
    .action(async (accessor) => {
      const data = await apiPost(`/api/v1/approvals/${accessor}/deny`, {
        source: "manual",
      });
      console.log(`Denied accessor: ${accessor}`);
      if (data) console.log(JSON.stringify(data, null, 2));
    });
}
