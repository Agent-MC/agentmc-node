import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cliPath = fileURLToPath(new URL("../bin/agentmc-api.mjs", import.meta.url));

test("cli help lists runtime:start", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "--help"]);

  assert.match(stdout, /\bruntime:start\b/);
});

test("runtime:start validates required AGENTMC env", async () => {
  const env = { ...process.env };
  delete env.AGENTMC_BASE_URL;
  for (const key of Object.keys(env)) {
    if (/^AGENTMC_API_KEY_\d+$/.test(key)) {
      delete env[key];
    }
  }

  await assert.rejects(
    () => execFileAsync(process.execPath, [cliPath, "runtime:start"], { env }),
    (error) => {
      assert.equal(error?.code, 1);
      assert.match(
        String(error?.stderr),
        /No agent runtime keys found\. Set one or more AGENTMC_API_KEY_<AGENT_ID>=mca_\.\.\. environment variables\./
      );
      return true;
    }
  );
});
