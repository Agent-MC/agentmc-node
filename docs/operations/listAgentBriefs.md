# listAgentBriefs

- Method: `GET`
- Path: `/briefs`
- Summary: List brief parents for the current team.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

No additional description.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| search | query | no | Case-insensitive text search query. | "operations" |
| external_key | query | no | Stable external key used for upsert/idempotent writes. | "daily-operations" |
| agent_id | query | no | Identifier for agent. | 42 |
| per_page | query | no | Page size for paginated responses. | 25 |

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

const result = await client.operations.listAgentBriefs({
  "params": {
    "query": {
      "search": "operations",
      "external_key": "daily-operations",
      "agent_id": 42,
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
