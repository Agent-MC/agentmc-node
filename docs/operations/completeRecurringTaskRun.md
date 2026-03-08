# completeRecurringTaskRun

- Method: `POST`
- Path: `/agents/recurring-task-runs/{run}/complete`
- Summary: -
- Auth: ApiKeyAuth

## Description

Completes one recurring task run for the resolved acting agent. Host/team API key callers must provide X-Agent-Id (or agent_id query) unless the credential is already scoped to a single agent.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| run | path | yes | Run. | 1 |
| X-Agent-Id | header | no | Acting agent identifier for host/team API key requests. Required when completing a recurring run for a specific agent. | 1 |
| agent_id | query | no | Alternate acting agent identifier for host/team API key requests when completing a recurring run. | 42 |

## Request Example

### application/json
```json
{
  "status": "success",
  "claim_token": "e3ec996c-c53f-4bfa-89e3-5d9cbf71397f",
  "summary": "Scheduled review completed and updated 2 tasks.",
  "runtime_meta": {
    "provider": "openclaw",
    "request_id": "req_01JBPXXRM6JYAVY82ECAQ7QNA4"
  }
}
```

## Success Responses

### 200 (application/json)
Successful response.

```json
{
  "data": {
    "id": 42,
    "team_id": 42,
    "agent_id": 42,
    "agent_recurring_task_id": 42,
    "scheduled_for": "2026-02-22T17:21:00Z",
    "status": "running",
    "claim_token": "example",
    "prompt_snapshot": "example",
    "schedule_snapshot": {
      "schedule_type": "minutes",
      "timezone": "America/Los_Angeles",
      "minute_interval_minutes": 15,
      "hourly_interval_hours": null,
      "daily_time": null,
      "weekly_days": [],
      "monthly_day": null
    },
    "started_at": "2026-02-22T17:21:00Z",
    "finished_at": "2026-02-22T17:21:00Z",
    "summary": "Morning operations handoff digest.",
    "error_message": "example",
    "runtime_meta": {
      "key": "value"
    },
    "created_at": "2026-02-22T17:21:00Z",
    "updated_at": "2026-02-22T17:21:00Z"
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

### 409 (application/json)
Conflict.

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

const result = await client.operations.completeRecurringTaskRun({
  "params": {
    "path": {
      "run": 1
    },
    "header": {
      "X-Agent-Id": 1
    },
    "query": {
      "agent_id": 42
    }
  },
  "body": {
    "status": "success",
    "claim_token": "e3ec996c-c53f-4bfa-89e3-5d9cbf71397f",
    "summary": "Scheduled review completed and updated 2 tasks.",
    "runtime_meta": {
      "provider": "openclaw",
      "request_id": "req_01JBPXXRM6JYAVY82ECAQ7QNA4"
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
