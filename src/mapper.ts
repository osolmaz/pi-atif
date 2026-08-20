import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { type ExportWarning, warning } from "./diagnostics.js";
import { ATIF_VERSION, trajectoryId } from "./identity.js";
import {
  type AtifContentPart,
  type AtifFinalMetrics,
  type AtifMetrics,
  type AtifObservationResult,
  type AtifStep,
  type AtifToolCall,
  type AtifTrajectory,
  type JsonObject,
  toJsonValue,
  validateAtifTrajectory,
} from "./schema.js";
import type {
  LivePromptMetadata,
  SessionBranchSnapshot,
  SessionSnapshot,
} from "./session-types.js";

interface PiTextContent {
  type: "text";
  text: string;
}
interface PiImageContent {
  type: "image";
  data: string;
  mimeType: string;
}
interface PiThinkingContent {
  type: "thinking";
  thinking: string;
  redacted?: boolean;
}
interface PiToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  namespace?: string;
}
interface PiUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h?: number;
  reasoning?: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}
interface PiAssistantMessage {
  role: "assistant";
  content: (PiTextContent | PiThinkingContent | PiToolCall)[];
  api: string;
  provider: string;
  model: string;
  responseModel?: string;
  responseId?: string;
  usage: PiUsage;
  stopReason: string;
  errorMessage?: string;
  rawStopReason?: string;
}
interface PiToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (PiTextContent | PiImageContent)[];
  isError: boolean;
  details?: unknown;
  usage?: PiUsage;
  addedToolNames?: string[];
}
interface PiUserMessage {
  role: "user";
  content: string | (PiTextContent | PiImageContent)[];
}
interface PiBashMessage {
  role: "bashExecution";
  command: string;
  output: string;
  exitCode?: number;
  cancelled: boolean;
  truncated: boolean;
  fullOutputPath?: string;
  excludeFromContext?: boolean;
}
interface PiCustomMessage {
  role: "custom";
  customType: string;
  content: string | (PiTextContent | PiImageContent)[];
  display: boolean;
  details?: unknown;
}

export interface MapBranchOptions {
  agentVersion: string;
  exporterVersion: string;
  profileId: string;
}

export interface MapBranchResult {
  trajectory: AtifTrajectory;
  warnings: ExportWarning[];
}

interface MetricAccumulator {
  observed: boolean;
  prompt: number;
  completion: number;
  cached: number;
  cost: number;
}

function asObject(value: unknown): JsonObject {
  const converted = toJsonValue(value);
  return converted && !Array.isArray(converted) && typeof converted === "object" ? converted : {};
}

function validNonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function contentToAtif(
  content: string | (PiTextContent | PiImageContent)[],
  warnings: ExportWarning[],
  entryId: string,
): string | AtifContentPart[] {
  if (typeof content === "string") return content;
  const parts: AtifContentPart[] = [];
  for (const part of content) {
    if (part.type === "text") {
      parts.push({ type: "text", text: part.text });
    } else {
      warnings.push(
        warning(
          "embedded-image-omitted",
          `Pi stores image content as embedded ${part.mimeType} data, while ATIF requires a path`,
          { entryId, field: "message.content" },
        ),
      );
    }
  }
  return parts;
}

function usageToMetrics(
  usage: PiUsage | undefined,
  warnings: ExportWarning[],
  entryId: string,
): AtifMetrics | undefined {
  if (!usage) return undefined;
  const rawValues = [
    usage.input,
    usage.output,
    usage.cacheRead,
    usage.cacheWrite,
    usage.cost.total,
  ];
  if (rawValues.some((value) => !validNonnegative(value))) {
    warnings.push(
      warning("invalid-metric-omitted", "Pi reported a negative or non-finite usage value", {
        entryId,
        field: "message.usage",
      }),
    );
    return undefined;
  }
  if (rawValues.every((value) => value === 0)) return undefined;

  const metrics: AtifMetrics = {
    prompt_tokens: usage.input + usage.cacheRead,
    completion_tokens: usage.output,
    cached_tokens: usage.cacheRead,
    cost_usd: usage.cost.total,
    extra: {
      pi_atif: {
        input_tokens_excluding_cache_hits: usage.input,
        cache_write_tokens: usage.cacheWrite,
        total_tokens_reported_by_pi: usage.totalTokens,
        ...(usage.cacheWrite1h === undefined ? {} : { cache_write_1h_tokens: usage.cacheWrite1h }),
        ...(usage.reasoning === undefined ? {} : { reasoning_tokens: usage.reasoning }),
        cost_breakdown: asObject(usage.cost),
      },
    },
  };
  return metrics;
}

