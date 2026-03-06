import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { detectRuntimeAgents } from "../dist/index.js";

async function withTempDir(callback) {
  const dir = await mkdtemp(join(tmpdir(), "agentmc-agent-discovery-test-"));
  try {
    await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("detectRuntimeAgents resolves emoji from nested profile objects in OpenClaw config", async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, "openclaw.json");

    await writeFile(
      configPath,
      JSON.stringify(
        {
          agents: {
            list: [
              {
                id: "main",
                name: "Profile Main",
                profile: {
                  emoji: "🦞"
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

    const agents = await detectRuntimeAgents({
      runtimeProvider: "openclaw",
      openclawConfigPath: configPath,
      workspaceDir: dir
    });

    assert.equal(agents.length, 1);
    assert.equal(agents[0]?.emoji, "🦞");
  });
});

test("detectRuntimeAgents resolves emoji from markdown identity fields in OpenClaw config", async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, "openclaw.json");

    await writeFile(
      configPath,
      JSON.stringify(
        {
          agents: {
            list: [
              {
                id: "main",
                name: "Markdown Main",
                identity: "- **Name:** Markdown Main\n- **Emoji:** 🦞"
              }
            ]
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const agents = await detectRuntimeAgents({
      runtimeProvider: "openclaw",
      openclawConfigPath: configPath,
      workspaceDir: dir
    });

    assert.equal(agents.length, 1);
    assert.equal(agents[0]?.emoji, "🦞");
  });
});
