# agentHeartbeat

- Method: `POST`
- Path: `/hosts/heartbeat`
- Summary: Record host heartbeat and runtime telemetry.
- Auth: ApiKeyAuth

## Description

Accepts heartbeat pings with required host telemetry payload and required runtime agent metadata.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| X-Host-Fingerprint | header | no | Optional host fingerprint header fallback. Used only when host.fingerprint is omitted from the request body. | "a3f56f330f311a2159f8c101eaf1439a29f1d57f007375d56aa79f304bc4f112" |

## Request Example

None.

## Success Responses

### 200 (none)
Heartbeat accepted.

```text
No response body.
```


## Error Responses

### 401 (none)
Missing or invalid API key.

```text
No response body.
```

### 403 (none)
Forbidden.

```text
No response body.
```


## SDK Example

```ts
import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.agentHeartbeat({
  "params": {
    "header": {
      "X-Host-Fingerprint": "a3f56f330f311a2159f8c101eaf1439a29f1d57f007375d56aa79f304bc4f112"
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
