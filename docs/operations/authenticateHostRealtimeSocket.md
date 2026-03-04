# authenticateHostRealtimeSocket

- Method: `POST`
- Path: `/hosts/realtime/socket-auth`
- Summary: Sign one websocket channel subscription for the host realtime watch channel.
- Auth: ApiKeyAuth

## Description

Used by host runtimes to subscribe to host-scoped realtime availability events (new requested sessions) with host API key context.

## Parameters

None.

## Request Example

### application/json
```json
{
  "socket_id": "1234.567890",
  "channel_name": "private-agent-realtime-host.12"
}
```

## Success Responses

### 200 (application/json)
Host socket subscription authorized.

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

const result = await client.operations.authenticateHostRealtimeSocket({
  "body": {
    "socket_id": "1234.567890",
    "channel_name": "private-agent-realtime-host.12"
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
