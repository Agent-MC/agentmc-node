import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.createFile({
  "body": {
    "upload_id": "tup_8f4f7f3f836d43d28c4f7311a48258f5",
    "display_name": "incident-timeline.md",
    "folder_id": 12,
    "owner_agent_id": 42
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
