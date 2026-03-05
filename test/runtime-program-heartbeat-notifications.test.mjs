import assert from "node:assert/strict";
import test from "node:test";

import { AgentRuntimeProgram } from "../dist/index.js";

test("heartbeat notification catch-up polls unread notifications and forwards them to the runtime", async () => {
  const notification = {
    id: "4c08909f-1ccb-48a2-9e73-9346f2300886",
    notification_type: "mention",
    message: "Please review this heartbeat catch-up.",
    is_read: false
  };

  const listNotificationsCalls = [];
  const ingestCalls = [];

  const runtime = new AgentRuntimeProgram({
    client: {
      operations: {
        listNotifications: async (input = {}) => {
          listNotificationsCalls.push(input);
          return {
            error: null,
            status: 200,
            response: new Response(),
            data: {
              data: [notification]
            }
          };
        }
      }
    }
  });

  runtime.realtimeRuntime = {
    ingestNotificationsFromApi: async (rows, options) => {
      ingestCalls.push({ rows, options });
      return {
        source: options?.source ?? "api_poll",
        sessionId: 91,
        totalReceived: rows.length,
        processed: rows.length,
        skipped: 0
      };
    }
  };

  await runtime.catchUpNotificationsDuringHeartbeat(42);

  assert.equal(listNotificationsCalls.length, 1);
  assert.deepEqual(listNotificationsCalls[0]?.params?.query, {
    unread: true,
    per_page: 50,
    page: 1
  });
  assert.deepEqual(listNotificationsCalls[0]?.headers, {
    "X-Agent-Id": "42"
  });

  assert.equal(ingestCalls.length, 1);
  assert.deepEqual(ingestCalls[0], {
    rows: [notification],
    options: { source: "api_poll" }
  });
});
