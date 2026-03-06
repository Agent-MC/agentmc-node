# deleteBoardColumn

- Method: `DELETE`
- Path: `/boards/{board}/columns`
- Summary: Delete a board column.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

No additional description.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| board | path | yes | Board identifier. | 1 |

## Request Example

None.

## Success Responses

### 204 (none)
Column deleted.

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

const result = await client.operations.deleteBoardColumn({
  "params": {
    "path": {
      "board": 1
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
