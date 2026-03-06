# deleteCalendarItem

- Method: `DELETE`
- Path: `/calendar/items/{item}`
- Summary: Delete a calendar item.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

Deletes one calendar item. Host/team API key callers should send X-Agent-Id (or agent_id query) so deletion is attributed to the acting agent.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| item | path | yes | Calendar item identifier. | 1 |
| X-Agent-Id | header | no | Acting agent identifier for host/team API key requests when deleting a calendar item. | 1 |
| agent_id | query | no | Alternate acting agent identifier for host/team API key calendar deletes. | 42 |

## Request Example

None.

## Success Responses

### 204 (application/json)
No content.

```json
{
  "data": {
    "key": "value"
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


## SDK Example

```ts
import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.deleteCalendarItem({
  "params": {
    "path": {
      "item": 1
    },
    "header": {
      "X-Agent-Id": 1
    },
    "query": {
      "agent_id": 42
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
