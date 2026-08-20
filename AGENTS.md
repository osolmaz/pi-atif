# pi-atif

- Read the installed Pi extension, session, package, and compaction documentation before changing
  runtime behavior.
- Use documented public Pi APIs only. Do not parse session JSONL in production code.
- Keep the snapshot converter pure. The extension, CLI, and library must use the same converter.
- Preserve observed session facts. Omit unavailable facts with structured warnings instead of
  inventing values.
- Keep automatic export disabled by default and never append pi-atif state to Pi sessions.
- Treat raw trajectories as sensitive. Do not upload output or apply destructive redaction by
  default.
- Keep ATIF-v1.7 validation aligned with Harbor's pinned authoritative validator.
- Add synthetic tests for every mapping, privacy, durability, or compatibility change.
- Use Conventional Commits for commits and pull request titles.
- Before finishing, run `npm run check`, `npm run mutate`, `npm run slophammer`,
  `npm run validate:harbor`, `npm run smoke:pi`, and `git diff --check`.
