import assert from "node:assert/strict";
import test from "node:test";

import { AgentMCApi } from "../dist/index.js";

test("mixed-scheme operations send only one auth header", async () => {
  let capturedHeaders = null;

  const client = new AgentMCApi({
    apiKey: "mca_test_key",
    fetch: async (input, init) => {
      const requestHeaders =
        init?.headers ??
        (input instanceof Request ? input.headers : undefined);
      capturedHeaders = new Headers(requestHeaders);

      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    }
  });

  await client.operations.listBoards();

  assert.ok(capturedHeaders, "expected request headers to be captured");
  assert.equal(capturedHeaders.get("x-api-key"), "mca_test_key");
  assert.equal(capturedHeaders.has("authorization"), false);
});
