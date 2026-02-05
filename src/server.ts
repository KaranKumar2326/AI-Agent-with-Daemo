import express from "express";
import bodyParser from "body-parser";
import agentController from "./controller/agentController";
import cors from "cors";
import { initDaemo, resetDaemo } from "./services/daemoService";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(bodyParser.json());


const ensureDaemo = async (req: any, res: any, next: any) => {
  try {
    await initDaemo();
    next();
  } catch (err) {
    res.status(500).json({ error: "Daemo engine failed to initialize" });
  }
};

/**
 * Health + Wake Route
 */
app.get("/", async (req, res) => {
  try {
    await initDaemo();

    res.json({
      status: "ok",
      daemo: "connected",
      time: new Date().toISOString(),
    });
  } catch (err) {
    resetDaemo();

    res.status(500).json({
      status: "error",
      daemo: "disconnected",
    });
  }
});

/**
 * API Routes
 */
app.post("/agent/query", ensureDaemo, agentController.processQuery);
app.post("/agent/query-stream", ensureDaemo, agentController.processQueryStreamed);

app.listen(PORT, () => {
  console.log(`🚀 API running on port ${PORT}`);
});
setInterval(async () => {
  try {
    console.log("💓 Daemo keep-alive ping");

    await initDaemo();
  } catch (err) {
    console.error("⚠️ Keep-alive failed:", err);
    resetDaemo();
  }
}, 120000);
