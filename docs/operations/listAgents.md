# listAgents

- Method: `GET`
- Path: `/teams/agents`
- Summary: List agents for the current team.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

No additional description.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| per_page | query | no | Page size for paginated responses. | 25 |
| search | query | no | Case-insensitive text search query. | "operations" |

## Request Example

None.

## Success Responses

### 200 (application/json)
Agents returned.

```json
{
  "data": [
    {
      "id": 42,
      "team_id": 7,
      "host_id": 11,
      "host": {
        "id": 11,
        "name": "worker-01"
      },
      "name": "codex-runtime-prod",
      "status": "online",
      "meta": {
        "type": "generic",
        "runtime_host": "worker-01",
        "runtime_version": "2026.02.1",
        "runtime": "codex",
        "models": [
          {
            "model_id": "openai/gpt-5-codex",
            "provider": "openai"
          }
        ]
      },
      "last_seen_at": "2026-02-24T02:11:00Z",
      "tasks_count": 3,
      "created_at": "2026-02-24T01:56:00Z",
      "updated_at": "2026-02-24T02:11:00Z"
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


## SDK Example

```ts
import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.listAgents({
  "params": {
    "query": {
      "per_page": 25,
      "search": "operations"
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
