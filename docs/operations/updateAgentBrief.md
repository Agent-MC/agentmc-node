# updateAgentBrief

- Method: `PATCH`
- Path: `/briefs/{id}`
- Summary: Edit one brief parent.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

Updates one saved parent brief by id and appends a child entry when entry fields are provided.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| id | path | yes | Brief identifier. | 1 |

## Request Example

None.

## Success Responses

### 200 (none)
Brief record updated.

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

const result = await client.operations.updateAgentBrief({
  "params": {
    "path": {
      "id": 1
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
