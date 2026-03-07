import assert from "node:assert/strict";
import test from "node:test";

import { AgentMCApi } from "../dist/index.js";

test("mixed-scheme operations send only one auth header", async () => {
  let capturedHeaders = null;

  const client = new AgentMCApi({
    apiKey: "cc_test_key",
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
  assert.equal(capturedHeaders.get("x-api-key"), "cc_test_key");
  assert.equal(capturedHeaders.has("authorization"), false);
});

test("client normalizes blank config values to safe defaults", async () => {
  let capturedHeaders = null;

  const client = new AgentMCApi({
    baseUrl: "   ",
    apiKey: "  cc_test_key  ",
    userAgent: "   ",
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

  assert.equal(client.getBaseUrl(), "https://agentmc.ai/api/v1");
  assert.equal(client.getOpenApiUrl(), "https://agentmc.ai/api/openapi.json");
  assert.equal(client.getConfiguredApiKey(), "cc_test_key");

  await client.operations.listBoards();

  assert.ok(capturedHeaders, "expected request headers to be captured");
  assert.equal(capturedHeaders.get("x-api-key"), "cc_test_key");
  assert.match(capturedHeaders.get("user-agent") ?? "", /Mozilla\/5\.0/);
});

test("per-request auth overrides are trimmed before sending", async () => {
  let capturedHeaders = null;

  const client = new AgentMCApi({
    apiKey: "fallback_key",
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

  await client.operations.listBoards({
    auth: {
      apiKey: "  override_key  "
    }
  });

  assert.ok(capturedHeaders, "expected request headers to be captured");
  assert.equal(capturedHeaders.get("x-api-key"), "override_key");
});
