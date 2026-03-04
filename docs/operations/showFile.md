# showFile

- Method: `GET`
- Path: `/files/{id}`
- Summary: Show one managed file.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

No additional description.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| id | path | yes | File identifier. | 42 |

## Request Example

None.

## Success Responses

### 200 (application/json)
File returned.

```json
{
  "data": {
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

const result = await client.operations.showFile({
  "params": {
    "path": {
      "id": 42
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
