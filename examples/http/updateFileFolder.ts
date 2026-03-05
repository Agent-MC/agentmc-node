import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.updateFileFolder({
  "params": {
    "path": {
      "id": 42
    }
  },
  "body": {
    "name": "Incident Runbooks",
    "parent_id": null
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
