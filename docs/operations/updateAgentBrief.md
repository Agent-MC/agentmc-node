# updateAgentBrief

- Method: `PATCH`
- Path: `/briefs/{id}`
- Summary: Edit one brief parent.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

Updates one saved parent brief by id and appends a child entry when entry fields are provided.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| id | path | yes | Brief identifier. | 42 |

## Request Example

### application/json
```json
{
  "brief": {
    "name": "Daily Operations Brief",
    "summary": "Operations handoff digest for the morning window.",
    "timezone": "America/Los_Angeles",
    "sections": [
      {
        "key": "incidents",
        "label": "Incidents"
      },
      {
        "key": "followups",
        "label": "Follow-ups"
      }
    ],
    "content_markdown": "## Updates\n- Incident queue cleared\n- Follow-up tasks assigned",
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

### 200 (application/json)
Brief record updated.

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

const result = await client.operations.updateAgentBrief({
  "params": {
    "path": {
      "id": 42
    }
  },
  "body": {
    "brief": {
      "name": "Daily Operations Brief",
      "summary": "Operations handoff digest for the morning window.",
      "timezone": "America/Los_Angeles",
      "sections": [
        {
          "key": "incidents",
          "label": "Incidents"
        },
        {
          "key": "followups",
          "label": "Follow-ups"
        }
      ],
      "content_markdown": "## Updates\n- Incident queue cleared\n- Follow-up tasks assigned",
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
