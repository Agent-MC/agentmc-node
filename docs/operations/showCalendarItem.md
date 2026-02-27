# showCalendarItem

- Method: `GET`
- Path: `/calendar/items/{item}`
- Summary: Show one calendar item.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

No additional description.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| item | path | yes | Calendar item identifier. | 1 |

## Request Example

None.

## Success Responses

### 200 (application/json)
Calendar item returned.

```json
{
  "data": {
    "id": 42,
    "team_id": 42,
    "type": "event",
    "title": "Example Title",
    "description": "Example description text.",
    "start_at": "2026-02-22T17:21:00Z",
    "end_at": "2026-02-22T17:21:00Z",
    "due_at": "2026-02-22T17:21:00Z",
    "all_day": false,
    "location": "example",
    "timezone": "America/Los_Angeles",
    "status": "todo",
    "priority": "low",
    "visibility": "team",
    "created_by": 1,
    "updated_by": 1,
    "assignees": [
      {
        "id": 42,
        "assignee_type": "user",
        "assignee_id": 42,
        "role": "owner",
        "name": "Example Name",
        "created_at": "2026-02-22T17:21:00Z"
      }
    ],
    "comments_count": 1,
    "created_at": "2026-02-22T17:21:00Z",
    "updated_at": "2026-02-22T17:21:00Z",
    "deleted_at": "2026-02-22T17:21:00Z"
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


## SDK Example

```ts
import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.showCalendarItem({
  "params": {
    "path": {
      "item": 1
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
