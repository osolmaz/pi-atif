import { createHash } from "node:crypto";

export const ATIF_VERSION = "ATIF-v1.7" as const;
export const DEFAULT_EXPORT_PROFILE = "raw-v1";

export function trajectoryId(sessionId: string, leafId: string, profileId: string): string {
  const digest = createHash("sha256")
    .update([sessionId, leafId, ATIF_VERSION, profileId].join("\0"))
    .digest("hex");
  return `pi-atif-${digest}`;
}

export function trajectoryFilename(id: string): string {
  return `${id}.json`;
}
