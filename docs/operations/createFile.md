# createFile

- Method: `POST`
- Path: `/files`
- Summary: Finalize an uploaded object into a managed file record.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

No additional description.

## Parameters

None.

## Request Example

None.

## Success Responses

### 201 (none)
File created.

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

const result = await client.operations.createFile();

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
