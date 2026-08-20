import { extname, join } from "node:path";
import type { ExportWarning } from "./diagnostics.js";
import { trajectoryFilename } from "./identity.js";
import { mapBranchToAtif } from "./mapper.js";
import { type RedactionProfile, rawRedactionProfile } from "./redaction.js";
import { validateAtifTrajectory } from "./schema.js";
import { type SessionReader, type SnapshotOptions, snapshotSession } from "./session-source.js";
import type { LeafSelection, SessionBranchSnapshot, SessionSnapshot } from "./session-types.js";
import { stableStringify } from "./stable-json.js";
import { type WriteResult, writeAtomicDirectory, writeAtomicFile } from "./writer.js";

export interface ExportSessionOptions extends SnapshotOptions {
  destination: string;
  agentVersion: string;
  exporterVersion: string;
  selection?: LeafSelection;
  force?: boolean;
  redactionProfile?: RedactionProfile;
  signal?: AbortSignal;
}

export interface ExportArtifact extends WriteResult {
  trajectoryId: string;
  leafId: string;
  warnings: readonly ExportWarning[];
}

function selectBranches(
  snapshot: SessionSnapshot,
  selection: LeafSelection,
): SessionBranchSnapshot[] {
  if (selection === "all") return [...snapshot.branches];
  if (selection === "current") {
    if (!snapshot.currentLeafId) throw new Error("The Pi session has no current leaf");
    const current = snapshot.branches.find((branch) => branch.leafId === snapshot.currentLeafId);
    if (!current)
      throw new Error(`Current Pi leaf ${snapshot.currentLeafId} is not in the session tree`);
    return [current];
  }
  const leaf = snapshot.branches.find((branch) => branch.leafId === selection);
  if (leaf) return [leaf];
  for (const branch of snapshot.branches) {
    const index = branch.entries.findIndex((entry) => entry.id === selection);
    if (index >= 0) {
      return [{ leafId: selection, entries: branch.entries.slice(0, index + 1) }];
    }
  }
  throw new Error(`Pi entry or leaf ${selection} was not found`);
}

export async function exportSnapshot(
  snapshot: SessionSnapshot,
  options: Omit<ExportSessionOptions, keyof SnapshotOptions>,
): Promise<ExportArtifact[]> {
  const profile = options.redactionProfile ?? rawRedactionProfile;
  const branches = selectBranches(snapshot, options.selection ?? "current");
  const artifacts = await Promise.all(
    branches.map(async (branch) => {
      const mapped = mapBranchToAtif(snapshot, branch, {
        agentVersion: options.agentVersion,
        exporterVersion: options.exporterVersion,
        profileId: profile.id,
      });
      const transformed = validateAtifTrajectory(await profile.transform(mapped.trajectory));
      return {
        branch,
        trajectory: transformed,
        content: stableStringify(transformed),
        warnings: mapped.warnings,
      };
    }),
  );

  if (artifacts.length === 1 && extname(options.destination) === ".json") {
    const artifact = artifacts[0];
    if (!artifact) return [];
    const write = await writeAtomicFile(
      options.destination,
      artifact.content,
      options.force,
      options.signal,
    );
    return [
      {
        ...write,
        trajectoryId: artifact.trajectory.trajectory_id,
        leafId: artifact.branch.leafId,
        warnings: artifact.warnings,
      },
    ];
  }

  const files = new Map(
    artifacts.map((artifact) => [
      trajectoryFilename(artifact.trajectory.trajectory_id),
      artifact.content,
    ]),
  );
  const writes = await writeAtomicDirectory(
    options.destination,
    files,
    options.force,
    options.signal,
  );
  return artifacts.map((artifact) => {
    const path = join(options.destination, trajectoryFilename(artifact.trajectory.trajectory_id));
    const write = writes.find((candidate) => candidate.path === path);
    if (!write) throw new Error(`Writer did not return ${path}`);
    return {
      ...write,
      trajectoryId: artifact.trajectory.trajectory_id,
      leafId: artifact.branch.leafId,
      warnings: artifact.warnings,
    };
  });
}

export async function exportSession(
  manager: SessionReader,
  options: ExportSessionOptions,
): Promise<ExportArtifact[]> {
  const snapshot = snapshotSession(manager, options);
  return exportSnapshot(snapshot, options);
}
