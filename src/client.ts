import createClient from "openapi-fetch";

import { operations, operationsById, type OperationDefinition, type OperationId } from "./generated/operations";
import {
  subscribeToHostRealtimeSessionRequests,
  prewarmRealtimeTransport,
  publishRealtimeMessage,
  type AgentRealtimePublishMessageOptions,
  type AgentRealtimePublishMessageResult,
  subscribeToRealtimeNotifications,
  type AgentRealtimeNotificationsOptions,
  type AgentRealtimeNotificationsSubscription,
  type HostRealtimeSessionRequestsOptions,
  type HostRealtimeSessionRequestsSubscription
} from "./realtime";
import type { paths } from "./generated/schema";
import type {
  AgentMCApiAuthConfig,
  AgentMCApiClientConfig,
  RequestOptionsById,
  ResultById
} from "./types";

const DEFAULT_BASE_URL = "https://agentmc.ai/api/v1";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

type HttpMethod = "get" | "post" | "put" | "patch" | "delete";
type OpenApiFetchMethod = Uppercase<HttpMethod>;

const METHOD_TO_CLIENT_CALL: Record<HttpMethod, OpenApiFetchMethod> = {
  get: "GET",
  post: "POST",
  put: "PUT",
  patch: "PATCH",
  delete: "DELETE"
};

const NETWORK_RETRYABLE_OPERATION_IDS = new Set<OperationId>([
  "agentHeartbeat",
  "listAgentRealtimeRequestedSessions",
  "claimAgentRealtimeSession",
  "authenticateAgentRealtimeSocket",
  "authenticateHostRealtimeSocket",
  "listAgentRealtimeSignals",
  "closeAgentRealtimeSession"
]);
const NETWORK_RETRY_MAX_ATTEMPTS = 3;
const NETWORK_RETRY_BASE_DELAY_MS = 350;
const NETWORK_RETRY_MAX_DELAY_MS = 2_000;
const RETRYABLE_NETWORK_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ENOTFOUND",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT"
]);

export class AgentMCApi {
  private readonly auth: AgentMCApiAuthConfig;
  private readonly baseUrl: string;
  private readonly defaultHeaders: Headers;
  private readonly openapiClient: ReturnType<typeof createClient<paths>>;

  readonly operations: {
    [Id in OperationId]: (options?: RequestOptionsById<Id>) => Promise<ResultById<Id>>;
  };

  constructor(config: AgentMCApiClientConfig = {}) {
    this.auth = {
      apiKey: normalizeNonEmptyString(config.apiKey) ?? undefined
    };
    this.baseUrl = normalizeBaseUrl(config.baseUrl);

    this.defaultHeaders = new Headers(config.headers);

    if (!this.defaultHeaders.has("Accept")) {
      this.defaultHeaders.set("Accept", "application/json");
    }

    if (!this.defaultHeaders.has("User-Agent")) {
      this.defaultHeaders.set("User-Agent", normalizeNonEmptyString(config.userAgent) ?? DEFAULT_USER_AGENT);
    }

    this.openapiClient = createClient<paths>({
      baseUrl: this.baseUrl,
      fetch: config.fetch
    });

    this.operations = Object.fromEntries(
      operations.map((operation) => [
        operation.operationId,
        (options?: RequestOptionsById<OperationId>) => this.request(operation.operationId, options)
      ])
    ) as {
      [Id in OperationId]: (options?: RequestOptionsById<Id>) => Promise<ResultById<Id>>;
    };
  }

  listOperations(): readonly OperationDefinition[] {
    return operations;
  }

