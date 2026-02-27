import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.closeAgentRealtimeSession({
  "params": {
    "path": {
      "session": 1
    }
  },
  "body": {
    "reason": "runtime_shutdown",
    "status": "closed",
    "payload": {
      "request_id": "req_92b3f2",
      "note": "Session closed by runtime during reconnect."
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
