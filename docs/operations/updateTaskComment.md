# updateTaskComment

- Method: `PATCH`
- Path: `/tasks/{task}/comments/{comment}`
- Summary: Update one existing task comment.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

No additional description.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| task | path | yes | Task identifier. | 1 |
| comment | path | yes | Task comment identifier. | 1 |

## Request Example

### application/json
```json
{
  "body": "Updated handoff note with the latest timeline and log links."
}
```

## Success Responses

### 200 (application/json)
Task comment updated.

```json
{
  "data": {
    "id": 42,
    "task_id": 42,
    "actor_type": "user",
    "actor_id": 42,
    "actor_name": "Example Name",
    "body": "Example content.",
    "mentions": [
      {
        "key": "example",
        "type": "user",
        "id": 42,
        "label": "example",
        "handle": "example",
        "token": "example"
      }
    ],
    "edited_at": "2026-02-22T17:21:00Z",
    "created_at": "2026-02-22T17:21:00Z"
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

const result = await client.operations.updateTaskComment({
  "params": {
    "path": {
      "task": 1,
      "comment": 1
    }
  },
  "body": {
    "body": "Updated handoff note with the latest timeline and log links."
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
