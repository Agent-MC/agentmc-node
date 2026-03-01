import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AgentRuntimeProgram } from "../dist/index.js";

async function withStubOpenClaw(callback) {
  const dir = await mkdtemp(join(tmpdir(), "agentmc-openclaw-cmd-test-"));
  const commandPath = join(dir, "openclaw");
  const script = `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "OpenClaw 2026.3.1"
  exit 0
fi
echo "{}"
`;

  await writeFile(commandPath, script, "utf8");
  await chmod(commandPath, 0o755);

  try {
    await callback({ dir, commandPath });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("resolveOpenClawProvider falls back to discovered PATH command when OPENCLAW_CMD is invalid", async () => {
  await withStubOpenClaw(async ({ dir, commandPath }) => {
    const previousPath = process.env.PATH;

    try {
      process.env.PATH = dir;

      const runtime = new AgentRuntimeProgram({
        client: { operations: {} },
        openclawCommand: "/definitely/not/real/openclaw",
        runtimeModels: ["openai/gpt-5-codex"]
      });

      const provider = await runtime.resolveOpenClawProvider(true);

      assert.equal(provider.kind, "openclaw");
      assert.equal(provider.name, "openclaw");
      assert.equal(provider.version, "2026.3.1");
      assert.deepEqual(provider.models, ["openai/gpt-5-codex"]);

      const resolvedCommand = await runtime.resolveOpenClawCommand();
      assert.equal(resolvedCommand, commandPath);
    } finally {
      if (typeof previousPath === "string") {
        process.env.PATH = previousPath;
      } else {
        delete process.env.PATH;
      }
    }
  });
});
