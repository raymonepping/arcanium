import { apiGet } from "../client.js";

export function registerIntegrations(program) {
  program
    .command("integrations")
    .description("List external integration channels (Jubes-class)")
    .action(async () => {
      try {
        const data = await apiGet("/api/v1/integrations");
        for (const c of data.channels ?? data) {
          console.log(
            `${(c.status || "?").padEnd(10)} ${(c.kind || "?").padEnd(16)} ${c.name}${c.supplier ? "  (" + c.supplier + ")" : ""}`,
          );
        }
      } catch (e) {
        console.error(e.message);
      }
    });
}
