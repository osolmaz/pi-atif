import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import piAtifExtension from "../src/extension.js";
import { openFixture } from "./helpers.js";

interface RegisteredCommand {
  handler: (args: string, context: ExtensionContext) => Promise<void>;
}

describe("Pi extension", () => {
  it("registers /atif, captures live metadata, and leaves the session unchanged", async () => {
    const manager = await openFixture("linear-v2.jsonl");
    const before = manager.getEntries().length;
    const commands = new Map<string, RegisteredCommand>();
    const events = new Map<
      string,
      (event: unknown, context: ExtensionContext) => Promise<unknown>
    >();
    const notifications: string[] = [];
    const api = {
      registerCommand(name: string, command: RegisteredCommand) {
        commands.set(name, command);
      },
      on(name: string, handler: (event: unknown, context: ExtensionContext) => Promise<unknown>) {
        events.set(name, handler);
      },
      getActiveTools: () => ["read"],
      getAllTools: () => [
        {
          name: "read",
          description: "Read a file",
          parameters: { type: "object", properties: {} },
        },
      ],
    } as unknown as ExtensionAPI;
    piAtifExtension(api);

    const context = {
      cwd: manager.getCwd(),
      hasUI: true,
      sessionManager: manager,
      ui: { notify: (message: string) => notifications.push(message) },
    } as unknown as ExtensionContext;
    await events.get("session_start")?.({ reason: "startup" }, context);
    await events.get("before_agent_start")?.(
      { systemPrompt: "Observed prompt", prompt: "Legacy extension message", images: [] },
      context,
    );
    const output = await mkdtemp(join(tmpdir(), "pi-atif-extension-"));
    await commands.get("atif")?.handler(`export --output ${join(output, "atif")}`, context);

    expect(await readdir(join(output, "atif"))).toHaveLength(1);
    expect(manager.getEntries()).toHaveLength(before);
    expect(notifications.at(-1)).toContain("Exported 1 ATIF trajectory");
    await events.get("session_shutdown")?.({ reason: "quit" }, context);
  });

  it("writes automatically only after explicit opt-in", async () => {
    const previousAuto = process.env.PI_ATIF_AUTO_EXPORT;
    const previousOutput = process.env.PI_ATIF_OUTPUT_DIR;
    const output = await mkdtemp(join(tmpdir(), "pi-atif-auto-"));
    process.env.PI_ATIF_AUTO_EXPORT = "1";
    process.env.PI_ATIF_OUTPUT_DIR = output;
    try {
      const manager = await openFixture("linear-v2.jsonl");
      const events = new Map<
        string,
        (event: unknown, context: ExtensionContext) => Promise<unknown>
      >();
      const api = {
        registerCommand() {},
        on(name: string, handler: (event: unknown, context: ExtensionContext) => Promise<unknown>) {
          events.set(name, handler);
        },
        getActiveTools: () => [],
        getAllTools: () => [],
      } as unknown as ExtensionAPI;
      piAtifExtension(api);
      const context = {
        cwd: manager.getCwd(),
        hasUI: false,
        sessionManager: manager,
        ui: { notify() {} },
      } as unknown as ExtensionContext;
      await events.get("agent_settled")?.({}, context);
      expect(await readdir(join(output, manager.getSessionId()))).toHaveLength(1);
    } finally {
      if (previousAuto === undefined) delete process.env.PI_ATIF_AUTO_EXPORT;
      else process.env.PI_ATIF_AUTO_EXPORT = previousAuto;
      if (previousOutput === undefined) delete process.env.PI_ATIF_OUTPUT_DIR;
      else process.env.PI_ATIF_OUTPUT_DIR = previousOutput;
    }
  });

  it("does not write automatically unless explicitly enabled", async () => {
    const previousAuto = process.env.PI_ATIF_AUTO_EXPORT;
    const previousOutput = process.env.PI_ATIF_OUTPUT_DIR;
    delete process.env.PI_ATIF_AUTO_EXPORT;
    delete process.env.PI_ATIF_OUTPUT_DIR;
    try {
      const manager = await openFixture("linear-v2.jsonl");
      const events = new Map<
        string,
        (event: unknown, context: ExtensionContext) => Promise<unknown>
      >();
      const api = {
        registerCommand() {},
        on(name: string, handler: (event: unknown, context: ExtensionContext) => Promise<unknown>) {
          events.set(name, handler);
        },
        getActiveTools: () => [],
        getAllTools: () => [],
      } as unknown as ExtensionAPI;
      piAtifExtension(api);
      const context = {
        cwd: manager.getCwd(),
        hasUI: false,
        sessionManager: manager,
        ui: { notify() {} },
      } as unknown as ExtensionContext;
      await events.get("agent_settled")?.({}, context);
    } finally {
      if (previousAuto === undefined) delete process.env.PI_ATIF_AUTO_EXPORT;
      else process.env.PI_ATIF_AUTO_EXPORT = previousAuto;
      if (previousOutput === undefined) delete process.env.PI_ATIF_OUTPUT_DIR;
      else process.env.PI_ATIF_OUTPUT_DIR = previousOutput;
    }
  });
});
