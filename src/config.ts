import "dotenv/config";

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing env variable: ${key}`);
  }
  return value;
}

export const config = {
  daemoKey: required("DAEMO_AGENT_API_KEY"),
  daemoGatewayUrl: process.env.DAEMO_GATEWAY_URL || "https://gateway.daemo.ai",
  clientUrl:
    process.env.DAEMO_CLIENT_URL ??
    "engine.daemo.ai:50052",
  google: {
    sheetId: required("GOOGLE_SHEET_ID"),
    keyBase64: required("GOOGLE_KEY_BASE64"),
  },
};
