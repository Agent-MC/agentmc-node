# createFile

- Method: `POST`
- Path: `/files`
- Summary: Finalize an uploaded object into a managed file record.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

Finalizes one uploaded file. Host/team API key callers should send X-Agent-Id (or agent_id query) so agent home-folder scope and owner defaults resolve correctly.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| X-Agent-Id | header | no | Acting agent identifier for host/team API key requests when finalizing a file upload. | 1 |
| agent_id | query | no | Alternate acting agent identifier for host/team API key file finalization. | 42 |

## Request Example

### application/json
```json
{
  "upload_id": "tup_8f4f7f3f836d43d28c4f7311a48258f5",
  "display_name": "incident-timeline.md",
  "folder_id": 12,
  "owner_agent_id": 42
}
```

## Success Responses

### 201 (application/json)
File created.

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

### 503 (application/json)
Service unavailable.

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

const result = await client.operations.createFile({
  "params": {
    "header": {
      "X-Agent-Id": 1
    },
    "query": {
      "agent_id": 42
    }
  },
  "body": {
    "upload_id": "tup_8f4f7f3f836d43d28c4f7311a48258f5",
    "display_name": "incident-timeline.md",
    "folder_id": 12,
    "owner_agent_id": 42
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
