import { apiGet, apiPost, apiDelete } from "../client.js";

export function registerSuppliers(program) {
  const cmd = program.command("suppliers").description("Manage suppliers");

  cmd
    .command("list")
    .description("List all suppliers")
    .action(async () => {
      const data = await apiGet("/api/v1/suppliers");
      console.log(JSON.stringify(data, null, 2));
    });

  cmd
    .command("create")
    .description("Register a new supplier")
    .requiredOption("--name <name>", "Supplier name")
    .requiredOption(
      "--namespace <ns>",
      "Vault namespace path (e.g. suppliers/pepsi)",
    )
    .option("--sla <tier>", "SLA tier: standard or premium", "standard")
    .action(async (opts) => {
      const data = await apiPost("/api/v1/suppliers", {
        name: opts.name,
        vault_namespace: opts.namespace,
        sla_tier: opts.sla,
      });
      console.log(JSON.stringify(data, null, 2));
    });

  cmd
    .command("delete <id>")
    .description("Deregister a supplier by ID")
    .action(async (id) => {
      await apiDelete(`/api/v1/suppliers/${id}`);
      console.log(`Supplier ${id} deleted.`);
    });
}
