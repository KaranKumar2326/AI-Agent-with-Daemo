import express from "express";
import bodyParser from "body-parser";
import agentController from "./controller/agentController";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(bodyParser.json());

// API Routes
app.get("/", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Inventory Agent is running",
    time: new Date().toISOString(),
  });
});
app.post("/agent/query", agentController.processQuery);
app.post("/agent/query-stream", agentController.processQueryStreamed);

app.listen(PORT, () => {
  console.log(`🚀 API running on port ${PORT}`);
});
