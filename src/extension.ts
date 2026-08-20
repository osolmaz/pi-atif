import { createHash } from "node:crypto";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parseExportArguments, tokenizeArguments } from "./arguments.js";
import { exportSession } from "./exporter.js";
import { toJsonValue } from "./schema.js";
import type { LivePromptMetadata } from "./session-types.js";
import { EXPORTER_VERSION, getPiRuntimeVersion } from "./version.js";

interface LiveState {
  captures: LivePromptMetadata[];
  complete: boolean;
  lastCaptureHash?: string;
}

const liveBySession = new Map<string, LiveState>();
const writeQueues = new Map<string, Promise<void>>();

function autoExportEnabled(): boolean {
  return process.env.PI_ATIF_AUTO_EXPORT === "1" && Boolean(process.env.PI_ATIF_OUTPUT_DIR);
}

function stateFor(ctx: ExtensionContext): LiveState {
  const id = ctx.sessionManager.getSessionId();
  let state = liveBySession.get(id);
  if (!state) {
    const hasAssistant = ctx.sessionManager
      .getEntries()
      .some(
        (entry) =>
          entry.type === "message" && (entry.message as { role?: string }).role === "assistant",
      );
    state = { captures: [], complete: !hasAssistant };
    liveBySession.set(id, state);
  }
  return state;
}

function toolDefinitions(pi: ExtensionAPI): Record<string, unknown>[] {
  const active = new Set(pi.getActiveTools());
  return pi
    .getAllTools()
    .filter((tool) => active.has(tool.name))
    .map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: toJsonValue(tool.parameters) ?? {},
      },
    }));
}

function enqueue<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(sessionId) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const queued = result.then(
    () => undefined,
    () => undefined,
  );
  writeQueues.set(sessionId, queued);
  void queued.finally(() => {
    if (writeQueues.get(sessionId) === queued) writeQueues.delete(sessionId);
  });
  return result;
}

async function performExport(
  ctx: ExtensionContext,
  options: { destination: string; selection: string; force: boolean },
): Promise<Awaited<ReturnType<typeof exportSession>>> {
  const state = stateFor(ctx);
  return exportSession(ctx.sessionManager, {
    destination: options.destination,
    selection: options.selection,
    force: options.force,
    agentVersion: await getPiRuntimeVersion(),
    exporterVersion: EXPORTER_VERSION,
    livePromptMetadata: state.captures,
    liveMetadataComplete: state.complete,
  });
}

async function autoExport(ctx: ExtensionContext): Promise<void> {
  const root = process.env.PI_ATIF_OUTPUT_DIR;
  if (!autoExportEnabled() || !root) return;
  const sessionId = ctx.sessionManager.getSessionId();
  await enqueue(sessionId, async () => {
    await performExport(ctx, {
      destination: join(root, sessionId),
      selection: "current",
      force: true,
    });
  });
}

export default function piAtifExtension(pi: ExtensionAPI): void {
  pi.registerCommand("atif", {
    description: "Export this Pi session as Harbor ATIF-v1.7 (usage: /atif export [options])",
    // Command validation and notification stay at the Pi adapter boundary.
    // eslint-disable-next-line complexity
    handler: async (input, ctx) => {
      try {
        const tokens = tokenizeArguments(input);
        const command = tokens.shift();
        if (command !== "export") {
          throw new Error(
            "Usage: /atif export [--leaf <id>|--all-leaves] [--output <path>] [--force]",
          );
        }
        const parsed = parseExportArguments(tokens);
        if (parsed.session || parsed.allSessions || parsed.limit || parsed.cwd) {
          throw new Error("Historical and batch options are available through the pi-atif CLI");
        }
        const destination =
          parsed.output ??
          join(
            process.env.PI_ATIF_OUTPUT_DIR ?? join(ctx.cwd, ".pi", "atif"),
            ctx.sessionManager.getSessionId(),
          );
        const artifacts = await enqueue(ctx.sessionManager.getSessionId(), async () =>
          performExport(ctx, {
            destination,
            selection: parsed.leaf ?? "current",
            force: parsed.force,
          }).then((result) => {
            if (ctx.hasUI) {
              const warningCount = result.reduce(
                (total, artifact) => total + artifact.warnings.length,
                0,
              );
              ctx.ui.notify(
                `Exported ${String(result.length)} ATIF trajectory${result.length === 1 ? "" : "s"} to ${destination}${warningCount ? ` with ${String(warningCount)} warning${warningCount === 1 ? "" : "s"}` : ""}`,
                warningCount ? "warning" : "info",
              );
            }
            return result;
          }),
        );
        void artifacts;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (ctx.hasUI) ctx.ui.notify(`ATIF export failed: ${message}`, "error");
        else console.error(`ATIF export failed: ${message}`);
      }
    },
  });

  pi.on("session_start", (_event, ctx) => {
    stateFor(ctx);
  });

  pi.on("before_agent_start", (event, ctx) => {
    const leafId = ctx.sessionManager.getLeafId();
    if (!leafId) return;
    const state = stateFor(ctx);
    const definitions = toolDefinitions(pi);
    const digest = createHash("sha256")
      .update(JSON.stringify([event.systemPrompt, definitions]))
      .digest("hex");
    if (digest === state.lastCaptureHash) return;
    state.captures.push({
      afterEntryId: leafId,
      systemPrompt: event.systemPrompt,
      toolDefinitions: definitions,
    });
    state.lastCaptureHash = digest;
  });

  pi.on("agent_settled", async (_event, ctx) => {
    try {
      await autoExport(ctx);
    } catch (error) {
      if (ctx.hasUI) ctx.ui.notify(`Automatic ATIF export failed: ${String(error)}`, "error");
    }
  });

  pi.on("session_before_switch", async (_event, ctx) => {
    try {
      await autoExport(ctx);
    } catch (error) {
      if (ctx.hasUI) ctx.ui.notify(`Automatic ATIF export failed: ${String(error)}`, "error");
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    try {
      if (autoExportEnabled()) {
        await Promise.race([
          autoExport(ctx),
          new Promise<never>((_resolve, reject) => {
            setTimeout(() => {
              reject(new Error("Automatic ATIF export timed out during shutdown"));
            }, 5_000);
          }),
        ]);
      }
    } catch (error) {
      if (ctx.hasUI) ctx.ui.notify(`Automatic ATIF export failed: ${String(error)}`, "error");
    } finally {
      liveBySession.delete(ctx.sessionManager.getSessionId());
    }
  });
}
