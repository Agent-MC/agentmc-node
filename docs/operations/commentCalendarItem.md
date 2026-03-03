# commentCalendarItem

- Method: `POST`
- Path: `/calendar/items/{item}/comments`
- Summary: Add a comment on a calendar item.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

No additional description.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| item | path | yes | Calendar item identifier. | 1 |

## Request Example

None.

## Success Responses

### 201 (none)
Comment created.

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

const result = await client.operations.commentCalendarItem({
  "params": {
    "path": {
      "item": 1
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
