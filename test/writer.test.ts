import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OutputConflictError, writeAtomicDirectory, writeAtomicFile } from "../src/writer.js";

describe("atomic writer", () => {
  it("writes owner-only files and supports idempotent reruns", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-atif-writer-"));
    const path = join(root, "nested", "trajectory.json");
    const first = await writeAtomicFile(path, "one\n");
    const second = await writeAtomicFile(path, "one\n");
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(join(root, "nested"))).mode & 0o777).toBe(0o700);
    expect(await readdir(join(root, "nested"))).toEqual(["trajectory.json"]);
  });

  it("refuses conflicts and replaces only when forced", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-atif-writer-"));
    const path = join(root, "trajectory.json");
    await writeAtomicFile(path, "one\n");
    await expect(writeAtomicFile(path, "two\n")).rejects.toBeInstanceOf(OutputConflictError);
    await writeAtomicFile(path, "two\n", true);
    expect(await readFile(path, "utf8")).toBe("two\n");
  });

  it("commits all-leaf output as a complete directory and recovers a verified backup", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-atif-writer-"));
    const path = join(root, "trajectories");
    const files = new Map([
      ["a.json", "a\n"],
      ["b.json", "b\n"],
    ]);
    await writeAtomicDirectory(path, files);
    expect(await readdir(path)).toEqual(["a.json", "b.json"]);

    const id = "12345678-1234-1234-1234-123456789abc";
    const backup = join(root, `.trajectories.pi-atif-${id}.backup`);
    const stage = join(root, `.trajectories.pi-atif-${id}.tmp`);
    await rename(path, backup);
    await writeFile(
      `${path}.pi-atif-transaction.json`,
      `${JSON.stringify({
        schema: "pi-atif-directory-transaction-v1",
        id,
        destination: path,
        backup,
        stage,
      })}\n`,
    );
    const result = await writeAtomicDirectory(path, files);
    expect(result.every((item) => item.idempotent)).toBe(true);
    expect(await readdir(path)).toEqual(["a.json", "b.json"]);
    await expect(access(backup)).rejects.toBeDefined();
  });

  it("refuses and then replaces a conflicting all-leaf directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-atif-writer-"));
    const path = join(root, "trajectories");
    await writeAtomicDirectory(path, new Map([["a.json", "a\n"]]));
    await expect(writeAtomicDirectory(path, new Map([["b.json", "b\n"]]))).rejects.toBeInstanceOf(
      OutputConflictError,
    );
    await writeAtomicDirectory(path, new Map([["b.json", "b\n"]]), true);
    expect(await readdir(path)).toEqual(["b.json"]);
  });

  it("does not delete an unverified backup-like directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-atif-writer-"));
    const path = join(root, "trajectories");
    const unrelated = `${path}.pi-atif-backup`;
    await writeAtomicDirectory(path, new Map([["a.json", "a\n"]]));
    await writeAtomicDirectory(unrelated, new Map([["old.json", "old\n"]]));
    const result = await writeAtomicDirectory(path, new Map([["a.json", "a\n"]]));
    expect(result.every((item) => item.idempotent)).toBe(true);
    expect(await readdir(unrelated)).toEqual(["old.json"]);
  });

  it("finishes a verified transaction that already committed the destination", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-atif-writer-"));
    const path = join(root, "trajectories");
    const id = "abcdefab-1234-1234-1234-abcdefabcdef";
    const backup = join(root, `.trajectories.pi-atif-${id}.backup`);
    const stage = join(root, `.trajectories.pi-atif-${id}.tmp`);
    await writeAtomicDirectory(path, new Map([["a.json", "a\n"]]));
    await mkdir(backup);
    await writeFile(join(backup, "old.json"), "old\n");
    await mkdir(stage);
    await writeFile(join(stage, "staged.json"), "staged\n");
    await writeFile(
      `${path}.pi-atif-transaction.json`,
      `${JSON.stringify({
        schema: "pi-atif-directory-transaction-v1",
        id,
        destination: path,
        backup,
        stage,
      })}\n`,
    );
    const result = await writeAtomicDirectory(path, new Map([["a.json", "a\n"]]));
    expect(result.every((item) => item.idempotent)).toBe(true);
    await expect(access(backup)).rejects.toBeDefined();
    await expect(access(stage)).rejects.toBeDefined();
    await expect(access(`${path}.pi-atif-transaction.json`)).rejects.toBeDefined();
  });

  it("discards an uncommitted verified stage when no prior destination existed", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-atif-writer-"));
    const path = join(root, "trajectories");
    const id = "fedcbafe-1234-1234-1234-fedcbafedcba";
    const backup = join(root, `.trajectories.pi-atif-${id}.backup`);
    const stage = join(root, `.trajectories.pi-atif-${id}.tmp`);
    await mkdir(stage);
    await writeFile(join(stage, "partial.json"), "partial\n");
    await writeFile(
      `${path}.pi-atif-transaction.json`,
      `${JSON.stringify({
        schema: "pi-atif-directory-transaction-v1",
        id,
        destination: path,
        backup,
        stage,
      })}\n`,
    );
    await writeAtomicDirectory(path, new Map([["a.json", "a\n"]]));
    expect(await readdir(path)).toEqual(["a.json"]);
    await expect(access(stage)).rejects.toBeDefined();
  });

  it("refuses an unverified transaction marker", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-atif-writer-"));
    const path = join(root, "trajectories");
    await writeFile(`${path}.pi-atif-transaction.json`, "user data\n");
    await expect(writeAtomicDirectory(path, new Map([["a.json", "a\n"]]))).rejects.toBeInstanceOf(
      OutputConflictError,
    );
    expect(await readFile(`${path}.pi-atif-transaction.json`, "utf8")).toBe("user data\n");
  });

  it("refuses a JSON transaction marker that does not identify this export", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-atif-writer-"));
    const path = join(root, "trajectories");
    await writeFile(
      `${path}.pi-atif-transaction.json`,
      `${JSON.stringify({ schema: "other", id: "not-owned" })}\n`,
    );
    await expect(writeAtomicDirectory(path, new Map([["a.json", "a\n"]]))).rejects.toBeInstanceOf(
      OutputConflictError,
    );
  });

  it("does not commit an export that was already interrupted", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-atif-writer-"));
    const path = join(root, "trajectory.json");
    const controller = new AbortController();
    controller.abort();
    await expect(writeAtomicFile(path, "data\n", false, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    await expect(access(path)).rejects.toBeDefined();
  });

  it("does not weaken an existing parent directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-atif-writer-"));
    await chmod(root, 0o755);
    await writeAtomicFile(join(root, "trajectory.json"), "data\n");
    expect((await stat(root)).mode & 0o777).toBe(0o755);
  });
});
