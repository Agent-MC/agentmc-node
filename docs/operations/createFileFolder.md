# createFileFolder

- Method: `POST`
- Path: `/files/folders`
- Summary: Create a managed file folder.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

No additional description.

## Parameters

None.

## Request Example

None.

## Success Responses

### 201 (none)
Folder created.

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

const result = await client.operations.createFileFolder();

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
