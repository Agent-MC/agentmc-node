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

None.

## Success Responses

### 200 (none)
Notifications updated.

```text
No response body.
```


## Error Responses

### default (none)
Error response.

```text
No response body.
```


## SDK Example

```ts
import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.markAllNotificationsRead();

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
