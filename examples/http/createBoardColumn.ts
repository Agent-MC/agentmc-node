import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.createBoardColumn({
  "params": {
    "path": {
      "board": 1
    }
  },
  "body": {
    "name": "In Progress",
    "position": 2
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