  getConfiguredApiKey(): string | null {
    return this.auth.apiKey ?? null;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getOpenApiUrl(): string {
    return deriveOpenApiUrl(this.baseUrl);
  }

  getOperation(operationId: OperationId): OperationDefinition {
    return operationsById[operationId];
  }

  async subscribeToRealtimeNotifications(
    options: AgentRealtimeNotificationsOptions
  ): Promise<AgentRealtimeNotificationsSubscription> {
    return subscribeToRealtimeNotifications(this, options);
  }

  async subscribeToHostRealtimeSessionRequests(
    options: HostRealtimeSessionRequestsOptions
  ): Promise<HostRealtimeSessionRequestsSubscription> {
    return subscribeToHostRealtimeSessionRequests(this, options);
  }

  async publishRealtimeMessage(options: AgentRealtimePublishMessageOptions): Promise<AgentRealtimePublishMessageResult> {
    return publishRealtimeMessage(this, options);
  }

  async prewarmRealtimeTransport(): Promise<void> {
    await prewarmRealtimeTransport();
  }

  async request<Id extends OperationId>(operationId: Id, options?: RequestOptionsById<Id>): Promise<ResultById<Id>> {
    const operation = operationsById[operationId];

    if (!operation) {
      throw new Error(`Unknown operationId: ${operationId}`);
    }

    this.validateRequiredInputs(operation, options);

    const headers = this.buildHeaders(operation, options?.headers, options?.auth);

    const requestOptions: Record<string, unknown> = {
      headers,
      signal: options?.signal
    };

    if (options?.params !== undefined) {
      requestOptions.params = options.params;
    }

    if (options?.body !== undefined) {
      requestOptions.body = options.body;
    }

    const method = METHOD_TO_CLIENT_CALL[operation.method];

    const request = this.openapiClient[method] as (
      path: never,
      options: never
    ) => Promise<{ data?: unknown; error?: unknown; response: Response }>;

    const response = await this.requestWithNetworkRetry(
      operation.operationId,
      request,
      operation.path as never,
      requestOptions as never
    );

    return {
      ...response,
      status: response.response.status
    } as ResultById<Id>;
  }

  private async requestWithNetworkRetry(
    operationId: OperationId,
    request: (path: never, options: never) => Promise<{ data?: unknown; error?: unknown; response: Response }>,
    path: never,
    requestOptions: never
  ): Promise<{ data?: unknown; error?: unknown; response: Response }> {
    const retriesEnabled = NETWORK_RETRYABLE_OPERATION_IDS.has(operationId);
    const maxAttempts = retriesEnabled ? NETWORK_RETRY_MAX_ATTEMPTS : 1;

    let attempt = 0;
    let lastError: unknown = null;
    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        return await request(path, requestOptions);
      } catch (error) {
        lastError = error;
        const retryableError = isRetryableNetworkError(error);
        if (!retryableError || attempt >= maxAttempts) {
          throw normalizeNetworkError(error, operationId, attempt, maxAttempts);
        }

        await sleep(Math.min(NETWORK_RETRY_MAX_DELAY_MS, NETWORK_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)));
      }
    }

    throw normalizeNetworkError(lastError, operationId, maxAttempts, maxAttempts);
  }

  private validateRequiredInputs(
    operation: OperationDefinition,
    options?: { params?: unknown; body?: unknown }
  ): void {
    if (operation.requestBodyRequired && options?.body === undefined) {
      throw new Error(`Missing required request body for ${operation.operationId}.`);
    }

    const requiredParameters = operation.parameters.filter((parameter) => parameter.required);
    if (requiredParameters.length === 0) {
      return;
    }

    const paramsByLocation = (options?.params ?? {}) as Record<string, Record<string, unknown> | undefined>;
    const missing = requiredParameters
      .filter((parameter) => {
        const location = paramsByLocation[parameter.in];
        const value = location?.[parameter.name];
        return value === undefined || value === null || (typeof value === "string" && value.length === 0);
      })
      .map((parameter) => `${parameter.in}.${parameter.name}`);

    if (missing.length > 0) {
      throw new Error(`Missing required parameters for ${operation.operationId}: ${missing.join(", ")}.`);
    }
  }

  private buildHeaders(
    operation: OperationDefinition,
    customHeaders?: HeadersInit,
    requestAuth?: AgentMCApiAuthConfig
  ): Headers {
    const headers = new Headers(this.defaultHeaders);

    const mergedAuth: AgentMCApiAuthConfig = {
      apiKey: normalizeNonEmptyString(requestAuth?.apiKey) ?? this.auth.apiKey
    };

    const authHeaders = this.resolveAuthHeaders(operation, mergedAuth);
    for (const [key, value] of Object.entries(authHeaders)) {
      headers.set(key, value);
    }

    if (customHeaders) {
      const resolvedCustomHeaders = new Headers(customHeaders);
      resolvedCustomHeaders.forEach((value, key) => headers.set(key, value));
    }

    return headers;
  }

  private resolveAuthHeaders(operation: OperationDefinition, auth: AgentMCApiAuthConfig): Record<string, string> {
    if (operation.security.length === 0) {
      return {};
    }

    for (const requirement of operation.security) {
      const headers: Record<string, string> = {};
      let supported = true;

      for (const scheme of requirement) {
        const header = this.authHeaderForScheme(scheme, auth);
        if (!header) {
          supported = false;
          break;
        }

        headers[header.name] = header.value;
      }

      if (supported) {
        return headers;
      }
    }

    const requiredSchemes = operation.security.map((requirement) => requirement.join(" + ")).join(" OR ");
    throw new Error(
      `Missing credentials for ${operation.operationId}. Configure one of: ${requiredSchemes}`
    );
  }

  private authHeaderForScheme(
    scheme: string,
    auth: AgentMCApiAuthConfig
  ): { name: string; value: string } | null {
    switch (scheme) {
      case "ApiKeyAuth":
        return auth.apiKey ? { name: "X-Api-Key", value: auth.apiKey } : null;
      default:
        return null;
    }
  }
}

