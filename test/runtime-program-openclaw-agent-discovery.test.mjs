import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AgentRuntimeProgram } from "../dist/index.js";

async function withTempDir(callback) {
  const dir = await mkdtemp(join(tmpdir(), "agentmc-openclaw-agent-discovery-test-"));
  try {
    await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeExecutable(path, content) {
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
}

test("OpenClaw machine identity falls back to gateway call agents.list when agents list command fails", async () => {
  await withTempDir(async (dir) => {
    const commandPath = join(dir, "openclaw");

    await writeExecutable(
      commandPath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "OpenClaw 2026.3.1"
  exit 0
fi
if [ "$1" = "agents" ] && [ "$2" = "list" ]; then
  echo "unknown command: agents list" >&2
  exit 2
fi
if [ "$1" = "gateway" ] && [ "$2" = "call" ] && [ "$3" = "agents.list" ]; then
  echo '{"payload":{"agents":[{"id":"main","name":"Gateway Main","identity":{"name":"Gateway Main","emoji":"🦞"}}]}}'
  exit 0
fi
echo "{}"
`
    );

    const runtime = new AgentRuntimeProgram({
      client: { operations: {} },
      openclawCommand: commandPath
    });

    const snapshot = await runtime.resolveOpenClawMachineIdentitySnapshot("", { name: "fallback" });

    assert.equal(snapshot?.name, "Gateway Main");
    assert.equal(snapshot?.emoji, "🦞");
    assert.deepEqual(snapshot?.identity, { name: "Gateway Main", emoji: "🦞" });
  });
});

test("OpenClaw machine identity resolves agent name from agents list --json object maps", async () => {
  await withTempDir(async (dir) => {
    const commandPath = join(dir, "openclaw");

    await writeExecutable(
      commandPath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "OpenClaw 2026.3.1"
  exit 0
fi
if [ "$1" = "agents" ] && [ "$2" = "list" ] && [ "$3" = "--json" ]; then
  echo '{"agents":{"main":{"name":"Agents List Main","identity":{"emoji":"🦞"}}}}'
  exit 0
fi
if [ "$1" = "gateway" ] && [ "$2" = "call" ] && [ "$3" = "agents.list" ]; then
  echo '{"payload":{"agents":[{"id":"main","name":"Gateway Main","identity":{"name":"Gateway Main","emoji":"🤖"}}]}}'
  exit 0
fi
echo "{}"
`
    );

    const runtime = new AgentRuntimeProgram({
      client: { operations: {} },
      openclawCommand: commandPath
    });

    const snapshot = await runtime.resolveOpenClawMachineIdentitySnapshot("", { name: "fallback" });

    assert.equal(snapshot?.name, "Agents List Main");
    assert.equal(snapshot?.emoji, "🦞");
    assert.deepEqual(snapshot?.identity, { name: "Agents List Main", emoji: "🦞" });
  });
});

test("OpenClaw machine identity falls back to OPENCLAW_CONFIG_PATH when CLI discovery commands fail", async () => {
  await withTempDir(async (dir) => {
    const commandPath = join(dir, "openclaw");
    const configPath = join(dir, "openclaw.json");
    const previousConfigPath = process.env.OPENCLAW_CONFIG_PATH;

    await writeExecutable(
      commandPath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "OpenClaw 2026.3.1"
  exit 0
fi
echo "command failed" >&2
exit 2
`
    );

    await writeFile(
      configPath,
      JSON.stringify(
        {
          agents: {
            list: [
              {
                id: "main",
                name: "Config Main",
                identity: {
                  name: "Config Main",
                  emoji: "🤖"
                }
              }
            ]
          }
        },
        null,
        2
      ),
      "utf8"
    );

    try {
      process.env.OPENCLAW_CONFIG_PATH = configPath;

      const runtime = new AgentRuntimeProgram({
        client: { operations: {} },
        openclawCommand: commandPath
      });

      const snapshot = await runtime.resolveOpenClawMachineIdentitySnapshot("", { name: "fallback" });

      assert.equal(snapshot?.name, "Config Main");
      assert.equal(snapshot?.emoji, "🤖");
      assert.deepEqual(snapshot?.identity, { name: "Config Main", emoji: "🤖" });
    } finally {
      if (typeof previousConfigPath === "string") {
        process.env.OPENCLAW_CONFIG_PATH = previousConfigPath;
      } else {
        delete process.env.OPENCLAW_CONFIG_PATH;
      }
    }
  });
});

test("OpenClaw machine identity can resolve from OPENCLAW_CONFIG_PATH when command is unavailable", async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, "openclaw.json");
    const previousConfigPath = process.env.OPENCLAW_CONFIG_PATH;
    const previousPath = process.env.PATH;

    await writeFile(
      configPath,
      JSON.stringify(
        {
          agents: {
            list: [
              {
                id: "main",
                name: "Config Only Main",
                identity: {
                  name: "Config Only Main",
                  emoji: "🛰️"
                }
              }
            ]
          }
        },
        null,
        2
      ),
      "utf8"
    );

    try {
      process.env.OPENCLAW_CONFIG_PATH = configPath;
      process.env.PATH = "";

      const runtime = new AgentRuntimeProgram({
        client: { operations: {} },
        openclawCommand: "/not/available/openclaw"
      });

      const snapshot = await runtime.resolveOpenClawMachineIdentitySnapshot("", { name: "fallback" });

      assert.equal(snapshot?.name, "Config Only Main");
      assert.equal(snapshot?.emoji, "🛰️");
      assert.deepEqual(snapshot?.identity, { name: "Config Only Main", emoji: "🛰️" });
    } finally {
      if (typeof previousConfigPath === "string") {
        process.env.OPENCLAW_CONFIG_PATH = previousConfigPath;
      } else {
        delete process.env.OPENCLAW_CONFIG_PATH;
      }

      if (typeof previousPath === "string") {
        process.env.PATH = previousPath;
      } else {
        delete process.env.PATH;
      }
    }
  });
});
