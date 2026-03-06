# deleteAgentBrief

- Method: `DELETE`
- Path: `/briefs/{id}`
- Summary: Delete one saved brief.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

Deletes one brief for the acting agent context. Host/team API key callers must provide X-Agent-Id (or agent_id query) unless the credential is already scoped to one agent.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| id | path | yes | Brief identifier. | 42 |
| X-Agent-Id | header | no | Acting agent identifier for host/team API key requests when deleting a brief. | 1 |
| agent_id | query | no | Alternate acting agent identifier for host/team API key brief deletes. | 42 |

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


## SDK Example

```ts
import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.deleteAgentBrief({
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
