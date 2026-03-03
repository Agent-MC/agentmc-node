# listAgentRealtimeRequestedSessions

- Method: `GET`
- Path: `/hosts/realtime/sessions/requested`
- Summary: List requested realtime sessions for one agent or a host.
- Auth: ApiKeyAuth

## Description

When X-Agent-Id (or agent_id query) is provided, returns requested sessions for that agent. With a host API key and no agent context, returns requested sessions across all agents assigned to that host.

## Parameters

None.

## Request Example

None.

## Success Responses

### 200 (none)
Requested realtime sessions returned.

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

const result = await client.operations.listAgentRealtimeRequestedSessions();

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