function addMetrics(accumulator: MetricAccumulator, metrics: AtifMetrics | undefined): void {
  if (!metrics) return;
  accumulator.observed = true;
  accumulator.prompt += metrics.prompt_tokens ?? 0;
  accumulator.completion += metrics.completion_tokens ?? 0;
  accumulator.cached += metrics.cached_tokens ?? 0;
  accumulator.cost += metrics.cost_usd ?? 0;
}

function finalMetrics(accumulator: MetricAccumulator, totalSteps: number): AtifFinalMetrics {
  return {
    ...(accumulator.observed
      ? {
          total_prompt_tokens: accumulator.prompt,
          total_completion_tokens: accumulator.completion,
          total_cached_tokens: accumulator.cached,
          total_cost_usd: accumulator.cost,
        }
      : {}),
    total_steps: totalSteps,
  };
}

function stepExtra(entryId: string, values: JsonObject = {}): JsonObject {
  return { pi_atif: { entry_id: entryId, ...values } };
}

function toolResult(
  message: PiToolResultMessage,
  warnings: ExportWarning[],
  entryId: string,
  hasMatchingCall: boolean,
): AtifObservationResult {
  if (!hasMatchingCall) {
    warnings.push(
      warning(
        "orphan-tool-result",
        "Tool result does not match a tool call in the assistant step",
        {
          entryId,
        },
      ),
    );
  }
  return {
    ...(hasMatchingCall ? { source_call_id: message.toolCallId } : {}),
    content: contentToAtif(message.content, warnings, entryId),
    extra: {
      pi_atif: {
        entry_id: entryId,
        tool_name: message.toolName,
        is_error: message.isError,
        ...(message.addedToolNames ? { added_tool_names: message.addedToolNames } : {}),
        ...(message.details === undefined ? {} : { details: toJsonValue(message.details) ?? null }),
        ...(message.usage === undefined ? {} : { tool_usage: toJsonValue(message.usage) ?? null }),
      },
    },
  };
}

function promptStep(metadata: LivePromptMetadata): AtifStep {
  return {
    step_id: 0,
    source: "system",
    message: metadata.systemPrompt,
    extra: {
      pi_atif: {
        kind: "system_prompt",
        after_entry_id: metadata.afterEntryId,
        active_tool_names: metadata.toolDefinitions
          .map((definition) => {
            const fn = definition.function;
            return fn && typeof fn === "object" && "name" in fn
              ? String((fn as Record<string, unknown>).name)
              : undefined;
          })
          .filter((name): name is string => name !== undefined),
      },
    },
  };
}

