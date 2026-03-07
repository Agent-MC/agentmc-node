# listAgents

- Method: `GET`
- Path: `/teams/agents`
- Summary: List agents for the current team.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

Returns visible agents for the current team. Host API keys are limited to agents assigned to that authenticated host.

## Parameters

None.

## Request Example

None.

## Success Responses

### 200 (none)
Agents returned.

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

const result = await client.operations.listAgents();

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
