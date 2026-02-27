# agentHeartbeat

- Method: `POST`
- Path: `/agents/heartbeat`
- Summary: Record agent heartbeat and runtime host telemetry.
- Auth: ApiKeyAuth

## Description

Accepts heartbeat payloads with required host telemetry and required runtime agent metadata. Runtime clients should include `meta.models` on every heartbeat as current runtime model inventory.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| X-Host-Fingerprint | header | no | Optional host fingerprint header fallback. Used only when host.fingerprint is omitted from the request body. | "a3f56f330f311a2159f8c101eaf1439a29f1d57f007375d56aa79f304bc4f112" |

## Request Example

### application/json
```json
{
  "meta": {
    "type": "codex",
    "runtime": {
      "name": "openclaw",
      "version": "2026.2.26",
      "build": "bc50708",
      "mode": "openclaw"
    },
    "openclaw_version": "2026.2.26",
    "openclaw_build": "bc50708",
    "models": [
      "🦞 OpenClaw 2026.2.26 (bc50708)",
      "openai/gpt-5-codex"
    ],
    "node_version": "v22.14.0",
    "runtime_mode": "openclaw",
    "tool_availability": {
      "chat_realtime": true,
      "files_realtime": true,
      "notifications_realtime": true
    }
  },
  "host": {
    "fingerprint": "a3f56f330f311a2159f8c101eaf1439a29f1d57f007375d56aa79f304bc4f112",
    "name": "worker-01",
    "meta": {
      "hostname": "worker-01",
      "ip": "10.0.2.15",
      "network": {
        "private_ip": "10.0.2.15",
        "public_ip": "34.222.10.10"
      },
      "os": "Ubuntu",
      "os_version": "24.04",
      "arch": "x86_64",
      "cpu": "Intel Xeon",
      "cpu_cores": 8,
      "ram_gb": 32,
      "disk": {
        "total_bytes": 536870912000,
        "free_bytes": 322122547200
      },
      "uptime_seconds": 86400,
      "runtime": {
        "name": "codex",
        "version": "2026.02.1"
      }
    }
  },
  "agent": {
    "id": 42,
    "name": "Jarvis",
    "identity": {
      "name": "Jarvis",
      "creature": "robot",
      "vibe": "calm"
    }
  }
}
```

## Success Responses

### 200 (application/json)
Heartbeat accepted.

```json
{
  "ok": true,
  "server_time": "2026-02-22T17:21:02Z",
  "host": {
    "id": 12,
    "team_id": 7,
    "name": "worker-01",
    "fingerprint": "a3f56f330f311a2159f8c101eaf1439a29f1d57f007375d56aa79f304bc4f112",
    "status": "online",
    "last_seen_at": "2026-02-22T17:21:02Z",
    "meta": {
      "hostname": "worker-01",
      "os": "Ubuntu",
      "arch": "x86_64",
      "runtime": {
        "name": "codex",
        "version": "2026.02.1"
      }
    },
    "created_by_user_id": 1,
    "agents_total": 1,
    "agents_online": 1,
    "created_at": "2026-02-22T17:21:02Z",
    "updated_at": "2026-02-22T17:21:02Z"
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

const result = await client.operations.agentHeartbeat({
  "params": {
    "header": {
      "X-Host-Fingerprint": "a3f56f330f311a2159f8c101eaf1439a29f1d57f007375d56aa79f304bc4f112"
    }
  },
  "body": {
    "meta": {
      "type": "codex",
      "runtime": {
        "name": "openclaw",
        "version": "2026.2.26",
        "build": "bc50708",
        "mode": "openclaw"
      },
      "openclaw_version": "2026.2.26",
      "openclaw_build": "bc50708",
      "models": [
        "🦞 OpenClaw 2026.2.26 (bc50708)",
        "openai/gpt-5-codex"
      ],
      "node_version": "v22.14.0",
      "runtime_mode": "openclaw",
      "tool_availability": {
        "chat_realtime": true,
        "files_realtime": true,
        "notifications_realtime": true
      }
    },
    "host": {
      "fingerprint": "a3f56f330f311a2159f8c101eaf1439a29f1d57f007375d56aa79f304bc4f112",
      "name": "worker-01",
      "meta": {
        "hostname": "worker-01",
        "ip": "10.0.2.15",
        "network": {
          "private_ip": "10.0.2.15",
          "public_ip": "34.222.10.10"
        },
        "os": "Ubuntu",
        "os_version": "24.04",
        "arch": "x86_64",
        "cpu": "Intel Xeon",
        "cpu_cores": 8,
        "ram_gb": 32,
        "disk": {
          "total_bytes": 536870912000,
          "free_bytes": 322122547200
        },
        "uptime_seconds": 86400,
        "runtime": {
          "name": "codex",
          "version": "2026.02.1"
        }
      }
    },
    "agent": {
      "id": 42,
      "name": "Jarvis",
      "identity": {
        "name": "Jarvis",
        "creature": "robot",
        "vibe": "calm"
      }
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
