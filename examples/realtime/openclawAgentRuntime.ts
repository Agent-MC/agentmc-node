import { AgentMCApi, AgentRuntime } from "@agentmc/api";

function requireEnv(name: string): string {
  const value = String(process.env[name] ?? "").trim();
  if (value === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const baseUrl = requireEnv("AGENTMC_BASE_URL");
  const agentId = Number.parseInt(requireEnv("AGENTMC_AGENT_ID"), 10);
  const apiKey = String(process.env.AGENTMC_API_KEY ?? "").trim();

  if (!Number.isInteger(agentId) || agentId < 1) {
    throw new Error("AGENTMC_AGENT_ID must be a positive integer.");
  }

  if (apiKey === "") {
    throw new Error("AGENTMC_API_KEY is not set. Please set AGENTMC_API_KEY to your AgentMC API key, then retry.");
  }

  const client = new AgentMCApi({
    baseUrl: `${baseUrl.replace(/\/+$/, "")}/api/v1`,
    apiKey
  });

  const runtime = new AgentRuntime({
    client,
    agent: agentId,
    runtimeDocsDirectory: process.cwd(),
    openclawAgent: process.env.OPENCLAW_AGENT || "main",
    openclawCommand: process.env.OPENCLAW_CMD || "openclaw",
    openclawSessionsPath: process.env.OPENCLAW_SESSIONS_PATH || undefined,
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
