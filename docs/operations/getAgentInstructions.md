# getAgentInstructions

- Method: `GET`
- Path: `/agents/instructions`
- Summary: Fetch the AgentMC instruction bundle for the authenticated agent.
- Auth: ApiKeyAuth

## Description

Returns managed runtime files and bundle metadata. Send current_bundle_version to fetch files only when the bundle has changed.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| current_bundle_version | query | no | Last applied instruction bundle version from local runtime state. | "bundle_2fa07fcadd6575cc" |

## Request Example

None.

## Success Responses

### 200 (application/json)
Instruction bundle returned.

```json
{
  "ok": true,
  "changed": true,
  "bundle_version": "bundle_2fa07fcadd6575cc",
  "generated_at": "2026-02-25T14:10:00Z",
  "defaults": {
    "heartbeat_interval_seconds": 300
  },
  "agent": {
    "id": 42
  },
  "files": [
    {
      "id": "skill.md",
      "path": ".agentmc/skills/skill.md",
      "content": "# AgentMC\n",
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

const result = await client.operations.getAgentInstructions({
  "params": {
    "query": {
      "current_bundle_version": "bundle_2fa07fcadd6575cc"
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
