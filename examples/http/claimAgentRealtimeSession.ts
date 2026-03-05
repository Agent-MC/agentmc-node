import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.claimAgentRealtimeSession({
  "params": {
    "path": {
      "session": 1
    }
  },
  "body": {
    "owner_token": "agent-claim:16f40b2b5dfb20c9af20db9f0d6d7b61"
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
