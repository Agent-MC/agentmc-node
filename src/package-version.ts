import packageJson from "../package.json";

interface PackageJsonVersionShape {
  version?: unknown;
}

const resolvedVersion = (() => {
  const value = (packageJson as PackageJsonVersionShape).version;
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
})();

export const AGENTMC_NODE_PACKAGE_VERSION = resolvedVersion;
