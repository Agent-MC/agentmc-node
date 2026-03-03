# updateCalendarItem

- Method: `PUT`
- Path: `/calendar/items/{item}`
- Summary: Update a calendar item.
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

### 200 (none)
Calendar item updated.

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

const result = await client.operations.updateCalendarItem({
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
