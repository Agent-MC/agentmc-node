import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi();

const result = await client.operations.getAgentsInstructions({
  "params": {
    "query": {
      "current_bundle_version": "example",
      "agent_id": 42
    },
    "header": {
      "X-Agent-Id": 1
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
