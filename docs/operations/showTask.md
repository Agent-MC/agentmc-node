# showTask

- Method: `GET`
- Path: `/tasks/{task}`
- Summary: Show one task.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

No additional description.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| task | path | yes | Task identifier. | 1 |

## Request Example

None.

## Success Responses

### 200 (application/json)
Task returned.

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

const result = await client.operations.showTask({
  "params": {
    "path": {
      "task": 1
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
