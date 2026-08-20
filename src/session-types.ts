import type { SessionEntry, SessionHeader } from "@earendil-works/pi-coding-agent";
import type { ExportWarning } from "./diagnostics.js";

export interface LivePromptMetadata {
  afterEntryId: string;
  systemPrompt: string;
  toolDefinitions: readonly Record<string, unknown>[];
}

export interface SessionBranchSnapshot {
  leafId: string;
  entries: readonly SessionEntry[];
}

export interface SessionSnapshot {
  header: SessionHeader;
  sessionId: string;
  sessionFile?: string;
  sessionName?: string;
  currentLeafId: string | null;
  branches: readonly SessionBranchSnapshot[];
  labels: Readonly<Record<string, string>>;
  livePromptMetadata: readonly LivePromptMetadata[];
  sourceWarnings: readonly ExportWarning[];
}

export type LeafSelection = string;
