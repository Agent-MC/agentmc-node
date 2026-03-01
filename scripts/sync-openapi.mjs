import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);
const EXCLUDED_OPERATION_IDS = new Set();
const EXCLUDED_ENDPOINTS = new Set();

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const specDir = resolve(projectRoot, "spec");
const sourceSpecPath = resolve(specDir, "openapi.source.json");

const sourcePathFromEnv = process.env.AGENTMC_OPENAPI_PATH;
const defaultLocalPath = resolve(projectRoot, "..", "agentmc.ai", "public", "openapi.json");
const sourceUrl = process.env.AGENTMC_OPENAPI_URL ?? "https://agentmc.ai/api/openapi.json";
const disableLocalFallback = ["1", "true", "yes", "on"].includes(
  String(process.env.AGENTMC_OPENAPI_DISABLE_LOCAL_FALLBACK ?? "").toLowerCase()
);

mkdirSync(specDir, { recursive: true });

function getOperationSecurity(spec, operation) {
  if (Array.isArray(operation.security)) {
    return operation.security;
  }

  if (Array.isArray(spec.security)) {
    return spec.security;
  }

  return [];
}

function pruneUnusedSecuritySchemes(spec) {
  const securitySchemes = spec.components?.securitySchemes;
  if (!securitySchemes || typeof securitySchemes !== "object") {
    return;
  }

  const usedSchemes = new Set();

  for (const pathItem of Object.values(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method)) {
        continue;
      }

      const security = getOperationSecurity(spec, operation);
      for (const requirement of security) {
        for (const scheme of Object.keys(requirement)) {
          usedSchemes.add(scheme);
        }
      }
    }
  }

  for (const scheme of Object.keys(securitySchemes)) {
    if (!usedSchemes.has(scheme)) {
      delete securitySchemes[scheme];
    }
  }
}

function endpointSignature(pathName, method) {
  return `${method.toLowerCase()} ${pathName}`;
}

function shouldExcludeOperation(pathName, method, operation) {
  return (
    EXCLUDED_OPERATION_IDS.has(operation?.operationId) ||
    EXCLUDED_ENDPOINTS.has(endpointSignature(pathName, method))
  );
}

function sanitizeSpec(rawSpec) {
  const spec = structuredClone(rawSpec);
  let removedCount = 0;

  for (const [pathName, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method)) {
        continue;
      }

      if (shouldExcludeOperation(pathName, method, operation)) {
        delete pathItem[method];
        removedCount += 1;
      }
    }

    const hasHttpMethods = Object.keys(pathItem).some((key) => HTTP_METHODS.has(key));
    if (!hasHttpMethods) {
      delete spec.paths[pathName];
    }
  }

  pruneUnusedSecuritySchemes(spec);

  return {
    spec,
    removedCount
  };
}

async function loadSpec() {
  if (sourcePathFromEnv && existsSync(sourcePathFromEnv)) {
    return readFileSync(sourcePathFromEnv, "utf8");
  }

  if (!disableLocalFallback && existsSync(defaultLocalPath)) {
    return readFileSync(defaultLocalPath, "utf8");
  }

  const response = await fetch(sourceUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch OpenAPI spec from ${sourceUrl}: HTTP ${response.status}`);
  }

  return response.text();
}

try {
  const raw = await loadSpec();
  const parsed = JSON.parse(raw);
  const { spec, removedCount } = sanitizeSpec(parsed);
  writeFileSync(sourceSpecPath, `${JSON.stringify(spec, null, 2)}\n`);
  console.log(`Synced OpenAPI spec -> ${sourceSpecPath} (removed ${removedCount} excluded operations)`);
} catch (error) {
  console.error("Unable to sync OpenAPI spec");
  console.error(error);
  process.exitCode = 1;
}
