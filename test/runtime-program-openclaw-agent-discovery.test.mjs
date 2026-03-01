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
