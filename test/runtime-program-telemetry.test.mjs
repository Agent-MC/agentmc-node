import assert from "node:assert/strict";
import test from "node:test";

import { AgentRuntimeProgram } from "../dist/index.js";

function createRuntimeProgram(snapshots, models = ["openai/gpt-5-codex"]) {
  const runtime = new AgentRuntimeProgram({
    client: { operations: {} },
    publicIp: "203.0.113.10"
  });

  runtime.runtimeProvider = {
    kind: "openclaw",
    name: "openclaw",
    version: "2026.2.26",
    build: "bc50708",
    mode: "openclaw",
    models
  };

  runtime.agentProfile = {
    id: 42,
    name: "codex-runtime",
    type: "runtime",
    identity: { name: "codex-runtime" }
  };

  runtime.loadOpenClawTelemetrySnapshots = async () => snapshots;
  runtime.resolveMachineIdentitySnapshot = async () => null;

  return runtime;
}

test("buildHeartbeatBody extracts telemetry from nested runtime status objects", async () => {
  const runtime = createRuntimeProgram([
    {
      runtime: {
        name: "openclaw",
        version: "2026.2.26",
        build: "bc50708",
        mode: "direct",
        models: ["openai/gpt-5.3-codex"]
      },
      tokens: {
        in: 77000,
        out: 1800
      },
      cache: {
        hit_rate: 0.89,
        tokens: {
          cached: 600000,
          new: 0
        }
      },
      context: {
        tokens: {
          used: 76000,
          max: 272000
        },
        percent_used: 28,
        compactions: 0
      },
      usage: {
        window: {
          percent_left: 86,
          time_left: "3h 4m"
        },
        day: {
          percent_left: 24,
          time_left: "3d 16h"
        }
      },
      queue: {
        name: "collect",
        depth: 1
      },
      auth: {
        mode: "oauth (openai-codex:default)"
      },
      thinking: {
        mode: "off"
      },
      session: {
        id: "agent:main:main"
      },
      tools: {
        browser: true,
        exec: true,
        nodes: true,
        messaging: true,
        sessions: true,
        memory: true
      }
    }
  ]);

  const body = await runtime.buildHeartbeatBody();
  const meta = body.meta;

  assert.equal(meta.tokens_in, 77000);
  assert.equal(meta.tokens_out, 1800);
  assert.equal(meta.cache_hit_rate_percent, 89);
  assert.equal(meta.cache_tokens_cached, 600000);
  assert.equal(meta.cache_tokens_new, 0);
  assert.equal(meta.context_tokens_used, 76000);
  assert.equal(meta.context_tokens_max, 272000);
  assert.equal(meta.context_percent_used, 28);
  assert.equal(meta.context_compactions, 0);
  assert.equal(meta.usage_window_percent_left, 86);
  assert.equal(meta.usage_window_time_left, "3h 4m");
  assert.equal(meta.usage_day_percent_left, 24);
  assert.equal(meta.usage_day_time_left, "3d 16h");
  assert.equal(meta.session, "agent:main:main");
  assert.equal(meta.queue, "collect");
  assert.equal(meta.queue_depth, 1);
  assert.equal(meta.auth, "oauth (openai-codex:default)");
  assert.equal(meta.thinking_mode, false);
  assert.equal(meta.browser_tool_available, true);
  assert.equal(meta.exec_tool_available, true);
  assert.equal(meta.nodes_tool_available, true);
  assert.equal(meta.messaging_tool_available, true);
  assert.equal(meta.sessions_tool_available, true);
  assert.equal(meta.memory_tool_available, true);
});

test("buildHeartbeatBody extracts telemetry from status-style text fragments", async () => {
  const runtime = createRuntimeProgram([
    {
      status: {
        model: "Model: openai-codex/gpt-5.3-codex",
        cache: "Cache: 89% hit, 600000 cached, 0 new",
        usage: "Usage: Window 86% left @3h 4m | Day 24% left @3d 16h",
        runtime: "Runtime: openclaw | Think: off",
        tools: "Tools: Browser on | Exec on | Nodes on | Messaging on | Sessions on | Memory on",
        tokens: "Tokens: 77000 in / 1800 out",
        context: "Context: 76000/272000 (28%) | Compactions: 0",
        session: "Session: agent:main:main",
        queue: "Queue depth: 1",
        auth: "Auth: oauth (openai-codex:default)"
      }
    }
  ], []);

  const body = await runtime.buildHeartbeatBody();
  const meta = body.meta;

  assert.deepEqual(meta.models, ["openai-codex/gpt-5.3-codex"]);
  assert.equal(meta.tokens_in, 77000);
  assert.equal(meta.tokens_out, 1800);
  assert.equal(meta.cache_hit_rate_percent, 89);
  assert.equal(meta.cache_tokens_cached, 600000);
  assert.equal(meta.cache_tokens_new, 0);
  assert.equal(meta.context_tokens_used, 76000);
  assert.equal(meta.context_tokens_max, 272000);
  assert.equal(meta.context_percent_used, 28);
  assert.equal(meta.context_compactions, 0);
  assert.equal(meta.usage_window_percent_left, 86);
  assert.equal(meta.usage_window_time_left, "3h 4m");
  assert.equal(meta.usage_day_percent_left, 24);
  assert.equal(meta.usage_day_time_left, "3d 16h");
  assert.equal(meta.runtime_mode, "openclaw");
  assert.equal(meta.thinking_mode, "off");
  assert.equal(meta.browser_tool_available, true);
  assert.equal(meta.exec_tool_available, true);
  assert.equal(meta.nodes_tool_available, true);
  assert.equal(meta.messaging_tool_available, true);
  assert.equal(meta.sessions_tool_available, true);
  assert.equal(meta.memory_tool_available, true);
  assert.equal(meta.session, "agent:main:main");
  assert.equal(meta.queue_depth, 1);
  assert.equal(meta.auth, "oauth (openai-codex:default)");
});

test("buildHeartbeatBody applies machine identity emoji/name into heartbeat payload", async () => {
  const runtime = createRuntimeProgram([{}]);

  runtime.resolveMachineIdentitySnapshot = async () => ({
    name: "Orbit",
    identity: {
      name: "Orbit",
      emoji: "🤖"
    },
    emoji: "🤖"
  });

  const body = await runtime.buildHeartbeatBody();
  const meta = body.meta;

  assert.equal(body.agent.name, "Orbit");
  assert.equal(body.agent.identity.emoji, "🤖");
  assert.equal(meta.emoji, "🤖");
});
