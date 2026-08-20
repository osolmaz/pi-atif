import { describe, expect, it } from "vitest";
import { mapBranchToAtif } from "../src/mapper.js";
import { snapshotSession } from "../src/session-source.js";
import { openFixture } from "./helpers.js";

const OPTIONS = { agentVersion: "0.84.2", exporterVersion: "0.1.0", profileId: "raw-v1" };

describe("mapBranchToAtif", () => {
  // This assertion covers one complete mapping fixture and its related fields.
  // eslint-disable-next-line complexity
  it("maps tool calls, results, metrics, compaction, and warnings truthfully", async () => {
    const snapshot = snapshotSession(await openFixture("branched-v3.jsonl"));
    const branch = snapshot.branches.find((candidate) => candidate.leafId === "l1");
    if (!branch) throw new Error("Missing l1 fixture branch");
    const result = mapBranchToAtif(snapshot, branch, OPTIONS);

    const toolStep = result.trajectory.steps.find((step) => step.tool_calls?.length);
    expect(toolStep?.tool_calls?.[0]?.tool_call_id).toBe("call-1");
    expect(toolStep?.observation?.results[0]?.source_call_id).toBe("call-1");
    expect(toolStep?.metrics).toMatchObject({
      prompt_tokens: 150,
      completion_tokens: 20,
      cached_tokens: 50,
    });

    const compaction = result.trajectory.steps.find(
      (step) => step.extra?.pi_atif && objectValue(step.extra.pi_atif).kind === "compaction",
    );
    expect(compaction?.extra?.context_management).toEqual({
      type: "compaction",
      boundary: "replace",
    });
    expect(objectValue(compaction?.extra?.pi_atif).retained_tail_count).toBe(1);
    expect(result.warnings.map((item) => item.code)).toContain("embedded-image-omitted");
    expect(result.warnings.map((item) => item.code)).toContain("unsupported-entry-omitted");
    expect(result.trajectory.final_metrics?.total_prompt_tokens).toBe(690);
    expect(result.trajectory.final_metrics?.total_cached_tokens).toBe(130);
  });

  it("maps alternative branches without labeling them as subagents", async () => {
    const snapshot = snapshotSession(await openFixture("branched-v3.jsonl"));
    const branch = snapshot.branches.find((candidate) => candidate.leafId === "b2");
    if (!branch) throw new Error("Missing b2 fixture branch");
    const result = mapBranchToAtif(snapshot, branch, OPTIONS);
    const serialized = JSON.stringify(result.trajectory);
    expect(result.trajectory.session_id).toBe("session-branched");
    expect(serialized).not.toContain("subagent_trajectories");
    const summary = result.trajectory.steps.find(
      (step) => step.extra?.pi_atif && objectValue(step.extra.pi_atif).kind === "branch_summary",
    );
    expect(summary?.extra?.context_management).toEqual({ type: "injection", boundary: "append" });
  });

  it("maps shell and custom messages while reporting invalid metrics and orphan results", async () => {
    const snapshot = snapshotSession(await openFixture("messages-v3.jsonl"));
    const branch = snapshot.branches[0];
    if (!branch) throw new Error("Missing messages fixture branch");
    const result = mapBranchToAtif(snapshot, branch, OPTIONS);
    const kinds = result.trajectory.steps.map((step) => objectValue(step.extra?.pi_atif).kind);
    expect(kinds).toContain("bash_execution");
    expect(kinds).toContain("custom_message");
    expect(kinds).toContain("orphan_tool_result");
    expect(result.warnings.map((item) => item.code)).toContain("invalid-metric-omitted");
    expect(result.warnings.filter((item) => item.code === "orphan-tool-result")).toHaveLength(2);
    expect(result.warnings.map((item) => item.code)).toContain("unsupported-entry-omitted");
    expect(result.warnings.map((item) => item.code)).toContain("unsupported-message-omitted");
  });

  it("rejects a branch with no ATIF-representable steps", async () => {
    const snapshot = snapshotSession(await openFixture("branched-v3.jsonl"));
    const main = snapshot.branches.find((branch) => branch.leafId === "l1");
    if (!main) throw new Error("Missing l1 fixture branch");
    const entries = main.entries.filter(
      (entry) => entry.type === "session_info" || entry.type === "label",
    );
    expect(() => mapBranchToAtif(snapshot, { leafId: "metadata-only", entries }, OPTIONS)).toThrow(
      "no ATIF-representable steps",
    );
  });

  it("inserts only observed live prompt metadata", async () => {
    const manager = await openFixture("linear-v1.jsonl");
    const leaf = manager.getLeafId();
    if (!leaf) throw new Error("Missing fixture leaf");
    const snapshot = snapshotSession(manager, {
      liveMetadataComplete: true,
      livePromptMetadata: [
        {
          afterEntryId: leaf,
          systemPrompt: "Observed system prompt",
          toolDefinitions: [
            {
              type: "function",
              function: {
                name: "write",
                description: "Write a file",
                parameters: { type: "object" },
              },
            },
            { type: "invalid" },
            {
              type: "function",
              function: {
                name: "read",
                description: "Read a file",
                parameters: { type: "object" },
              },
            },
          ],
        },
      ],
    });
    const branch = snapshot.branches[0];
    if (!branch) throw new Error("Missing fixture branch");
    const result = mapBranchToAtif(snapshot, branch, OPTIONS);
    expect(result.trajectory.steps.at(-1)?.message).toBe("Observed system prompt");
    expect(result.trajectory.agent.tool_definitions?.[0]).toBeDefined();
    expect(result.warnings.map((item) => item.code)).not.toContain(
      "historical-live-metadata-unavailable",
    );
  });
});

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
