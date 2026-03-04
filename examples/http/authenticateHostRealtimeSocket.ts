import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.authenticateHostRealtimeSocket({
  "body": {
    "socket_id": "1234.567890",
    "channel_name": "private-agent-realtime-host.12"
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
