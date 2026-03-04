import { AgentMCApi, AgentRuntime } from "@agentmc/api";

function requireApiKey(): string {
  const value = String(process.env.AGENTMC_API_KEY ?? "").trim();
  if (value === "") {
    throw new Error("AGENTMC_API_KEY is not set. Please set AGENTMC_API_KEY to your AgentMC API key, then retry.");
  }
  return value;
}

function resolveAgentIdArg(argv: readonly string[]): number {
  const value = Number.parseInt(String(argv[2] ?? "").trim(), 10);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("Pass the AgentMC agent id as the first argument: `tsx examples/realtime/openclawAgentRuntime.ts <agent_id>`.");
  }
  return value;
}

async function main(): Promise<void> {
  const agentId = resolveAgentIdArg(process.argv);
  const apiKey = requireApiKey();

  const client = new AgentMCApi({
    baseUrl: "https://agentmc.ai/api/v1",
    apiKey
  });

  const runtime = new AgentRuntime({
    client,
    agent: agentId,
    runtimeDocsDirectory: process.cwd(),
    openclawAgent: "main",
    openclawCommand: "openclaw",
    onSessionReady: (session) => {
      console.log(`session ${session.id}: ready`);
    },
    onConnectionStateChange: ({ sessionId, state }) => {
      console.log(`session ${sessionId}: connection ${state}`);
    },
    onNotification: ({ sessionId, source, notificationType, notification }) => {
      console.log(
        `session ${sessionId}: notification ${notificationType ?? "unknown"} (source=${source})`,
        notification
      );
    },
    onNotificationBridge: ({ sessionId, requestId, run }) => {
      console.log(
        `session ${sessionId}: notification bridge ${requestId} -> ${run.status} (${run.textSource})`
      );
    },
    onUnhandledMessage: ({ sessionId, channelType, payload }) => {
      console.log(`session ${sessionId}: unhandled ${channelType ?? "unknown"}`, payload);
    },
    onError: (error) => {
      console.error("runtime error:", error.message);
    }
  });

  await runtime.start();
  console.log("AgentMC realtime runtime started.");

  const shutdown = async () => {
    console.log("Shutting down...");
    await runtime.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
