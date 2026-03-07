# createBoardColumn

- Method: `POST`
- Path: `/boards/{board}/columns`
- Summary: Create a board column.
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

### 201 (none)
Column created.

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

const result = await client.operations.createBoardColumn({
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
