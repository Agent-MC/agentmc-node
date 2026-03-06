# authenticateAgentRealtimeSocket

- Method: `POST`
- Path: `/hosts/realtime/sessions/{session}/socket-auth`
- Summary: Sign one websocket channel subscription for a realtime session (host or agent context).
- Auth: ApiKeyAuth

## Description

Accepts host API key context by session ownership. X-Agent-Id remains optional for explicit single-agent routing.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| session | path | yes | Realtime session identifier. | 1 |

## Request Example

None.

## Success Responses

### 200 (none)
Socket subscription authorized.

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

const result = await client.operations.authenticateAgentRealtimeSocket({
  "params": {
    "path": {
      "session": 1
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
