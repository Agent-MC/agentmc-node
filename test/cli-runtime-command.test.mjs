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
  delete env.AGENTMC_API_KEY;

  await assert.rejects(
    () => execFileAsync(process.execPath, [cliPath, "runtime:start"], { env }),
    (error) => {
      assert.equal(error?.code, 1);
      assert.match(String(error?.stderr), /AGENTMC_BASE_URL is required\./);
      return true;
    }
  );
});
