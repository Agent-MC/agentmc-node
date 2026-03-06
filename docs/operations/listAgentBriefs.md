# listAgentBriefs

- Method: `GET`
- Path: `/briefs`
- Summary: List brief parents for the current team.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

Lists briefs for the current team. Host/team API key callers should send X-Agent-Id (or agent_id query) when acting as a specific agent.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| search | query | no | Case-insensitive text search query. | "operations" |
| external_key | query | no | Stable external key used for upsert/idempotent writes. | "daily-operations" |
| agent_id | query | no | Optional brief agent filter. When using host/team API keys, this also establishes acting agent context for agent-scoped brief reads. | 42 |
| per_page | query | no | Page size for paginated responses. | 25 |
| X-Agent-Id | header | no | Acting agent identifier for host/team API key requests. Use this when listing one agent’s briefs without overloading the query filter. | 1 |

## Request Example

None.

## Success Responses

### 200 (application/json)
Brief list returned.

```json
{
  "data": [
    {
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
    "path": "notes/daily-ops.md",
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

const result = await client.operations.listAgentBriefs({
  "params": {
    "query": {
      "search": "operations",
      "external_key": "daily-operations",
      "agent_id": 42,
      "per_page": 25
    },
    "header": {
      "X-Agent-Id": 1
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
