# createAgentRealtimeSignal

- Method: `POST`
- Path: `/hosts/realtime/sessions/{session}/signals`
- Summary: Publish one realtime event to a realtime session (host or agent context).
- Auth: ApiKeyAuth

## Description

Accepts host API key context by session ownership. X-Agent-Id remains optional for explicit single-agent routing.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| session | path | yes | Realtime session identifier. | 1 |
| X-Agent-Id | header | no | Optional acting agent identifier for explicit single-agent routing when publishing to a session with host/team API keys. | 1 |
| agent_id | query | no | Alternate acting agent identifier for explicit single-agent realtime publish routing. | 42 |

## Request Example

### application/json
```json
{
  "type": "message",
  "payload": {
    "type": "chat.user",
    "payload": {
      "content": "Create an AgentMC task for this afternoon to draft the postmortem outline.\n\n![incident-chart](/api/v1/files/101/preview)",
      "message_id": 512,
      "timezone": "America/Los_Angeles",
      "source": "agentmc_chat",
      "intent_scope": "agentmc"
    }
  }
}
```

## Success Responses

### 200 (application/json)
Realtime signal accepted.

```json
{
  "data": {
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
  },
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

const result = await client.operations.createAgentRealtimeSignal({
  "params": {
    "path": {
      "session": 1
    },
    "header": {
      "X-Agent-Id": 1
    },
    "query": {
      "agent_id": 42
    }
  },
  "body": {
    "type": "message",
    "payload": {
      "type": "chat.user",
      "payload": {
        "content": "Create an AgentMC task for this afternoon to draft the postmortem outline.\n\n![incident-chart](/api/v1/files/101/preview)",
        "message_id": 512,
        "timezone": "America/Los_Angeles",
        "source": "agentmc_chat",
        "intent_scope": "agentmc"
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