function normalizeBaseUrl(value: string | undefined): string {
  const normalized = normalizeNonEmptyString(value);
  if (!normalized) {
    return DEFAULT_BASE_URL;
  }

  return normalized.replace(/\/+$/, "");
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function deriveOpenApiUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    const path = url.pathname.replace(/\/+$/, "");

    if (path.endsWith("/api/v1")) {
      url.pathname = `${path.slice(0, -"/api/v1".length)}/api/openapi.json`;
    } else if (path.endsWith("/api")) {
      url.pathname = `${path}/openapi.json`;
    } else if (path === "") {
      url.pathname = "/api/openapi.json";
    } else {
      url.pathname = `${path}/api/openapi.json`;
    }

    return url.toString();
  } catch {
    const normalized = normalizeBaseUrl(baseUrl);
    if (normalized.endsWith("/api/v1")) {
      return `${normalized.slice(0, -"/api/v1".length)}/api/openapi.json`;
    }
    if (normalized.endsWith("/api")) {
      return `${normalized}/openapi.json`;
    }
    return `${normalized}/api/openapi.json`;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeNetworkError(error: unknown, operationId: OperationId, attempt: number, maxAttempts: number): Error {
  const fallback = `Network request failed for ${operationId}.`;
  const baseError = error instanceof Error ? error : new Error(String(error ?? fallback));

  const details = extractNetworkFailureDetails(baseError);
  const parts = [baseError.message || fallback];
  if (details.length > 0) {
    parts.push(details.join("; "));
  }
  if (maxAttempts > 1) {
    parts.push(`attempt=${attempt}/${maxAttempts}`);
  }

  return new Error(parts.join(" | "));
}

function isRetryableNetworkError(error: unknown): boolean {
  const resolvedError = error instanceof Error ? error : new Error(String(error ?? ""));
  const message = (resolvedError.message || "").toLowerCase();
  if (message.includes("fetch failed") || message.includes("network")) {
    return true;
  }

  const details = extractNetworkFailureDetails(resolvedError);
  return details.some((value) => {
    const normalized = value.toUpperCase();
    for (const code of RETRYABLE_NETWORK_ERROR_CODES) {
      if (normalized.includes(code)) {
        return true;
      }
    }
    return false;
  });
}

function extractNetworkFailureDetails(error: Error): string[] {
  const details = new Set<string>();

  const root = error as Error & {
    code?: unknown;
    errno?: unknown;
    syscall?: unknown;
    address?: unknown;
    cause?: unknown;
  };
  addErrorShapeDetails(details, root as unknown as Record<string, unknown>);

  const cause = root.cause;
  if (cause && typeof cause === "object") {
    addErrorShapeDetails(details, cause as Record<string, unknown>);
  }

  return Array.from(details);
}

function addErrorShapeDetails(details: Set<string>, value: Record<string, unknown>): void {
  const code = valueAsString(value.code);
  if (code) {
    details.add(`code=${code}`);
  }

  const errno = valueAsString(value.errno);
  if (errno) {
    details.add(`errno=${errno}`);
  }

  const syscall = valueAsString(value.syscall);
  if (syscall) {
    details.add(`syscall=${syscall}`);
  }

  const address = valueAsString(value.address);
  if (address) {
    details.add(`address=${address}`);
  }

  const causeMessage = valueAsString(value.message);
  if (causeMessage && causeMessage.trim() !== "") {
    details.add(`cause=${causeMessage.trim()}`);
  }
}

function valueAsString(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}
