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

1. Produce 2 to 4 genuinely competing causal hypotheses.
2. Hypotheses are causal mechanisms, not possible repair locations. Do not split one
   observed mechanism into separate hypotheses merely because a workaround could live
   in a helper, setup file, or direct test file.
3. Each hypothesis should name a causal variable/mechanism that could make a different
   prediction under at least one plausible controlled experiment.
4. For cross-test state/DOM leakage, explicitly inspect runner lifecycle/isolation
   settings (for example threads, isolate, pool, environment, globals, setupFiles)
   before attributing the cause to missing manual cleanup in several downstream files.
5. Manual cleanup absence can be evidence or a workaround opportunity, but it is not
   automatically a distinct root cause if automatic cleanup may be expected.
6. Use only evidence supplied by PatchVerdict's trusted baseline and deterministic reconnaissance.
7. Evidence refs must use:
   - FILE with an exact path from preInspectedFiles
   - TEST with the exact trusted baseline command
8. Do not invent repository observations.
9. Keep meaningful uncertainty explicit in missingEvidence.
10. The discriminationGoal should identify what evidence would best distinguish the leading hypotheses.
11. Do not propose patch targets, edits, repair kinds, implementation steps, or fixes.
12. Every hypothesis status is OPEN at this stage.
13. Return only JSON that satisfies the authoritative schema below.

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
- Prefer distinct upstream mechanisms that would make observably different predictions.
- Treat "cleanup missing in helper", "cleanup missing in setup", and "cleanup missing in
  the test file" as one cleanup-mechanism family unless repository evidence shows they
  are independent causes.
- If runner configuration exposes a lifecycle/isolation variable relevant to leaked
  state, include that upstream configuration/runtime mechanism as a competing hypothesis
  instead of filling the board with downstream cleanup variants.
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
