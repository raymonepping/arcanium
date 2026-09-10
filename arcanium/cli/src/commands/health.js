import { apiGet } from "../client.js";

export function registerHealth(program) {
  program
    .command("health")
    .description("Check Arcanium API health")
    .action(async () => {
      const data = await apiGet("/health");
      console.log(JSON.stringify(data, null, 2));
    });
}
