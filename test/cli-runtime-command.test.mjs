import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cliPath = fileURLToPath(new URL("../bin/agentmc-api.mjs", import.meta.url));

test("cli help lists runtime commands", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "--help"]);

  assert.match(stdout, /\bruntime:start\b/);
  assert.match(stdout, /\bruntime:status\b/);
});

test("runtime:start validates required AGENTMC env", async () => {
  const env = { ...process.env };
  delete env.AGENTMC_BASE_URL;
  delete env.AGENTMC_API_KEY;

  await assert.rejects(
    () => execFileAsync(process.execPath, [cliPath, "runtime:start"], { env }),
    (error) => {
      assert.equal(error?.code, 1);
      assert.match(
        String(error?.stderr),
        /Runtime bootstrap failed\. Set AGENTMC_API_KEY \(host key\)\./
      );
      return true;
    }
  );
});

test("runtime:status reports not running when status file is missing", async () => {
  const missingPath = join(tmpdir(), `agentmc-missing-status-${Date.now()}.json`);
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "runtime:status", "--status-path", missingPath], {
    env: {
      ...process.env
    }
  });

  assert.match(stdout, /AgentMC runtime status: NOT RUNNING/);
  assert.match(stdout, /runtime status file not found/);
});

test("runtime:status --json returns worker heartbeat details", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agentmc-runtime-status-"));
  const statusPath = join(dir, "runtime-status.json");
  const stateDir = join(dir, "workspace", ".agentmc");
  const statePath = join(stateDir, "state.agent-7.json");
  const heartbeatAt = new Date().toISOString();

  await mkdir(stateDir, { recursive: true });
  await writeFile(
    statePath,
    `${JSON.stringify({
      agent_id: 7,
      last_heartbeat_at: heartbeatAt
    }, null, 2)}\n`,
    "utf8"
  );

  await writeFile(
    statusPath,
    `${JSON.stringify({
      schema_version: 1,
      pid: process.pid,
      status: "running",
      mode: "single-agent",
      started_at: heartbeatAt,
      updated_at: heartbeatAt,
      host_fingerprint: "test-host",
      summary: "running",
      workers: [
        {
          local_key: "agent-7",
          local_name: "agent-7",
          provider: "openclaw",
          agent_id: 7,
          workspace_dir: join(dir, "workspace"),
          state_path: statePath,
          openclaw_agent: "agent-7"
        }
      ]
    }, null, 2)}\n`,
    "utf8"
  );

  const { stdout } = await execFileAsync(process.execPath, [cliPath, "runtime:status", "--status-path", statusPath, "--json"], {
    env: {
      ...process.env
    }
  });
  const payload = JSON.parse(stdout);

  assert.equal(payload.running, true);
  assert.equal(payload.status, "running");
  assert.equal(payload.workers.length, 1);
  assert.equal(payload.workers[0].agent_id, 7);
  assert.equal(payload.workers[0].last_heartbeat_at, heartbeatAt);
});
