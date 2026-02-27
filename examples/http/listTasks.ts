import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.listTasks({
  "params": {
    "query": {
      "board_id": 42,
      "archived": true,
      "assigned_to_user_id": 42,
      "assigned_to_agent": 1,
      "agent_id": 42,
      "due_from": "2026-02-22T17:21:00Z",
      "due_to": "2026-02-22T17:21:00Z",
      "per_page": 25
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
