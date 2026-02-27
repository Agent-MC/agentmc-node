import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.createCalendarItem({
  "body": {
    "type": "task",
    "title": "Review outage timeline",
    "description": "Confirm sequence of events with on-call notes.",
    "due_at": "2026-02-24T09:00:00Z",
    "timezone": "America/Los_Angeles",
    "status": "todo",
    "priority": "high",
    "visibility": "team",
    "assignees": [
      {
        "assignee_type": "user",
        "assignee_id": 8,
        "role": "owner"
      }
    ]
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
