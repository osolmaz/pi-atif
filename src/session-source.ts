import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { type SessionInfo, SessionManager } from "@earendil-works/pi-coding-agent";
import { warning } from "./diagnostics.js";
import type {
  LivePromptMetadata,
  SessionBranchSnapshot,
  SessionSnapshot,
} from "./session-types.js";

export class SessionSourceError extends Error {
  constructor(
    message: string,
    readonly code: "ambiguous-session" | "empty-session" | "invalid-session" | "session-not-found",
  ) {
    super(message);
    this.name = "SessionSourceError";
  }
}

export interface SnapshotOptions {
  livePromptMetadata?: readonly LivePromptMetadata[];
  liveMetadataComplete?: boolean;
}

export type SessionReader = Pick<
  SessionManager,
  | "getBranch"
  | "getEntries"
  | "getHeader"
  | "getLabel"
  | "getLeafId"
  | "getSessionFile"
  | "getSessionId"
  | "getSessionName"
  | "getTree"
>;

function collectLeafIds(manager: SessionReader): string[] {
  const leaves: string[] = [];
  const visit = (nodes: ReturnType<SessionReader["getTree"]>): void => {
    for (const node of nodes) {
      if (node.children.length === 0) {
        leaves.push(node.entry.id);
      } else {
        visit(node.children);
      }
    }
  };
  visit(manager.getTree());
  return leaves.sort();
}

export function snapshotSession(
  manager: SessionReader,
  options: SnapshotOptions = {},
): SessionSnapshot {
  const header = manager.getHeader();
  if (!header) {
    throw new SessionSourceError("Pi did not provide a session header", "invalid-session");
  }

  const leafIds = collectLeafIds(manager);
  if (leafIds.length === 0) {
    throw new SessionSourceError("The Pi session has no exportable entries", "empty-session");
  }

  const branches: SessionBranchSnapshot[] = leafIds.map((leafId) => ({
    leafId,
    entries: manager.getBranch(leafId),
  }));
  const labels: Record<string, string> = {};
  for (const entry of manager.getEntries()) {
    const label = manager.getLabel(entry.id);
    if (label !== undefined) labels[entry.id] = label;
  }

  const sourceWarnings = [];
  if (!options.liveMetadataComplete) {
    sourceWarnings.push(
      warning(
        "historical-live-metadata-unavailable",
        "System prompts and active tool definitions are included only when observed by the live extension",
      ),
    );
  }
  sourceWarnings.push(
    warning(
      "agent-origin-version-unavailable",
      "Pi sessions do not record the Pi version that originally created each entry; agent.version identifies the export runtime",
    ),
  );

  return {
    header,
    sessionId: manager.getSessionId(),
    sessionFile: manager.getSessionFile(),
    sessionName: manager.getSessionName(),
    currentLeafId: manager.getLeafId(),
    branches,
    labels,
    livePromptMetadata: options.livePromptMetadata ?? [],
    sourceWarnings,
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function chooseSession(query: string, sessions: readonly SessionInfo[]): SessionInfo {
  const exact = sessions.filter((session) => session.id === query || session.path === query);
  const matches =
    exact.length > 0 ? exact : sessions.filter((session) => session.id.startsWith(query));
  if (matches.length === 0) {
    throw new SessionSourceError(`No Pi session matches ${query}`, "session-not-found");
  }
  if (matches.length > 1) {
    const ids = matches
      .map((session) => session.id)
      .sort()
      .join(", ");
    throw new SessionSourceError(
      `Pi session selector ${query} is ambiguous: ${ids}`,
      "ambiguous-session",
    );
  }
  const match = matches[0];
  if (!match) throw new SessionSourceError(`No Pi session matches ${query}`, "session-not-found");
  return match;
}

export async function openHistoricalSession(
  query: string,
  options: { cwd?: string; sessionDir?: string } = {},
): Promise<SessionManager> {
  const candidate = resolve(query);
  if (await pathExists(candidate)) {
    return SessionManager.open(candidate, options.sessionDir);
  }
  const sessions = options.cwd
    ? await SessionManager.list(options.cwd, options.sessionDir)
    : await SessionManager.listAll(options.sessionDir);
  return SessionManager.open(chooseSession(query, sessions).path, options.sessionDir);
}
