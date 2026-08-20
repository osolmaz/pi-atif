import { describe, expect, it } from "vitest";
import { trajectoryId } from "../src/identity.js";

describe("trajectoryId", () => {
  it("is deterministic and changes at contract boundaries", () => {
    const first = trajectoryId("session", "leaf", "raw-v1");
    expect(trajectoryId("session", "leaf", "raw-v1")).toBe(first);
    expect(trajectoryId("session", "other", "raw-v1")).not.toBe(first);
    expect(trajectoryId("session", "leaf", "redacted-v1")).not.toBe(first);
  });
});
