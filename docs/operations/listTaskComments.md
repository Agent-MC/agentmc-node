# listTaskComments

- Method: `GET`
- Path: `/tasks/{task}/comments`
- Summary: List comments on one task.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

No additional description.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| task | path | yes | Task identifier. | 1 |
| per_page | query | no | Page size for paginated responses. | 25 |

## Request Example

None.

## Success Responses

### 200 (application/json)
Task comments returned.

```json
{
  "data": [
    {
      "id": 42,
      "task_id": 42,
      "actor_type": "user",
      "actor_id": 42,
      "actor_name": "Example Name",
      "body": "Example content.",
      "mentions": [
        {
          "key": "example",
          "type": "user",
          "id": 42,
          "label": "example",
          "handle": "example",
          "token": "example"
        }
      ],
      "edited_at": "2026-02-22T17:21:00Z",
      "created_at": "2026-02-22T17:21:00Z"
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

### 404 (application/json)
Resource not found.

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

const result = await client.operations.listTaskComments({
  "params": {
    "path": {
      "task": 1
    },
    "query": {
      "per_page": 25
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
