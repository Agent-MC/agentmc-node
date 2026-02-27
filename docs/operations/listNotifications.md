# listNotifications

- Method: `GET`
- Path: `/notifications`
- Summary: List team notifications (mentions, assignments, and comment activity) for the authenticated principal.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

No additional description.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| unread | query | no | Filter unread notifications only. Accepts true/false (and 1/0). | true |
| per_page | query | no | Page size for paginated responses. | 25 |

## Request Example

None.

## Success Responses

### 200 (application/json)
Notifications returned.

```json
{
  "data": [
    {
      "id": "c084fc57-b2c6-466c-adcb-cf6f4efca42a",
      "notification_type": "mention",
      "source_type": "App\\Notifications\\MentionedInCommentNotification",
      "team_id": 7,
      "subject_type": "task",
      "subject_id": 121,
      "subject_label": "Prepare incident postmortem",
      "actor_type": "user",
      "actor_id": 3,
      "actor_name": "Alex Morgan",
      "assignee_type": null,
      "assignee_id": null,
      "mention_handle": "@tim",
      "comment": "Can you own the timeline section before standup?",
      "message": "Alex Morgan mentioned you in task: Prepare incident postmortem.",
      "url": "/tasks/121?comment=998",
      "comment_id": 998,
      "response_action": {
        "type": "post_comment_reply",
        "method": "POST",
        "path": "/tasks/121/comments",
        "request_body": {
          "body": "Thanks, I can own the timeline section."
        }
      },
      "is_read": false,
      "read_at": null,
      "created_at": "2026-02-24T02:11:00Z",
      "updated_at": "2026-02-24T02:11:00Z"
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

### 422 (application/json)
Validation failed.

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

const result = await client.operations.listNotifications({
  "params": {
    "query": {
      "unread": true,
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
