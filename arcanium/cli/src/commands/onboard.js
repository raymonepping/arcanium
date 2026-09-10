import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { apiGet, apiPost } from "../client.js";

// Interactive equivalent of the UI onboarding wizard (Prompt 15.1).
export function registerOnboard(program) {
  program
    .command("onboard")
    .description(
      "Guided cryptographic onboarding — service → application → requirements → provision",
    )
    .action(async () => {
      const rl = createInterface({ input: stdin, output: stdout });
      const ask = (q, def) =>
        rl
          .question(def ? `${q} [${def}] ` : `${q} `)
          .then((a) => a.trim() || def || "");
      const yes = (q) => ask(`${q} (y/N)`).then((a) => /^y/i.test(a));

      try {
        // 1. Service / supplier
        const suppliers = await apiGet("/api/v1/suppliers");
        console.log(
          "\nExisting suppliers: " +
            (suppliers.map((s) => s.name).join(", ") || "(none)"),
        );
        const chosenName = await ask("Supplier name (existing, or a new one)");
        let supplier = suppliers.find((s) => s.name === chosenName);
        if (!supplier) {
          const name = await ask("  New supplier name");
          const ns = await ask("  Vault namespace", `suppliers/${name}`);
          const tier = await ask("  SLA tier (standard/premium)", "standard");
          const res = await apiPost("/api/v1/suppliers", {
            name,
            vault_namespace: ns,
            sla_tier: tier,
          });
          supplier = res;
          console.log(
            `  ✓ tenant provisioned (job ${res.provisioning_job?.id?.slice(0, 8)})`,
          );
        }

        // 2. Application
        const appName = await ask("\nApplication name");
        const desc = await ask("  Description", "");
        const app = await apiPost("/api/v1/applications", {
          name: appName,
          description: desc,
          supplier_id: supplier.id,
        });
        console.log(`  ✓ application registered (${app.id})`);

        // 3. Requirements
        console.log("\nCryptographic requirements:");
        const tls = await yes("  TLS / X.509?");
        const sym = await yes("  Symmetric encryption?");
        const sig = await yes("  Digital signatures?");

        // 4. Custody
        const custody =
          (await ask("\nKey custody (vault / softhsm)", "vault")) === "softhsm"
            ? "softhsm"
            : "vault";

        // 5. Provision
        const capabilities = [];
        if (sym) capabilities.push("encrypt", "decrypt");
        if (sig) capabilities.push("sign", "verify");
        console.log("\nProvisioning…");
        const r = await apiPost(`/api/v1/applications/${app.id}/provision`, {
          custody,
          key_type: sig ? "rsa-4096" : "aes256-gcm96",
          capabilities,
          tls,
        });
        const job = r.provisioning_job;
        console.log(`  job ${job.id.slice(0, 8)} → ${job.status}`);
        for (const s of job.steps)
          console.log(`    ${String(s.status).padEnd(10)} ${s.step}`);
      } finally {
        rl.close();
      }
    });
}
