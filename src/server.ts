import express from "express";
import bodyParser from "body-parser";
import agentController from "./controller/agentController";
import cors from "cors";
import { initDaemo } from "./services/daemoService";


const app = express();
const PORT = process.env.PORT || 4000;

app.use(
  cors({
    origin: "*", // allow all (for now)
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(async (req, res, next) => {
  try {
    await initDaemo();
  } catch (err) {
    console.error("Daemon reconnect failed");
  }

  next();
});

app.use(bodyParser.json());

// API Routes
app.get("/", async (req, res) => {
  try {
    await initDaemo();

    res.status(200).json({
      status: "ok",
      daemo: "connected",
      time: new Date().toISOString(),
    });
  } catch {
    res.status(500).json({
      status: "error",
      daemo: "disconnected",
    });
  }
});

app.post("/agent/query", agentController.processQuery);
app.post("/agent/query-stream", agentController.processQueryStreamed);

app.listen(PORT, () => {
  console.log(`🚀 API running on port ${PORT}`);
});
