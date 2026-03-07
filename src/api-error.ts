type JsonObject = Record<string, unknown>;

export function summarizeApiError(error: unknown): string | null {
  const payload = valueAsObject(error);
  const root = valueAsObject(payload?.error) ?? payload;
  const code = valueAsString(root?.code);
  const message = valueAsString(root?.message);

  if (code && message) {
    return `${code}: ${message}`;
  }

  if (message) {
    return message;
  }

  return code;
}

export function createOperationStatusError(operationId: string, status: number): Error {
  const resolvedStatus = Number.isInteger(status) && status > 0 ? status : null;
  const statusSuffix = resolvedStatus === null ? "unknown status" : `status ${resolvedStatus}`;

  return new Error(`${operationId} failed with ${statusSuffix}.`);
}

function valueAsObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as JsonObject;
}

function valueAsString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
