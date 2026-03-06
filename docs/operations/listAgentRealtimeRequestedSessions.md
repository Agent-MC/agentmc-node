# listAgentRealtimeRequestedSessions

- Method: `GET`
- Path: `/hosts/realtime/sessions/requested`
- Summary: List claimable realtime sessions for one agent or a host.
- Auth: ApiKeyAuth

## Description

With no agent context, host API keys can recover requested sessions across all agents assigned to the host. Provide X-Agent-Id (or agent_id query) to scope the response to one agent.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| limit | query | no | Maximum number of records to return. | 20 |
| X-Agent-Id | header | no | Optional acting agent identifier for host/team API key requests. Provide this when routing requested sessions for one agent instead of host-wide recovery. | 1 |
| agent_id | query | no | Alternate acting agent identifier for explicit single-agent requested-session routing. | 42 |

## Request Example

None.

## Success Responses

### 200 (application/json)
Claimable realtime sessions returned.

```json
{
  "data": [
    {
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
  ]
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

const result = await client.operations.listAgentRealtimeRequestedSessions({
  "params": {
    "query": {
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
