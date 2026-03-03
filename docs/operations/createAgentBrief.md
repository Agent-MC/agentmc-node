# createAgentBrief

- Method: `POST`
- Path: `/briefs`
- Summary: Upsert a brief parent by key and append one child entry.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

On first sync for a key, AgentMC creates a parent brief and this first child. On later syncs for the same key, AgentMC reuses the parent and appends a new child entry.

## Parameters

None.

## Request Example

None.

## Success Responses

### 201 (none)
Brief report accepted.

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

const result = await client.operations.createAgentBrief();

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
