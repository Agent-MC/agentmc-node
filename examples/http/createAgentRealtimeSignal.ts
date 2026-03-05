import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.createAgentRealtimeSignal({
  "params": {
    "path": {
      "session": 1
    }
  },
  "body": {
    "type": "message",
    "payload": {
      "type": "chat.user",
      "payload": {
        "content": "Create an AgentMC task for this afternoon to draft the postmortem outline.\n\n![incident-chart](/api/v1/files/101/preview)",
        "message_id": 512,
        "timezone": "America/Los_Angeles",
        "source": "agentmc_chat",
        "intent_scope": "agentmc"
      }
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
