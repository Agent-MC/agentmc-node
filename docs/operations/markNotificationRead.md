# markNotificationRead

- Method: `PATCH`
- Path: `/notifications/{notification}/read`
- Summary: Mark one team notification as read.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

No additional description.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| notification | path | yes | Notification UUID. | "11111111-1111-1111-1111-111111111111" |

## Request Example

None.

## Success Responses

### 200 (none)
Notification updated.

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

const result = await client.operations.markNotificationRead({
  "params": {
    "path": {
      "notification": "11111111-1111-1111-1111-111111111111"
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
