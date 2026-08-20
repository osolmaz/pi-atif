import { createHash, randomUUID } from "node:crypto";
import { access, chmod, mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export class OutputConflictError extends Error {
  constructor(readonly path: string) {
    super(`Output already exists with different content: ${path}`);
    this.name = "OutputConflictError";
  }
}

export interface WriteResult {
  path: string;
  sha256: string;
  idempotent: boolean;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Export was interrupted", "AbortError");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function ensureDirectory(path: string): Promise<void> {
  const created = await mkdir(path, { recursive: true, mode: 0o700 });
  if (created) await chmod(created, 0o700);
}

async function writeFreshFile(path: string, content: string): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(path, 0o600);
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function writeAtomicFile(
  destination: string,
  content: string,
  force = false,
  signal?: AbortSignal,
): Promise<WriteResult> {
  throwIfAborted(signal);
  const parent = dirname(destination);
  await ensureDirectory(parent);
  const digest = sha256(content);
  if (await exists(destination)) {
    const current = await readFile(destination, "utf8");
    if (current === content) return { path: destination, sha256: digest, idempotent: true };
    if (!force) throw new OutputConflictError(destination);
  }

  const temporary = join(parent, `.${basename(destination)}.pi-atif-${randomUUID()}.tmp`);
  let committed = false;
  try {
    await writeFreshFile(temporary, content);
    throwIfAborted(signal);
    await rename(temporary, destination);
    committed = true;
    await syncDirectory(parent);
    return { path: destination, sha256: digest, idempotent: false };
  } finally {
    if (!committed && (await exists(temporary))) await rm(temporary, { force: true });
  }
}

async function directoryMatches(
  destination: string,
  files: ReadonlyMap<string, string>,
): Promise<boolean> {
  if (!(await exists(destination))) return false;
  const names = (await readdir(destination)).sort();
  const expected = [...files.keys()].sort();
  if (names.length !== expected.length || names.some((name, index) => name !== expected[index]))
    return false;
  for (const [name, content] of files) {
    if ((await readFile(join(destination, name), "utf8")) !== content) return false;
  }
  return true;
}

async function recoverDirectory(destination: string, backup: string): Promise<void> {
  const destinationExists = await exists(destination);
  const backupExists = await exists(backup);
  if (!destinationExists && backupExists) {
    await rename(backup, destination);
    await syncDirectory(dirname(destination));
  } else if (destinationExists && backupExists) {
    await rm(backup, { recursive: true, force: true });
    await syncDirectory(dirname(destination));
  }
}

// The transaction keeps recovery, replacement, and cleanup in one ordered operation.
// eslint-disable-next-line complexity
export async function writeAtomicDirectory(
  destination: string,
  files: ReadonlyMap<string, string>,
  force = false,
  signal?: AbortSignal,
): Promise<WriteResult[]> {
  throwIfAborted(signal);
  const parent = dirname(destination);
  await ensureDirectory(parent);
  const backup = `${destination}.pi-atif-backup`;
  await recoverDirectory(destination, backup);

  if (await directoryMatches(destination, files)) {
    return [...files].map(([name, content]) => ({
      path: join(destination, name),
      sha256: sha256(content),
      idempotent: true,
    }));
  }
  if ((await exists(destination)) && !force) throw new OutputConflictError(destination);

  const stage = join(parent, `.${basename(destination)}.pi-atif-${randomUUID()}.tmp`);
  let stageCommitted = false;
  await mkdir(stage, { mode: 0o700 });
  try {
    for (const [name, content] of [...files].sort(([left], [right]) => left.localeCompare(right))) {
      await writeFreshFile(join(stage, name), content);
    }
    await syncDirectory(stage);
    throwIfAborted(signal);

    if (await exists(destination)) await rename(destination, backup);
    try {
      await rename(stage, destination);
      stageCommitted = true;
      await syncDirectory(parent);
    } catch (error) {
      if (!(await exists(destination)) && (await exists(backup))) await rename(backup, destination);
      await syncDirectory(parent);
      throw error;
    }
    if (await exists(backup)) {
      await rm(backup, { recursive: true, force: true });
      await syncDirectory(parent);
    }
    return [...files].map(([name, content]) => ({
      path: join(destination, name),
      sha256: sha256(content),
      idempotent: false,
    }));
  } finally {
    if (!stageCommitted && (await exists(stage))) await rm(stage, { recursive: true, force: true });
  }
}
