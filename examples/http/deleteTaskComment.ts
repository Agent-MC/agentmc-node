import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.deleteTaskComment({
  "params": {
    "path": {
      "task": 1,
      "comment": 1
    },
    "header": {
      "X-Agent-Id": 1
    },
    "query": {
      "agent_id": 1
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
