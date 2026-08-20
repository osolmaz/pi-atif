#!/usr/bin/env node

import { join, resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { ArgumentError, parseExportArguments } from "./arguments.js";
import { type ExportArtifact, exportSnapshot } from "./exporter.js";
import { rawRedactionProfile } from "./redaction.js";
import {
  openHistoricalSession,
  SessionSourceError,
  safeSessionId,
  snapshotSession,
} from "./session-source.js";
import { EXPORTER_VERSION, getPiRuntimeVersion } from "./version.js";
import { OutputConflictError } from "./writer.js";

const abortController = new AbortController();
process.once("SIGINT", () => {
  abortController.abort();
});

const HELP = `Usage:
  pi-atif export --session <path-or-id> --output <path> [--leaf <id>|--all-leaves]
                 [--force] [--format <human|json>]
  pi-atif export --all --limit <count> --output <directory> [--cwd <path>]
                 [--leaf <id>|--all-leaves] [--force] [--format <human|json>]
`;

interface CliResult {
  ok: boolean;
  artifacts: ExportArtifact[];
  errors: { session: string; message: string }[];
}

function outputResult(result: CliResult, format: "human" | "json"): void {
  if (format === "json") {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  for (const artifact of result.artifacts) {
    process.stdout.write(
      `${artifact.idempotent ? "Verified" : "Wrote"} ${artifact.path} (${artifact.sha256})${artifact.warnings.length ? `, ${String(artifact.warnings.length)} warning(s)` : ""}\n`,
    );
  }
  for (const error of result.errors) process.stderr.write(`${error.session}: ${error.message}\n`);
}

function historicalSelection(branchCount: number, requested?: string): string {
  if (requested) return requested;
  if (branchCount !== 1) {
    throw new ArgumentError(
      "Historical session has multiple leaves; use --leaf <id> or --all-leaves",
    );
  }
  return "all";
}

async function exportOne(
  selector: string,
  destination: string,
  options: ReturnType<typeof parseExportArguments>,
  agentVersion: string,
  signal: AbortSignal,
): Promise<ExportArtifact[]> {
  const manager = await openHistoricalSession(selector, { cwd: options.cwd });
  const snapshot = snapshotSession(manager, { liveMetadataComplete: false });
  return exportSnapshot(snapshot, {
    destination,
    selection: historicalSelection(snapshot.branches.length, options.leaf),
    force: options.force,
    agentVersion,
    exporterVersion: EXPORTER_VERSION,
    redactionProfile: rawRedactionProfile,
    signal,
  });
}

// The top-level command keeps exit and batch routing visible in one place.
// eslint-disable-next-line complexity
async function run(): Promise<number> {
  const [command, ...tokens] = process.argv.slice(2);
  if (command === "--help" || command === "-h" || !command) {
    process.stdout.write(HELP);
    return command ? 0 : 2;
  }
  if (command !== "export") throw new ArgumentError(`Unknown command: ${command}\n${HELP}`);
  const options = parseExportArguments(tokens);
  if (!options.output) throw new ArgumentError("--output is required");
  if (options.allSessions === Boolean(options.session)) {
    throw new ArgumentError("Use exactly one of --session or --all");
  }
  if (options.allSessions && !options.limit)
    throw new ArgumentError("Batch export requires --limit");
  const destination = resolve(options.output);
  const agentVersion = await getPiRuntimeVersion();

  if (options.session) {
    const artifacts = await exportOne(
      options.session,
      destination,
      options,
      agentVersion,
      abortController.signal,
    );
    outputResult({ ok: true, artifacts, errors: [] }, options.format);
    return 0;
  }

  const sessions = options.cwd
    ? await SessionManager.list(options.cwd)
    : await SessionManager.listAll();
  const selected = sessions
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, options.limit);
  const result: CliResult = { ok: true, artifacts: [], errors: [] };
  for (const session of selected) {
    try {
      result.artifacts.push(
        ...(await exportOne(
          session.path,
          join(destination, safeSessionId(session.id)),
          options,
          agentVersion,
          abortController.signal,
        )),
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      result.ok = false;
      result.errors.push({
        session: session.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  outputResult(result, options.format);
  return result.ok ? 0 : 6;
}

try {
  process.exitCode = await run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  if (error instanceof DOMException && error.name === "AbortError") process.exitCode = 130;
  else if (error instanceof ArgumentError) process.exitCode = 2;
  else if (error instanceof SessionSourceError) process.exitCode = 3;
  else if (error instanceof OutputConflictError) process.exitCode = 5;
  else process.exitCode = 4;
}
