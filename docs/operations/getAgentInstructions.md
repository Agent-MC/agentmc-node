# getAgentInstructions

- Method: `GET`
- Path: `/agents/instructions`
- Summary: Fetch the AgentMC instruction bundle for the authenticated agent.
- Auth: ApiKeyAuth OR SessionCookieAuth

## Description

Returns managed runtime files and bundle metadata. Send current_bundle_version to fetch files only when the bundle has changed.

## Parameters

| Name | In | Required | Description | Example |
| --- | --- | --- | --- | --- |
| current_bundle_version | query | no | Last applied instruction bundle version from local runtime state. | "bundle_2fa07fcadd6575cc" |

## Request Example

None.

## Success Responses

### 200 (none)
Instruction bundle returned.

```text
No response body.
```


## Error Responses

### 401 (none)
Missing or invalid credentials.

```text
No response body.
```

### 403 (none)
Forbidden.

```text
No response body.
```

### 422 (none)
Validation failed.

```text
No response body.
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
