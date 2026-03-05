# createAgentBrief

- Method: `POST`
- Path: `/briefs`
- Summary: Upsert a brief parent by key and append one child entry.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

On first sync for a key, AgentMC creates a parent brief and this first child. On later syncs for the same key, AgentMC reuses the parent and appends a new child entry.

## Parameters

None.

## Request Example

### application/json
```json
{
  "brief": {
    "key": "daily-operations",
    "name": "Daily Operations Brief",
    "summary": "Operations handoff digest for the morning window.",
    "timezone": "America/Los_Angeles",
    "headline": "3 overdue tasks | 4 upcoming events",
    "content_markdown": "## Highlights\n- Elevated API error rate\n- Two incidents resolved\n\n![ops-dashboard](/api/v1/files/101/preview)",
    "meta": {
      "external_source": "daily-ops-job",
      "schedule": "0 7 * * *"
    }
  },
  "source": {
    "agent_id": 42,
    "meta": {
      "runtime": "codex"
    }
  }
}
```

## Success Responses

### 201 (application/json)
Brief report accepted.

```json
{
  "brief": {
    "id": 42,
    "team_id": 42,
    "agent_id": 42,
    "external_key": "daily-operations",
    "external_id": "ops-brief-2026-02-22",
    "name": "Example Name",
    "timezone": "America/Los_Angeles",
    "summary": "Morning operations handoff digest.",
    "include_sections": [
      {
        "key": "value"
      }
    ],
    "headline": "3 overdue tasks | 4 upcoming events",
    "content_markdown": "## Highlights\n- Elevated API error rate",
    "content_json": {
      "key": "value"
    },
    "source_meta": {
      "key": "value"
    },
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
    "received_at": "2026-02-22T17:21:00Z",
    "generated_at": "2026-02-22T17:21:00Z",
    "read_by_user_id": 42,
    "latest_entry_id": 42,
    "entries_count": 0,
    "latest_entry": {
      "id": 42,
      "agent_id": 42,
      "external_id": "ops-brief-2026-02-22",
      "name": "Example Name",
      "timezone": "America/Los_Angeles",
      "summary": "Morning operations handoff digest.",
      "include_sections": [
        {
          "key": "value"
        }
      ],
      "headline": "3 overdue tasks | 4 upcoming events",
      "content_markdown": "## Highlights\n- Elevated API error rate",
      "content_json": {
        "key": "value"
      },
      "source_meta": {
        "key": "value"
      },
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
      "received_at": "2026-02-22T17:21:00Z",
      "generated_at": "2026-02-22T17:21:00Z",
      "created_at": "2026-02-22T17:21:00Z",
      "updated_at": "2026-02-22T17:21:00Z"
    },
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

const result = await client.operations.createAgentBrief({
  "body": {
    "brief": {
      "key": "daily-operations",
      "name": "Daily Operations Brief",
      "summary": "Operations handoff digest for the morning window.",
      "timezone": "America/Los_Angeles",
      "headline": "3 overdue tasks | 4 upcoming events",
      "content_markdown": "## Highlights\n- Elevated API error rate\n- Two incidents resolved\n\n![ops-dashboard](/api/v1/files/101/preview)",
      "meta": {
        "external_source": "daily-ops-job",
        "schedule": "0 7 * * *"
      }
    },
    "source": {
      "agent_id": 42,
      "meta": {
        "runtime": "codex"
      }
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
