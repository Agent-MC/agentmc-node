import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AgentRuntime, AgentRuntimeProgram } from "../dist/index.js";

test("runtime log wiring prefers Agent Files debug events over generic file signals", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agentmc-runtime-logs-"));
  const infoMessages = [];
  const originalStart = AgentRuntime.prototype.start;
  const originalGetStatus = AgentRuntime.prototype.getStatus;

  AgentRuntime.prototype.start = async function startStub() {};
  AgentRuntime.prototype.getStatus = function getStatusStub() {
    return {
      running: true,
      activeSessions: [],
      realtimeSessionsEnabled: true,
      sessionPollingEnabled: true,
      chatRealtimeEnabled: true,
      filesRealtimeEnabled: true,
      docsRealtimeEnabled: true,
      notificationsRealtimeEnabled: true
    };
  };

  try {
    const program = new AgentRuntimeProgram({
      client: { operations: {} },
      workspaceDir: dir,
      onInfo: (message, meta) => {
        infoMessages.push({ message, meta });
      }
    });

    await program.startRealtimeRuntime(42, {
      kind: "openclaw",
      name: "OpenClaw",
      version: "test",
      build: null,
      mode: "test",
      models: []
    });

    const realtime = program.realtimeRuntime;
    assert.ok(realtime);

    const infoCountBeforeSignal = infoMessages.length;
    await realtime.options.onSignal?.({
      sessionId: 91,
      source: "websocket",
      signal: {
        id: 77,
        session_id: 91,
        sender: "browser",
        type: "message",
        payload: {
          type: "file.save",
          payload: {
            request_id: "req-log-save",
            file_id: "AGENTS.md"
          }
        },
        created_at: null
      }
    });

    assert.equal(infoMessages.length, infoCountBeforeSignal);

    await realtime.options.onDebug?.({
      event: "file.save.received",
      at: new Date().toISOString(),
      details: {
        session_id: 91,
        request_id: "req-log-save",
        signal_id: 77,
        file_id: "AGENTS.md"
      }
    });

    const lastMessage = infoMessages.at(-1);
    assert.equal(lastMessage?.message, "Agent file save received");
    assert.deepEqual(lastMessage?.meta, {
      session_id: 91,
      request_id: "req-log-save",
      signal_id: 77,
      file_id: "AGENTS.md"
    });
  } finally {
    AgentRuntime.prototype.start = originalStart;
    AgentRuntime.prototype.getStatus = originalGetStatus;
    await rm(dir, { recursive: true, force: true });
  }
});
