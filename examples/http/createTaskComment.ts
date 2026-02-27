import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.createTaskComment({
  "params": {
    "path": {
      "task": 1
    }
  },
  "body": {
    "body": "Posting a handoff note for [@Alex Morgan](/mentions/user/8) to review before standup.",
    "actor_type": "agent",
    "actor_id": 42
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
