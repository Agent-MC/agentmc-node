import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.listFiles({
  "params": {
    "query": {
      "q": "retro",
      "folder_id": 42,
      "owner_agent_id": 42,
      "mime_group": "text",
      "sort": "updated_at",
      "direction": "asc",
      "per_page": 25
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
