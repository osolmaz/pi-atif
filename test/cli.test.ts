import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CLI = resolve("dist/cli.js");

async function fixtureCopy(name: string): Promise<{ root: string; path: string }> {
  const root = await mkdtemp(join(tmpdir(), "pi-atif-cli-"));
  const path = join(root, basename(name));
  await copyFile(resolve("fixtures/pi", name), path);
  return { root, path };
}

function run(args: string[], env: NodeJS.ProcessEnv = process.env) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env });
}

describe("pi-atif CLI", () => {
  it("exports one historical session with machine-readable output", async () => {
    const fixture = await fixtureCopy("linear-v2.jsonl");
    const output = join(fixture.root, "trajectory.json");
    const result = run([
      "export",
      "--session",
      fixture.path,
      "--output",
      output,
      "--format",
      "json",
    ]);
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout) as { ok: boolean; artifacts: unknown[] };
    expect(report.ok).toBe(true);
    expect(report.artifacts).toHaveLength(1);
    const trajectory: unknown = JSON.parse(await readFile(output, "utf8"));
    expect(trajectory).toMatchObject({ schema_version: "ATIF-v1.7" });
  });

  it("requires explicit leaf selection for branched historical sessions", async () => {
    const fixture = await fixtureCopy("branched-v3.jsonl");
    const result = run([
      "export",
      "--session",
      fixture.path,
      "--output",
      join(fixture.root, "out"),
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("multiple leaves");
  });

  it("exports all leaves through the same converter", async () => {
    const fixture = await fixtureCopy("branched-v3.jsonl");
    const output = join(fixture.root, "out");
    const result = run([
      "export",
      "--session",
      fixture.path,
      "--output",
      output,
      "--all-leaves",
      "--format",
      "json",
    ]);
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout) as { artifacts: unknown[] };
    expect(report.artifacts).toHaveLength(2);
  });

  it("exports a bounded historical batch", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-atif-cli-batch-"));
    const home = join(root, "home");
    const cwd = join(root, "project");
    const setup = `
      import { mkdirSync } from "node:fs";
      import { SessionManager } from "@earendil-works/pi-coding-agent";
      mkdirSync(${JSON.stringify(cwd)}, { recursive: true });
      const manager = SessionManager.create(${JSON.stringify(cwd)});
      manager.appendMessage({ role: "user", content: "batch", timestamp: 1 });
      manager.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        api: "openai-responses",
        provider: "openai",
        model: "test-model",
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: 2,
      });
    `;
    const env = { ...process.env, HOME: home };
    const prepared = spawnSync(process.execPath, ["--input-type=module", "--eval", setup], {
      cwd: resolve("."),
      encoding: "utf8",
      env,
    });
    expect(prepared.status, prepared.stderr).toBe(0);
    const result = run(
      [
        "export",
        "--all",
        "--limit",
        "1",
        "--cwd",
        cwd,
        "--output",
        join(root, "out"),
        "--format",
        "json",
      ],
      env,
    );
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout) as { artifacts: unknown[] };
    expect(report.artifacts).toHaveLength(1);
  });

  it("returns a stable source failure code", async () => {
    const fixture = await fixtureCopy("linear-v2.jsonl");
    const result = run([
      "export",
      "--session",
      "does-not-exist",
      "--cwd",
      fixture.root,
      "--output",
      join(fixture.root, "missing-output.json"),
    ]);
    expect(result.status).toBe(3);
  });
});
