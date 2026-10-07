import type { ChatMessages } from "@openrouter/sdk/models";

import { openRouter, AGENT_MODEL } from "../ai/openrouter.js";
import { jsonSchemaResponseFormat } from "../ai/structured-output.js";

import { messageContentToText } from "./message-content.js";
import type { InvestigationBaselineContext } from "./investigation-context.js";
import {
  reconnaissanceForModel,
  type ReconnaissanceContext,
} from "./reconnaissance.js";
import {
  HYPOTHESIS_BOARD_JSON_SCHEMA,
  hypothesisBoardResponseJsonSchema,
  assertHypothesisBoardGrounding,
  parseHypothesisBoard,
  type HypothesisBoard,
} from "./hypothesis-board.js";

const HYPOTHESIS_BOARD_SYSTEM_PROMPT = `
You are PatchVerdict's causal hypothesis planner.

Your job is to create a small set of competing causal hypotheses BEFORE patch planning begins.

You are not the repair planner.

Rules:

1. Produce 2 to 5 genuinely competing causal hypotheses.
2. Use only evidence supplied by PatchVerdict's trusted baseline and deterministic reconnaissance.
3. Evidence refs must use:
   - FILE with an exact path from preInspectedFiles
   - TEST with the exact trusted baseline command
4. Do not invent repository observations.
5. Keep meaningful uncertainty explicit in missingEvidence.
6. The discriminationGoal should identify what evidence would best distinguish the leading hypotheses.
7. Do not propose patch targets, edits, repair kinds, implementation steps, or fixes.
8. Every hypothesis status is OPEN at this stage.
9. Return only JSON that satisfies the authoritative schema below.

Authoritative Hypothesis Board JSON Schema:

${HYPOTHESIS_BOARD_JSON_SCHEMA}
`.trim();

function boardGroundingContext(input: {
  baseline: InvestigationBaselineContext;
  reconnaissance: ReconnaissanceContext;
}) {
  return {
    baselineCommand: input.baseline.command,
    preInspectedFiles: input.reconnaissance.preInspectedFiles,
  };
}

function validateBoard(
  text: string,
  input: {
    baseline: InvestigationBaselineContext;
    reconnaissance: ReconnaissanceContext;
  },
): HypothesisBoard {
  const board = parseHypothesisBoard(text);

  assertHypothesisBoardGrounding(board, boardGroundingContext(input));

  return board;
}

export async function createInitialHypothesisBoard(input: {
  issue: string;
  baseline: InvestigationBaselineContext;
  reconnaissance: ReconnaissanceContext;
}): Promise<HypothesisBoard> {
  const messages: ChatMessages[] = [
    {
      role: "system" as const,
      content: HYPOTHESIS_BOARD_SYSTEM_PROMPT,
    },
    {
      role: "user" as const,
      content: `
Reported issue:

${input.issue}

Trusted baseline evidence:

${JSON.stringify(input.baseline, null, 2)}

Deterministic reconnaissance:

${JSON.stringify(reconnaissanceForModel(input.reconnaissance), null, 2)}

Build the initial target-free causal hypothesis board.

Important:
- A repair location is not proof of causal ownership.
- Prefer distinct explanations that could be separated by future evidence.
- inventoryPreview is discovery only. A discovered path is not FILE evidence unless it also appears in preInspectedFiles.
- If a useful discovered file was not pre-inspected, mention the need to inspect it in missingEvidence; do not cite it as observed FILE evidence.
- TEST evidence source must be exactly the trusted baseline command, never the command plus a description.
- If a claim about external library/runtime behavior is not directly observed here, express the missing evidence rather than treating model memory as proof.
- Do not recommend any patch.
`.trim(),
    },
  ];

  const response = await openRouter.chat.send({
    chatRequest: {
      model: AGENT_MODEL,
      messages,
      responseFormat: jsonSchemaResponseFormat(
        "patchverdict_hypothesis_board",
        hypothesisBoardResponseJsonSchema(boardGroundingContext(input)),
      ),
      stream: false,
    },
  });

  if (!("choices" in response)) {
    throw new Error("Expected a non-streaming hypothesis-board response.");
  }

  const message = response.choices[0]?.message;

  if (!message) {
    throw new Error("Model returned no initial hypothesis board.");
  }

  messages.push(message);

  const text = messageContentToText(message.content);

  try {
    return validateBoard(text, input);
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.message
        : "Unknown hypothesis-board validation error";

    messages.push({
      role: "user",
      content: `
PatchVerdict rejected the initial hypothesis board.

Validation error:

${reason}

Repair the board using only evidence that was already supplied.

Allowed FILE evidence:
${input.reconnaissance.preInspectedFiles.map((path) => `- ${path}`).join("\n") || "- none"}

Allowed TEST evidence:
- ${input.baseline.command}

Do not add patch targets, edits, fixes, repair kinds, implementation steps, or tool calls.
Return only corrected JSON matching this authoritative schema:

${HYPOTHESIS_BOARD_JSON_SCHEMA}
`.trim(),
    });

    const repairResponse = await openRouter.chat.send({
      chatRequest: {
        model: AGENT_MODEL,
        messages,
        responseFormat: jsonSchemaResponseFormat(
          "patchverdict_hypothesis_board_repair",
          hypothesisBoardResponseJsonSchema(boardGroundingContext(input)),
        ),
        stream: false,
      },
    });

    if (!("choices" in repairResponse)) {
      throw new Error(
        "Expected a non-streaming hypothesis-board repair response.",
      );
    }

    const repairMessage = repairResponse.choices[0]?.message;

    if (!repairMessage) {
      throw new Error("Model returned no hypothesis-board repair response.");
    }

    const repairedText = messageContentToText(repairMessage.content);

    try {
      return validateBoard(repairedText, input);
    } catch (repairError) {
      const repairReason =
        repairError instanceof Error
          ? repairError.message
          : "Unknown hypothesis-board repair error";

      throw new Error(
        [
          "Initial Hypothesis Board v4 failed after one no-tool repair.",
          `Initial validation: ${reason}`,
          `Repair validation: ${repairReason}`,
        ].join("\n"),
      );
    }
  }
}
