# listTasks

- Method: `GET`
- Path: `/tasks`
- Summary: List board tasks.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

No additional description.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| board_id | query | no | Board identifier. | 42 |
| archived | query | no | Filter tasks by archive state. Accepts true/false (and 1/0). | true |
| assigned_to_user_id | query | no | Identifier for assigned to user. | 42 |
| assigned_to_agent | query | no | Assigned to agent. | 1 |
| agent_id | query | no | Identifier for agent. | 42 |
| due_from | query | no | Due from. | "2026-02-22T17:21:00Z" |
| due_to | query | no | Due to. | "2026-02-22T17:21:00Z" |
| per_page | query | no | Page size for paginated responses. | 25 |

## Request Example

None.

## Success Responses

### 200 (application/json)
Task list returned.

```json
{
  "data": [
    {
      "id": 42,
      "team_id": 42,
      "board_id": 42,
      "column_id": 42,
      "title": "Example Title",
      "description": "Example description text.",
      "archived_at": "2026-02-22T17:21:00Z",
      "is_archived": true,
      "position": 1,
      "due_at": "2026-02-22T17:21:00Z",
      "created_by_user_id": 42,
      "assigned_to_user_id": 42,
      "assigned_to_agent_id": 42,
      "assignee_type": "human",
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

const result = await client.operations.listTasks({
  "params": {
    "query": {
      "board_id": 42,
      "archived": true,
      "assigned_to_user_id": 42,
      "assigned_to_agent": 1,
      "agent_id": 42,
      "due_from": "2026-02-22T17:21:00Z",
      "due_to": "2026-02-22T17:21:00Z",
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
