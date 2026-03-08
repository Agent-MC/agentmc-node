import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.commentCalendarItem({
  "params": {
    "path": {
      "item": 1
    },
    "header": {
      "X-Agent-Id": 1
    },
    "query": {
      "agent_id": 42
    }
  },
  "body": {
    "body": "Added links to logs and timeline document.\n\n![handoff](/api/v1/files/101/preview)",
    "actor_type": "agent",
    "actor_id": 42
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
