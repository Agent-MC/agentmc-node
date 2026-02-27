# listHosts

- Method: `GET`
- Path: `/hosts`
- Summary: List hosts for the current team.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

Returns host records with connectivity state and machine metadata fields (meta) used for host diagnostics.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| per_page | query | no | Page size for paginated responses. | 25 |
| status | query | no | Current lifecycle status for this record. Allowed values: online, offline. | "online" |
| search | query | no | Case-insensitive text search query. | "operations" |

## Request Example

None.

## Success Responses

### 200 (application/json)
Host list returned.

```json
{
  "data": [
    {
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

const result = await client.operations.listHosts({
  "params": {
    "query": {
      "per_page": 25,
      "status": "online",
      "search": "operations"
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
