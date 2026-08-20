# Export contract

pi-atif exports facts from Pi sessions without changing those sessions.

## Inputs

Current-session export reads the public `SessionManager` on the extension context. Historical export
opens sessions through the public `SessionManager.open`, `list`, and `listAll` methods. pi-atif does
not parse Pi session JSONL directly.

The default live export selects the current leaf. Historical export rejects an ambiguous session or
leaf selection. `all` exports one independent ATIF trajectory for each leaf.

## Output

The first release emits ATIF-v1.7 only. Each selected leaf gets one linear trajectory. All leaf
trajectories use the real Pi session ID and deterministic per-document trajectory IDs. Alternative
branches are not subagents.

Serialization, filenames, trajectory IDs, warnings, and hashes are deterministic for one source and
export profile. Missing data is omitted and reported. pi-atif does not generate placeholder text,
current-time timestamps, rewards, retry causes, or subagent relationships.

Empty branches fail because ATIF requires at least one step.

## Privacy

Raw trajectories can contain private prompts, paths, tool arguments, results, and errors. Export is
local only. Directories created by pi-atif use mode `0700`; files use mode `0600`. Redaction is an
explicit named transform applied before validation and writing. The built-in `raw` profile does not
redact content.

## Writes

Output is validated before commit. A single file is written and synced in its destination directory,
then atomically renamed and followed by a directory sync. Multi-leaf output is staged as a complete
directory before rename. Identical output is an idempotent success. Different existing output is a
conflict unless the caller explicitly permits replacement.

Failures leave the Pi session unchanged. pi-atif removes only temporary paths that it owns.

## Automatic export

Automatic export is disabled by default. Set both `PI_ATIF_AUTO_EXPORT=1` and
`PI_ATIF_OUTPUT_DIR=<path>` to enable export after an agent settles and at supported session switch
or shutdown boundaries. Automatic writes are serialized per session.
