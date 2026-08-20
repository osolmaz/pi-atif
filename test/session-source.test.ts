import { copyFile, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  openHistoricalSession,
  type SessionReader,
  SessionSourceError,
  snapshotSession,
} from "../src/session-source.js";
import { openFixture } from "./helpers.js";

describe("snapshotSession", () => {
  it("loads and migrates v1 sessions through SessionManager", async () => {
    const snapshot = snapshotSession(await openFixture("linear-v1.jsonl"));
    expect(snapshot.header.version).toBe(3);
    expect(snapshot.branches).toHaveLength(1);
    expect(snapshot.branches[0]?.entries.every((entry) => entry.id && "parentId" in entry)).toBe(
      true,
    );
  });

  it("loads and migrates v2 custom messages through SessionManager", async () => {
    const snapshot = snapshotSession(await openFixture("linear-v2.jsonl"));
    const message = snapshot.branches[0]?.entries.find((entry) => entry.type === "message");
    const custom = snapshot.branches[0]?.entries.find(
      (entry) => entry.type === "message" && (entry.message as { role?: string }).role === "custom",
    );
    expect(snapshot.header.version).toBe(3);
    expect(message).toBeDefined();
    expect(custom).toBeDefined();
  });

  it("captures all leaves and the current leaf", async () => {
    const snapshot = snapshotSession(await openFixture("branched-v3.jsonl"));
    expect(snapshot.branches.map((branch) => branch.leafId)).toEqual(["b2", "l1"]);
    expect(snapshot.currentLeafId).toBe("b2");
    expect(snapshot.labels.u1).toBe("start");
  });

  it("opens a historical session by exact path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-atif-session-path-"));
    const path = join(directory, "linear-v2.jsonl");
    await copyFile(resolve("fixtures/pi/linear-v2.jsonl"), path);
    const manager = await openHistoricalSession(path);
    expect(manager.getSessionId()).toBe("session-v2");
  });

  it("reports missing and ambiguous historical selectors", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-atif-sessions-"));
    await expect(
      openHistoricalSession("missing", { cwd: "/workspace/v2", sessionDir: directory }),
    ).rejects.toMatchObject({ code: "session-not-found" });

    const fixture = await readFile(resolve("fixtures/pi/linear-v2.jsonl"), "utf8");
    await writeFile(join(directory, "one.jsonl"), fixture.replace("session-v2", "session-aa"));
    await writeFile(join(directory, "two.jsonl"), fixture.replace("session-v2", "session-ab"));
    await expect(
      openHistoricalSession("session-a", { cwd: "/workspace/v2", sessionDir: directory }),
    ).rejects.toMatchObject({ code: "ambiguous-session" });
  });

  it("rejects empty sessions and missing headers", () => {
    expect(() => snapshotSession(emptyManager())).toThrow(SessionSourceError);
    expect(() => snapshotSession(emptyManager(false))).toThrow("session header");
  });
});

function emptyManager(withHeader = true): SessionReader {
  const header = {
    type: "session" as const,
    version: 3,
    id: "empty",
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: "/tmp",
  };
  return {
    getHeader: () => (withHeader ? header : null),
    getTree: () => [],
    getEntries: () => [],
    getLabel: () => undefined,
    getBranch: () => [],
    getSessionId: () => "empty",
    getSessionFile: () => undefined,
    getSessionName: () => undefined,
    getLeafId: () => null,
  };
}
