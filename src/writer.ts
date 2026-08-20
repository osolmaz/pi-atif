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

interface DirectoryTransaction {
  schema: "pi-atif-directory-transaction-v1";
  id: string;
  destination: string;
  backup: string;
  stage: string;
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

function transactionPath(destination: string): string {
  return `${destination}.pi-atif-transaction.json`;
}

// Every field and path must match before recovery can mutate a backup.
// eslint-disable-next-line complexity
function isDirectoryTransaction(
  value: unknown,
  destination: string,
): value is DirectoryTransaction {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (
    record.schema !== "pi-atif-directory-transaction-v1" ||
    typeof record.id !== "string" ||
    !/^[0-9a-f-]{36}$/.test(record.id) ||
    record.destination !== destination ||
    typeof record.backup !== "string" ||
    typeof record.stage !== "string"
  ) {
    return false;
  }
  const parent = dirname(destination);
  const prefix = `.${basename(destination)}.pi-atif-${record.id}`;
  return (
    dirname(record.backup) === parent &&
    dirname(record.stage) === parent &&
    basename(record.backup) === `${prefix}.backup` &&
    basename(record.stage) === `${prefix}.tmp`
  );
}

async function loadDirectoryTransaction(
  destination: string,
): Promise<DirectoryTransaction | undefined> {
  const path = transactionPath(destination);
  if (!(await exists(path))) return undefined;
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (isDirectoryTransaction(parsed, destination)) return parsed;
  } catch {
    // The path is not a transaction owned by pi-atif.
  }
  throw new OutputConflictError(path);
}

async function recoverDirectory(destination: string): Promise<void> {
  const transaction = await loadDirectoryTransaction(destination);
  if (!transaction) return;
  const destinationExists = await exists(destination);
  const backupExists = await exists(transaction.backup);
  if (!destinationExists && backupExists) {
    await rename(transaction.backup, destination);
  } else if (destinationExists && backupExists) {
    await rm(transaction.backup, { recursive: true, force: true });
  }
  if (await exists(transaction.stage)) {
    await rm(transaction.stage, { recursive: true, force: true });
  }
  await rm(transactionPath(destination), { force: true });
  await syncDirectory(dirname(destination));
}

async function beginDirectoryTransaction(
  destination: string,
  stage: string,
): Promise<DirectoryTransaction> {
  const id = /\.pi-atif-([0-9a-f-]{36})\.tmp$/.exec(basename(stage))?.[1];
  if (!id) throw new Error(`Invalid pi-atif staging path: ${stage}`);
  const transaction: DirectoryTransaction = {
    schema: "pi-atif-directory-transaction-v1",
    id,
    destination,
    backup: join(dirname(destination), `.${basename(destination)}.pi-atif-${id}.backup`),
    stage,
  };
  await writeFreshFile(transactionPath(destination), `${JSON.stringify(transaction)}\n`);
  await syncDirectory(dirname(destination));
  return transaction;
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
  await recoverDirectory(destination);

  if (await directoryMatches(destination, files)) {
    return [...files].map(([name, content]) => ({
      path: join(destination, name),
      sha256: sha256(content),
      idempotent: true,
    }));
  }
  if ((await exists(destination)) && !force) throw new OutputConflictError(destination);

  const id = randomUUID();
  const stage = join(parent, `.${basename(destination)}.pi-atif-${id}.tmp`);
  let stageCommitted = false;
  let transaction: DirectoryTransaction | undefined;
  await mkdir(stage, { mode: 0o700 });
  try {
    for (const [name, content] of [...files].sort(([left], [right]) => left.localeCompare(right))) {
      await writeFreshFile(join(stage, name), content);
    }
    await syncDirectory(stage);
    throwIfAborted(signal);

    if (await exists(destination)) {
      transaction = await beginDirectoryTransaction(destination, stage);
      await rename(destination, transaction.backup);
    }
    try {
      await rename(stage, destination);
      stageCommitted = true;
      await syncDirectory(parent);
    } catch (error) {
      if (transaction && !(await exists(destination)) && (await exists(transaction.backup))) {
        await rename(transaction.backup, destination);
      }
      await syncDirectory(parent);
      throw error;
    }
    if (transaction) {
      if (await exists(transaction.backup)) {
        await rm(transaction.backup, { recursive: true, force: true });
      }
      await rm(transactionPath(destination), { force: true });
      await syncDirectory(parent);
    }
    return [...files].map(([name, content]) => ({
      path: join(destination, name),
      sha256: sha256(content),
      idempotent: false,
    }));
  } finally {
    if (!stageCommitted && (await exists(stage))) await rm(stage, { recursive: true, force: true });
    if (transaction && (await exists(transactionPath(destination)))) {
      await recoverDirectory(destination);
    }
  }
}
