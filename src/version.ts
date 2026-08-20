import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getPackageDir } from "@earendil-works/pi-coding-agent";

export const EXPORTER_VERSION = "0.1.0";

export async function getPiRuntimeVersion(): Promise<string> {
  const packageJson = JSON.parse(await readFile(join(getPackageDir(), "package.json"), "utf8")) as {
    version?: unknown;
  };
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    throw new Error("The installed Pi package does not expose a valid version");
  }
  return packageJson.version;
}
