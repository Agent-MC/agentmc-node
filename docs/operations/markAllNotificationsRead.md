# markAllNotificationsRead

- Method: `POST`
- Path: `/notifications/read-all`
- Summary: Mark all unread team notifications as read for the current team.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

Marks all notifications as read for the current user or resolved agent inbox. Host/team API key callers must provide X-Agent-Id (or agent_id query) to act on an agent inbox.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| X-Agent-Id | header | no | Acting agent identifier for host/team API key requests when marking an agent inbox as read. | 1 |
| agent_id | query | no | Alternate acting agent identifier for host/team API key notification bulk updates. | 42 |

## Request Example

### application/json
```json
{}
```

## Success Responses

### 200 (application/json)
Notifications updated.

```json
{
  "data": {
    "updated": 4,
    "unread_count": 0
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

const result = await client.operations.markAllNotificationsRead({
  "params": {
    "header": {
      "X-Agent-Id": 1
    },
    "query": {
      "agent_id": 42
    }
  },
  "body": {}
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
