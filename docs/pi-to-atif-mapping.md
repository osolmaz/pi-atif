# Pi to ATIF mapping

## Root fields

- `schema_version` is `ATIF-v1.7`.
- `session_id` is Pi's real session ID.
- `trajectory_id` is a stable hash of the session ID, leaf ID, schema version, and export profile.
- `agent.name` is `pi`.
- `agent.version` is the observed Pi runtime version used to load and convert the session. A warning
  states that historical sessions do not record their original Pi version.
- Pi provenance, selected ancestry, the normalized session version, completeness, and warnings are
  stored under `extra.pi_atif`. Pi owns any v1 or v2 migration performed during loading.

## Steps

- Pi user messages become user steps.
- Pi assistant messages become agent steps.
- Contiguous tool results are attached to the preceding agent step by exact tool-call ID.
- User shell messages become user steps with an observation and exit metadata.
- Custom messages that enter Pi context become user steps with their custom type in `extra`.
- Model and thinking-level changes become system steps.
- Compaction becomes a system step with a `replace` context-management boundary.
- Branch summaries become system steps with an `append` context-management boundary.
- Labels and session names become trajectory metadata, not dialogue.
- Plain extension state and unknown entries are omitted with warnings.

## Content

Text is preserved exactly. ATIF accepts image paths, while Pi session messages store embedded base64
image data. Embedded images are omitted with a structured warning because pi-atif does not invent a
path or write a second artifact.

Thinking blocks become `reasoning_content` only when Pi persisted them. Encrypted signatures and raw
provider payloads are not exported.

## Metrics and errors

For each assistant message, `prompt_tokens` is Pi input tokens plus cache-read tokens, because Pi's
input count excludes cache hits. `cached_tokens` is the cache-read count. Cache-write counts and the
raw Pi usage breakdown are stored under metrics metadata without double counting. Completion tokens,
cost, stop reason, provider, response model, and errors come only from persisted Pi data.

Compaction and branch-summary usage contributes to final totals when Pi recorded it. Missing totals
are omitted rather than reported as measured zero. Retry causes and counts are not inferred.
