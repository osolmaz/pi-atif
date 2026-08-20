import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportSnapshot } from "../src/exporter.js";
import { trajectoryId } from "../src/identity.js";
import { snapshotSession } from "../src/session-source.js";
import { openFixture } from "./helpers.js";

const OPTIONS = { agentVersion: "0.84.2", exporterVersion: "0.1.0" };

describe("exportSnapshot", () => {
  it("writes deterministic single-leaf output", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-atif-export-"));
    const output = join(root, "trajectory.json");
    const snapshot = snapshotSession(await openFixture("linear-v1.jsonl"));
    const first = await exportSnapshot(snapshot, {
      ...OPTIONS,
      destination: output,
      selection: "all",
    });
    const bytes = await readFile(output, "utf8");
    const second = await exportSnapshot(snapshot, {
      ...OPTIONS,
      destination: output,
      selection: "all",
    });
    expect(second[0]?.idempotent).toBe(true);
    expect(await readFile(output, "utf8")).toBe(bytes);
    expect(first[0]?.sha256).toBe(second[0]?.sha256);
  });

  it("applies explicit redaction before final output and identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-atif-export-"));
    const output = join(root, "trajectory.json");
    const snapshot = snapshotSession(await openFixture("linear-v1.jsonl"));
    const artifacts = await exportSnapshot(snapshot, {
      ...OPTIONS,
      destination: output,
      selection: "all",
      redactionProfile: {
        id: "test-redacted-v1",
        transform: (trajectory) => {
          const copy = structuredClone(trajectory);
          copy.steps = copy.steps.map((step) => ({
            ...step,
            message:
              typeof step.message === "string"
                ? step.message.replaceAll("Legacy", "[redacted]")
                : step.message,
          }));
          return copy;
        },
      },
    });
    const bytes = await readFile(output, "utf8");
    expect(bytes).not.toContain("Legacy");
    expect(bytes).toContain("[redacted]");
    expect(artifacts[0]?.trajectoryId).toBe(
      trajectoryId(snapshot.sessionId, snapshot.branches[0]?.leafId ?? "", "test-redacted-v1"),
    );
  });

  it("writes one file per selected leaf", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-atif-export-"));
    const output = join(root, "trajectories");
    const snapshot = snapshotSession(await openFixture("branched-v3.jsonl"));
    const artifacts = await exportSnapshot(snapshot, {
      ...OPTIONS,
      destination: output,
      selection: "all",
    });
    expect(artifacts).toHaveLength(2);
    expect(await readdir(output)).toHaveLength(2);
    expect(new Set(artifacts.map((artifact) => artifact.trajectoryId)).size).toBe(2);
  });

  it("rejects missing current and explicit leaf selections", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-atif-export-"));
    const snapshot = snapshotSession(await openFixture("linear-v2.jsonl"));
    await expect(
      exportSnapshot(
        { ...snapshot, currentLeafId: null },
        {
          ...OPTIONS,
          destination: join(root, "current.json"),
          selection: "current",
        },
      ),
    ).rejects.toThrow("no current leaf");
    await expect(
      exportSnapshot(
        { ...snapshot, currentLeafId: "ghost" },
        {
          ...OPTIONS,
          destination: join(root, "ghost.json"),
          selection: "current",
        },
      ),
    ).rejects.toThrow("not in the session tree");
    await expect(
      exportSnapshot(snapshot, {
        ...OPTIONS,
        destination: join(root, "missing.json"),
        selection: "missing",
      }),
    ).rejects.toThrow("was not found");
  });

  it("validates redacted output before creating a final file", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-atif-export-"));
    const output = join(root, "invalid.json");
    const snapshot = snapshotSession(await openFixture("linear-v2.jsonl"));
    await expect(
      exportSnapshot(snapshot, {
        ...OPTIONS,
        destination: output,
        selection: "all",
        redactionProfile: {
          id: "invalid-v1",
          transform: (trajectory) => ({ ...trajectory, steps: [] }),
        },
      }),
    ).rejects.toThrow();
    await expect(readFile(output, "utf8")).rejects.toBeDefined();
  });

  it("exports an exact non-leaf entry as a branch endpoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-atif-export-"));
    const output = join(root, "trajectory.json");
    const snapshot = snapshotSession(await openFixture("branched-v3.jsonl"));
    const artifacts = await exportSnapshot(snapshot, {
      ...OPTIONS,
      destination: output,
      selection: "u1",
    });
    expect(artifacts[0]?.leafId).toBe("u1");
  });
});
