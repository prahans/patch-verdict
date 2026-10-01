import { describe, expect, it } from "vitest";
import { divide } from "../src/divide";

describe("divide", () => {
  it("divides two numbers", () => {
    expect(divide(10, 2)).toBe(5);
  });

  it("rejects division by zero", () => {
    expect(() => divide(10, 0)).toThrow("Division by zero");
  });
});
