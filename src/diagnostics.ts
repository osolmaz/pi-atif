export type WarningCode =
  | "agent-origin-version-unavailable"
  | "embedded-image-omitted"
  | "historical-live-metadata-unavailable"
  | "invalid-metric-omitted"
  | "orphan-tool-result"
  | "unsupported-entry-omitted"
  | "unsupported-message-omitted";

export interface ExportWarning {
  code: WarningCode;
  message: string;
  entryId?: string;
  field?: string;
}

export function warning(
  code: WarningCode,
  message: string,
  options: Pick<ExportWarning, "entryId" | "field"> = {},
): ExportWarning {
  return { code, message, ...options };
}
