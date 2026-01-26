import express from "express";
import bodyParser from "body-parser";
import agentController from "./controller/agentController";

const app = express();

app.use(bodyParser.json());

// API Routes
app.post("/agent/query", agentController.processQuery);
app.post("/agent/query-stream", agentController.processQueryStreamed);

app.listen(4000, () => {
  console.log("🚀 API running at http://localhost:4000");
});
