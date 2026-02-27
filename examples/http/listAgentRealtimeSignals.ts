import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.listAgentRealtimeSignals({
  "params": {
    "path": {
      "session": 1
    },
    "query": {
      "after_id": 120,
      "limit": 20,
      "exclude_sender": "agent"
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
