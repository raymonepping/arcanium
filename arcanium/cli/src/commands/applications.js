import { apiGet, apiPost } from "../client.js";

export function registerApplications(program) {
  const cmd = program
    .command("applications")
    .description("Manage applications");

  cmd
    .command("list")
    .description("List applications, optionally filtered by supplier name")
    .option("--supplier <name>", "Filter by supplier name")
    .action(async (opts) => {
      if (opts.supplier) {
        // Resolve supplier name → id
        const suppliers = await apiGet("/api/v1/suppliers");
        const sup = suppliers.find((s) => s.name === opts.supplier);
        if (!sup) {
          console.error(`Supplier '${opts.supplier}' not found`);
          process.exit(1);
        }
        const data = await apiGet(`/api/v1/suppliers/${sup.id}/applications`);
        console.log(JSON.stringify(data, null, 2));
      } else {
        const data = await apiGet("/api/v1/applications");
        console.log(JSON.stringify(data, null, 2));
      }
    });

  cmd
    .command("register")
    .description("Register a new application")
    .requiredOption("--name <name>", "Application name")
    .option("--description <desc>", "Description")
    .option("--supplier <name>", "Associate with supplier by name")
    .action(async (opts) => {
      let supplier_id = null;
      if (opts.supplier) {
        const suppliers = await apiGet("/api/v1/suppliers");
        const sup = suppliers.find((s) => s.name === opts.supplier);
        if (!sup) {
          console.error(`Supplier '${opts.supplier}' not found`);
          process.exit(1);
        }
        supplier_id = sup.id;
      }
      const data = await apiPost("/api/v1/applications", {
        name: opts.name,
        description: opts.description ?? "",
        supplier_id,
      });
      console.log(JSON.stringify(data, null, 2));
    });

  cmd
    .command("provision <id>")
    .description(
      "Provision workload identity + policy + Transit key for an application",
    )
    .option("--tls", "also create a PKI role")
    .option("--symmetric", "AES-256-GCM key (default)")
    .option("--signing", "RSA-4096 signing key")
    .option("--custody <mode>", "vault | softhsm", "vault")
    .option("--rotation <days>", "auto-rotation period in days")
    .action(async (id, opts) => {
      const capabilities = [];
      if (opts.symmetric || (!opts.signing && !opts.tls))
        capabilities.push("encrypt", "decrypt");
      if (opts.signing) capabilities.push("sign", "verify");
      const body = {
        custody: opts.custody === "softhsm" ? "softhsm" : "vault",
        key_type: opts.signing ? "rsa-4096" : "aes256-gcm96",
        capabilities,
        tls: !!opts.tls,
        rotation_days: opts.rotation ? Number(opts.rotation) : undefined,
      };
      const data = await apiPost(`/api/v1/applications/${id}/provision`, body);
      console.log(JSON.stringify(data?.provisioning_job ?? data, null, 2));
    });

  cmd
    .command("deregister <id>")
    .description("Deregister an application by ID")
    .action(async (id) => {
      const res = await fetch(
        `${(await import("../config.js")).default.apiBase}/api/v1/applications/${id}`,
        { method: "DELETE" },
      );
      if (!res.ok)
        throw new Error(`DELETE /api/v1/applications/${id} → ${res.status}`);
      console.log(`Application ${id} deregistered.`);
    });

  // arcanium applications classify <name|id> --category platform|tenant|unscoped
  cmd
    .command("classify <nameOrId>")
    .description(
      "Set the governance category for an application (platform | tenant | unscoped)",
    )
    .requiredOption("--category <category>", "platform | tenant | unscoped")
    .action(async (nameOrId, opts) => {
      const valid = ["platform", "tenant", "unscoped"];
      if (!valid.includes(opts.category)) {
        console.error(`--category must be one of: ${valid.join(", ")}`);
        process.exit(1);
      }
      // Resolve name → id if a UUID was not supplied.
      let id = nameOrId;
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          nameOrId,
        )
      ) {
        const apps = await apiGet("/api/v1/applications");
        const match = apps.find((a) => a.name === nameOrId);
        if (!match) {
          console.error(`Application '${nameOrId}' not found`);
          process.exit(1);
        }
        id = match.id;
      }
      const data = await apiPost(`/api/v1/applications/${id}/classify`, {
        category: opts.category,
      });
      console.log(JSON.stringify(data, null, 2));
    });
}
