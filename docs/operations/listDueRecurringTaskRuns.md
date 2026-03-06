# listDueRecurringTaskRuns

- Method: `GET`
- Path: `/agents/recurring-task-runs/due`
- Summary: -
- Auth: ApiKeyAuth

## Description

Returns due recurring task runs for one resolved agent. Host/team API key callers must provide X-Agent-Id (or agent_id query) unless the credential is already scoped to a single agent.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| limit | query | no | Maximum number of records to return. | 20 |
| X-Agent-Id | header | no | Acting agent identifier for host/team API key requests. Required when claiming due runs for a specific agent. | 1 |
| agent_id | query | no | Alternate acting agent identifier for host/team API key requests when claiming due runs. | 42 |

## Request Example

None.

## Success Responses

### 200 (application/json)
Successful response.

```json
{
  "data": [
    {
      "run_id": 42,
      "task_id": 42,
      "prompt": "example",
      "scheduled_for": "2026-02-22T17:21:00Z",
      "claim_token": "example",
      "agent_id": 42
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

const result = await client.operations.listDueRecurringTaskRuns({
  "params": {
    "query": {
      "limit": 20,
      "agent_id": 42
    },
    "header": {
      "X-Agent-Id": 1
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
