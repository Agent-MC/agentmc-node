# showHost

- Method: `GET`
- Path: `/hosts/{id}`
- Summary: Show one host.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

Returns one host record including id/team/name/fingerprint, status + last_seen_at, metadata snapshot, and assigned-agent totals.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| id | path | yes | Host identifier. | 1 |

## Request Example

None.

## Success Responses

### 200 (none)
Host returned.

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

const result = await client.operations.showHost({
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
