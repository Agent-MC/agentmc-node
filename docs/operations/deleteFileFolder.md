# deleteFileFolder

- Method: `DELETE`
- Path: `/files/folders/{id}`
- Summary: Delete a managed file folder.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

Deletes one folder node and permanently deletes all nested files and subfolders in that folder subtree.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| id | path | yes | Folder identifier. | 1 |

## Request Example

None.

## Success Responses

### 204 (none)
Folder deleted.

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

const result = await client.operations.deleteFileFolder({
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
