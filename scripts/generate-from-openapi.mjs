import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);
const SUCCESS_STATUS_PATTERN = /^2\d\d$/;
const ERROR_STATUS_PATTERN = /^[45]\d\d$/;
const EXCLUDED_OPERATION_IDS = new Set();
const EXCLUDED_ENDPOINTS = new Set();

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const sourceSpecPath = resolve(projectRoot, "spec/openapi.source.json");
const filteredSpecPath = resolve(projectRoot, "spec/openapi.filtered.json");
const schemaTypesPath = resolve(projectRoot, "src/generated/schema.ts");
const operationsTsPath = resolve(projectRoot, "src/generated/operations.ts");
const docsDir = resolve(projectRoot, "docs/operations");
const examplesDir = resolve(projectRoot, "examples/http");
const docsIndexJsonPath = resolve(docsDir, "index.json");
const docsReadmePath = resolve(docsDir, "README.md");

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function cleanGeneratedDirectory(dirPath, keep = new Set()) {
  mkdirSync(dirPath, { recursive: true });

  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    if (keep.has(entry.name)) {
      continue;
    }

    rmSync(resolve(dirPath, entry.name), { recursive: true, force: true });
  }
}

function getOperationSecurity(spec, operation) {
  if (Array.isArray(operation.security)) {
    return operation.security;
  }

  if (Array.isArray(spec.security)) {
    return spec.security;
  }

  return [];
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

function filterExcludedOperations(spec) {
  const copy = structuredClone(spec);
  let removedCount = 0;

  for (const [pathName, pathItem] of Object.entries(copy.paths ?? {})) {
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
      delete copy.paths[pathName];
    }
  }

  pruneUnusedSecuritySchemes(copy);

  return {
    filteredSpec: copy,
    removedCount
  };
}

