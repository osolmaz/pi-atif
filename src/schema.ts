import { z } from "zod";
import { ATIF_VERSION } from "./identity.js";

export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
// Recursive JSON objects require an index signature rather than Record in TypeScript 5.
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface AtifContentPart {
  type: "text" | "image";
  text?: string;
  source?: {
    media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    path: string;
  };
}

export interface AtifMetrics {
  prompt_tokens?: number;
  completion_tokens?: number;
  cached_tokens?: number;
  cost_usd?: number;
  prompt_token_ids?: number[];
  completion_token_ids?: number[];
  logprobs?: number[];
  extra?: JsonObject;
}

export interface AtifToolCall {
  tool_call_id: string;
  function_name: string;
  arguments: JsonObject;
  extra?: JsonObject;
}

export interface AtifObservationResult {
  source_call_id?: string;
  content?: string | AtifContentPart[];
  extra?: JsonObject;
}

export interface AtifStep {
  step_id: number;
  timestamp?: string;
  source: "system" | "user" | "agent";
  model_name?: string;
  reasoning_effort?: string | number;
  message: string | AtifContentPart[];
  reasoning_content?: string;
  tool_calls?: AtifToolCall[];
  observation?: { results: AtifObservationResult[] };
  metrics?: AtifMetrics;
  is_copied_context?: boolean;
  llm_call_count?: number;
  extra?: JsonObject;
}

export interface AtifFinalMetrics {
  total_prompt_tokens?: number;
  total_completion_tokens?: number;
  total_cached_tokens?: number;
  total_cost_usd?: number;
  total_steps?: number;
  extra?: JsonObject;
}

export interface AtifAgent {
  name: string;
  version: string;
  model_name?: string;
  tool_definitions?: JsonObject[];
  extra?: JsonObject;
}

export interface AtifTrajectory {
  schema_version: typeof ATIF_VERSION;
  session_id: string;
  trajectory_id: string;
  agent: AtifAgent;
  steps: AtifStep[];
  notes?: string;
  final_metrics?: AtifFinalMetrics;
  extra?: JsonObject;
}

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
const jsonObjectSchema = z.record(z.string(), jsonValueSchema);
const imageSourceSchema = z
  .object({
    media_type: z.enum(["image/jpeg", "image/png", "image/gif", "image/webp"]),
    path: z.string(),
  })
  .strict();
const contentPartSchema = z
  .object({
    type: z.enum(["text", "image"]),
    text: z.string().optional(),
    source: imageSourceSchema.optional(),
  })
  .strict()
  .superRefine((part, context) => {
    if (part.type === "text" && (part.text === undefined || part.source !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Text content requires text and forbids source",
      });
    }
    if (part.type === "image" && (part.source === undefined || part.text !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Image content requires source and forbids text",
      });
    }
  });
const messageSchema = z.union([z.string(), z.array(contentPartSchema)]);
const metricsSchema = z
  .object({
    prompt_tokens: z.number().int().nonnegative().optional(),
    completion_tokens: z.number().int().nonnegative().optional(),
    cached_tokens: z.number().int().nonnegative().optional(),
    cost_usd: z.number().nonnegative().optional(),
    prompt_token_ids: z.array(z.number().int()).optional(),
    completion_token_ids: z.array(z.number().int()).optional(),
    logprobs: z.array(z.number()).optional(),
    extra: jsonObjectSchema.optional(),
  })
  .strict();
const toolCallSchema = z
  .object({
    tool_call_id: z.string(),
    function_name: z.string(),
    arguments: jsonObjectSchema,
    extra: jsonObjectSchema.optional(),
  })
  .strict();
const observationResultSchema = z
  .object({
    source_call_id: z.string().optional(),
    content: messageSchema.optional(),
    extra: jsonObjectSchema.optional(),
  })
  .strict();
