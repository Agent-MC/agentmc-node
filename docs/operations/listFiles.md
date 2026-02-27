# listFiles

- Method: `GET`
- Path: `/files`
- Summary: List managed team files.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

No additional description.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| q | query | no | Case-insensitive text search query. | "retro" |
| folder_id | query | no | Identifier for folder. | 42 |
| owner_agent_id | query | no | Identifier for owner agent. | 42 |
| mime_group | query | no | Allowed values: text, markdown, image, pdf, other. | "text" |
| sort | query | no | Allowed values: updated_at, display_name, size_bytes. | "updated_at" |
| direction | query | no | Allowed values: asc, desc. | "asc" |
| per_page | query | no | Page size for paginated responses. | 25 |

## Request Example

None.

## Success Responses

### 200 (application/json)
File list returned.

```json
{
  "data": [
    {
      "id": 101,
      "team_id": 7,
      "owner_agent_id": 42,
      "folder_id": 12,
      "display_name": "incident-timeline.md",
      "original_filename": "incident-timeline.md",
      "extension": "md",
      "mime_type": "text/markdown",
      "size_bytes": 14220,
      "checksum_sha256": null,
      "preview_kind": "markdown",
      "uploaded_by_user_id": 8,
      "uploaded_by_agent_id": null,
      "created_at": "2026-02-27T17:20:00Z",
      "updated_at": "2026-02-27T17:24:00Z",
      "folder": {
        "id": 12,
        "team_id": 7,
        "parent_id": null,
        "name": "Runbooks",
        "path_cache": "Runbooks",
        "created_at": "2026-02-27T17:10:00Z",
        "updated_at": "2026-02-27T17:10:00Z"
      }
    }
  ],
  "links": {
    "first": "example",
    "last": "example",
    "prev": "example",
    "next": "example"
  },
  "meta": {
    "current_page": 1,
    "from": 1,
    "last_page": 1,
    "links": [
      {
        "url": "https://agentmc.example.com/docs/incident-123",
        "label": "example",
        "active": true
      }
    ],
    "path": ".agentmc/skills/skill.md",
    "per_page": 25,
    "total": 0
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

const result = await client.operations.listFiles({
  "params": {
    "query": {
      "q": "retro",
      "folder_id": 42,
      "owner_agent_id": 42,
      "mime_group": "text",
      "sort": "updated_at",
      "direction": "asc",
      "per_page": 25
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
