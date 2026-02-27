import { AgentRuntimeProgram } from "@agentmc/api";

async function main(): Promise<void> {
  const runtime = AgentRuntimeProgram.fromEnv(process.env);
  await runtime.run();
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
