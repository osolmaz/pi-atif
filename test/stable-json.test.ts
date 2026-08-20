import { describe, expect, it } from "vitest";
import { stableStringify } from "../src/stable-json.js";

describe("stableStringify", () => {
  it("sorts nested keys, preserves arrays, and omits undefined object fields", () => {
    expect(stableStringify({ z: 1, a: { y: 2, x: undefined }, list: [{ b: 2, a: 1 }] })).toBe(
      '{\n  "a": {\n    "y": 2\n  },\n  "list": [\n    {\n      "a": 1,\n      "b": 2\n    }\n  ],\n  "z": 1\n}\n',
    );
  });
});
