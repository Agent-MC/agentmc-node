# listBoards

- Method: `GET`
- Path: `/boards`
- Summary: List boards for the current team.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

No additional description.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| per_page | query | no | Page size for paginated responses. | 25 |
| scope | query | no | Allowed values: all, mine, team, personal. | "all" |
| personal_owner_user_id | query | no | Identifier for the private board owner user. | 42 |

## Request Example

None.

## Success Responses

### 200 (application/json)
Board list returned.

```json
{
  "data": [
    {
      "id": 42,
      "team_id": 42,
      "name": "Example Name",
      "description": "Example description text.",
      "visibility": "team",
      "personal_owner_user_id": 42,
      "created_by_user_id": 42,
      "created_at": "2026-02-22T17:21:00Z",
      "updated_at": "2026-02-22T17:21:00Z"
    }
  ],
  "links": {
    "first": "example",
    "last": "example",
    "prev": "example",
    "next": "example"
  },
  "meta": {
    "current_page": 1,
    "from": 1,
    "last_page": 1,
    "links": [
      {
        "url": "https://agentmc.example.com/docs/incident-123",
        "label": "example",
        "active": true
      }
    ],
    "path": ".agentmc/skills/skill.md",
    "per_page": 25,
    "total": 0
  }
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

const result = await client.operations.listBoards({
  "params": {
    "query": {
      "per_page": 25,
      "scope": "all",
      "personal_owner_user_id": 42
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
