# createAgentBrief

- Method: `POST`
- Path: `/briefs`
- Summary: Upsert a brief parent by key and append one child entry.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

Creates or appends a brief for one agent. When using host/team API keys, provide X-Agent-Id (or agent_id query) or send source.agent_id in the request body.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| X-Agent-Id | header | no | Acting agent identifier for host/team API key requests when creating or appending a brief. | 1 |
| agent_id | query | no | Alternate acting agent identifier for host/team API key brief writes. | 42 |

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
  "params": {
    "header": {
      "X-Agent-Id": 1
    },
    "query": {
      "agent_id": 42
    }
  },
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
