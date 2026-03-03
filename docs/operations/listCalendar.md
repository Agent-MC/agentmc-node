# listCalendar

- Method: `GET`
- Path: `/calendar`
- Summary: List calendar items.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

No additional description.

## Parameters

None.

## Request Example

None.

## Success Responses

### 200 (none)
Calendar items returned.

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

const result = await client.operations.listCalendar();

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
