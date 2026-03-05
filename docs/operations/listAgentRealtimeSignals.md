# listAgentRealtimeSignals

- Method: `GET`
- Path: `/hosts/realtime/sessions/{session}/signals`
- Summary: List realtime signals for one claimed session (host or agent context).
- Auth: ApiKeyAuth

## Description

Returns persisted signals ordered by id so websocket clients can catch up missed events after reconnect.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| session | path | yes | Realtime session identifier. | 1 |
| after_id | query | no | Only return signals with id greater than this value. | 1 |
| limit | query | no | Maximum number of signals to return. | 1 |

## Request Example

None.

## Success Responses

### 200 (none)
Realtime signals returned.

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

const result = await client.operations.listAgentRealtimeSignals({
  "params": {
    "path": {
      "session": 1
    },
    "query": {
      "after_id": 1,
      "limit": 1
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
