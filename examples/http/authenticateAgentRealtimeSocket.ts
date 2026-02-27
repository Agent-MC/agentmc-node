import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.authenticateAgentRealtimeSocket({
  "params": {
    "path": {
      "session": 1
    }
  },
  "body": {
    "socket_id": "1234.567890",
    "channel_name": "private-agent-realtime.7.42"
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
