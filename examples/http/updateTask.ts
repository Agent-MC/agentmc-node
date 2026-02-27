import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.updateTask({
  "params": {
    "path": {
      "task": 1
    }
  },
  "body": {
    "title": "Draft post-incident summary",
    "archived_at": "2026-02-25T12:45:00Z",
    "due_at": "2026-02-24T19:00:00Z",
    "assigned_to_agent_id": 42
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
