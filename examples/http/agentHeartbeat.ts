import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.agentHeartbeat({
  "params": {
    "header": {
      "X-Host-Fingerprint": "a3f56f330f311a2159f8c101eaf1439a29f1d57f007375d56aa79f304bc4f112"
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
