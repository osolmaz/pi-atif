import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mapBranchToAtif } from "../src/mapper.js";
import { snapshotSession } from "../src/session-source.js";
import { stableStringify } from "../src/stable-json.js";
import { openFixture } from "./helpers.js";

const OPTIONS = { agentVersion: "0.84.2", exporterVersion: "0.1.0", profileId: "raw-v1" };

describe("golden trajectories", () => {
  it.each([
    ["linear-v2.jsonl", "current", "fixtures/golden/linear-v2.atif.json"],
    ["branched-v3.jsonl", "b2", "fixtures/golden/branched-v3-b2.atif.json"],
    ["branched-v3.jsonl", "l1", "fixtures/golden/branched-v3-l1.atif.json"],
  ])("matches %s leaf %s", async (fixture, leaf, golden) => {
    const snapshot = snapshotSession(await openFixture(fixture));
    const branch =
      leaf === "current"
        ? snapshot.branches.find((candidate) => candidate.leafId === snapshot.currentLeafId)
        : snapshot.branches.find((candidate) => candidate.leafId === leaf);
    if (!branch) throw new Error(`Missing ${fixture} leaf ${leaf}`);
    const actual = stableStringify(mapBranchToAtif(snapshot, branch, OPTIONS).trajectory);
    expect(actual).toBe(await readFile(resolve(golden), "utf8"));
  });
});
