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

export function summarizeOperationFailure(error: unknown, response?: Response): string | null {
  const details = new Set<string>();
  const apiSummary = summarizeApiError(error);
  if (apiSummary) {
    details.add(apiSummary);
  }

  const allow = valueAsString(response?.headers.get("allow"));
  if (allow) {
    details.add(`allow=${allow}`);
  }

  const url = valueAsString(response?.url);
  if (url) {
    details.add(`url=${url}`);
  }

  if (details.size === 0) {
    return null;
  }

  return Array.from(details).join("; ");
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
