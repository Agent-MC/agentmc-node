import assert from "node:assert/strict";
import test from "node:test";

import { AgentRuntimeProgram } from "../dist/index.js";

const PROVIDER = {
  kind: "external",
  name: "codex",
  version: "1.0.0",
  build: null,
  mode: "direct",
  models: ["openai/gpt-5-codex"]
};

function createRuntimeProgram(clientOverrides = {}) {
  return new AgentRuntimeProgram({
    client: {
      operations: {
        ...clientOverrides
      }
    }
  });
}

test("resolveAgentProfile falls back when API lookup and configured profile are unavailable", async () => {
  const runtime = createRuntimeProgram();
  const profile = await runtime.resolveAgentProfile(42, PROVIDER);

  assert.equal(profile.id, 42);
  assert.equal(profile.name, "agent-42");
  assert.equal(profile.type, "runtime");
  assert.deepEqual(profile.identity, { name: "agent-42" });
});

test("resolveAgentProfile keeps configured name and falls back type when options.agentType is missing", async () => {
  const runtime = new AgentRuntimeProgram({
    client: { operations: {} },
    agentName: "worker-alpha"
  });
  const profile = await runtime.resolveAgentProfile(7, PROVIDER);

  assert.equal(profile.id, 7);
  assert.equal(profile.name, "worker-alpha");
  assert.equal(profile.type, "runtime");
  assert.deepEqual(profile.identity, { name: "worker-alpha" });
});

test("resolveAgentProfile uses options.agentName and options.agentType overrides when provided", async () => {
  const runtime = new AgentRuntimeProgram({
    client: { operations: {} },
    agentName: "configured-name",
    agentType: "configured-type"
  });
  const profile = await runtime.resolveAgentProfile(42, PROVIDER);

  assert.equal(profile.name, "configured-name");
  assert.equal(profile.type, "configured-type");
  assert.deepEqual(profile.identity, { name: "configured-name" });
});

test("resolveAgentProfile prefers OpenClaw machine snapshot name before synthetic fallback", async () => {
  const runtime = createRuntimeProgram();
  const profile = await runtime.resolveAgentProfile(9, {
    ...PROVIDER,
    kind: "openclaw",
    machineIdentityResolver: async () => ({
      name: "openclaw-alpha",
      identity: {
        name: "openclaw-alpha",
        emoji: "🦞"
      },
      emoji: "🦞"
    })
  });

  assert.equal(profile.id, 9);
  assert.equal(profile.name, "openclaw-alpha");
  assert.equal(profile.type, "runtime");
  assert.equal(profile.emoji, "🦞");
  assert.deepEqual(profile.identity, { name: "openclaw-alpha", emoji: "🦞" });
});
