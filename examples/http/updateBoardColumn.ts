import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.updateBoardColumn({
  "params": {
    "path": {
      "board": 1
    }
  },
  "body": {
    "column_id": 13,
    "name": "Review",
    "position": 3
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
