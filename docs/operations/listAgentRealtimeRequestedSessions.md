# listAgentRealtimeRequestedSessions

- Method: `GET`
- Path: `/hosts/realtime/sessions/requested`
- Summary: List claimable realtime sessions for one agent or a host.
- Auth: ApiKeyAuth

## Description

When X-Agent-Id (or agent_id query) is provided, returns open system realtime sessions (requested, claimed, or active) for that agent. With a host API key and no agent context, returns open system sessions across all agents assigned to that host so runtimes can recover existing sessions after restarts.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| limit | query | no | Maximum number of records to return. | 20 |

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
      "limit": 20
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
