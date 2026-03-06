# getAgentsInstructions

- Method: `GET`
- Path: `/agents/instructions`
- Summary: Fetch the instruction bundle for one agent.
- Auth: None

## Description

Agent context is required when using host/team API keys. Provide X-Agent-Id (or agent_id query) so AgentMC returns the correct bundle for the acting agent.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| current_bundle_version | query | no | Current bundle version. | "example" |
| X-Agent-Id | header | no | Acting agent identifier for host/team API key requests. Required when the runtime is acting as a specific agent. | 1 |
| agent_id | query | no | Alternate acting agent identifier. Required when using host/team API keys without a scoped agent credential. | 42 |

## Request Example

None.

## Success Responses

### 200 (application/json)
Successful response.

```json
{
  "ok": true,
  "changed": true,
  "bundle_version": "bundle_2fa07fcadd6575cc",
  "generated_at": "2026-02-25T14:10:00Z",
  "defaults": {
    "heartbeat_interval_seconds": 60
  },
  "agent": {
    "id": 42
  },
  "files": [
    {
      "id": "skill.md",
      "path": ".agentmc/skills/skill.md",
      "content": "# AgentMC Skill\n",
      "sha256": "f96c95bd27dc9f3415cc0f4d817b5ec6f14185b6fcb5db9f6b6f14f648f8e9e4"
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

const client = new AgentMCApi();

const result = await client.operations.getAgentsInstructions({
  "params": {
    "query": {
      "current_bundle_version": "example",
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
