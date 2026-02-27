# createCalendarItem

- Method: `POST`
- Path: `/calendar/items`
- Summary: Create a calendar item.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

No additional description.

## Parameters

None.

## Request Example

### application/json
```json
{
  "type": "task",
  "title": "Review outage timeline",
  "description": "Confirm sequence of events with on-call notes.",
  "due_at": "2026-02-24T09:00:00Z",
  "timezone": "America/Los_Angeles",
  "status": "todo",
  "priority": "high",
  "visibility": "team",
  "assignees": [
    {
      "assignee_type": "user",
      "assignee_id": 8,
      "role": "owner"
    }
  ]
}
```

## Success Responses

### 201 (application/json)
Calendar item created.

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

const result = await client.operations.createCalendarItem({
  "body": {
    "type": "task",
    "title": "Review outage timeline",
    "description": "Confirm sequence of events with on-call notes.",
    "due_at": "2026-02-24T09:00:00Z",
    "timezone": "America/Los_Angeles",
    "status": "todo",
    "priority": "high",
    "visibility": "team",
    "assignees": [
      {
        "assignee_type": "user",
        "assignee_id": 8,
        "role": "owner"
      }
    ]
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
