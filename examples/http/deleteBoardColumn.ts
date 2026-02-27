import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.deleteBoardColumn({
  "params": {
    "path": {
      "board": 1
    }
  },
  "body": {
    "column_id": 13
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
