import type { operations, OperationId } from "./generated/operations";
import type { paths } from "./generated/schema";

export type KnownPath = keyof paths & string;
export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";
export type KnownMethod<P extends KnownPath> = Extract<keyof paths[P], HttpMethod>;

export interface AgentMCApiAuthConfig {
  apiKey?: string;
}

export interface AgentMCApiClientConfig extends AgentMCApiAuthConfig {
  baseUrl?: string;
  headers?: HeadersInit;
  userAgent?: string;
  fetch?: typeof globalThis.fetch;
}

type OperationSchema<P extends KnownPath, M extends KnownMethod<P>> = paths[P][M];

type ExtractParameters<Schema> = Schema extends { parameters: infer Parameters }
  ? Parameters
  : Schema extends { parameters?: infer Parameters }
    ? Parameters
    : never;

type ExtractRequestBody<Schema> = Schema extends { requestBody: infer RequestBody }
  ? RequestBody extends { content: infer Content }
    ? Content extends Record<string, unknown>
      ? Content[keyof Content]
      : never
    : never
  : Schema extends { requestBody?: infer OptionalRequestBody }
    ? OptionalRequestBody extends { content: infer Content }
      ? Content extends Record<string, unknown>
        ? Content[keyof Content]
        : never
      : never
    : never;

type ExtractResponses<Schema> = Schema extends { responses: infer Responses } ? Responses : never;

type ResponseContent<Response> = Response extends { content: infer Content }
  ? Content extends Record<string, unknown>
    ? Content[keyof Content]
    : never
  : undefined;

type SuccessStatusString = `${2}${number}${number}`;
type ErrorStatusString = `${4}${number}${number}` | `${5}${number}${number}` | "default";
type SuccessStatusNumber = 200 | 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 226;

type ValueByKey<ObjectType, Keys extends PropertyKey> = Keys extends keyof ObjectType
  ? ObjectType[Keys]
  : never;

type SuccessResponse<Schema> = ResponseContent<
  ValueByKey<ExtractResponses<Schema>, Extract<keyof ExtractResponses<Schema>, SuccessStatusString | SuccessStatusNumber>>
>;

type ErrorResponse<Schema> = ResponseContent<
  ValueByKey<ExtractResponses<Schema>, Extract<keyof ExtractResponses<Schema>, ErrorStatusString>>
>;

export type OperationRequestOptions<P extends KnownPath, M extends KnownMethod<P>> = {
  params?: ExtractParameters<OperationSchema<P, M>>;
  body?: ExtractRequestBody<OperationSchema<P, M>>;
  headers?: HeadersInit;
  signal?: AbortSignal;
  auth?: AgentMCApiAuthConfig;
};

export type OperationResult<P extends KnownPath, M extends KnownMethod<P>> = {
  data: SuccessResponse<OperationSchema<P, M>> | undefined;
  error: ErrorResponse<OperationSchema<P, M>> | undefined;
  response: Response;
  status: number;
};

type AllOperations = (typeof operations)[number];

export type OperationById<Id extends OperationId> = Extract<AllOperations, { operationId: Id }>;

export type OperationPathById<Id extends OperationId> = OperationById<Id>["path"] & KnownPath;

export type OperationMethodById<Id extends OperationId> =
  OperationById<Id>["method"] & KnownMethod<OperationPathById<Id>>;

export type RequestOptionsById<Id extends OperationId> = OperationRequestOptions<
  OperationPathById<Id>,
  OperationMethodById<Id>
>;

export type ResultById<Id extends OperationId> = OperationResult<
  OperationPathById<Id>,
  OperationMethodById<Id>
>;
