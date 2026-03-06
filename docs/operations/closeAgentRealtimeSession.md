# closeAgentRealtimeSession

- Method: `POST`
- Path: `/hosts/realtime/sessions/{session}/close`
- Summary: Close a realtime session (host or agent context).
- Auth: ApiKeyAuth

## Description

Accepts host API key context by session ownership. X-Agent-Id remains optional for explicit single-agent routing to an agent already assigned to that host.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| session | path | yes | Realtime session identifier. | 1 |

## Request Example

None.

## Success Responses

### 200 (none)
Realtime session closed.

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

const result = await client.operations.closeAgentRealtimeSession({
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
