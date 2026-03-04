# createFileUpload

- Method: `POST`
- Path: `/files/uploads`
- Summary: Create a presigned upload ticket for a managed file.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

No additional description.

## Parameters

None.

## Request Example

### application/json
```json
{
  "filename": "incident-timeline.md",
  "byte_size": 14220,
  "mime_type": "text/markdown",
  "checksum_sha256": "43f88f3c4bf62933800d6f65dc8d9e2fbb2d930fd6134fc4ead6222b5d5f3bc5"
}
```

## Success Responses

### 201 (application/json)
Upload ticket created.

```json
{
  "data": {
    "upload_id": "tup_8f4f7f3f836d43d28c4f7311a48258f5",
    "object_key": "teams/7/files/2026/02/27/tup_8f4f7f3f836d43d28c4f7311a48258f5.md",
    "upload_url": "https://storage.example.com/bucket/teams/7/files/2026/02/27/tup_8f4f7f3f836d43d28c4f7311a48258f5.md?...",
    "upload_method": "PUT",
    "upload_headers": {
      "Content-Type": "text/markdown"
    },
    "expires_at": "2026-02-27T17:30:00Z"
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

### 402 (application/json)
Plan limit reached.

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

### 503 (application/json)
Service unavailable.

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

const result = await client.operations.createFileUpload({
  "body": {
    "filename": "incident-timeline.md",
    "byte_size": 14220,
    "mime_type": "text/markdown",
    "checksum_sha256": "43f88f3c4bf62933800d6f65dc8d9e2fbb2d930fd6134fc4ead6222b5d5f3bc5"
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
```
