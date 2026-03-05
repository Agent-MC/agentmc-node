import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.updateTaskComment({
  "params": {
    "path": {
      "task": 1,
      "comment": 1
    }
  },
  "body": {
    "body": "Updated handoff note with the latest timeline and log links."
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
