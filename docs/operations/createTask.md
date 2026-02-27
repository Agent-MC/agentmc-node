# createTask

- Method: `POST`
- Path: `/tasks`
- Summary: Create a task.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

No additional description.

## Parameters

None.

## Request Example

### application/json
```json
{
  "board_id": 5,
  "column_id": 13,
  "title": "Draft post-incident summary",
  "description": "Capture timeline, impact, and remediation status.",
  "archived_at": null,
  "position": 2,
  "due_at": "2026-02-24T17:00:00Z",
  "assigned_to_user_id": 8
}
```

## Success Responses

### 201 (application/json)
Task created.

```json
{
  "data": {
    "id": 42,
    "team_id": 42,
    "board_id": 42,
    "column_id": 42,
    "title": "Example Title",
    "description": "Example description text.",
    "archived_at": "2026-02-22T17:21:00Z",
    "is_archived": true,
    "position": 1,
    "due_at": "2026-02-22T17:21:00Z",
    "created_by_user_id": 42,
    "assigned_to_user_id": 42,
    "assigned_to_agent_id": 42,
    "assignee_type": "human",
    "created_at": "2026-02-22T17:21:00Z",
    "updated_at": "2026-02-22T17:21:00Z"
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

### 402 (application/json)
Plan limit reached.

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

const result = await client.operations.createTask({
  "body": {
    "board_id": 5,
    "column_id": 13,
    "title": "Draft post-incident summary",
    "description": "Capture timeline, impact, and remediation status.",
    "archived_at": null,
    "position": 2,
    "due_at": "2026-02-24T17:00:00Z",
    "assigned_to_user_id": 8
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
