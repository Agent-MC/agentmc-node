import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AgentRuntimeProgram } from "../dist/index.js";

async function withStubOpenClaw(callback, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), "agentmc-openclaw-cmd-test-"));
  const commandPath = join(dir, "openclaw");
  const modelsStatusJson = String(options.modelsStatusJson ?? "{}");
  const modelsStatusRedirect = options.modelsToStderr ? " 1>&2" : "";
  const script = [
    "#!/bin/sh",
    'if [ "$1" = "--version" ]; then',
    '  echo "OpenClaw 2026.3.1"',
    "  exit 0",
    "fi",
    'if [ "$1" = "models" ] && [ "$2" = "status" ] && [ "$3" = "--json" ]; then',
    `  cat <<'JSON'${modelsStatusRedirect}`,
    modelsStatusJson,
    "JSON",
    "  exit 0",
    "fi",
    'echo "{}"',
    ""
  ].join("\n");

  await writeFile(commandPath, script, "utf8");
  await chmod(commandPath, 0o755);

  try {
    await callback({ dir, commandPath });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("resolveOpenClawProvider falls back to discovered PATH command when options.openclawCommand is invalid", async () => {
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

test("resolveOpenClawProvider reads models from defaultModel/resolvedDefault/allowed inventory", async () => {
  await withStubOpenClaw(async ({ commandPath }) => {
    const runtime = new AgentRuntimeProgram({
      client: { operations: {} },
      openclawCommand: commandPath
    });

    const provider = await runtime.resolveOpenClawProvider(true);

    assert.equal(provider.kind, "openclaw");
    assert.deepEqual(provider.models, ["openai-codex/gpt-5.3-codex"]);
  }, {
    modelsStatusJson: `{
  "defaultModel": "openai-codex/gpt-5.3-codex",
  "resolvedDefault": "openai-codex/gpt-5.3-codex",
  "allowed": ["openai-codex/gpt-5.3-codex"]
}`
  });
});

test("resolveOpenClawProvider parses models inventory when JSON is emitted on stderr", async () => {
  await withStubOpenClaw(async ({ commandPath }) => {
    const runtime = new AgentRuntimeProgram({
      client: { operations: {} },
      openclawCommand: commandPath
    });

    const provider = await runtime.resolveOpenClawProvider(true);

    assert.equal(provider.kind, "openclaw");
    assert.deepEqual(provider.models, ["openai-codex/gpt-5.3-codex"]);
  }, {
    modelsStatusJson: `{
  "allowed": ["openai-codex/gpt-5.3-codex"]
}`,
    modelsToStderr: true
  });
});

test("resolveRuntimeProvider auto-detects OpenClaw from PATH with API-key-only fromEnv config", async () => {
  await withStubOpenClaw(async ({ dir }) => {
    const previousPath = process.env.PATH;

    try {
      process.env.PATH = typeof previousPath === "string" && previousPath !== "" ? `${dir}:${previousPath}` : dir;
      const runtime = AgentRuntimeProgram.fromEnv({
        AGENTMC_API_KEY: "mca_test_key"
      });

      const provider = await runtime.resolveRuntimeProvider();

      assert.equal(provider.kind, "openclaw");
      assert.equal(provider.mode, "openclaw");
      assert.deepEqual(provider.models, ["openai-codex/gpt-5.3-codex"]);
    } finally {
      if (typeof previousPath === "string") {
        process.env.PATH = previousPath;
      } else {
        delete process.env.PATH;
      }
    }
  }, {
    modelsStatusJson: `{
  "defaultModel": "openai-codex/gpt-5.3-codex",
  "resolvedDefault": "openai-codex/gpt-5.3-codex",
  "allowed": ["openai-codex/gpt-5.3-codex"]
}`
  });
});

test("resolveRuntimeProvider treats options.runtimeCommand=openclaw path as OpenClaw candidate in auto mode", async () => {
  await withStubOpenClaw(async ({ commandPath }) => {
    const runtime = new AgentRuntimeProgram({
      client: { operations: {} },
      runtimeCommand: commandPath
    });

    const provider = await runtime.resolveRuntimeProvider();

    assert.equal(provider.kind, "openclaw");
    assert.equal(provider.mode, "openclaw");
    assert.deepEqual(provider.models, ["openai-codex/gpt-5.3-codex"]);
  }, {
    modelsStatusJson: `{
  "defaultModel": "openai-codex/gpt-5.3-codex",
  "allowed": ["openai-codex/gpt-5.3-codex"]
}`
  });
});
