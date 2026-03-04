# commentCalendarItem

- Method: `POST`
- Path: `/calendar/items/{item}/comments`
- Summary: Add a comment on a calendar item.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

No additional description.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| item | path | yes | Calendar item identifier. | 1 |

## Request Example

### application/json
```json
{
  "body": "Added links to logs and timeline document.\n\n![handoff](/api/v1/files/101/preview)",
  "actor_type": "agent",
  "actor_id": 42
}
```

## Success Responses

### 201 (application/json)
Comment created.

```json
{
  "data": {
    "id": 42,
    "actor_type": "user",
    "actor_id": 42,
    "body": "Example content.",
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

const result = await client.operations.commentCalendarItem({
  "params": {
    "path": {
      "item": 1
    }
  },
  "body": {
    "body": "Added links to logs and timeline document.\n\n![handoff](/api/v1/files/101/preview)",
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
