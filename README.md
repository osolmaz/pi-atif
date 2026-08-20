# pi-atif

pi-atif is a Pi package and CLI for exporting coding-agent sessions as Harbor ATIF-v1.7
trajectories. It exports current and historical sessions through Pi's public session APIs without
changing the source session.

## Install

Install a tagged release as a Pi package:

```bash
pi install git:github.com/osolmaz/pi-atif@<tag>
```

To use the historical-session CLI, install the same tag with npm:

```bash
npm install --global git+https://github.com/osolmaz/pi-atif.git#<tag>
```

Pi packages run with your user permissions. Review the source before installation.

## Export the current session

Run this command inside Pi:

```text
/atif export
```

The default destination is `.pi/atif/<session-id>/` under the current project. Select a leaf or all
leaves explicitly when needed:

```text
/atif export --leaf <entry-id> --output ./trajectory.json
/atif export --all-leaves --output ./trajectories
```

Each selected Pi tree leaf becomes one linear ATIF trajectory. Sibling leaves share the real Pi
session ID and have distinct deterministic trajectory IDs. Alternative branches are not labeled as
subagents.

## Export a historical session

Use a session file, full session ID, or unambiguous partial session ID:

```bash
pi-atif export \
  --session <path-or-id> \
  --leaf <entry-id> \
  --output ./trajectory.json
```

A historical session with more than one leaf requires `--leaf` or `--all-leaves`:

```bash
pi-atif export \
  --session <path-or-id> \
  --all-leaves \
  --output ./trajectories
```

Use `--format json` for machine-readable command results. Batch export requires both `--all` and a
positive `--limit`.

## Output guarantees

pi-atif uses the same converter for the extension, CLI, and library API. It validates output before
writing, uses stable serialization, and writes owner-only files through an atomic commit. Repeating
an export with identical content is safe. A different existing destination is rejected unless
`--force` is explicit.

Historical sessions do not contain every live fact. Missing system prompts, active tool definitions,
provider payloads, retry causes, token IDs, log probabilities, and subagent relationships are omitted
and reported as structured warnings. pi-atif does not create placeholder values for missing facts.

## Privacy

Raw trajectories can contain prompts, tool arguments, tool results, file paths, and provider errors.
pi-atif keeps exports local and does not upload them. The built-in `raw-v1` profile does not redact
content, so inspect output before sharing it.

## Automatic export

Automatic export is disabled by default. Enable it only with both variables:

```bash
export PI_ATIF_AUTO_EXPORT=1
export PI_ATIF_OUTPUT_DIR="$HOME/private/pi-atif"
```

Pi then exports the current leaf after the agent settles and at supported session shutdown or switch
boundaries.

## Library API

The package exports the snapshot reader, pure mapper, ATIF validator, exporter, deterministic
serializer, and atomic writer:

```typescript
import { exportSession } from "pi-atif";

const artifacts = await exportSession(sessionManager, {
  destination: "./trajectories",
  selection: "all",
  agentVersion: "<observed-pi-version>",
  exporterVersion: "<pi-atif-version>",
});
```

The caller must supply the observed Pi runtime version. The exporter records that historical Pi
sessions do not preserve the version that originally created each entry.

## License

[MIT](LICENSE)
