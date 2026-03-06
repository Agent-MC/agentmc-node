# listAgentRealtimeSignals

- Method: `GET`
- Path: `/hosts/realtime/sessions/{session}/signals`
- Summary: List realtime signals for one claimed session (host or agent context).
- Auth: ApiKeyAuth

## Description

Lists persisted realtime signals for one claimed session. Host API keys may use host-scoped ownership or provide X-Agent-Id for explicit single-agent routing.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| session | path | yes | Realtime session identifier. | 1 |
| after_id | query | no | Return only records with id greater than this value. | 120 |
| limit | query | no | Maximum number of records to return. | 20 |
| X-Agent-Id | header | no | Optional acting agent identifier for explicit single-agent routing when listing session signals with host/team API keys. | 1 |
| agent_id | query | no | Alternate acting agent identifier for explicit single-agent session signal routing. | 42 |

## Request Example

None.

## Success Responses

### 200 (application/json)
Realtime signals returned.

```json
{
  "data": [
    {
      "id": 42,
      "team_id": 42,
      "agent_id": 42,
      "session_id": 42,
      "sender": "agent",
      "type": "example",
      "payload": {
        "key": "value"
      },
      "created_at": "2026-02-22T17:21:00Z",
      "updated_at": "2026-02-22T17:21:00Z"
    }
  ],
  "session": {
    "id": 42,
    "team_id": 42,
    "agent_id": 42,
    "requested_by_user_id": 42,
    "status": "requested",
    "claimed_at": "2026-02-22T17:21:00Z",
    "opened_at": "2026-02-22T17:21:00Z",
    "closed_at": "2026-02-22T17:21:00Z",
    "expires_at": "2026-02-22T17:21:00Z",
    "last_browser_heartbeat_at": "2026-02-22T17:21:00Z",
    "last_agent_heartbeat_at": "2026-02-22T17:21:00Z",
    "meta": {
      "key": "value"
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

### 409 (application/json)
Conflict.

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

const result = await client.operations.listAgentRealtimeSignals({
  "params": {
    "path": {
      "session": 1
    },
    "query": {
      "after_id": 120,
      "limit": 20,
      "agent_id": 42
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
