import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.updateFile({
  "params": {
    "path": {
      "id": 42
    }
  },
  "body": {
    "display_name": "incident-timeline-v2.md",
    "folder_id": 14,
    "owner_agent_id": null
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
