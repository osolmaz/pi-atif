import { copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { mapBranchToAtif, snapshotSession, stableStringify } from "../dist/index.js";

const options = {
  agentVersion: "0.84.2",
  exporterVersion: "0.1.0",
  profileId: "raw-v1",
};
const cases = [
  ["linear-v2.jsonl", "current", "linear-v2.atif.json"],
  ["branched-v3.jsonl", "b2", "branched-v3-b2.atif.json"],
  ["branched-v3.jsonl", "l1", "branched-v3-l1.atif.json"],
];
const output = resolve("fixtures/golden");
await mkdir(output, { recursive: true });
for (const [fixture, leaf, filename] of cases) {
  const temporary = await mkdtemp(join(tmpdir(), "pi-atif-golden-"));
  const sessionPath = join(temporary, basename(fixture));
  await copyFile(resolve("fixtures/pi", fixture), sessionPath);
  const manager = SessionManager.open(sessionPath, temporary);
  const snapshot = snapshotSession(manager);
  const branch =
    leaf === "current"
      ? snapshot.branches.find((candidate) => candidate.leafId === snapshot.currentLeafId)
      : snapshot.branches.find((candidate) => candidate.leafId === leaf);
  if (!branch) throw new Error(`Missing ${fixture} leaf ${leaf}`);
  await writeFile(
    join(output, filename),
    stableStringify(mapBranchToAtif(snapshot, branch, options).trajectory),
    "utf8",
  );
}