// Assistant content, tools, metrics, and observations are one ATIF step contract.
// eslint-disable-next-line complexity
function mapAssistant(
  entry: SessionEntry,
  message: PiAssistantMessage,
  thinkingLevel: string | undefined,
  results: PiToolResultMessage[],
  resultEntries: SessionEntry[],
  warnings: ExportWarning[],
): AtifStep {
  const textParts = message.content.filter((part): part is PiTextContent => part.type === "text");
  const thinkingParts = message.content.filter(
    (part): part is PiThinkingContent => part.type === "thinking" && !part.redacted,
  );
  const calls: AtifToolCall[] = message.content
    .filter((part): part is PiToolCall => part.type === "toolCall")
    .map((call) => ({
      tool_call_id: call.id,
      function_name: call.name,
      arguments: asObject(call.arguments),
      ...(call.namespace ? { extra: { pi_atif: { namespace: call.namespace } } } : {}),
    }));
  const callIds = new Set(calls.map((call) => call.tool_call_id));
  const observations = results.map((result, index) =>
    toolResult(
      result,
      warnings,
      resultEntries[index]?.id ?? entry.id,
      callIds.has(result.toolCallId),
    ),
  );
  const metrics = usageToMetrics(message.usage, warnings, entry.id);
  const extra: JsonObject = {
    pi_atif: {
      entry_id: entry.id,
      provider: message.provider,
      api: message.api,
      stop_reason: message.stopReason,
      ...(message.rawStopReason ? { raw_stop_reason: message.rawStopReason } : {}),
      ...(message.responseModel ? { response_model: message.responseModel } : {}),
      ...(message.responseId ? { response_id: message.responseId } : {}),
      ...(message.errorMessage ? { error_message: message.errorMessage } : {}),
    },
  };
  return {
    step_id: 0,
    timestamp: entry.timestamp,
    source: "agent",
    model_name: message.model,
    ...(thinkingLevel ? { reasoning_effort: thinkingLevel } : {}),
    message:
      textParts.length === 1
        ? (textParts[0]?.text ?? "")
        : textParts.map((part) => ({ type: "text" as const, text: part.text })),
    ...(thinkingParts.length > 0
      ? { reasoning_content: thinkingParts.map((part) => part.thinking).join("\n\n") }
      : {}),
    ...(calls.length > 0 ? { tool_calls: calls } : {}),
    ...(observations.length > 0 ? { observation: { results: observations } } : {}),
    ...(metrics ? { metrics } : {}),
    llm_call_count: 1,
    extra,
  };
}

// Pi's context-management entry variants require separate truthful representations.
// eslint-disable-next-line complexity
function mapSystemEntry(
  entry: SessionEntry,
  warnings: ExportWarning[],
): { step?: AtifStep; usage?: AtifMetrics } {
  if (entry.type === "model_change") {
    return {
      step: {
        step_id: 0,
        timestamp: entry.timestamp,
        source: "system",
        message: "Model changed",
        extra: stepExtra(entry.id, {
          kind: "model_change",
          provider: entry.provider,
          model_id: entry.modelId,
        }),
      },
    };
  }
  if (entry.type === "thinking_level_change") {
    return {
      step: {
        step_id: 0,
        timestamp: entry.timestamp,
        source: "system",
        message: "Thinking level changed",
        extra: stepExtra(entry.id, {
          kind: "thinking_level_change",
          thinking_level: entry.thinkingLevel,
        }),
      },
    };
  }
  if (entry.type === "compaction") {
    const usage = usageToMetrics(entry.usage, warnings, entry.id);
    const retainedTail = (entry as unknown as { retainedTail?: unknown[] }).retainedTail;
    return {
      step: {
        step_id: 0,
        timestamp: entry.timestamp,
        source: "system",
        message: "Context compaction",
        observation: { results: [{ content: entry.summary }] },
        extra: {
          context_management: { type: "compaction", boundary: "replace" },
          ...stepExtra(entry.id, {
            kind: "compaction",
            first_kept_entry_id: entry.firstKeptEntryId,
            tokens_before: entry.tokensBefore,
            from_hook: entry.fromHook ?? false,
            ...(retainedTail ? { retained_tail_count: retainedTail.length } : {}),
            ...(entry.details === undefined ? {} : { details: toJsonValue(entry.details) ?? null }),
            ...(usage ? { generation_metrics: toJsonValue(usage) ?? null } : {}),
          }),
        },
      },
      usage,
    };
  }
  if (entry.type === "branch_summary") {
    const usage = usageToMetrics(entry.usage, warnings, entry.id);
    return {
      step: {
        step_id: 0,
        timestamp: entry.timestamp,
        source: "system",
        message: "Branch summary",
        observation: { results: [{ content: entry.summary }] },
        extra: {
          context_management: { type: "injection", boundary: "append" },
          ...stepExtra(entry.id, {
            kind: "branch_summary",
            from_entry_id: entry.fromId,
            from_hook: entry.fromHook ?? false,
            ...(entry.details === undefined ? {} : { details: toJsonValue(entry.details) ?? null }),
            ...(usage ? { generation_metrics: toJsonValue(usage) ?? null } : {}),
          }),
        },
      },
      usage,
    };
  }
  return {};
}

