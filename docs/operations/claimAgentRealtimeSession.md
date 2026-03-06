# claimAgentRealtimeSession

- Method: `POST`
- Path: `/hosts/realtime/sessions/{session}/claim`
- Summary: Claim one realtime session for websocket message handling (host or agent context).
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
Realtime session claimed.

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

const result = await client.operations.claimAgentRealtimeSession({
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
