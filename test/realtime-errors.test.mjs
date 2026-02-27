import assert from "node:assert/strict";
import test from "node:test";

import { publishRealtimeMessage } from "../dist/index.js";

test("publishRealtimeMessage redacts backend error payload details", async () => {
  const secret = "sk_live_backend_secret_value";
  const client = {
    operations: {
      createAgentRealtimeSignal: async () => ({
        error: {
          message: "backend failure",
          token: secret,
          nested: { authorization: `Token ${secret}` }
        },
        status: 500
      })
    }
  };

  await assert.rejects(
    () =>
      publishRealtimeMessage(client, {
        agent: 7,
        session: 42,
        channelType: "chat.user",
        payload: {
          content: "hello"
        }
      }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(
        error.message,
        "createAgentRealtimeSignal failed with status 500."
      );
      assert.equal(error.message.includes(secret), false);
      assert.equal(error.message.includes("authorization"), false);
      return true;
    }
  );
});
