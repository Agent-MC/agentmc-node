import { AgentMCApi } from "@agentmc/api";

async function main(): Promise<void> {
  const apiKey = process.env.AGENTMC_API_KEY;
  const agent = Number.parseInt(process.env.AGENTMC_AGENT_ID ?? "", 10);

  if (!apiKey || !Number.isInteger(agent) || agent < 1) {
    throw new Error("Set AGENTMC_API_KEY and AGENTMC_AGENT_ID before running this example.");
  }

  const client = new AgentMCApi({ apiKey });

  // Keep this subscription alive for the full runtime process lifetime (not heartbeat-only windows).
  const subscription = await client.subscribeToRealtimeNotifications({
    agent,
    autoCloseSession: false,
    onReady: (session) => {
      console.log(`Realtime subscription ready. session_id=${session.id}`);
    },
    onSignal: (signal) => {
      console.log("signal", signal.type, signal.id, signal.sender);
    },
    onNotification: ({ notificationType, notification }) => {
      console.log("notification", notificationType ?? "unknown", notification);
    },
    onError: (error) => {
      console.error("realtime error:", error.message);
    }
  });

  await subscription.ready;
  console.log(
    "Subscription is ready. For full chat/docs/notification runtime behavior, use examples/realtime/openclawAgentRuntime.ts."
  );

  const shutdown = async () => {
    await subscription.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
