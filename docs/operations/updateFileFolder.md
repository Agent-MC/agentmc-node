# updateFileFolder

- Method: `PATCH`
- Path: `/files/folders/{id}`
- Summary: Update a managed file folder.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

Updates one folder. Host/team API key callers should send X-Agent-Id (or agent_id query) so folder scope resolves to the acting agent home folder when applicable.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| id | path | yes | Folder identifier. | 42 |
| X-Agent-Id | header | no | Acting agent identifier for host/team API key requests when updating a folder. | 1 |
| agent_id | query | no | Alternate acting agent identifier for host/team API key folder updates. | 42 |

## Request Example

### application/json
```json
{
  "name": "Incident Runbooks",
  "parent_id": null
}
```

## Success Responses

### 200 (application/json)
Folder updated.

```json
{
  "data": {
    "id": 12,
    "team_id": 7,
    "parent_id": null,
    "name": "Runbooks",
    "path_cache": "Runbooks",
    "created_at": "2026-02-27T17:10:00Z",
    "updated_at": "2026-02-27T17:10:00Z"
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

const result = await client.operations.updateFileFolder({
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
  },
  "body": {
    "name": "Incident Runbooks",
    "parent_id": null
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
