import { Request, Response } from "express";
import { DaemoClient, LlmConfig } from "daemo-engine";
import { normalizeQuery } from "../normalizer/normalizeQuery";
import { getSessionData } from "../services/daemoService";
import { config } from "../config";

let daemoClient: DaemoClient | null = null;

function getDaemoClient() {
  if (!daemoClient) {
    console.log("Connecting to:", config.clientUrl);

    daemoClient = new DaemoClient({
      daemoAgentUrl: config.clientUrl,
      agentApiKey: config.daemoKey,
    });
  }

  return daemoClient;
}

function buildLlmConfig(max_tokens?: number): LlmConfig | undefined {
  const provider = process.env.LLM_PROVIDER;
  console.log("LLM Provider:", provider);

  if (!provider) return undefined;

  return {
    provider,
    maxTokens: max_tokens,
    model: process.env.LLM_MODEL,
  };
}

/* ===============================
   POST /agent/query
================================ */

const processQuery = async (req: Request, res: Response) => {
  try {
    const { query, thread_id, context, max_tokens } = req.body;

    console.log("BODY:", req.body);

    if (!query) {
      return res.status(400).json({ error: "Query required" });
    }

    const normalized = normalizeQuery(query);

    console.log("NORMALIZED:", normalized);

    const session = getSessionData();

    if (!session) {
      return res.status(500).json({ error: "Agent not initialized" });
    }

    const client = getDaemoClient();
    const enrichedQuery = `
User intent: ${normalized.intent}
Product: ${normalized.product ?? "unknown"}
Amount: ${normalized.amount ?? "none"}`;

    const result = await client.processQuery(query, {
      threadId: thread_id,
      sessionId: session.ServiceName,
      llmConfig: buildLlmConfig(max_tokens),
      contextJson: context
        ? JSON.stringify(context)
        : undefined,
    });

    res.json(result);

  } catch (err: any) {
    console.error("PROCESS ERROR:", err);

    res.status(500).json({
      error: err.message,
    });
  }
};

/* ===============================
   STREAM
================================ */

const processQueryStreamed = (req: Request, res: Response) => {
  const { query, thread_id, context, max_tokens } = req.body;

  if (!query) {
    return res.status(400).json({ error: "Query required" });
  }

  const normalized = normalizeQuery(query);

  console.log("NORMALIZED:", normalized);

  const session = getSessionData();

  if (!session) {
    return res.status(500).json({ error: "Agent not initialized" });
  }

  res.setHeader("Content-Type", "text/event-stream");

  const client = getDaemoClient();
  const enrichedQuery = `
User intent: ${normalized.intent}
Product: ${normalized.product ?? "unknown"}
Amount: ${normalized.amount ?? "none"}`;

  const stream = client.processQueryStreamed(
    query,
    {
      onData(data) {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      },
      onError(error) {
        res.write(`event: error\ndata: ${error.message}\n\n`);
        res.end();
      },
      onEnd() {
        res.write(`event: end\ndata: {}\n\n`);
        res.end();
      },
    },
    {
      threadId: thread_id,
      sessionId: session.ServiceName,
      llmConfig: buildLlmConfig(max_tokens),
      contextJson: context
        ? JSON.stringify(context)
        : undefined,
    }
  );

  res.on("close", () => stream.cancel());
};

export default {
  processQuery,
  processQueryStreamed,
};
