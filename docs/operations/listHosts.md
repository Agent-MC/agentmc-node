# listHosts

- Method: `GET`
- Path: `/hosts`
- Summary: List hosts for the current team.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

Returns host records with connectivity state and machine metadata fields (meta) used for host diagnostics.

## Parameters

None.

## Request Example

None.

## Success Responses

### 200 (none)
Host list returned.

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

const result = await client.operations.listHosts();

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
