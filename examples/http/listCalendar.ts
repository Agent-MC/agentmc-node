import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.listCalendar({
  "params": {
    "query": {
      "view": "month",
      "start": "2026-02-22T17:21:00Z",
      "end": "2026-02-22T17:21:00Z",
      "type": "event",
      "status": "todo",
      "priority": "low",
      "assignee": "example",
      "q": "retro",
      "per_page": 25
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
