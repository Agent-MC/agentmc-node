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

async function withAgentEnv(values, callback) {
  const keys = ["AGENTMC_AGENT_NAME", "AGENTMC_AGENT_TYPE", "AGENTMC_AGENT_EMOJI"];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  try {
    for (const key of keys) {
      const value = values[key];
      if (typeof value === "string") {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
    await callback();
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (typeof value === "string") {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
  }
}

test("resolveAgentProfile falls back when API lookup and env profile are unavailable", async () => {
  await withAgentEnv({}, async () => {
    const runtime = createRuntimeProgram();
    const profile = await runtime.resolveAgentProfile(42, PROVIDER);

    assert.equal(profile.id, 42);
    assert.equal(profile.name, "agent-42");
    assert.equal(profile.type, "runtime");
    assert.deepEqual(profile.identity, { name: "agent-42" });
  });
});

test("resolveAgentProfile keeps env name and falls back type when AGENTMC_AGENT_TYPE is missing", async () => {
  await withAgentEnv({ AGENTMC_AGENT_NAME: "worker-alpha" }, async () => {
    const runtime = createRuntimeProgram();
    const profile = await runtime.resolveAgentProfile(7, PROVIDER);

    assert.equal(profile.id, 7);
    assert.equal(profile.name, "worker-alpha");
    assert.equal(profile.type, "runtime");
    assert.deepEqual(profile.identity, { name: "worker-alpha" });
  });
});

test("resolveAgentProfile prefers listAgents metadata when available", async () => {
  await withAgentEnv({ AGENTMC_AGENT_NAME: "env-name", AGENTMC_AGENT_TYPE: "env-type" }, async () => {
    const runtime = createRuntimeProgram({
      listAgents: async () => ({
        error: false,
        data: {
          data: [
            {
              id: 42,
              name: "api-name",
              type: "api-type",
              meta: {
                identity: {
                  name: "api-name",
                  emoji: "🤖"
                }
              }
            }
          ]
        }
      })
    });

    const profile = await runtime.resolveAgentProfile(42, PROVIDER);

    assert.equal(profile.name, "api-name");
    assert.equal(profile.type, "api-type");
    assert.equal(profile.emoji, "🤖");
    assert.deepEqual(profile.identity, { name: "api-name", emoji: "🤖" });
  });
});

test("resolveAgentProfile prefers OpenClaw machine snapshot name before synthetic fallback", async () => {
  await withAgentEnv({}, async () => {
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
});
