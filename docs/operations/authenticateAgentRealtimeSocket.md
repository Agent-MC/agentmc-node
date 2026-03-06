# authenticateAgentRealtimeSocket

- Method: `POST`
- Path: `/hosts/realtime/sessions/{session}/socket-auth`
- Summary: Sign one websocket channel subscription for a realtime session (host or agent context).
- Auth: ApiKeyAuth

## Description

Accepts host API key context by session ownership. X-Agent-Id remains optional for explicit single-agent routing.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| session | path | yes | Realtime session identifier. | 1 |
| X-Agent-Id | header | no | Optional acting agent identifier for explicit single-agent routing when authorizing a session websocket subscription with host/team API keys. | 1 |
| agent_id | query | no | Alternate acting agent identifier for explicit single-agent websocket subscription routing. | 42 |

## Request Example

### application/json
```json
{
  "socket_id": "1234.567890",
  "channel_name": "private-agent-realtime.7.42"
}
```

## Success Responses

### 200 (application/json)
Socket subscription authorized.

```json
{
  "auth": "example"
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

const result = await client.operations.authenticateAgentRealtimeSocket({
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
    "socket_id": "1234.567890",
    "channel_name": "private-agent-realtime.7.42"
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
