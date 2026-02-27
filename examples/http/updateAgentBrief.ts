import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.updateAgentBrief({
  "params": {
    "path": {
      "id": 42
    }
  },
  "body": {
    "brief": {
      "name": "Daily Operations Brief",
      "summary": "Operations handoff digest for the morning window.",
      "timezone": "America/Los_Angeles",
      "sections": [
        {
          "key": "incidents",
          "label": "Incidents"
        },
        {
          "key": "followups",
          "label": "Follow-ups"
        }
      ],
      "content_markdown": "## Updates\n- Incident queue cleared\n- Follow-up tasks assigned",
      "meta": {
        "external_source": "daily-ops-job",
        "schedule": "0 7 * * *"
      }
    },
    "source": {
      "agent_id": 42,
      "meta": {
        "runtime": "codex"
      }
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
