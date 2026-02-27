import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.createTask({
  "body": {
    "board_id": 5,
    "column_id": 13,
    "title": "Draft post-incident summary",
    "description": "Capture timeline, impact, and remediation status.",
    "archived_at": null,
    "position": 2,
    "due_at": "2026-02-24T17:00:00Z",
    "assigned_to_user_id": 8
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
