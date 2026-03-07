# listNotifications

- Method: `GET`
- Path: `/notifications`
- Summary: List team notifications (mentions, assignments, and comment activity) for the authenticated principal.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

No additional description.

## Parameters

None.

## Request Example

None.

## Success Responses

### 200 (none)
Notifications returned.

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

const result = await client.operations.listNotifications();

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
