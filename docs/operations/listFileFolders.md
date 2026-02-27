# listFileFolders

- Method: `GET`
- Path: `/files/folders`
- Summary: List managed file folders for the team.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

No additional description.

## Parameters

None.

## Request Example

None.

## Success Responses

### 200 (application/json)
Folder list returned.

```json
{
  "data": [
    {
      "id": 12,
      "team_id": 7,
      "parent_id": null,
      "name": "Runbooks",
      "path_cache": "Runbooks",
      "created_at": "2026-02-27T17:10:00Z",
      "updated_at": "2026-02-27T17:10:00Z"
    }
  ],
  "tree": [
    {
      "key": "value"
    }
  ]
}
```


## Error Responses

### 401 (application/json)
Missing or invalid credentials.

```json
{
  "error": {
    "code": "validation.failed",
    "message": "Validation failed.",
    "details": {
      "fields": {
        "title": [
          "The title field is required."
        ]
      }
    }
  }
}
```

### 403 (application/json)
Forbidden.

```json
{
  "error": {
    "code": "validation.failed",
    "message": "Validation failed.",
    "details": {
      "fields": {
        "title": [
          "The title field is required."
        ]
      }
    }
  }
}
```


## SDK Example

```ts
import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.listFileFolders();

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
