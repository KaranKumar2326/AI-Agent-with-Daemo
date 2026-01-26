import "dotenv/config";
import "./server";
import { initDaemo } from "./services/daemoService";


async function main() {
  await initDaemo();
}

main().catch((err) => {
  console.error("Startup failed:", err);
});
