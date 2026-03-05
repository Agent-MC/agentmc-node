# updateTaskComment

- Method: `PATCH`
- Path: `/tasks/{task}/comments/{comment}`
- Summary: Update one existing task comment.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

No additional description.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| task | path | yes | Task identifier. | 1 |
| comment | path | yes | Task comment identifier. | 1 |

## Request Example

None.

## Success Responses

### 200 (none)
Task comment updated.

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

const result = await client.operations.updateTaskComment({
  "params": {
    "path": {
      "task": 1,
      "comment": 1
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
