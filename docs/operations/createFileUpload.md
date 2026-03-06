# createFileUpload

- Method: `POST`
- Path: `/files/uploads`
- Summary: Create a presigned upload ticket for a managed file.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

No additional description.

## Parameters

None.

## Request Example

None.

## Success Responses

### 201 (none)
Upload ticket created.

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

const result = await client.operations.createFileUpload();

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