function decodePointerSegment(segment) {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function resolveRef(spec, ref) {
  if (!ref.startsWith("#/")) {
    throw new Error(`Only local refs are supported: ${ref}`);
  }

  const segments = ref.slice(2).split("/").map(decodePointerSegment);
  let current = spec;

  for (const segment of segments) {
    if (current === null || typeof current !== "object" || !(segment in current)) {
      throw new Error(`Unable to resolve ref: ${ref}`);
    }

    current = current[segment];
  }

  return current;
}

function deref(spec, value, seenRefs = new Set()) {
  if (Array.isArray(value)) {
    return value.map((item) => deref(spec, item, seenRefs));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  if (typeof value.$ref === "string") {
    if (seenRefs.has(value.$ref)) {
      return {};
    }

    const nextSeen = new Set(seenRefs);
    nextSeen.add(value.$ref);

    const resolved = deref(spec, resolveRef(spec, value.$ref), nextSeen);
    const { $ref, ...rest } = value;

    if (Object.keys(rest).length === 0) {
      return resolved;
    }

    return {
      ...resolved,
      ...deref(spec, rest, nextSeen)
    };
  }

  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    output[key] = deref(spec, nested, seenRefs);
  }

  return output;
}

function firstExampleFromExamplesObject(spec, examples) {
  if (!examples || typeof examples !== "object") {
    return undefined;
  }

  for (const rawExample of Object.values(examples)) {
    const example = deref(spec, rawExample);
    if (example && typeof example === "object" && "value" in example) {
      return example.value;
    }
  }

  return undefined;
}

function exampleFromSchema(spec, schema, depth = 0, seenRefs = new Set()) {
  if (!schema) {
    return undefined;
  }

  if (depth > 7) {
    return undefined;
  }

  const normalized = deref(spec, schema, seenRefs);

  if (!normalized || typeof normalized !== "object") {
    return undefined;
  }

  if ("example" in normalized) {
    return normalized.example;
  }

  if ("default" in normalized) {
    return normalized.default;
  }

  if ("const" in normalized) {
    return normalized.const;
  }

  if (Array.isArray(normalized.enum) && normalized.enum.length > 0) {
    return normalized.enum[0];
  }

  if (Array.isArray(normalized.oneOf) && normalized.oneOf.length > 0) {
    return exampleFromSchema(spec, normalized.oneOf[0], depth + 1, seenRefs);
  }

  if (Array.isArray(normalized.anyOf) && normalized.anyOf.length > 0) {
    return exampleFromSchema(spec, normalized.anyOf[0], depth + 1, seenRefs);
  }

  if (Array.isArray(normalized.allOf) && normalized.allOf.length > 0) {
    const mergedObject = {};
    let hasObjectShape = false;

    for (const part of normalized.allOf) {
      const partExample = exampleFromSchema(spec, part, depth + 1, seenRefs);
      if (partExample && typeof partExample === "object" && !Array.isArray(partExample)) {
        Object.assign(mergedObject, partExample);
        hasObjectShape = true;
      }
    }

    if (hasObjectShape) {
      return mergedObject;
    }

    return exampleFromSchema(spec, normalized.allOf[0], depth + 1, seenRefs);
  }

  const schemaType = normalized.type;

  if (schemaType === "object" || (!schemaType && normalized.properties)) {
    const output = {};

    for (const [propertyName, propertySchema] of Object.entries(normalized.properties ?? {})) {
      const propertyExample = exampleFromSchema(spec, propertySchema, depth + 1, seenRefs);
      if (propertyExample !== undefined) {
        output[propertyName] = propertyExample;
      }
    }

    if (Object.keys(output).length > 0) {
      return output;
    }

    if (normalized.additionalProperties && normalized.additionalProperties !== true) {
      const valueExample = exampleFromSchema(spec, normalized.additionalProperties, depth + 1, seenRefs);
      return {
        key: valueExample ?? "value"
      };
    }

    return {};
  }

  if (schemaType === "array") {
    const itemExample = exampleFromSchema(spec, normalized.items, depth + 1, seenRefs);
    return itemExample === undefined ? [] : [itemExample];
  }

  if (schemaType === "string") {
    switch (normalized.format) {
      case "date-time":
        return "2026-02-24T12:00:00Z";
      case "date":
        return "2026-02-24";
      case "uuid":
        return "11111111-1111-1111-1111-111111111111";
      case "email":
        return "agent@example.com";
      case "uri":
      case "url":
        return "https://agentmc.ai";
      default:
        return "string";
    }
  }

  if (schemaType === "integer") {
    return 1;
  }

  if (schemaType === "number") {
    return 1.5;
  }

  if (schemaType === "boolean") {
    return true;
  }

  return undefined;
}

function exampleFromMediaObject(spec, mediaObject) {
  const media = deref(spec, mediaObject);

  if (media && typeof media === "object" && "example" in media) {
    return media.example;
  }

  const examplesExample = firstExampleFromExamplesObject(spec, media?.examples);
  if (examplesExample !== undefined) {
    return examplesExample;
  }

  return exampleFromSchema(spec, media?.schema);
}

function exampleFromParameter(spec, parameter) {
  const resolved = deref(spec, parameter);

  if (resolved && typeof resolved === "object" && "example" in resolved) {
    return resolved.example;
  }

  const examplesExample = firstExampleFromExamplesObject(spec, resolved?.examples);
  if (examplesExample !== undefined) {
    return examplesExample;
  }

  return exampleFromSchema(spec, resolved?.schema);
}

function sanitizeMarkdownText(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n+/g, " ")
    .trim();
}

function sortStatusCodes(a, b) {
  const aNumeric = Number(a);
  const bNumeric = Number(b);

  const aIsNumeric = Number.isFinite(aNumeric);
  const bIsNumeric = Number.isFinite(bNumeric);

  if (aIsNumeric && bIsNumeric) {
    return aNumeric - bNumeric;
  }

  if (aIsNumeric) {
    return -1;
  }

  if (bIsNumeric) {
    return 1;
  }

  return a.localeCompare(b);
}

function isSuccessStatus(status) {
  return SUCCESS_STATUS_PATTERN.test(status);
}

function isErrorStatus(status) {
  return ERROR_STATUS_PATTERN.test(status) || status === "default";
}

