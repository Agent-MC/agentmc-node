import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.completeRecurringTaskRun({
  "params": {
    "path": {
      "run": 1
    }
  },
  "body": {
    "status": "success",
    "claim_token": "e3ec996c-c53f-4bfa-89e3-5d9cbf71397f",
    "summary": "Scheduled review completed and updated 2 tasks.",
    "runtime_meta": {
      "provider": "openclaw",
      "request_id": "req_01JBPXXRM6JYAVY82ECAQ7QNA4"
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
