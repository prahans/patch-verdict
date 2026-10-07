import { describe, expect, it } from "vitest";

import { messageContentToText } from "./message-content.js";

describe("messageContentToText", () => {
  it("returns string content", () => {
    expect(messageContentToText(" investigation complete ")).toBe(
      "investigation complete",
    );
  });

  it("extracts text parts", () => {
    expect(
      messageContentToText([
        {
          type: "text",
          text: "first",
        },

        {
          type: "text",
          text: "second",
        },
      ]),
    ).toBe("first\nsecond");
  });

  it("serializes structured object content", () => {
    expect(messageContentToText({ status: "FROZEN", confidence: "HIGH" })).toBe(
      '{"status":"FROZEN","confidence":"HIGH"}',
    );
  });

  it("returns an empty string for unsupported content", () => {
    expect(messageContentToText(null)).toBe("");
  });
});
