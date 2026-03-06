import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.markNotificationRead({
  "params": {
    "path": {
      "notification": "11111111-1111-4111-8111-111111111111"
    },
    "header": {
      "X-Agent-Id": 1
    },
    "query": {
      "agent_id": 42
    }
  },
  "body": {}
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
