import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.createFileUpload({
  "body": {
    "filename": "incident-timeline.md",
    "byte_size": 14220,
    "mime_type": "text/markdown",
    "checksum_sha256": "43f88f3c4bf62933800d6f65dc8d9e2fbb2d930fd6134fc4ead6222b5d5f3bc5"
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
