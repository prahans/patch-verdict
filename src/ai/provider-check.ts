import "dotenv/config";
import { describeOpenRouterFailure } from "./provider-errors.js";

/** A single low-cost tool-call probe. No E2B, repository clone or publication. */
async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("Missing OPENROUTER_API_KEY in the root environment.");
    process.exitCode = 1;
    return;
  }

  const { openRouter, AGENT_MODEL } = await import("./openrouter.js");
  console.log("Checking OpenRouter tool calling for " + AGENT_MODEL + "...");
  try {
    const response = await openRouter.chat.send({
      chatRequest: {
        model: AGENT_MODEL,
        messages: [
          {
            role: "user",
            content: "Call the health_ping function with ok=true. Do not use prose.",
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "health_ping",
              description: "Return the supplied confirmation.",
              parameters: {
                type: "object",
                properties: { ok: { type: "boolean" } },
                required: ["ok"],
                additionalProperties: false,
              },
            },
          },
        ],
        toolChoice: "required",
        stream: false,
      },
    });
    if (!("choices" in response)) {
      console.error(describeOpenRouterFailure(response, AGENT_MODEL));
      process.exitCode = 1;
      return;
    }
    const calls = response.choices[0]?.message?.toolCalls;
    if (!calls?.some((call) => call.function.name === "health_ping")) {
      console.error("Provider responded, but did not return the required tool call. Check model/tool-call compatibility.");
      process.exitCode = 1;
      return;
    }
    console.log("Provider tool-call check passed. You can now test a new mission.");
  } catch (error) {
    console.error(describeOpenRouterFailure(error, AGENT_MODEL));
    process.exitCode = 1;
  }
}

void main();
