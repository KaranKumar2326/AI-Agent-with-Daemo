import "dotenv/config";

import { initDaemo } from "./services/daemoService";
import "./server";

async function main() {
  await initDaemo();
}

main().catch((err) => {
  console.error("Startup failed:", err);
});