function collectToolDefinitions(metadata: readonly LivePromptMetadata[]): JsonObject[] | undefined {
  const byName = new Map<string, JsonObject>();
  for (const capture of metadata) {
    for (const definition of capture.toolDefinitions) {
      const json = asObject(definition);
      const fn = json.function;
      const name = fn && typeof fn === "object" && !Array.isArray(fn) ? fn.name : undefined;
      if (typeof name === "string") byName.set(name, json);
    }
  }
  const definitions = [...byName.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, definition]) => definition);
  return definitions.length > 0 ? definitions : undefined;
}

// The explicit branch keeps every Pi entry and message variant visible for semantic review.
// eslint-disable-next-line complexity
export function mapBranchToAtif(
  snapshot: SessionSnapshot,
  branch: SessionBranchSnapshot,
  options: MapBranchOptions,
): MapBranchResult {
  const warnings = [...snapshot.sourceWarnings];
  const steps: AtifStep[] = [];
  const totals: MetricAccumulator = {
    observed: false,
    prompt: 0,
    completion: 0,
    cached: 0,
    cost: 0,
  };
  const promptByEntry = new Map(
    snapshot.livePromptMetadata.map((metadata) => [metadata.afterEntryId, metadata]),
  );
  let previousPrompt: string | undefined;
  let thinkingLevel: string | undefined;
  const assistantModels = new Set<string>();

  for (let index = 0; index < branch.entries.length; index += 1) {
    const entry = branch.entries[index];
    if (!entry) continue;

    if (entry.type === "thinking_level_change") thinkingLevel = entry.thinkingLevel;

    if (entry.type === "message") {
      const message = entry.message as unknown as { role: string };
      if (message.role === "assistant") {
        const assistant = entry.message as unknown as PiAssistantMessage;
        assistantModels.add(assistant.model);
        const results: PiToolResultMessage[] = [];
        const resultEntries: SessionEntry[] = [];
        while (index + 1 < branch.entries.length) {
          const next = branch.entries[index + 1];
          if (
            next?.type !== "message" ||
            (next.message as unknown as { role: string }).role !== "toolResult"
          )
            break;
          results.push(next.message as unknown as PiToolResultMessage);
          resultEntries.push(next);
          index += 1;
        }
        const mapped = mapAssistant(
          entry,
          assistant,
          thinkingLevel,
          results,
          resultEntries,
          warnings,
        );
        steps.push(mapped);
        addMetrics(totals, mapped.metrics);
      } else if (message.role === "user") {
        const user = entry.message as unknown as PiUserMessage;
        steps.push({
          step_id: 0,
          timestamp: entry.timestamp,
          source: "user",
          message: contentToAtif(user.content, warnings, entry.id),
          extra: stepExtra(entry.id),
        });
      } else if (message.role === "bashExecution") {
        const bash = entry.message as unknown as PiBashMessage;
        steps.push({
          step_id: 0,
          timestamp: entry.timestamp,
          source: "user",
          message: `!${bash.command}`,
          observation: { results: [{ content: bash.output }] },
          extra: stepExtra(entry.id, {
            kind: "bash_execution",
            cancelled: bash.cancelled,
            truncated: bash.truncated,
            ...(bash.exitCode === undefined ? {} : { exit_code: bash.exitCode }),
            ...(bash.fullOutputPath ? { full_output_path: bash.fullOutputPath } : {}),
            ...(bash.excludeFromContext === undefined
              ? {}
              : { exclude_from_context: bash.excludeFromContext }),
          }),
        });
      } else if (message.role === "custom") {
        const custom = entry.message as unknown as PiCustomMessage;
        steps.push({
          step_id: 0,
          timestamp: entry.timestamp,
          source: "user",
          message: contentToAtif(custom.content, warnings, entry.id),
          extra: stepExtra(entry.id, {
            kind: "custom_message",
            custom_type: custom.customType,
            display: custom.display,
            ...(custom.details === undefined
              ? {}
              : { details: toJsonValue(custom.details) ?? null }),
          }),
        });
      } else if (message.role === "toolResult") {
        warnings.push(
          warning("orphan-tool-result", "Tool result has no contiguous assistant tool call", {
            entryId: entry.id,
          }),
        );
        const orphan = entry.message as unknown as PiToolResultMessage;
        steps.push({
          step_id: 0,
          timestamp: entry.timestamp,
          source: "system",
          message: "Unmatched tool result",
          observation: {
            results: [
              {
                content: contentToAtif(orphan.content, warnings, entry.id),
                extra: {
                  pi_atif: {
                    entry_id: entry.id,
                    original_tool_call_id: orphan.toolCallId,
                    tool_name: orphan.toolName,
                    is_error: orphan.isError,
                  },
                },
              },
            ],
          },
          extra: stepExtra(entry.id, { kind: "orphan_tool_result" }),
        });
      } else {
        warnings.push(
          warning("unsupported-message-omitted", `Unsupported Pi message role ${message.role}`, {
            entryId: entry.id,
          }),
        );
      }
    } else if (
      entry.type === "model_change" ||
      entry.type === "thinking_level_change" ||
      entry.type === "compaction" ||
      entry.type === "branch_summary"
    ) {
      const mapped = mapSystemEntry(entry, warnings);
      if (mapped.step) steps.push(mapped.step);
      addMetrics(totals, mapped.usage);
    } else if (entry.type === "custom_message") {
      steps.push({
        step_id: 0,
        timestamp: entry.timestamp,
        source: "user",
        message: contentToAtif(entry.content, warnings, entry.id),
        extra: stepExtra(entry.id, {
          kind: "custom_message",
          custom_type: entry.customType,
          display: entry.display,
          ...(entry.details === undefined ? {} : { details: toJsonValue(entry.details) ?? null }),
        }),
      });
    } else if (entry.type === "custom") {
      warnings.push(
        warning(
          "unsupported-entry-omitted",
          `Extension state entry ${entry.customType} is not dialogue`,
          {
            entryId: entry.id,
          },
        ),
      );
    }

    const metadata = promptByEntry.get(entry.id);
    if (metadata && metadata.systemPrompt !== previousPrompt) {
      steps.push(promptStep(metadata));
      previousPrompt = metadata.systemPrompt;
    }
  }

  if (steps.length === 0) {
    throw new Error(`Pi leaf ${branch.leafId} has no ATIF-representable steps`);
  }
  steps.forEach((step, index) => {
    step.step_id = index + 1;
  });

  const id = trajectoryId(snapshot.sessionId, branch.leafId, options.profileId);
  const toolDefinitions = collectToolDefinitions(snapshot.livePromptMetadata);
  const trajectory: AtifTrajectory = {
    schema_version: ATIF_VERSION,
    session_id: snapshot.sessionId,
    trajectory_id: id,
    agent: {
      name: "pi",
      version: options.agentVersion,
      ...(assistantModels.size === 1 ? { model_name: [...assistantModels][0] } : {}),
      ...(toolDefinitions ? { tool_definitions: toolDefinitions } : {}),
      extra: {
        pi_atif: {
          exporter: "pi-atif",
          exporter_version: options.exporterVersion,
          version_semantics: "export_runtime",
        },
      },
    },
    steps,
    final_metrics: finalMetrics(totals, steps.length),
    extra: {
      pi_atif: {
        profile_id: options.profileId,
        normalized_session_version: snapshot.header.version ?? 1,
        source_session_timestamp: snapshot.header.timestamp,
        source_cwd: snapshot.header.cwd,
        selected_leaf_id: branch.leafId,
        ancestry_entry_ids: branch.entries.map((entry) => entry.id),
        ...(snapshot.header.parentSession ? { parent_session: snapshot.header.parentSession } : {}),
        ...(snapshot.sessionName ? { session_name: snapshot.sessionName } : {}),
        labels: snapshot.labels,
        complete: warnings.length === 0,
        warnings: warnings.map((item) => asObject(item)),
      },
    },
  };

  return { trajectory: validateAtifTrajectory(trajectory), warnings };
}
