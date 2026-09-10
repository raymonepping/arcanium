import { apiGet, apiPost } from "../client.js";

export function registerKeys(program) {
  const cmd = program.command("keys").description("Manage Transit keys");

  cmd
    .command("list")
    .description("List Transit keys, optionally scoped to a supplier")
    .option(
      "--supplier <name>",
      "Supplier name — lists keys in supplier Vault namespace",
    )
    .action(async (opts) => {
      if (opts.supplier) {
        const suppliers = await apiGet("/api/v1/suppliers");
        const sup = suppliers.find((s) => s.name === opts.supplier);
        if (!sup) {
          console.error(`Supplier '${opts.supplier}' not found`);
          process.exit(1);
        }
        const data = await apiGet(`/api/v1/suppliers/${sup.id}/keys`);
        console.log(JSON.stringify(data, null, 2));
      } else {
        const data = await apiGet("/api/v1/keys");
        console.log(JSON.stringify(data, null, 2));
      }
    });

  cmd
    .command("create")
    .description("Create a new Transit key")
    .requiredOption("--name <name>", "Key name")
    .option(
      "--type <type>",
      "Key type (e.g. aes256-gcm96, rsa-4096)",
      "aes256-gcm96",
    )
    .action(async (opts) => {
      const data = await apiPost("/api/v1/keys", {
        name: opts.name,
        type: opts.type,
      });
      console.log(JSON.stringify(data, null, 2));
    });

  cmd
    .command("rotate <name>")
    .description("Rotate a Transit key (recorded as a provisioning job)")
    .action(async (name) => {
      const data = await apiPost(`/api/v1/keys/${name}/rotate`);
      console.log(JSON.stringify(data?.provisioning_job ?? data, null, 2));
    });

  cmd
    .command("rewrap <name>")
    .description(
      "Rewrap ciphertext to the latest key version (ciphertext only)",
    )
    .requiredOption("--ciphertext <ct>", "vault:v*: ciphertext string")
    .action(async (name, opts) => {
      const data = await apiPost(`/api/v1/keys/${name}/rewrap`, {
        ciphertext: opts.ciphertext,
      });
      console.log(data?.ciphertext ?? JSON.stringify(data, null, 2));
    });

  cmd
    .command("destroy <name>")
    .description(
      "Request key destruction — governance-gated, records an approval",
    )
    .action(async (name) => {
      const data = await apiPost(`/api/v1/keys/${name}/destroy`);
      console.log(JSON.stringify(data, null, 2));
    });
}
