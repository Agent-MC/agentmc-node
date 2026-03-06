# authenticateHostRealtimeSocket

- Method: `POST`
- Path: `/hosts/realtime/socket-auth`
- Summary: Sign one websocket channel subscription for the host realtime watch channel.
- Auth: ApiKeyAuth

## Description

Used by host runtimes to subscribe to host-scoped realtime availability events (new requested sessions) with host API key context.

## Parameters

None.

## Request Example

None.

## Success Responses

### 200 (none)
Host socket subscription authorized.

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

const result = await client.operations.authenticateHostRealtimeSocket();

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
