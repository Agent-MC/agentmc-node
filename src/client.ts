import createClient from "openapi-fetch";

import { operations, operationsById, type OperationDefinition, type OperationId } from "./generated/operations";
import {
  publishRealtimeMessage,
  type AgentRealtimePublishMessageOptions,
  type AgentRealtimePublishMessageResult,
  subscribeToRealtimeNotifications,
  type AgentRealtimeNotificationsOptions,
  type AgentRealtimeNotificationsSubscription
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

export class AgentMCApi {
  private readonly auth: AgentMCApiAuthConfig;
  private readonly defaultHeaders: Headers;
  private readonly openapiClient: ReturnType<typeof createClient<paths>>;

  readonly operations: {
    [Id in OperationId]: (options?: RequestOptionsById<Id>) => Promise<ResultById<Id>>;
  };

  constructor(config: AgentMCApiClientConfig = {}) {
    this.auth = {
      apiKey: config.apiKey
    };

    this.defaultHeaders = new Headers(config.headers);

    if (!this.defaultHeaders.has("Accept")) {
      this.defaultHeaders.set("Accept", "application/json");
    }

    if (!this.defaultHeaders.has("User-Agent")) {
      this.defaultHeaders.set("User-Agent", config.userAgent ?? DEFAULT_USER_AGENT);
    }

    this.openapiClient = createClient<paths>({
      baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
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

  getOperation(operationId: OperationId): OperationDefinition {
    return operationsById[operationId];
  }

  async subscribeToRealtimeNotifications(
    options: AgentRealtimeNotificationsOptions
  ): Promise<AgentRealtimeNotificationsSubscription> {
    return subscribeToRealtimeNotifications(this, options);
  }

  async publishRealtimeMessage(options: AgentRealtimePublishMessageOptions): Promise<AgentRealtimePublishMessageResult> {
    return publishRealtimeMessage(this, options);
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

    const response = await request(operation.path as never, requestOptions as never);

    return {
      ...response,
      status: response.response.status
    } as ResultById<Id>;
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
      apiKey: requestAuth?.apiKey ?? this.auth.apiKey
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