function buildOperationDefinition(spec, pathName, method, pathItem, operation) {
  const resolvedOperation = deref(spec, operation);
  const securityRequirements = getOperationSecurity(spec, resolvedOperation);
  const combinedParameters = [
    ...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []),
    ...(Array.isArray(resolvedOperation.parameters) ? resolvedOperation.parameters : [])
  ];

  const parameterByLocation = new Map();

  for (const parameterEntry of combinedParameters) {
    const parameter = deref(spec, parameterEntry);
    const key = `${parameter.in}:${parameter.name}`;
    parameterByLocation.set(key, {
      name: parameter.name,
      in: parameter.in,
      required: Boolean(parameter.required),
      description: parameter.description ?? "",
      example: exampleFromParameter(spec, parameter)
    });
  }

  const requestExamples = [];
  const requestBody = resolvedOperation.requestBody ? deref(spec, resolvedOperation.requestBody) : undefined;

  if (requestBody?.content && typeof requestBody.content === "object") {
    for (const [mediaType, mediaObject] of Object.entries(requestBody.content)) {
      requestExamples.push({
        mediaType,
        example: exampleFromMediaObject(spec, mediaObject)
      });
    }
  }

  const responses = [];
  const responseEntries = Object.entries(resolvedOperation.responses ?? {}).sort((a, b) =>
    sortStatusCodes(a[0], b[0])
  );

  for (const [status, responseEntry] of responseEntries) {
    const response = deref(spec, responseEntry);
    const content = response.content ?? {};
    const mediaTypes = Object.keys(content);

    if (mediaTypes.length === 0) {
      responses.push({
        status,
        mediaType: "none",
        description: response.description ?? "",
        hasContent: false,
        example: null
      });
      continue;
    }

    for (const mediaType of mediaTypes) {
      responses.push({
        status,
        mediaType,
        description: response.description ?? "",
        hasContent: true,
        example: exampleFromMediaObject(spec, content[mediaType])
      });
    }
  }

  return {
    operationId: resolvedOperation.operationId,
    method,
    path: pathName,
    summary: resolvedOperation.summary ?? "",
    description: resolvedOperation.description ?? "",
    tags: resolvedOperation.tags ?? [],
    security: securityRequirements.map((requirement) => Object.keys(requirement)),
    parameters: Array.from(parameterByLocation.values()),
    requestBodyRequired: Boolean(requestBody?.required),
    requestExamples,
    responses
  };
}

function buildUrlExample(pathName, parameters) {
  let finalPath = pathName;
  const pathParams = parameters.filter((parameter) => parameter.in === "path");

  for (const parameter of pathParams) {
    const fallback = `{${parameter.name}}`;
    const value = parameter.example === undefined ? fallback : String(parameter.example);
    finalPath = finalPath.replace(`{${parameter.name}}`, encodeURIComponent(value));
  }

  const queryParams = parameters.filter((parameter) => parameter.in === "query");
  const query = new URLSearchParams();

  for (const parameter of queryParams) {
    if (parameter.example !== undefined) {
      query.set(parameter.name, String(parameter.example));
    }
  }

  const base = `https://agentmc.ai/api/v1${finalPath}`;
  const queryString = query.toString();
  return queryString ? `${base}?${queryString}` : base;
}

function pickPrimaryRequestExample(operation) {
  if (operation.requestExamples.length === 0) {
    return undefined;
  }

  return (
    operation.requestExamples.find((entry) => entry.mediaType === "application/json") ??
    operation.requestExamples[0]
  );
}

function buildSdkCallOptions(operation) {
  const options = {};
  const groupedParams = {};

  for (const parameter of operation.parameters) {
    if (parameter.example === undefined) {
      continue;
    }

    if (!groupedParams[parameter.in]) {
      groupedParams[parameter.in] = {};
    }

    groupedParams[parameter.in][parameter.name] = parameter.example;
  }

  if (Object.keys(groupedParams).length > 0) {
    options.params = groupedParams;
  }

  const primaryRequest = pickPrimaryRequestExample(operation);
  if (primaryRequest && primaryRequest.example !== undefined) {
    options.body = primaryRequest.example;
  }

  return options;
}

function toTsObjectLiteral(value, indent = 2) {
  return JSON.stringify(value, null, indent);
}

function buildSdkExample(operation) {
  const options = buildSdkCallOptions(operation);
  const authProperty = pickSdkExampleAuthProperty(operation);

  const invocation =
    Object.keys(options).length === 0
      ? `client.operations.${operation.operationId}()`
      : `client.operations.${operation.operationId}(${toTsObjectLiteral(options)})`;

  const clientLines = authProperty
    ? [
        "const client = new AgentMCApi({",
        `  ${authProperty}`,
        "});"
      ]
    : ["const client = new AgentMCApi();"];

  return [
    'import { AgentMCApi } from "@agentmc/api";',
    "",
    ...clientLines,
    "",
    `const result = await ${invocation};`,
    "",
    "if (result.error) {",
    "  console.error(result.status, result.error);",
    "} else {",
    "  console.log(result.data);",
    "}"
  ].join("\n");
}

