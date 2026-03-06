import { readFileSync } from "node:fs";

interface PackageJsonVersionShape {
  version?: unknown;
}

function readPackageVersion(): string | null {
  try {
    const packageJsonUrl = new URL("../package.json", import.meta.url);
    const packageJson = JSON.parse(readFileSync(packageJsonUrl, "utf8")) as PackageJsonVersionShape;
    const value = packageJson.version;
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  } catch {
    return null;
  }
}

const resolvedVersion = readPackageVersion();

export const AGENTMC_NODE_PACKAGE_VERSION = resolvedVersion;
