import assert from "node:assert/strict";
import test from "node:test";

import { AgentRuntimeProgram } from "../dist/index.js";

function createProvider(onRun) {
  return {
    kind: "external",
    name: "test-provider",
    version: "1.0.0",
    build: null,
    mode: "test",
    models: [],
    runAgent: async (input) => {
      onRun(input);
      return {
        requestId: input.requestId,
        runId: "run-test-1",
        status: "ok",
        textSource: "provider",
        content: "completed"
      };
    }
  };
}

test("recurring task prompt is wrapped with AgentMC context", async () => {
  let capturedUserText = null;
  const runtime = new AgentRuntimeProgram({
    client: { operations: {} }
  });

  const provider = createProvider((input) => {
    capturedUserText = input.userText;
  });

  const result = await runtime.runRecurringTaskPrompt(provider, {
    runId: 101,
    taskId: 202,
    prompt: "Create a project update and reconcile task statuses.",
    scheduledFor: null,
    claimToken: "claim-token",
    agentId: null
  });

  assert.equal(result.status, "success");
  assert.ok(capturedUserText);
  assert.match(capturedUserText, /^\[AgentMC Context\]\n/m);
  assert.match(capturedUserText, /source=agentmc_recurring_task/);
  assert.match(capturedUserText, /skill_reference=.agentmc\/skills\/skill.md/);
  assert.match(capturedUserText, /rules_reference=.agentmc\/skills\/rules.md/);
  assert.match(
    capturedUserText,
    /Create a project update and reconcile task statuses\.\s*$/
  );
});

test("recurring task prompt does not double-wrap existing AgentMC context", async () => {
  let capturedUserText = null;
  const runtime = new AgentRuntimeProgram({
    client: { operations: {} }
  });

  const provider = createProvider((input) => {
    capturedUserText = input.userText;
  });

  const existing = [
    "[AgentMC Context]",
    "app=AgentMC",
    "source=agentmc_recurring_task",
    "",
    "Reconcile notifications and task comments."
  ].join("\n");

  await runtime.runRecurringTaskPrompt(provider, {
    runId: 102,
    taskId: 203,
    prompt: existing,
    scheduledFor: null,
    claimToken: "claim-token-2",
    agentId: null
  });

  assert.equal(capturedUserText, existing);
  assert.equal((capturedUserText.match(/\[AgentMC Context\]/g) ?? []).length, 1);
});
