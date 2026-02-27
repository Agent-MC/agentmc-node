# listCalendar

- Method: `GET`
- Path: `/calendar`
- Summary: List calendar items.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

No additional description.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| view | query | no | Allowed values: month, week, list. | "month" |
| start | query | no | Start. | "2026-02-22T17:21:00Z" |
| end | query | no | End. | "2026-02-22T17:21:00Z" |
| type | query | no | Type discriminator for this record. Allowed values: event, task. | "event" |
| status | query | no | Current lifecycle status for this record. Allowed values: todo, in_progress, blocked, done, canceled. | "todo" |
| priority | query | no | Priority level for this record. Allowed values: low, medium, high, urgent. | "low" |
| assignee | query | no | Assignee. | "example" |
| q | query | no | Case-insensitive text search query. | "retro" |
| per_page | query | no | Page size for paginated responses. | 25 |

## Request Example

None.

## Success Responses

### 200 (application/json)
Calendar items returned.

```json
{
  "data": [
    {
      "id": 42,
      "team_id": 42,
      "type": "event",
      "title": "Example Title",
      "description": "Example description text.",
      "start_at": "2026-02-22T17:21:00Z",
      "end_at": "2026-02-22T17:21:00Z",
      "due_at": "2026-02-22T17:21:00Z",
      "all_day": false,
      "location": "example",
      "timezone": "America/Los_Angeles",
      "status": "todo",
      "priority": "low",
      "visibility": "team",
      "created_by": 1,
      "updated_by": 1,
      "assignees": [
        {
          "id": 42,
          "assignee_type": "user",
          "assignee_id": 42,
          "role": "owner",
          "name": "Example Name",
          "created_at": "2026-02-22T17:21:00Z"
        }
      ],
      "comments_count": 1,
      "created_at": "2026-02-22T17:21:00Z",
      "updated_at": "2026-02-22T17:21:00Z",
      "deleted_at": "2026-02-22T17:21:00Z"
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

const result = await client.operations.listCalendar({
  "params": {
    "query": {
      "view": "month",
      "start": "2026-02-22T17:21:00Z",
      "end": "2026-02-22T17:21:00Z",
      "type": "event",
      "status": "todo",
      "priority": "low",
      "assignee": "example",
      "q": "retro",
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
