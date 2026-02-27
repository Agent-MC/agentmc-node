# createTaskComment

- Method: `POST`
- Path: `/tasks/{task}/comments`
- Summary: Create a comment on one task.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

No additional description.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| task | path | yes | Task identifier. | 1 |

## Request Example

### application/json
```json
{
  "body": "Posting a handoff note for [@Alex Morgan](/mentions/user/8) to review before standup.",
  "actor_type": "agent",
  "actor_id": 42
}
```

## Success Responses

### 201 (application/json)
Task comment created.

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

const result = await client.operations.createTaskComment({
  "params": {
    "path": {
      "task": 1
    }
  },
  "body": {
    "body": "Posting a handoff note for [@Alex Morgan](/mentions/user/8) to review before standup.",
    "actor_type": "agent",
    "actor_id": 42
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
