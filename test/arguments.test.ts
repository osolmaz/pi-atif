import { describe, expect, it } from "vitest";
import { ArgumentError, parseExportArguments, tokenizeArguments } from "../src/arguments.js";

describe("export arguments", () => {
  it("tokenizes quotes, escapes, and trailing backslashes", () => {
    expect(tokenizeArguments('export --output "a path"')).toEqual(["export", "--output", "a path"]);
    expect(tokenizeArguments("--output 'a path'")).toEqual(["--output", "a path"]);
    expect(tokenizeArguments("--output a\\ path")).toEqual(["--output", "a path"]);
    expect(tokenizeArguments("value\\")).toEqual(["value\\"]);
  });

  it("rejects an unterminated quote", () => {
    expect(() => tokenizeArguments("--output 'missing")).toThrow(ArgumentError);
  });

  it("parses every supported export option", () => {
    expect(
      parseExportArguments([
        "--session",
        "abc",
        "--leaf",
        "leaf",
        "--output",
        "out",
        "--force",
        "--format",
        "json",
        "--all",
        "--limit",
        "2",
        "--cwd",
        "/tmp",
        "--redaction-profile",
        "raw-v1",
      ]),
    ).toEqual({
      session: "abc",
      leaf: "leaf",
      output: "out",
      force: true,
      format: "json",
      allSessions: true,
      limit: 2,
      cwd: "/tmp",
      redactionProfile: "raw-v1",
    });
    expect(parseExportArguments(["--all-leaves"])).toMatchObject({ leaf: "all" });
  });

  it.each([
    [["--output"], "--output requires a value"],
    [["--format", "xml"], "--format must be human or json"],
    [["--limit", "0"], "--limit must be a positive integer"],
    [["--limit", "1.5"], "--limit must be a positive integer"],
    [["--redaction-profile", "guess-secrets"], "Unknown redaction profile"],
    [["--unknown"], "Unknown option"],
  ])("rejects invalid options %#", (tokens, message) => {
    expect(() => parseExportArguments(tokens)).toThrow(message);
  });
});
