import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { OpenClawAgentRuntime } from "../dist/index.js";

function createRuntime(sessionsPath, runtimeDocsDirectory, overrides = {}) {
  return new OpenClawAgentRuntime({
    client: { operations: {} },
    agent: 114,
    openclawAgent: "main",
    openclawSessionsPath: sessionsPath,
    runtimeDocsDirectory,
    ...overrides
  });
}

async function withFixture(run) {
  const dir = await mkdtemp(join(tmpdir(), "agentmc-openclaw-runtime-test-"));
  try {
    await run({
      dir,
      sessionsPath: join(dir, "sessions.json")
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function readLatestAssistantText(runtime, sessionKey) {
  return runtime.readLatestAssistantText(sessionKey);
}

function createSessionState(sessionId = 114) {
  return {
    sessionId,
    session: null,
    subscription: null,
    closed: false,
    closeReason: null,
    lastSignalId: 0,
    lastNonAgentSignalId: 0,
    connectionState: "connected",
    lastSignalPollAtMs: 0,
    nextSignalPollAtMs: 0,
    lastSignalRateLimitLogAtMs: 0,
    sawConnectedState: true,
    processedInboundKeys: new Map()
  };
}

test("polling cursor does not skip non-agent signals after agent websocket ids", async () => {
  await withFixture(async ({ dir, sessionsPath }) => {
    const requestedAfterIds = [];
    const notifications = [];

    const runtime = createRuntime(sessionsPath, dir, {
      client: {
        operations: {
          listAgentRealtimeSignals: async ({ params }) => {
            requestedAfterIds.push(params?.query?.after_id ?? null);

            return {
              error: null,
              status: 200,
              data: {
                data: [
                  {
                    id: 9,
                    session_id: 114,
                    sender: "system",
                    type: "message",
                    payload: {
                      type: "notification.created",
                      payload: {
                        notification: {
                          id: "notif-9",
                          notification_type: "mention",
                          is_read: false
                        }
                      }
                    },
                    created_at: null
                  }
                ]
              }
            };
          }
        }
      },
      onNotification: (event) => {
        notifications.push(event);
      }
    });

    const state = createSessionState();

    await runtime.handleSignal(
      state,
      {
        id: 10,
        session_id: 114,
        sender: "agent",
        type: "message",
        payload: {
          type: "chat.agent.delta",
          payload: {
            content: "thinking"
          }
        },
        created_at: null
      },
      "websocket"
    );

    await runtime.pollSessionSignals(state, "poll");

    assert.equal(requestedAfterIds[0], null);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]?.signal?.id, 9);
    assert.equal(state.lastSignalId, 10);
    assert.equal(state.lastNonAgentSignalId, 9);
  });
});

test("parses top-level keyed session map", async () => {
  await withFixture(async ({ dir, sessionsPath }) => {
    const sessionKey = "agent:main:agentmc:114";
    await writeFile(
      sessionsPath,
      JSON.stringify({
        [sessionKey]: {
          sessionId: "114",
          messages: [{ role: "assistant", content: "Top-level map works." }]
        }
      }),
      "utf8"
    );

    const runtime = createRuntime(sessionsPath, dir);
    const text = await readLatestAssistantText(runtime, sessionKey);

    assert.equal(text, "Top-level map works.");
  });
});

test("uses sessionFile JSONL when inline messages are absent", async () => {
  await withFixture(async ({ dir, sessionsPath }) => {
    const sessionKey = "agent:main:agentmc:114";
    const sessionFile = "114.jsonl";
    await writeFile(
      sessionsPath,
      JSON.stringify({
        [sessionKey]: {
          sessionId: "114",
          sessionFile
        }
      }),
      "utf8"
    );

    await writeFile(
      join(dir, sessionFile),
      `${JSON.stringify({ message: { role: "assistant", content: "JSONL assistant text." } })}\n`,
      "utf8"
    );

    const runtime = createRuntime(sessionsPath, dir);
    const text = await readLatestAssistantText(runtime, sessionKey);

    assert.equal(text, "JSONL assistant text.");
  });
});

test("ignores malformed JSONL lines and continues scanning older entries", async () => {
  await withFixture(async ({ dir, sessionsPath }) => {
    const sessionKey = "agent:main:agentmc:114";
    const sessionFile = join(dir, "114.jsonl");
    await writeFile(
      sessionsPath,
      JSON.stringify({
        [sessionKey]: {
          key: sessionKey,
          sessionFile
        }
      }),
      "utf8"
    );

    await writeFile(
      sessionFile,
      `${JSON.stringify({ message: { role: "assistant", content: "Recovered from older JSONL entry." } })}\n{bad json line}\n`,
      "utf8"
    );

    const runtime = createRuntime(sessionsPath, dir);
    const text = await readLatestAssistantText(runtime, sessionKey);

    assert.equal(text, "Recovered from older JSONL entry.");
  });
});

test("returns visible assistant text while skipping thinking/debug blocks", async () => {
  await withFixture(async ({ dir, sessionsPath }) => {
    const sessionKey = "agent:main:agentmc:114";
    const sessionFile = join(dir, "114.jsonl");
    await writeFile(
      sessionsPath,
      JSON.stringify({
        [sessionKey]: {
          key: sessionKey,
          sessionFile
        }
      }),
      "utf8"
    );

    await writeFile(
      sessionFile,
      `${JSON.stringify({
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "internal trace" },
            { type: "text", text: "Visible assistant output." }
          ]
        }
      })}\n`,
      "utf8"
    );

    const runtime = createRuntime(sessionsPath, dir);
    const text = await readLatestAssistantText(runtime, sessionKey);

    assert.equal(text, "Visible assistant output.");
  });
});

test("strips reply prefixes from assistant content", async () => {
  await withFixture(async ({ dir, sessionsPath }) => {
    const sessionKey = "agent:main:agentmc:114";
    await writeFile(
      sessionsPath,
      JSON.stringify({
        [sessionKey]: {
          key: sessionKey,
          messages: [{ role: "assistant", content: "` Hello" }]
        }
      }),
      "utf8"
    );

    const runtime = createRuntime(sessionsPath, dir);
    const text = await readLatestAssistantText(runtime, sessionKey);

    assert.equal(text, "Hello");
  });
});

test("strips leading [[reply_to_current]] control token from assistant content", async () => {
  await withFixture(async ({ dir, sessionsPath }) => {
    const sessionKey = "agent:main:agentmc:114";
    await writeFile(
      sessionsPath,
      JSON.stringify({
        [sessionKey]: {
          key: sessionKey,
          messages: [{ role: "assistant", content: "[[reply_to_current]] Final answer." }]
        }
      }),
      "utf8"
    );

    const runtime = createRuntime(sessionsPath, dir);
    const text = await readLatestAssistantText(runtime, sessionKey);

    assert.equal(text, "Final answer.");
  });
});

test("strips leading [[reply_to:...]] control token from assistant content", async () => {
  await withFixture(async ({ dir, sessionsPath }) => {
    const sessionKey = "agent:main:agentmc:114";
    await writeFile(
      sessionsPath,
      JSON.stringify({
        [sessionKey]: {
          key: sessionKey,
          messages: [{ role: "assistant", content: "[[reply_to: chat.user:11]] Final answer." }]
        }
      }),
      "utf8"
    );

    const runtime = createRuntime(sessionsPath, dir);
    const text = await readLatestAssistantText(runtime, sessionKey);

    assert.equal(text, "Final answer.");
  });
});

test("does not strip normal bracketed text", async () => {
  await withFixture(async ({ dir, sessionsPath }) => {
    const sessionKey = "agent:main:agentmc:114";
    await writeFile(
      sessionsPath,
      JSON.stringify({
        [sessionKey]: {
          key: sessionKey,
          messages: [{ role: "assistant", content: "[[note]] Keep this exactly." }]
        }
      }),
      "utf8"
    );

    const runtime = createRuntime(sessionsPath, dir);
    const text = await readLatestAssistantText(runtime, sessionKey);

    assert.equal(text, "[[note]] Keep this exactly.");
  });
});

test("falls back to session history when wait text is only a control tag", async () => {
  await withFixture(async ({ dir, sessionsPath }) => {
    const runtime = createRuntime(sessionsPath, dir);
    runtime.gatewayCall = async (method) => {
      if (method === "agent") {
        return { runId: "run-1" };
      }
      if (method === "agent.wait") {
        return { status: "ok", content: " [[reply_to_current]] " };
      }
      throw new Error(`Unexpected gateway method: ${method}`);
    };
    runtime.readLatestAssistantText = async () => "History assistant text.";

    const result = await runtime.runOpenClawChat({
      sessionId: 114,
      requestId: "req-1",
      userText: "hello"
    });

    assert.equal(result.textSource, "session_history");
    assert.equal(result.content, "History assistant text.");
  });
});

test("prefers top-level run response shape over nested wrapper payloads", async () => {
  await withFixture(async ({ dir, sessionsPath }) => {
    const openclawStubPath = join(dir, "openclaw-stub.mjs");
    await writeFile(
      openclawStubPath,
      `#!/usr/bin/env node
const method = process.argv[4];
const paramsIndex = process.argv.indexOf("--params");
const rawParams = paramsIndex >= 0 ? process.argv[paramsIndex + 1] : "{}";
const params = JSON.parse(rawParams);

if (method === "agent") {
  process.stdout.write(JSON.stringify({
    runId: "run-top-level",
    status: "accepted",
    acceptedAt: "2026-02-26T00:00:00.000Z",
    result: { runId: "run-from-wrapper" }
  }));
  process.exit(0);
}

if (method === "agent.wait") {
  process.stdout.write(JSON.stringify({
    status: "ok",
    content: "waited for " + String(params.runId || "")
  }));
  process.exit(0);
}

process.stderr.write("Unexpected method: " + String(method));
process.exit(1);
`,
      "utf8"
    );
    await chmod(openclawStubPath, 0o755);

    const runtime = createRuntime(sessionsPath, dir, {
      openclawCommand: openclawStubPath
    });

    const result = await runtime.runOpenClawChat({
      sessionId: 114,
      requestId: "req-shape",
      userText: "hello"
    });

    assert.equal(result.runId, "run-top-level");
    assert.equal(result.content, "waited for run-top-level");
  });
});

test("bridges unread notification events into OpenClaw runs", async () => {
  await withFixture(async ({ dir, sessionsPath }) => {
    const runtime = createRuntime(sessionsPath, dir);
    let capturedInput = null;
    const markedReadIds = [];

    runtime.runOpenClawChat = async (input) => {
      capturedInput = input;
      return {
        requestId: input.requestId,
        runId: "run-notification",
        status: "ok",
        textSource: "wait",
        content: "handled"
      };
    };
    runtime.options.client.operations.markNotificationRead = async ({ params }) => {
      markedReadIds.push(params?.path?.notification ?? null);
      return {
        error: null,
        status: 200,
        data: { data: { id: params?.path?.notification ?? null, is_read: true } }
      };
    };

    await runtime.maybeBridgeNotificationToAi(createSessionState(), {
      source: "websocket",
      signal: {
        id: 21,
        session_id: 114,
        sender: "system",
        type: "message",
        payload: {
          type: "notification.created",
          payload: {
            source: "agentmc_notification",
            intent_scope: "agentmc"
          }
        },
        created_at: null
      },
      notification: {
        id: "c084fc57-b2c6-466c-adcb-cf6f4efca42a",
        notification_type: "mention",
        message: "Please reply on task #121",
        is_read: false,
        response_action: {
          type: "post_comment_reply",
          method: "POST",
          path: "/tasks/121/comments",
          request_body: {
            body: "Thanks, on it."
          }
        }
      },
      notificationType: "mention",
      channelType: "notification.created"
    });

    assert.equal(capturedInput?.requestId, "notification-c084fc57-b2c6-466c-adcb-cf6f4efca42a");
    assert.match(capturedInput?.userText ?? "", /You received an AgentMC realtime notification\./);
    assert.match(capturedInput?.userText ?? "", /response_action JSON:/);
    assert.deepEqual(markedReadIds, ["c084fc57-b2c6-466c-adcb-cf6f4efca42a"]);
  });
});

test("subscription onNotification events are routed into OpenClaw runs", async () => {
  await withFixture(async ({ dir, sessionsPath }) => {
    const runtime = createRuntime(sessionsPath, dir);
    let capturedInput = null;

    runtime.runOpenClawChat = async (input) => {
      capturedInput = input;
      return {
        requestId: input.requestId,
        runId: "run-subscription-notification",
        status: "ok",
        textSource: "wait",
        content: "handled"
      };
    };

    await runtime.handleSubscriptionNotification(createSessionState(), {
      signal: {
        id: 31,
        session_id: 114,
        sender: "system",
        type: "message",
        payload: {
          type: "notification.created",
          payload: {
            source: "agentmc_notification",
            intent_scope: "agentmc"
          }
        },
        created_at: null
      },
      notification: {
        id: "f8c938dd-4c67-4eb4-a978-d5141d1229dc",
        notification_type: "mention",
        message: "Please review this PR",
        is_read: false
      },
      notificationType: "mention",
      channelType: "notification.created"
    });

    assert.equal(capturedInput?.requestId, "notification-f8c938dd-4c67-4eb4-a978-d5141d1229dc");
    assert.match(capturedInput?.userText ?? "", /You received an AgentMC realtime notification\./);
  });
});

test("websocket notification signals are routed into OpenClaw runs from handleSignal", async () => {
  await withFixture(async ({ dir, sessionsPath }) => {
    const runtime = createRuntime(sessionsPath, dir);
    let capturedInput = null;

    runtime.runOpenClawChat = async (input) => {
      capturedInput = input;
      return {
        requestId: input.requestId,
        runId: "run-handle-signal-notification",
        status: "ok",
        textSource: "wait",
        content: "handled"
      };
    };

    await runtime.handleSignal(
      createSessionState(),
      {
        id: 32,
        session_id: 114,
        sender: "browser",
        type: "message",
        payload: {
          type: "notification.created",
          payload: {
            notification: {
              id: "edcbf13d-8d69-42b4-9f1d-adcae952bc2a",
              notification_type: "mention",
              message: "Please confirm this was routed to OpenClaw.",
              is_read: false
            }
          }
        },
        created_at: null
      },
      "websocket"
    );

    assert.equal(capturedInput?.requestId, "notification-edcbf13d-8d69-42b4-9f1d-adcae952bc2a");
    assert.match(capturedInput?.userText ?? "", /You received an AgentMC realtime notification\./);
  });
});

test("websocket notification bridge dedupes between signal and subscription callbacks", async () => {
  await withFixture(async ({ dir, sessionsPath }) => {
    const runtime = createRuntime(sessionsPath, dir);
    let runCount = 0;

    runtime.runOpenClawChat = async (input) => {
      runCount += 1;
      return {
        requestId: input.requestId,
        runId: "run-deduped-notification",
        status: "ok",
        textSource: "wait",
        content: "handled"
      };
    };

    const state = createSessionState();
    const signal = {
      id: 33,
      session_id: 114,
      sender: "browser",
      type: "message",
      payload: {
        type: "notification.created",
        payload: {
          notification: {
            id: "0f599fe2-f95d-4cfa-b0e4-542f81ebad7c",
            notification_type: "mention",
            message: "Ensure dedupe across callbacks.",
            is_read: false
          }
        }
      },
      created_at: null
    };

    await runtime.handleSignal(state, signal, "websocket");
    await runtime.handleSubscriptionNotification(state, {
      signal,
      notification: signal.payload.payload.notification,
      notificationType: "mention",
      channelType: "notification.created"
    });

    assert.equal(runCount, 1);
  });
});

test("does not bridge read notifications by default", async () => {
  await withFixture(async ({ dir, sessionsPath }) => {
    const runtime = createRuntime(sessionsPath, dir);
    let wasInvoked = false;

    runtime.runOpenClawChat = async () => {
      wasInvoked = true;
      return {
        requestId: "ignored",
        runId: "ignored",
        status: "ok",
        textSource: "wait",
        content: "ignored"
      };
    };

    await runtime.maybeBridgeNotificationToAi(createSessionState(), {
      source: "websocket",
      signal: {
        id: 22,
        session_id: 114,
        sender: "system",
        type: "message",
        payload: {
          type: "notification.updated",
          payload: {}
        },
        created_at: null
      },
      notification: {
        id: "c084fc57-b2c6-466c-adcb-cf6f4efca42a",
        notification_type: "mention",
        message: "Already read",
        is_read: true
      },
      notificationType: "mention",
      channelType: "notification.updated"
    });

    assert.equal(wasInvoked, false);
  });
});

test("does not mark notification read when bridge run is unsuccessful", async () => {
  await withFixture(async ({ dir, sessionsPath }) => {
    const runtime = createRuntime(sessionsPath, dir);
    let markReadCallCount = 0;

    runtime.runOpenClawChat = async (input) => ({
      requestId: input.requestId,
      runId: "run-error",
      status: "error",
      textSource: "error",
      content: "failed"
    });
    runtime.options.client.operations.markNotificationRead = async () => {
      markReadCallCount += 1;
      return {
        error: null,
        status: 200,
        data: { data: { is_read: true } }
      };
    };

    await runtime.maybeBridgeNotificationToAi(createSessionState(), {
      source: "websocket",
      signal: {
        id: 45,
        session_id: 114,
        sender: "system",
        type: "message",
        payload: {
          type: "notification.created",
          payload: {}
        },
        created_at: null
      },
      notification: {
        id: "449f0ccc-0ca7-49c0-8bc9-49f20f0fd82e",
        notification_type: "mention",
        message: "This should not mark as read on bridge error.",
        is_read: false
      },
      notificationType: "mention",
      channelType: "notification.created"
    });

    assert.equal(markReadCallCount, 0);
  });
});

test("chat handling can be disabled independently from realtime docs/notifications", async () => {
  await withFixture(async ({ dir, sessionsPath }) => {
    let openclawRunCount = 0;
    const unhandled = [];
    const runtime = createRuntime(sessionsPath, dir, {
      chatRealtimeEnabled: false,
      onUnhandledMessage: (event) => {
        unhandled.push(event);
      }
    });

    runtime.runOpenClawChat = async (input) => {
      openclawRunCount += 1;
      return {
        requestId: input.requestId,
        runId: "run-chat-disabled",
        status: "ok",
        textSource: "wait",
        content: "unused"
      };
    };

    await runtime.handleSignal(
      createSessionState(),
      {
        id: 501,
        session_id: 114,
        sender: "browser",
        type: "message",
        payload: {
          type: "chat.user",
          payload: {
            request_id: "req-disabled-chat",
            content: "hello"
          }
        },
        created_at: null
      },
      "websocket"
    );

    assert.equal(openclawRunCount, 0);
    assert.equal(unhandled.length, 1);
    assert.equal(unhandled[0]?.channelType, "chat.user");
  });
});

test("docs handling can be disabled independently from realtime chat/notifications", async () => {
  await withFixture(async ({ dir, sessionsPath }) => {
    let snapshotSendCount = 0;
    const unhandled = [];
    const runtime = createRuntime(sessionsPath, dir, {
      docsRealtimeEnabled: false,
      onUnhandledMessage: (event) => {
        unhandled.push(event);
      }
    });

    runtime.sendSnapshotResponse = async () => {
      snapshotSendCount += 1;
    };

    await runtime.handleSignal(
      createSessionState(),
      {
        id: 601,
        session_id: 114,
        sender: "browser",
        type: "message",
        payload: {
          type: "snapshot.request",
          payload: {
            request_id: "req-disabled-docs"
          }
        },
        created_at: null
      },
      "websocket"
    );

    assert.equal(snapshotSendCount, 0);
    assert.equal(unhandled.length, 1);
    assert.equal(unhandled[0]?.channelType, "snapshot.request");
  });
});

test("agent profile update messages execute OpenClaw set-identity and ack success", async () => {
  await withFixture(async ({ dir, sessionsPath }) => {
    const openclawStubPath = join(dir, "openclaw-profile-stub.mjs");
    await writeFile(
      openclawStubPath,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "agents" && args[1] === "set-identity") {
  process.stdout.write("ok");
  process.exit(0);
}
process.stderr.write("Unexpected command: " + args.join(" "));
process.exit(1);
`,
      "utf8"
    );
    await chmod(openclawStubPath, 0o755);

    const runtime = createRuntime(sessionsPath, dir, {
      openclawCommand: openclawStubPath
    });
    const published = [];
    runtime.publishChannelMessage = async (_sessionId, channelType, requestId, payload) => {
      published.push({ channelType, requestId, payload });
    };

    await runtime.handleSignal(
      createSessionState(),
      {
        id: 701,
        session_id: 114,
        sender: "browser",
        type: "message",
        payload: {
          type: "agent.profile.update",
          payload: {
            request_id: "profile-update-1",
            name: "OpenClaw Agent",
            emoji: "🦞"
          }
        },
        created_at: null
      },
      "websocket"
    );

    assert.equal(published.length, 1);
    assert.equal(published[0]?.channelType, "agent.profile.updated");
    assert.equal(published[0]?.requestId, "profile-update-1");
    assert.equal(published[0]?.payload?.provider, "openclaw");
    assert.equal(published[0]?.payload?.agent_key, "main");
    assert.equal(published[0]?.payload?.profile?.name, "OpenClaw Agent");
    assert.equal(published[0]?.payload?.profile?.emoji, "🦞");
  });
});

test("agent profile update requires request_id", async () => {
  await withFixture(async ({ dir, sessionsPath }) => {
    const runtime = createRuntime(sessionsPath, dir);
    const published = [];
    runtime.publishChannelMessage = async (_sessionId, channelType, requestId, payload) => {
      published.push({ channelType, requestId, payload });
    };

    await runtime.handleSignal(
      createSessionState(),
      {
        id: 702,
        session_id: 114,
        sender: "browser",
        type: "message",
        payload: {
          type: "agent.profile.update",
          payload: {
            name: "Missing RequestId"
          }
        },
        created_at: null
      },
      "websocket"
    );

    assert.equal(published.length, 1);
    assert.equal(published[0]?.channelType, "agent.profile.error");
    assert.equal(published[0]?.payload?.code, "invalid_request");
    assert.equal(published[0]?.payload?.error, "request_id is required");
  });
});

test("chat bridge errors do not leak raw exception details to chat output", async () => {
  await withFixture(async ({ dir, sessionsPath }) => {
    const secret = "mc_backend_secret_token";
    const runtime = createRuntime(sessionsPath, dir);
    let lastPublished = null;

    runtime.runOpenClawChat = async () => {
      throw new Error(`bridge exploded with ${secret}`);
    };
    runtime.publishChannelMessage = async (_sessionId, channelType, _requestId, payload) => {
      if (channelType === "chat.agent.done") {
        lastPublished = payload;
      }
    };

    await runtime.handleChatUserSignal(
      createSessionState(),
      {
        id: 700,
        session_id: 114,
        sender: "browser",
        type: "message",
        payload: {},
        created_at: null
      },
      {
        request_id: "req-redaction-1"
      },
      {
        request_id: "req-redaction-1",
        content: "Please help"
      }
    );

    assert.ok(lastPublished);
    assert.equal(
      lastPublished.content,
      "I hit an OpenClaw bridge error and could not produce assistant output."
    );
    assert.equal(lastPublished.content.includes(secret), false);
  });
});

test("runtime operation errors redact backend error payload details", async () => {
  await withFixture(async ({ dir, sessionsPath }) => {
    const secret = "runtime-sensitive-auth-token";
    const runtime = createRuntime(sessionsPath, dir, {
      client: {
        operations: {
          listAgentRealtimeSignals: async () => ({
            error: {
              message: "forbidden",
              token: secret,
              nested: { authorization: `Token ${secret}` }
            },
            status: 403
          })
        }
      }
    });

    await assert.rejects(
      () => runtime.pollSessionSignals(createSessionState(), "poll"),
      (error) => {
        assert.ok(error instanceof Error);
        assert.equal(
          error.message,
          "listAgentRealtimeSignals failed with status 403."
        );
        assert.equal(error.message.includes(secret), false);
        assert.equal(error.message.includes("authorization"), false);
        return true;
      }
    );
  });
});
