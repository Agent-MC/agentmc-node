# showHost

- Method: `GET`
- Path: `/hosts/{id}`
- Summary: Show one host.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

Returns one host record including id/team/name/fingerprint, status + last_seen_at, metadata snapshot, and assigned-agent totals.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| id | path | yes | Host identifier. | 42 |
| agents_per_page | query | no | Agents per page. | 25 |

## Request Example

None.

## Success Responses

### 200 (application/json)
Host returned.

```json
{
  "data": {
    "id": 42,
    "team_id": 42,
    "name": "Example Name",
    "fingerprint": "a3f56f330f311a2159f8c101eaf1439a29f1d57f007375d56aa79f304bc4f112",
    "status": "online",
    "last_seen_at": "2026-02-22T17:21:00Z",
    "meta": {
      "hostname": "worker-01",
      "ip": "10.0.2.15",
      "os": "Ubuntu",
      "arch": "x86_64",
      "cpu": "Intel Xeon",
      "ram_gb": 32,
      "runtime": {
        "name": "openclaw",
        "version": "1.14.2"
      }
    },
    "created_by_user_id": 42,
    "agents_total": 1,
    "agents_online": 1,
    "created_at": "2026-02-22T17:21:00Z",
    "updated_at": "2026-02-22T17:21:00Z"
  },
  "agents": [
    {
      "id": 42,
      "team_id": 42,
      "host_id": 42,
      "name": "Example Name",
      "status": "online",
      "meta": {
        "key": "value"
      },
      "tasks_count": 0,
      "last_seen_at": "2026-02-22T17:21:00Z",
      "created_at": "2026-02-22T17:21:00Z",
      "updated_at": "2026-02-22T17:21:00Z"
    }
  ],
  "agents_meta": {
    "current_page": 1,
    "last_page": 1,
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

const result = await client.operations.showHost({
  "params": {
    "path": {
      "id": 42
    },
    "query": {
      "agents_per_page": 25
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
