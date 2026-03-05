# markAllNotificationsRead

- Method: `POST`
- Path: `/notifications/read-all`
- Summary: Mark all unread team notifications as read for the current team.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

No additional description.

## Parameters

None.

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
  "body": {}
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
