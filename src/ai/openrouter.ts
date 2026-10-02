import "dotenv/config";

import { OpenRouter } from "@openrouter/sdk";

const apiKey = process.env.OPENROUTER_API_KEY;

if (!apiKey) {
  throw new Error(
    "OPENROUTER_API_KEY is missing. Add it to the root .env file.",
  );
}

export const AGENT_MODEL = process.env.AGENT_MODEL ?? "qwen/qwen3-coder-next";

export const openRouter = new OpenRouter({
  apiKey,
});
