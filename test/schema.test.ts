import { describe, expect, it } from "vitest";
import { ATIF_VERSION } from "../src/identity.js";
import { toJsonValue, validateAtifTrajectory } from "../src/schema.js";

describe("ATIF-v1.7 schema", () => {
  it("sanitizes only JSON values", () => {
    expect(toJsonValue({ b: undefined, a: [1, Number.NaN, Symbol("x"), null] })).toEqual({
      a: [1, null],
    });
    expect(toJsonValue(BigInt(1))).toBeUndefined();
  });

  it("accepts a minimal valid trajectory", () => {
    expect(
      validateAtifTrajectory({
        schema_version: ATIF_VERSION,
        session_id: "session",
        trajectory_id: "trajectory",
        agent: { name: "pi", version: "0.84.2" },
        steps: [{ step_id: 1, source: "user", message: "hello" }],
      }),
    ).toBeDefined();
  });

  it("rejects non-sequential steps", () => {
    expect(() =>
      validateAtifTrajectory({
        schema_version: ATIF_VERSION,
        session_id: "session",
        trajectory_id: "trajectory",
        agent: { name: "pi", version: "0.84.2" },
        steps: [{ step_id: 2, source: "user", message: "hello" }],
      }),
    ).toThrow();
  });

  it("validates multimodal content and agent-only fields", () => {
    const trajectory = {
      schema_version: ATIF_VERSION,
      session_id: "session",
      trajectory_id: "trajectory",
      agent: { name: "pi", version: "0.84.2" },
      steps: [
        {
          step_id: 1,
          source: "user",
          message: [
            { type: "text", text: "look" },
            { type: "image", source: { media_type: "image/png", path: "image.png" } },
          ],
        },
      ],
    };
    expect(validateAtifTrajectory(trajectory)).toBeDefined();
    expect(
      validateAtifTrajectory({
        ...trajectory,
        steps: [{ step_id: 1, source: "agent", message: "dispatch", llm_call_count: 0 }],
      }),
    ).toBeDefined();
    expect(() =>
      validateAtifTrajectory({
        ...trajectory,
        steps: [{ step_id: 1, source: "user", message: "x", metrics: { prompt_tokens: 1 } }],
      }),
    ).toThrow("agent-only");
    expect(() =>
      validateAtifTrajectory({
        ...trajectory,
        steps: [
          {
            step_id: 1,
            source: "agent",
            message: "x",
            llm_call_count: 0,
            reasoning_content: "x",
            metrics: { prompt_tokens: 1 },
          },
        ],
      }),
    ).toThrow("requires an LLM call");
    expect(() =>
      validateAtifTrajectory({
        ...trajectory,
        steps: [
          {
            step_id: 1,
            source: "agent",
            message: "x",
            llm_call_count: 0,
            metrics: { prompt_tokens: 1 },
          },
        ],
      }),
    ).toThrow("metrics require an LLM call");
  });

  it("rejects malformed content parts and timestamps", () => {
    const root = {
      schema_version: ATIF_VERSION,
      session_id: "session",
      trajectory_id: "trajectory",
      agent: { name: "pi", version: "0.84.2" },
    };
    expect(() =>
      validateAtifTrajectory({
        ...root,
        steps: [{ step_id: 1, source: "user", message: [{ type: "text" }] }],
      }),
    ).toThrow("Text content requires text");
    expect(() =>
      validateAtifTrajectory({
        ...root,
        steps: [{ step_id: 1, source: "user", message: [{ type: "image" }] }],
      }),
    ).toThrow("Image content requires source");
    expect(() =>
      validateAtifTrajectory({
        ...root,
        steps: [
          {
            step_id: 1,
            source: "user",
            message: [{ type: "text", text: "x", source: { media_type: "image/png", path: "x" } }],
          },
        ],
      }),
    ).toThrow("forbids source");
    expect(() =>
      validateAtifTrajectory({
        ...root,
        steps: [{ step_id: 1, source: "user", message: [{ type: "image", text: "x" }] }],
      }),
    ).toThrow("forbids text");
    expect(() =>
      validateAtifTrajectory({
        ...root,
        steps: [{ step_id: 1, source: "user", message: "x", timestamp: "not-a-time" }],
      }),
    ).toThrow("ISO 8601");
  });

  it("rejects cross-step tool references", () => {
    expect(() =>
      validateAtifTrajectory({
        schema_version: ATIF_VERSION,
        session_id: "session",
        trajectory_id: "trajectory",
        agent: { name: "pi", version: "0.84.2" },
        steps: [
          {
            step_id: 1,
            source: "agent",
            message: "",
            observation: { results: [{ source_call_id: "missing", content: "result" }] },
          },
        ],
      }),
    ).toThrow();
  });
});
