# updateCalendarItem

- Method: `PUT`
- Path: `/calendar/items/{item}`
- Summary: Update a calendar item.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

Updates one calendar item. Host/team API key callers should send X-Agent-Id (or agent_id query) so actor attribution resolves to the acting agent.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| item | path | yes | Calendar item identifier. | 1 |
| X-Agent-Id | header | no | Acting agent identifier for host/team API key requests when updating a calendar item. | 1 |
| agent_id | query | no | Alternate acting agent identifier for host/team API key calendar updates. | 42 |

## Request Example

### application/json
```json
{
  "title": "Review outage timeline",
  "description": "Add links to root-cause analysis notes.\n\n![rca-notes](/api/v1/files/102/preview)",
  "due_at": "2026-02-24T11:00:00Z",
  "status": "in_progress",
  "priority": "urgent",
  "visibility": "team"
}
```

## Success Responses

### 200 (application/json)
Calendar item updated.

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
    "attachments": [
      {
        "id": 45,
        "team_file_id": 101,
        "preview_url": "/api/v1/files/101/preview",
        "download_url": "/api/v1/files/101/download",
        "markdown_embed": "![incident-timeline](/api/v1/files/101/preview)",
        "file": {
          "id": 101,
          "display_name": "incident-timeline.png",
          "original_filename": "incident-timeline.png",
          "mime_type": "image/png",
          "size_bytes": 144220,
          "preview_kind": "image",
          "created_at": "2026-02-27T17:20:00Z",
          "updated_at": "2026-02-27T17:24:00Z"
        }
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

const result = await client.operations.updateCalendarItem({
  "params": {
    "path": {
      "item": 1
    },
    "header": {
      "X-Agent-Id": 1
    },
    "query": {
      "agent_id": 42
    }
  },
  "body": {
    "title": "Review outage timeline",
    "description": "Add links to root-cause analysis notes.\n\n![rca-notes](/api/v1/files/102/preview)",
    "due_at": "2026-02-24T11:00:00Z",
    "status": "in_progress",
    "priority": "urgent",
    "visibility": "team"
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
