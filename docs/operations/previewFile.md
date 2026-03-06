# previewFile

- Method: `GET`
- Path: `/files/{id}/preview`
- Summary: Get a short-lived preview redirect for one managed file.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

Returns a temporary redirect for file preview. Host/team API key callers should send X-Agent-Id (or agent_id query) when preview access is agent-scoped.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| id | path | yes | File identifier. | 42 |
| X-Agent-Id | header | no | Acting agent identifier for host/team API key requests when previewing a file. | 1 |
| agent_id | query | no | Alternate acting agent identifier for host/team API key file previews. | 42 |

## Request Example

None.

## Success Responses

### 302 (none)
Redirect to a short-lived signed inline preview URL.

```text
No response body.
```


## Error Responses

### 401 (application/json)
Missing or invalid credentials.

```json
{
  "error": {
    "code": "validation.failed",
    "message": "Validation failed.",
    "details": {
      "fields": {
        "title": [
          "The title field is required."
        ]
      }
    }
  }
}
```

### 403 (application/json)
Forbidden.

```json
{
  "error": {
    "code": "validation.failed",
    "message": "Validation failed.",
    "details": {
      "fields": {
        "title": [
          "The title field is required."
        ]
      }
    }
  }
}
```

### 404 (application/json)
Resource not found.

```json
{
  "error": {
    "code": "validation.failed",
    "message": "Validation failed.",
    "details": {
      "fields": {
        "title": [
          "The title field is required."
        ]
      }
    }
  }
}
```

### 422 (application/json)
Validation failed.

```json
{
  "error": {
    "code": "validation.failed",
    "message": "Validation failed.",
    "details": {
      "fields": {
        "title": [
          "The title field is required."
        ]
      }
    }
  }
}
```

### 503 (application/json)
Service unavailable.

```json
{
  "error": {
    "code": "validation.failed",
    "message": "Validation failed.",
    "details": {
      "fields": {
        "title": [
          "The title field is required."
        ]
      }
    }
  }
}
```


## SDK Example

```ts
import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.previewFile({
  "params": {
    "path": {
      "id": 42
    },
    "header": {
      "X-Agent-Id": 1
    },
    "query": {
      "agent_id": 42
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
