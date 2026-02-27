import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.updateCalendarItem({
  "params": {
    "path": {
      "item": 1
    }
  },
  "body": {
    "title": "Review outage timeline",
    "description": "Add links to root-cause analysis notes.",
    "due_at": "2026-02-24T11:00:00Z",
    "status": "in_progress",
    "priority": "urgent",
    "visibility": "team"
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