function pickSdkExampleAuthProperty(operation) {
  const schemePriority = ["ApiKeyAuth"];
  const schemeToProperty = {
    ApiKeyAuth: "apiKey: process.env.AGENTMC_API_KEY"
  };

  for (const scheme of schemePriority) {
    if (operation.security.some((requirement) => requirement.includes(scheme))) {
      return schemeToProperty[scheme];
    }
  }

  return null;
}

function markdownResponseSection(operation, filterFn) {
  const matching = operation.responses.filter((response) => filterFn(response.status));

  if (matching.length === 0) {
    return "None.\n";
  }

  const sections = [];

  for (const response of matching) {
    sections.push(`### ${response.status} (${response.mediaType})`);
    if (response.description) {
      sections.push(response.description);
      sections.push("");
    }

    if (!response.hasContent) {
      sections.push("```text");
      sections.push("No response body.");
      sections.push("```");
      sections.push("");
      continue;
    }

    sections.push("```json");
    sections.push(JSON.stringify(response.example, null, 2));
    sections.push("```");
    sections.push("");
  }

  return sections.join("\n");
}

function buildOperationMarkdown(operation) {
  const securityText =
    operation.security.length === 0
      ? "None"
      : operation.security
          .map((requirement) => requirement.join(" + "))
          .join(" OR ");

  const parameterTable =
    operation.parameters.length === 0
      ? "None."
      : [
          "| Name | In | Required | Description | Example |",
          "| --- | --- | --- | --- | --- |",
          ...operation.parameters.map(
            (parameter) =>
              `| ${sanitizeMarkdownText(parameter.name)} | ${sanitizeMarkdownText(parameter.in)} | ${
                parameter.required ? "yes" : "no"
              } | ${sanitizeMarkdownText(parameter.description || "-")} | ${sanitizeMarkdownText(
                JSON.stringify(parameter.example)
              )} |`
          )
        ].join("\n");

  const requestSection =
    operation.requestExamples.length === 0
      ? "None."
      : operation.requestExamples
          .map((request) => {
            return [
              `### ${request.mediaType}`,
              "```json",
              JSON.stringify(request.example, null, 2),
              "```"
            ].join("\n");
          })
          .join("\n\n");

  return [
    `# ${operation.operationId}`,
    "",
    `- Method: \`${operation.method.toUpperCase()}\``,
    `- Path: \`${operation.path}\``,
    `- Summary: ${operation.summary || "-"}`,
    `- Auth: ${securityText}`,
    "",
    "## Description",
    "",
    operation.description || "No additional description.",
    "",
    "## Parameters",
    "",
    parameterTable,
    "",
    "## Request Example",
    "",
    requestSection,
    "",
    "## Success Responses",
    "",
    markdownResponseSection(operation, isSuccessStatus),
    "",
    "## Error Responses",
    "",
    markdownResponseSection(operation, isErrorStatus),
    "",
    "## SDK Example",
    "",
    "```ts",
    buildSdkExample(operation),
    "```",
    ""
  ].join("\n");
}

function buildDocsReadme(operations) {
  const lines = [
    "# AgentMC API Operation Docs",
    "",
    "Generated from `spec/openapi.filtered.json`.",
    "",
    "| Operation ID | Method | Path | Tags |",
    "| --- | --- | --- | --- |"
  ];

  for (const operation of operations) {
    lines.push(
      `| [${operation.operationId}](./${operation.operationId}.md) | ${operation.method.toUpperCase()} | \`${operation.path}\` | ${operation.tags.join(
        ", "
      ) || "-"} |`
    );
  }

  lines.push("");
  return lines.join("\n");
}