const observationSchema = z.object({ results: z.array(observationResultSchema) }).strict();
const isoTimestampSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Expected an ISO 8601 timestamp",
});
const stepSchema = z
  .object({
    step_id: z.number().int().min(1),
    timestamp: isoTimestampSchema.optional(),
    source: z.enum(["system", "user", "agent"]),
    model_name: z.string().optional(),
    reasoning_effort: z.union([z.string(), z.number()]).optional(),
    message: messageSchema,
    reasoning_content: z.string().optional(),
    tool_calls: z.array(toolCallSchema).optional(),
    observation: observationSchema.optional(),
    metrics: metricsSchema.optional(),
    is_copied_context: z.boolean().optional(),
    llm_call_count: z.number().int().nonnegative().optional(),
    extra: jsonObjectSchema.optional(),
  })
  .strict()
  .superRefine((step, context) => {
    if (step.source !== "agent") {
      for (const field of [
        "model_name",
        "reasoning_effort",
        "reasoning_content",
        "tool_calls",
        "metrics",
      ] as const) {
        if (step[field] !== undefined) {
          context.addIssue({ code: "custom", path: [field], message: `${field} is agent-only` });
        }
      }
    }
    if (step.source === "agent" && step.llm_call_count === 0) {
      if (step.metrics !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["metrics"],
          message: "metrics require an LLM call",
        });
      }
      if (step.reasoning_content !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["reasoning_content"],
          message: "reasoning_content requires an LLM call",
        });
      }
    }
  });
const finalMetricsSchema = z
  .object({
    total_prompt_tokens: z.number().int().nonnegative().optional(),
    total_completion_tokens: z.number().int().nonnegative().optional(),
    total_cached_tokens: z.number().int().nonnegative().optional(),
    total_cost_usd: z.number().nonnegative().optional(),
    total_steps: z.number().int().nonnegative().optional(),
    extra: jsonObjectSchema.optional(),
  })
  .strict();
const agentSchema = z
  .object({
    name: z.string(),
    version: z.string(),
    model_name: z.string().optional(),
    tool_definitions: z.array(jsonObjectSchema).optional(),
    extra: jsonObjectSchema.optional(),
  })
  .strict();

export const atifTrajectorySchema: z.ZodType<AtifTrajectory> = z
  .object({
    schema_version: z.literal(ATIF_VERSION),
    session_id: z.string(),
    trajectory_id: z.string(),
    agent: agentSchema,
    steps: z.array(stepSchema).min(1),
    notes: z.string().optional(),
    final_metrics: finalMetricsSchema.optional(),
    extra: jsonObjectSchema.optional(),
  })
  .strict()
  .superRefine((trajectory, context) => {
    trajectory.steps.forEach((step, index) => {
      if (step.step_id !== index + 1) {
        context.addIssue({
          code: "custom",
          path: ["steps", index, "step_id"],
          message: `Expected sequential step_id ${String(index + 1)}`,
        });
      }
      const callIds = new Set(step.tool_calls?.map((call) => call.tool_call_id) ?? []);
      step.observation?.results.forEach((result, resultIndex) => {
        if (result.source_call_id !== undefined && !callIds.has(result.source_call_id)) {
          context.addIssue({
            code: "custom",
            path: ["steps", index, "observation", "results", resultIndex, "source_call_id"],
            message: "Observation source_call_id must reference a tool call in the same step",
          });
        }
      });
    });
  });

export function validateAtifTrajectory(value: unknown): AtifTrajectory {
  return atifTrajectorySchema.parse(value);
}

// Recursive JSON type dispatch is intentionally explicit.
// eslint-disable-next-line complexity
export function toJsonValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const items: unknown[] = value;
    return items.map(toJsonValue).filter((item): item is JsonValue => item !== undefined);
  }
  if (typeof value === "object") {
    const record: Record<string, unknown> = value as Record<string, unknown>;
    const output: JsonObject = {};
    for (const [key, child] of Object.entries(record)) {
      const converted = toJsonValue(child);
      if (converted !== undefined) output[key] = converted;
    }
    return output;
  }
  return undefined;
}
