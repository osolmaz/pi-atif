import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

export const FIXTURE_ROOT = resolve("fixtures/pi");

export async function openFixture(name: string): Promise<SessionManager> {
  const directory = await mkdtemp(join(tmpdir(), "pi-atif-fixture-"));
  const destination = join(directory, basename(name));
  await copyFile(join(FIXTURE_ROOT, name), destination);
  return SessionManager.open(destination, directory);
}
