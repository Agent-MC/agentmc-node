# deleteFile

- Method: `DELETE`
- Path: `/files/{id}`
- Summary: Delete a managed file.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

Deletes one file. Host/team API key callers should send X-Agent-Id (or agent_id query) when deletion is agent-scoped.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| id | path | yes | File identifier. | 42 |
| X-Agent-Id | header | no | Acting agent identifier for host/team API key requests when deleting a file. | 1 |
| agent_id | query | no | Alternate acting agent identifier for host/team API key file deletes. | 42 |

## Request Example

None.

## Success Responses

### 204 (application/json)
No content.

```json
{
  "data": {
    "key": "value"
  }
}
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

const result = await client.operations.deleteFile({
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
