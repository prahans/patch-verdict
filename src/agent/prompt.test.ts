import { describe, expect, it } from "vitest";

import { INVESTIGATION_OUTPUT_JSON_SCHEMA } from "./prompt.js";

describe("INVESTIGATION_OUTPUT_JSON_SCHEMA", () => {
  it("keeps alternative-cause requirements synchronized with the runtime contract", () => {
    const schema = JSON.parse(INVESTIGATION_OUTPUT_JSON_SCHEMA) as {
      properties: {
        diagnosis: {
          properties: {
            rootCauseAnalysis: {
              properties: {
                alternatives: {
                  items: {
                    required: string[];
                  };
                };
              };
            };
          };
        };
      };
    };

    const required =
      schema.properties.diagnosis.properties.rootCauseAnalysis.properties
        .alternatives.items.required;

    expect(required).toEqual(
      expect.arrayContaining([
        "layer",
        "hypothesis",
        "status",
        "reason",
        "evidenceRefs",
      ]),
    );
  });
  it("exposes EXPERIMENT as an investigation evidence kind", () => {
    expect(INVESTIGATION_OUTPUT_JSON_SCHEMA).toContain('"EXPERIMENT"');
  });

});