function generateOperationsTs(operations) {
  const payload = JSON.stringify(operations, null, 2);

  return `/* eslint-disable */
// This file is generated by scripts/generate-from-openapi.mjs

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export interface OperationParameterDefinition {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required: boolean;
  description: string;
  example: unknown;
}

export interface OperationRequestExampleDefinition {
  mediaType: string;
  example: unknown;
}

export interface OperationResponseExampleDefinition {
  status: string;
  mediaType: string;
  description: string;
  hasContent: boolean;
  example: unknown;
}

export interface OperationDefinition {
  operationId: string;
  method: HttpMethod;
  path: string;
  summary: string;
  description: string;
  tags: string[];
  security: string[][];
  parameters: OperationParameterDefinition[];
  requestBodyRequired: boolean;
  requestExamples: OperationRequestExampleDefinition[];
  responses: OperationResponseExampleDefinition[];
}

export const operations = ${payload} as const satisfies readonly OperationDefinition[];

export type OperationId = (typeof operations)[number]["operationId"];

export const operationsById = Object.fromEntries(
  operations.map((operation) => [operation.operationId, operation])
) as Record<OperationId, (typeof operations)[number]>;
`;
}

function validateOperations(operations) {
  const duplicateOperationIds = new Set();
  const seen = new Set();

  for (const operation of operations) {
    if (!operation.operationId) {
      throw new Error(`Operation is missing operationId: ${operation.method.toUpperCase()} ${operation.path}`);
    }

    if (seen.has(operation.operationId)) {
      duplicateOperationIds.add(operation.operationId);
    }

    seen.add(operation.operationId);

    if (operation.requestExamples.length === 0 && operation.requestBodyRequired) {
      throw new Error(`Missing request example for required request body: ${operation.operationId}`);
    }

    const hasSuccessResponse = operation.responses.some((response) => isSuccessStatus(response.status));
    if (!hasSuccessResponse) {
      throw new Error(`Operation is missing success response: ${operation.operationId}`);
    }

    const hasErrorResponse = operation.responses.some((response) => isErrorStatus(response.status));
    if (!hasErrorResponse) {
      throw new Error(`Operation is missing error/default response example: ${operation.operationId}`);
    }
  }

  if (duplicateOperationIds.size > 0) {
    throw new Error(`Duplicate operationIds found: ${Array.from(duplicateOperationIds).join(", ")}`);
  }
}

function ensureDirectories() {
  mkdirSync(resolve(projectRoot, "src/generated"), { recursive: true });
  mkdirSync(docsDir, { recursive: true });
  mkdirSync(examplesDir, { recursive: true });
}

function generateExampleSource(operation) {
  return `${buildSdkExample(operation)}\n`;
}

function main() {
  ensureDirectories();

  if (!existsSync(sourceSpecPath)) {
    throw new Error(
      `Source spec missing at ${sourceSpecPath}. Run \"npm run sync:spec\" before \"npm run generate\".`
    );
  }

  const sourceSpec = readJson(sourceSpecPath);
  const { filteredSpec, removedCount } = filterExcludedOperations(sourceSpec);
  writeJson(filteredSpecPath, filteredSpec);

  const operations = [];

  for (const [pathName, pathItem] of Object.entries(filteredSpec.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method)) {
        continue;
      }

      const definition = buildOperationDefinition(filteredSpec, pathName, method, pathItem, operation);
      operations.push(definition);
    }
  }

  operations.sort((a, b) => a.operationId.localeCompare(b.operationId));

  validateOperations(operations);

  cleanGeneratedDirectory(docsDir, new Set(["README.md", "index.json"]));
  cleanGeneratedDirectory(examplesDir);

  for (const operation of operations) {
    const markdown = buildOperationMarkdown(operation);
    writeFileSync(resolve(docsDir, `${operation.operationId}.md`), markdown);
    writeFileSync(resolve(examplesDir, `${operation.operationId}.ts`), generateExampleSource(operation));
  }

  writeJson(docsIndexJsonPath, operations);
  writeFileSync(docsReadmePath, buildDocsReadme(operations));
  writeFileSync(operationsTsPath, generateOperationsTs(operations));

  execSync(`npx openapi-typescript \"${filteredSpecPath}\" -o \"${schemaTypesPath}\"`, {
    cwd: projectRoot,
    stdio: "inherit"
  });

  console.log(`Generated ${operations.length} operations (removed ${removedCount} excluded operations).`);
}

try {
  main();
} catch (error) {
  console.error("OpenAPI generation failed.");
  console.error(error);
  process.exitCode = 1;
}
