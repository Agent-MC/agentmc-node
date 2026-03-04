import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

import type { AgentMCApi } from "./client";
import type {
  AgentRealtimeConnectionState,
  AgentRealtimeNotificationEvent,
  AgentRealtimeSessionRecord,
  AgentRealtimeSignalMessage
} from "./realtime";

const execFileAsync = promisify(execFile);

const DEFAULT_REQUESTED_SESSION_LIMIT = 20;
const DEFAULT_REQUEST_POLL_MS = 2_000;
const DEFAULT_DUPLICATE_TTL_MS = 300_000;
const DEFAULT_PUSH_LOOP_DELAY_MS = 1_000;
const MAX_RATE_LIMIT_BACKOFF_MS = 120_000;
const DEFAULT_GATEWAY_TIMEOUT_MS = 240_000;
const DEFAULT_OPENCLAW_SUBMIT_TIMEOUT_MS = 30_000;
const DEFAULT_OPENCLAW_WAIT_TIMEOUT_MS = 180_000;
const DEFAULT_OPENCLAW_PROFILE_UPDATE_TIMEOUT_MS = 15_000;
const DEFAULT_OPENCLAW_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const DEFAULT_OPENCLAW_FORCE_KILL_GRACE_MS = 2_000;
const DEFAULT_CHAT_STATUS_DELTA_INTERVAL_MS = 20_000;
const DEFAULT_SELF_HEAL_CONNECTION_STALE_MS = 45_000;
const DEFAULT_SELF_HEAL_ACTIVITY_STALE_MS = 120_000;
const DEFAULT_SELF_HEAL_MIN_SESSION_AGE_MS = 20_000;
const DEFAULT_REALTIME_PUBLISH_TIMEOUT_MS = 10_000;
const DEFAULT_AGENTMC_API_BASE_URL = "https://agentmc.ai/api/v1";

const DEFAULT_OPENCLAW_DOC_IDS = [
  "AGENTS.md",
  "SOUL.md",
  "TOOLS.md",
  "IDENTITY.md",
  "USER.md",
  "BOOTSTRAP.md",
  "MEMORY.md"
] as const;

type JsonObject = Record<string, unknown>;
type MaybePromise = void | Promise<void>;
type SessionSignalSource = "websocket" | "api_poll";
type MaybeNotificationType = string | null;

export interface OpenClawRuntimeDocRecord {
  id: string;
  title: string;
  body_markdown: string;
  base_hash: string;
}

export interface OpenClawRuntimeSignalEvent {
  sessionId: number;
  source: SessionSignalSource;
  signal: AgentRealtimeSignalMessage;
}

export interface OpenClawRuntimeNotificationEvent {
  sessionId: number;
  source: SessionSignalSource;
  signal: AgentRealtimeSignalMessage;
  notification: JsonObject;
  notificationType: MaybeNotificationType;
  channelType: string | null;
}

export interface OpenClawRuntimeNotificationBridgeEvent {
  sessionId: number;
  source: SessionSignalSource;
  signal: AgentRealtimeSignalMessage;
  notification: JsonObject;
  notificationType: MaybeNotificationType;
  channelType: string | null;
  requestId: string;
  run: OpenClawRuntimeNotificationBridgeRunResult;
}

export interface OpenClawRuntimeNotificationBridgeRunResult {
  requestId: string;
  runId: string;
  status: "ok" | "error" | "timeout";
  textSource: "wait" | "session_history" | "fallback" | "error";
  content: string;
}

export interface OpenClawRuntimeUnhandledMessageEvent {
  sessionId: number;
  source: SessionSignalSource;
  signal: AgentRealtimeSignalMessage;
  channelType: string | null;
  payload: JsonObject;
}

export interface OpenClawRuntimeConnectionStateEvent {
  sessionId: number;
  state: AgentRealtimeConnectionState;
}

export interface OpenClawRuntimeDebugEvent {
  event: string;
  at: string;
  details: JsonObject;
}

export interface AgentRuntimeRunInput {
  sessionId: number;
  requestId: string;
  userText: string;
}

export type AgentRuntimeRunResult = OpenClawRuntimeNotificationBridgeRunResult;

export interface OpenClawAgentRuntimeOptions {
  client: AgentMCApi;
  agent: number;
  agentmcApiKey?: string;
  agentmcBaseUrl?: string;
  agentmcOpenApiUrl?: string;
  realtimeSessionsEnabled?: boolean;
  sessionPollingEnabled?: boolean;
  chatRealtimeEnabled?: boolean;
  filesRealtimeEnabled?: boolean;
  docsRealtimeEnabled?: boolean;
  notificationsRealtimeEnabled?: boolean;
  requestedSessionLimit?: number;
  requestPollMs?: number;
  duplicateTtlMs?: number;
  sendThinkingDelta?: boolean;
  thinkingText?: string;
  bridgeNotificationsToAi?: boolean;
  bridgeReadNotifications?: boolean;
  bridgeNotificationTypes?: readonly string[];
  closeSessionOnStop?: boolean;
  closeReason?: string;
  closeStatus?: "closed" | "failed";
  includeInitialSnapshot?: boolean;
  runtimeDocsDirectory?: string;
  runtimeWorkingDirectory?: string;
  runtimeDocIds?: readonly string[];
  includeMissingRuntimeDocs?: boolean;
  openclawCommand?: string;
  openclawAgent?: string;
  openclawSessionsPath?: string;
  openclawGatewayTimeoutMs?: number;
  openclawSubmitTimeoutMs?: number;
  openclawWaitTimeoutMs?: number;
  openclawProfileUpdateTimeoutMs?: number;
  openclawMaxBufferBytes?: number;
  selfHealEnabled?: boolean;
  selfHealConnectionStaleMs?: number;
  selfHealActivityStaleMs?: number;
  selfHealMinSessionAgeMs?: number;
  selfHealCloseRemote?: boolean;
  runtimeSource?: string;
  runAgent?: (input: AgentRuntimeRunInput) => Promise<AgentRuntimeRunResult>;
  onSessionReady?: (session: AgentRealtimeSessionRecord) => MaybePromise;
  onSessionClosed?: (sessionId: number, reason: string) => MaybePromise;
  onSignal?: (event: OpenClawRuntimeSignalEvent) => MaybePromise;
  onNotification?: (event: OpenClawRuntimeNotificationEvent) => MaybePromise;
  onNotificationBridge?: (event: OpenClawRuntimeNotificationBridgeEvent) => MaybePromise;
  onConnectionStateChange?: (event: OpenClawRuntimeConnectionStateEvent) => MaybePromise;
  onUnhandledMessage?: (event: OpenClawRuntimeUnhandledMessageEvent) => MaybePromise;
  onDebug?: (event: OpenClawRuntimeDebugEvent) => MaybePromise;
  onError?: (error: Error) => MaybePromise;
}

export interface OpenClawAgentRuntimeStatus {
  running: boolean;
  activeSessions: number[];
  realtimeSessionsEnabled: boolean;
  sessionPollingEnabled: boolean;
  chatRealtimeEnabled: boolean;
  filesRealtimeEnabled: boolean;
  docsRealtimeEnabled: boolean;
  notificationsRealtimeEnabled: boolean;
}

export interface OpenClawRuntimeApiNotificationIngestOptions {
  sessionId?: number;
  includeRead?: boolean;
  source?: SessionSignalSource;
}

export interface OpenClawRuntimeApiNotificationIngestResult {
  source: SessionSignalSource;
  sessionId: number | null;
  totalReceived: number;
  processed: number;
  skipped: number;
}

interface ResolvedOptions {
  client: AgentMCApi;
  agent: number;
  agentmcApiKey: string | null;
  agentmcBaseUrl: string;
  agentmcOpenApiUrl: string;
  realtimeSessionsEnabled: boolean;
  sessionPollingEnabled: boolean;
  chatRealtimeEnabled: boolean;
  filesRealtimeEnabled: boolean;
  docsRealtimeEnabled: boolean;
  notificationsRealtimeEnabled: boolean;
  requestedSessionLimit: number;
  requestPollMs: number;
  duplicateTtlMs: number;
  sendThinkingDelta: boolean;
  thinkingText: string;
  bridgeNotificationsToAi: boolean;
  bridgeReadNotifications: boolean;
  bridgeNotificationTypes: Set<string> | null;
  closeSessionOnStop: boolean;
  closeReason: string;
  closeStatus: "closed" | "failed";
  includeInitialSnapshot: boolean;
  runtimeDocsDirectory: string;
  runtimeWorkingDirectory: string;
  runtimeDocIds: string[];
  includeMissingRuntimeDocs: boolean;
  openclawCommand: string;
  openclawAgent: string;
  openclawSessionsPath: string;
  openclawGatewayTimeoutMs: number;
  openclawSubmitTimeoutMs: number;
  openclawWaitTimeoutMs: number;
  openclawProfileUpdateTimeoutMs: number;
  openclawMaxBufferBytes: number;
  selfHealEnabled: boolean;
  selfHealConnectionStaleMs: number;
  selfHealActivityStaleMs: number;
  selfHealMinSessionAgeMs: number;
  selfHealCloseRemote: boolean;
  runtimeSource: string;
  runAgent?: (input: AgentRuntimeRunInput) => Promise<AgentRuntimeRunResult>;
  onSessionReady?: (session: AgentRealtimeSessionRecord) => MaybePromise;
  onSessionClosed?: (sessionId: number, reason: string) => MaybePromise;
  onSignal?: (event: OpenClawRuntimeSignalEvent) => MaybePromise;
  onNotification?: (event: OpenClawRuntimeNotificationEvent) => MaybePromise;
  onNotificationBridge?: (event: OpenClawRuntimeNotificationBridgeEvent) => MaybePromise;
  onConnectionStateChange?: (event: OpenClawRuntimeConnectionStateEvent) => MaybePromise;
  onUnhandledMessage?: (event: OpenClawRuntimeUnhandledMessageEvent) => MaybePromise;
  onDebug?: (event: OpenClawRuntimeDebugEvent) => MaybePromise;
  onError?: (error: Error) => MaybePromise;
}

interface SessionState {
  sessionId: number;
  session: AgentRealtimeSessionRecord | null;
  subscription: {
    disconnect: () => Promise<void>;
    ready: Promise<void>;
  } | null;
  closed: boolean;
  closeReason: string | null;
  lastSignalId: number;
  lastNonAgentSignalId: number;
  connectionState: AgentRealtimeConnectionState;
  sawConnectedState: boolean;
  createdAtMs: number;
  lastHealthActivityAtMs: number;
  lastConnectionStateChangeAtMs: number;
  chatSignalQueue: Promise<void>;
  processedInboundKeys: Map<string, number>;
  inboundChunkBuffers: Map<string, InboundChunkBuffer>;
}

interface OpenClawRunResult extends OpenClawRuntimeNotificationBridgeRunResult {}

interface InboundChunkFrame {
  channelType: string;
  chunkId: string;
  chunkIndex: number;
  chunkTotal: number;
  requestId: string | null;
  data: string;
}

interface InboundChunkBuffer {
  channelType: string;
  chunkId: string;
  chunkTotal: number;
  requestId: string | null;
  chunks: Map<number, string>;
  updatedAtMs: number;
}

interface BridgedAgentMcRuntimeContext {
  apiKey: string | null;
  apiBaseUrl: string;
  openApiUrl: string;
}

export class OpenClawAgentRuntime {
  private readonly options: ResolvedOptions;
  private readonly sessions = new Map<number, SessionState>();
  private readonly processedNotificationKeys = new Map<string, number>();
  private stopRequested = false;
  private runPromise: Promise<void> | null = null;
  private nextSessionAcquireAtMs = 0;
  private lastSessionAcquireRateLimitLogAtMs = 0;
  private sessionAcquireRateLimitStreak = 0;

  constructor(options: OpenClawAgentRuntimeOptions) {
    this.options = resolveOptions(options);
  }

  getStatus(): OpenClawAgentRuntimeStatus {
    return {
      running: this.runPromise !== null && !this.stopRequested,
      activeSessions: Array.from(this.sessions.keys()).sort((left, right) => left - right),
      realtimeSessionsEnabled: this.options.realtimeSessionsEnabled,
      sessionPollingEnabled: this.options.sessionPollingEnabled,
      chatRealtimeEnabled: this.options.chatRealtimeEnabled,
      filesRealtimeEnabled: this.options.filesRealtimeEnabled,
      docsRealtimeEnabled: this.options.docsRealtimeEnabled,
      notificationsRealtimeEnabled: this.options.notificationsRealtimeEnabled
    };
  }

  attachSession(sessionId: number): boolean {
    const resolvedSessionId = toPositiveInteger(sessionId);
    if (resolvedSessionId < 1) {
      return false;
    }

    if (!this.options.realtimeSessionsEnabled || this.stopRequested || this.sessions.has(resolvedSessionId)) {
      return false;
    }

    this.startSessionLoop(resolvedSessionId);
    return true;
  }

  async ingestNotificationsFromApi(
    notifications: readonly unknown[],
    options: OpenClawRuntimeApiNotificationIngestOptions = {}
  ): Promise<OpenClawRuntimeApiNotificationIngestResult> {
    const source = options.source ?? "api_poll";
    const totalReceived = Array.isArray(notifications) ? notifications.length : 0;
    if (!Array.isArray(notifications) || notifications.length === 0) {
      return {
        source,
        sessionId: null,
        totalReceived: 0,
        processed: 0,
        skipped: 0
      };
    }

    if (!this.options.notificationsRealtimeEnabled || this.stopRequested) {
      return {
        source,
        sessionId: null,
        totalReceived,
        processed: 0,
        skipped: totalReceived
      };
    }

    const sessionState = this.resolveNotificationSessionState(options.sessionId);
    if (!sessionState) {
      return {
        source,
        sessionId: null,
        totalReceived,
        processed: 0,
        skipped: totalReceived
      };
    }

    const includeRead = options.includeRead === true;
    let processed = 0;
    let skipped = 0;

    for (let index = 0; index < notifications.length; index += 1) {
      if (this.stopRequested || sessionState.closed) {
        skipped += notifications.length - index;
        break;
      }

      const notification = valueAsObject(notifications[index]);
      if (!notification) {
        skipped += 1;
        continue;
      }

      if (!includeRead && valueAsBoolean(notification.is_read) === true) {
        skipped += 1;
        continue;
      }

      const signal = this.buildSyntheticNotificationSignal(sessionState.sessionId, notification, index);
      const notificationType = valueAsString(notification.notification_type)?.toLowerCase() ?? null;
      const processedEvent = await this.dispatchNotificationEvent(sessionState, {
        source,
        signal,
        notification,
        notificationType,
        channelType: "notification.api_fallback"
      });

      if (processedEvent) {
        processed += 1;
      } else {
        skipped += 1;
      }
    }

    return {
      source,
      sessionId: sessionState.sessionId,
      totalReceived,
      processed,
      skipped
    };
  }

  async run(): Promise<void> {
    if (this.runPromise) {
      return this.runPromise;
    }

    this.stopRequested = false;
    this.nextSessionAcquireAtMs = 0;
    this.sessionAcquireRateLimitStreak = 0;
    const runner = this.runLoop();
    this.runPromise = runner;

    try {
      await runner;
    } finally {
      if (this.runPromise === runner) {
        this.runPromise = null;
      }
    }
  }

  async start(): Promise<void> {
    if (this.runPromise) {
      return;
    }

    this.stopRequested = false;
    this.nextSessionAcquireAtMs = 0;
    this.sessionAcquireRateLimitStreak = 0;
    const runner = this.runLoop();
    this.runPromise = runner;

    runner.finally(() => {
      if (this.runPromise === runner) {
        this.runPromise = null;
      }
    });
  }

  async stop(): Promise<void> {
    this.stopRequested = true;

    const pendingCloses = Array.from(this.sessions.values()).map((state) =>
      this.closeSession(state, this.options.closeReason, true)
    );
    await Promise.allSettled(pendingCloses);

    if (this.runPromise) {
      await this.runPromise;
    }
  }

  private async runLoop(): Promise<void> {
    await mkdir(this.options.runtimeDocsDirectory, { recursive: true });
    await mkdir(this.options.runtimeWorkingDirectory, { recursive: true });

    try {
      await this.options.client.prewarmRealtimeTransport();
    } catch (error) {
      await this.emitError(
        new Error(
          `Realtime transport prewarm failed; continuing without prewarm. ${normalizeError(error).message}`
        )
      );
    }

    while (!this.stopRequested) {
      const nowMs = Date.now();
      if (this.shouldAcquireSession(nowMs)) {
        try {
          await this.acquirePersistentSession();
        } catch (error) {
          await this.emitError(normalizeError(error));
        }
      }

      await sleep(this.resolveLoopDelayMs());
    }
  }

  private shouldAcquireSession(nowMs: number): boolean {
    if (!this.options.realtimeSessionsEnabled) {
      return false;
    }

    if (!this.options.sessionPollingEnabled) {
      return false;
    }

    return nowMs >= this.nextSessionAcquireAtMs;
  }

  private async acquirePersistentSession(): Promise<void> {
    const nowMs = Date.now();
    const response = await this.options.client.operations.listAgentRealtimeRequestedSessions({
      headers: {
        "X-Agent-Id": String(this.options.agent)
      },
    });

    if (response.error) {
      const status = Number(response.status || 0);
      if (status === 429) {
        this.sessionAcquireRateLimitStreak += 1;
        const streakMultiplier = 2 ** Math.min(this.sessionAcquireRateLimitStreak, 5);
        const baseBackoffMs = Math.max(this.options.requestPollMs * streakMultiplier, 4_000);
        const retryAfterMs = parseRetryAfterMs(response.response);
        const cappedBackoffMs = Math.min(Math.max(baseBackoffMs, retryAfterMs ?? 0), MAX_RATE_LIMIT_BACKOFF_MS);
        const backoffMs = withJitter(cappedBackoffMs, resolveBackoffJitterMs(cappedBackoffMs));
        this.nextSessionAcquireAtMs = nowMs + backoffMs;
        if (nowMs - this.lastSessionAcquireRateLimitLogAtMs >= 5_000) {
          this.lastSessionAcquireRateLimitLogAtMs = nowMs;
          await this.emitError(
            new Error(
              `realtime session acquisition rate limited (429); backing off for ${backoffMs}ms.`
            )
          );
        }
        return;
      }

      this.sessionAcquireRateLimitStreak = 0;
      this.nextSessionAcquireAtMs =
        nowMs + withJitter(this.options.requestPollMs, resolveBackoffJitterMs(this.options.requestPollMs));
      throw createOperationError("listAgentRealtimeRequestedSessions", response.status, response.error);
    }

    this.sessionAcquireRateLimitStreak = 0;
    this.nextSessionAcquireAtMs =
      nowMs + withJitter(this.options.requestPollMs, resolveBackoffJitterMs(this.options.requestPollMs));

    const payload = valueAsObject(response.data) ?? (await readJsonResponseObject(response.response));
    const sessions = Array.isArray(payload?.data) ? payload.data : [];
    const orderedSessions = [...sessions].sort(
      (left, right) => toPositiveInteger(right?.id) - toPositiveInteger(left?.id)
    );
    const limitedSessions = orderedSessions.slice(0, Math.max(1, this.options.requestedSessionLimit));

    const preferredSessions = limitedSessions.filter((session) => toPositiveInteger(session?.requested_by_user_id) >= 1);
    const fallbackSessions = limitedSessions.filter((session) => toPositiveInteger(session?.requested_by_user_id) < 1);
    const nextSessionId = [...preferredSessions, ...fallbackSessions]
      .map((session) => toPositiveInteger(session?.id))
      .find((sessionId) => sessionId > 0 && !this.sessions.has(sessionId));

    if (typeof nextSessionId !== "number") {
      return;
    }

    this.startSessionLoop(nextSessionId);
  }

  private resolveLoopDelayMs(): number {
    const nowMs = Date.now();
    if (this.sessions.size > 0) {
      return DEFAULT_PUSH_LOOP_DELAY_MS;
    }

    const fallbackDelayMs = Math.max(this.options.requestPollMs, 1_500);
    const requestedDelayMs = Math.max(0, this.nextSessionAcquireAtMs - nowMs);

    return Math.max(150, Math.min(fallbackDelayMs, requestedDelayMs));
  }

  private startSessionLoop(sessionId: number): void {
    const nowMs = Date.now();
    const state: SessionState = {
      sessionId,
      session: null,
      subscription: null,
      closed: false,
      closeReason: null,
      lastSignalId: 0,
      lastNonAgentSignalId: 0,
      connectionState: "connecting",
      sawConnectedState: false,
      createdAtMs: nowMs,
      lastHealthActivityAtMs: nowMs,
      lastConnectionStateChangeAtMs: nowMs,
      chatSignalQueue: Promise.resolve(),
      processedInboundKeys: new Map(),
      inboundChunkBuffers: new Map()
    };

    this.sessions.set(sessionId, state);

    void (async () => {
      try {
        const subscription = await this.options.client.subscribeToRealtimeNotifications({
          agent: this.options.agent,
          session: sessionId,
          autoCloseSession: false,
          onReady: async (session) => {
            const nowMs = Date.now();
            state.session = session;
            state.connectionState = "connected";
            state.lastConnectionStateChangeAtMs = nowMs;
            state.lastHealthActivityAtMs = nowMs;

            if (this.options.includeInitialSnapshot && this.options.filesRealtimeEnabled) {
              const reason = state.sawConnectedState ? "reconnected" : "session_ready";
              await this.sendInitialSnapshot(state, reason);
            }

            state.sawConnectedState = true;
            await callOptionalHandler(this.options.onSessionReady, session, this.options.onError);
          },
          onSignal: async (signal) => {
            void this.handleSignal(state, signal, "websocket").catch(async (error) => {
              await this.emitError(normalizeError(error));
            });
          },
          onNotification: async (event) => {
            await this.handleSubscriptionNotification(state, event);
          },
          onConnectionStateChange: async (nextState) => {
            const nowMs = Date.now();
            const previousState = state.connectionState;
            state.connectionState = nextState;
            state.lastConnectionStateChangeAtMs = nowMs;

            if (
              this.options.includeInitialSnapshot &&
              this.options.filesRealtimeEnabled &&
              nextState === "connected" &&
              previousState !== "connected" &&
              state.sawConnectedState
            ) {
              await this.sendInitialSnapshot(state, "reconnected");
            }

            if (nextState === "connected") {
              state.sawConnectedState = true;
              state.lastHealthActivityAtMs = nowMs;
            }

            await callOptionalHandler(
              this.options.onConnectionStateChange,
              {
                sessionId: state.sessionId,
                state: nextState
              },
              this.options.onError
            );
          },
          onError: async (error) => {
            await this.emitError(error);
          }
        });

        state.subscription = subscription;
        state.session = subscription.session;
        try {
          await subscription.ready;
        } catch (error) {
          if (this.stopRequested) {
            state.closeReason = this.options.closeReason;
            await this.closeSession(state, state.closeReason, this.options.closeSessionOnStop, true, this.options.closeStatus);
            return;
          }

          const nowMs = Date.now();
          const normalizedError = normalizeError(error);

          state.connectionState = "unavailable";
          state.lastConnectionStateChangeAtMs = nowMs;
          state.lastHealthActivityAtMs = nowMs;

          await callOptionalHandler(
            this.options.onConnectionStateChange,
            {
              sessionId: state.sessionId,
              state: "unavailable"
            },
            this.options.onError
          );

          await this.emitError(
            new Error(
              `Realtime websocket startup failed for session ${state.sessionId}; recycling session. ${normalizedError.message}`
            )
          );
          state.closeReason = "session_websocket_startup_failed";
          await this.closeSession(
            state,
            state.closeReason,
            this.options.selfHealCloseRemote,
            this.options.selfHealCloseRemote,
            "failed"
          );
          return;
        }

        while (!this.stopRequested && !state.closed) {
          const nowMs = Date.now();
          await this.maybeSelfHealSession(state, nowMs);
          if (state.closed || this.stopRequested) {
            break;
          }

          await sleep(150);
        }
      } catch (error) {
        const normalizedError = normalizeError(error);
        if (isSessionClaimFailureError(normalizedError)) {
          state.closeReason = "session_claim_failed";
        } else {
          state.closeReason = state.closeReason ?? "session_loop_error";
        }

        await this.emitError(normalizedError);
      } finally {
        const hasOwnedSessionHandle = state.subscription !== null || state.session !== null;
        const shouldCloseRemote =
          !this.stopRequested && this.options.selfHealCloseRemote && hasOwnedSessionHandle;
        await this.closeSession(
          state,
          state.closeReason ?? "session_loop_ended",
          shouldCloseRemote,
          shouldCloseRemote,
          shouldCloseRemote ? "failed" : undefined
        );
      }
    })();
  }

  private async handleSignal(
    state: SessionState,
    signal: AgentRealtimeSignalMessage,
    source: SessionSignalSource
  ): Promise<void> {
    if (state.closed) {
      return;
    }

    state.lastHealthActivityAtMs = Date.now();
    const normalizedSender = normalizeLowercase(signal.sender);

    if (signal.id > 0) {
      const isAgentSender = normalizedSender === "agent";

      if (isAgentSender) {
        if (signal.id <= state.lastSignalId) {
          return;
        }
      } else {
        if (signal.id <= state.lastNonAgentSignalId) {
          return;
        }
        state.lastNonAgentSignalId = signal.id;
      }

      state.lastSignalId = Math.max(state.lastSignalId, signal.id);
    }

    await callOptionalHandler(
      this.options.onSignal,
      {
        sessionId: state.sessionId,
        source,
        signal
      },
      this.options.onError
    );

    if (this.options.notificationsRealtimeEnabled) {
      await this.dispatchSignalNotificationEvents(state, signal, source);
    }

    const signalType = normalizeLowercase(signal.type);
    if (signalType === "close") {
      state.closeReason = "session_closed";
      await this.closeSession(state, state.closeReason, false);
      return;
    }

    if (normalizedSender !== "browser" || signalType !== "message") {
      return;
    }

    const payload = valueAsObject(signal.payload) ?? {};
    const channelType = normalizeLowercase(payload.type);
    const channelPayload = valueAsObject(payload.payload) ?? {};

    if (this.options.chatRealtimeEnabled && (channelType === "chat.user" || channelType === "chat.request")) {
      await this.enqueueChatUserSignal(state, signal, payload, channelPayload);
      return;
    }

    if (this.options.filesRealtimeEnabled && channelType === "snapshot.request") {
      await this.handleSnapshotRequest(state, payload, channelPayload);
      return;
    }

    if (this.options.filesRealtimeEnabled && channelType === "file.save") {
      await this.handleFileSave(state, payload, channelPayload);
      return;
    }

    if (this.options.filesRealtimeEnabled && channelType === "file.delete") {
      await this.handleFileDelete(state, payload, channelPayload);
      return;
    }

    if (channelType === "agent.profile.update") {
      await this.emitDebug("agent.profile.update.signal", {
        session_id: state.sessionId,
        source,
        request_id:
          valueAsString(channelPayload.request_id)?.trim() ||
          valueAsString(payload.request_id)?.trim() ||
          null,
        payload_keys: Object.keys(channelPayload).slice(0, 12)
      });
      await this.handleAgentProfileUpdate(state, payload, channelPayload);
      return;
    }

    await callOptionalHandler(
      this.options.onUnhandledMessage,
      {
        sessionId: state.sessionId,
        source,
        signal,
        channelType: channelType || null,
        payload: channelPayload
      },
      this.options.onError
    );
  }

  private enqueueChatUserSignal(
    state: SessionState,
    signal: AgentRealtimeSignalMessage,
    envelope: JsonObject,
    payload: JsonObject
  ): Promise<void> {
    const existingQueue = state.chatSignalQueue instanceof Promise ? state.chatSignalQueue : Promise.resolve();
    state.chatSignalQueue = existingQueue
      .catch(() => {})
      .then(async () => {
        if (state.closed || this.stopRequested) {
          return;
        }

        state.lastHealthActivityAtMs = Date.now();
        try {
          await this.handleChatUserSignal(state, signal, envelope, payload);
          state.lastHealthActivityAtMs = Date.now();
        } catch (error) {
          await this.emitError(normalizeError(error));
        }
      });

    return state.chatSignalQueue;
  }

  private async handleSubscriptionNotification(
    state: SessionState,
    event: AgentRealtimeNotificationEvent
  ): Promise<void> {
    if (!this.options.notificationsRealtimeEnabled) {
      return;
    }

    state.lastHealthActivityAtMs = Date.now();
    await this.dispatchNotificationEvent(state, {
      source: "websocket",
      signal: event.signal,
      notification: event.notification,
      notificationType: event.notificationType,
      channelType: event.channelType
    });
  }

  private async dispatchSignalNotificationEvents(
    state: SessionState,
    signal: AgentRealtimeSignalMessage,
    source: SessionSignalSource
  ): Promise<void> {
    const payload = valueAsObject(signal.payload) ?? {};
    const channelType = valueAsString(payload.type)?.toLowerCase() ?? null;
    const body = valueAsObject(payload.payload) ?? payload;
    const notification = extractNotification(body, channelType);

    if (notification) {
      const notificationType = valueAsString(notification.notification_type)?.toLowerCase() ?? null;
      await this.dispatchNotificationEvent(state, {
        source,
        signal,
        notification,
        notificationType,
        channelType
      });
    }
  }

  private async dispatchNotificationEvent(
    state: Pick<SessionState, "sessionId" | "session" | "closed">,
    input: {
      source: SessionSignalSource;
      signal: AgentRealtimeSignalMessage;
      notification: JsonObject;
      notificationType: MaybeNotificationType;
      channelType: string | null;
    }
  ): Promise<boolean> {
    const eventDedupeKey = notificationEventDedupeKey(input.notification, input.signal.id);
    if (!this.shouldProcessNotificationKey(eventDedupeKey)) {
      return false;
    }

    await this.maybeBridgeNotificationToAi(state, input);

    if (!this.options.onNotification) {
      return true;
    }

    await callOptionalHandler(
      this.options.onNotification,
      {
        sessionId: state.sessionId,
        source: input.source,
        signal: input.signal,
        notification: input.notification,
        notificationType: input.notificationType,
        channelType: input.channelType
      },
      this.options.onError
    );
    return true;
  }

  private async maybeBridgeNotificationToAi(
    state: Pick<SessionState, "sessionId" | "session" | "closed">,
    input: {
      source: SessionSignalSource;
      signal: AgentRealtimeSignalMessage;
      notification: JsonObject;
      notificationType: MaybeNotificationType;
      channelType: string | null;
    }
  ): Promise<void> {
    if (state.closed || this.stopRequested) {
      return;
    }

    const effectiveNotificationType =
      normalizeLowercase(input.notificationType) || normalizeLowercase(input.notification.notification_type) || null;

    if (!this.options.bridgeNotificationsToAi) {
      return;
    }

    if (!shouldBridgeNotificationType(this.options.bridgeNotificationTypes, effectiveNotificationType)) {
      return;
    }

    if (!this.options.bridgeReadNotifications && valueAsBoolean(input.notification.is_read) === true) {
      return;
    }

    const dedupeKey = notificationDedupeKey(input.notification, input.signal.id);
    if (!this.shouldProcessNotificationKey(dedupeKey)) {
      return;
    }

    const requestId = notificationRequestId(input.notification, input.signal.id, state.sessionId);
    const userText = buildNotificationBridgeUserText({
      notification: input.notification,
      notificationType: effectiveNotificationType,
      channelType: input.channelType,
      signalId: input.signal.id
    });

    const bridgedUserText = buildAgentMcBridgeMessage({
      userText
    });

    let runResult: OpenClawRunResult;
    try {
      runResult = await this.runAgentChat({
        sessionId: state.sessionId,
        requestId,
        userText: bridgedUserText
      });
    } catch (error) {
      runResult = {
        requestId,
        runId: `agentmc-${state.sessionId}-${requestId}`,
        status: "error",
        textSource: "error",
        content: fallbackAssistantContentForStatus("error")
      };
      await this.emitError(normalizeError(error));
    }

    await this.markNotificationReadOnSuccess(input.notification, runResult);

    await callOptionalHandler(
      this.options.onNotificationBridge,
      {
        sessionId: state.sessionId,
        source: input.source,
        signal: input.signal,
        notification: input.notification,
        notificationType: effectiveNotificationType,
        channelType: input.channelType,
        requestId,
        run: runResult
      },
      this.options.onError
    );
  }

  private async markNotificationReadOnSuccess(
    notification: JsonObject,
    runResult: OpenClawRunResult
  ): Promise<void> {
    if (runResult.status !== "ok" || runResult.textSource !== "wait") {
      return;
    }

    if (valueAsBoolean(notification.is_read) === true) {
      return;
    }

    const notificationId = valueAsString(notification.id)?.trim();
    if (!notificationId) {
      return;
    }

    try {
      const response = await this.options.client.operations.markNotificationRead({
        params: {
          path: {
            notification: notificationId
          }
        },
        headers: {
          "X-Agent-Id": String(this.options.agent)
        }
      });

      if (response.error) {
        await this.emitError(createOperationError("markNotificationRead", response.status, response.error));
      }
    } catch (error) {
      await this.emitError(normalizeError(error));
    }
  }

  private async handleChatUserSignal(
    state: SessionState,
    signal: AgentRealtimeSignalMessage,
    envelope: JsonObject,
    payload: JsonObject
  ): Promise<void> {
    this.pruneInboundChunkBuffers(state);

    let resolvedPayload = payload;
    let requestIdHint: string | null = null;
    let chunkIdHint: string | null = null;
    const channelType = normalizeLowercase(envelope.type) || "chat.user";
    const inboundChunkFrame = parseInboundChunkFrame(channelType, payload);

    if (inboundChunkFrame) {
      const chunkFrameDedupeKey = `chat:chunk:${inboundChunkFrame.chunkId}:${inboundChunkFrame.chunkIndex}`;
      if (!shouldProcessInboundKey(state, chunkFrameDedupeKey, this.options.duplicateTtlMs)) {
        return;
      }

      const chunkResult = this.collectInboundChunk(state, inboundChunkFrame);
      requestIdHint = chunkResult.requestId;
      chunkIdHint = inboundChunkFrame.chunkId;

      if (chunkResult.status === "pending") {
        return;
      }

      if (chunkResult.status === "error") {
        const chunkRequestId =
          requestIdHint ||
          valueAsString(payload.request_id)?.trim() ||
          valueAsString(envelope.request_id)?.trim() ||
          `req-${state.sessionId}-${inboundChunkFrame.chunkId}`;
        await this.publishChannelMessage(state.sessionId, "chat.agent.done", chunkRequestId, {
          content: chunkResult.error,
          meta: {
            source: this.options.runtimeSource,
            run_id: `agentmc-${state.sessionId}-${chunkRequestId}`,
            status: "error",
            text_source: "error",
            signal_id: signal.id,
            generated_at: new Date().toISOString()
          }
        });
        return;
      }

      resolvedPayload = chunkResult.payload;
      requestIdHint = chunkResult.requestId;
    }

    const requestId =
      valueAsString(resolvedPayload.request_id)?.trim() ||
      valueAsString(payload.request_id)?.trim() ||
      valueAsString(envelope.request_id)?.trim() ||
      requestIdHint ||
      (chunkIdHint ? `req-${state.sessionId}-${chunkIdHint}` : `req-${state.sessionId}-${Date.now().toString(36)}`);
    const messageId = toPositiveInteger(resolvedPayload.message_id);
    const dedupeKey = messageId > 0 ? `chat:message:${messageId}` : `chat:request:${requestId}`;
    if (!shouldProcessInboundKey(state, dedupeKey, this.options.duplicateTtlMs)) {
      return;
    }

    const userText =
      valueAsString(resolvedPayload.content)?.trim() ||
      valueAsString(resolvedPayload.message)?.trim() ||
      "";

    if (userText === "") {
      await this.publishChannelMessage(state.sessionId, "chat.agent.done", requestId, {
        content: "I need a user message before I can respond.",
        ...(messageId > 0 ? { message_id: messageId } : {}),
        meta: {
          source: this.options.runtimeSource,
          run_id: `agentmc-${state.sessionId}-${requestId}`,
          status: "error",
          text_source: "error",
          signal_id: signal.id,
          generated_at: new Date().toISOString()
        }
      });
      return;
    }

    const bridgedUserText = buildAgentMcBridgeMessage({
      userText
    });

    let runResult: OpenClawRunResult;
    const stopActivityPulse = this.startSessionActivityPulse(state);
    const stopChatStatusPulse = this.startChatStatusPulse(state, requestId, messageId);
    try {
      runResult = await this.runAgentChat({
        sessionId: state.sessionId,
        requestId,
        userText: bridgedUserText
      });
    } catch (error) {
      runResult = {
        requestId,
        runId: `agentmc-${state.sessionId}-${requestId}`,
        status: "error",
        textSource: "error",
        content: fallbackAssistantContentForStatus("error")
      };
      await this.emitError(normalizeError(error));
    } finally {
      stopChatStatusPulse();
      stopActivityPulse();
      state.lastHealthActivityAtMs = Date.now();
    }

    const content = sanitizeAssistantOutputText(runResult.content);
    const finalizedContent =
      content === "" ? fallbackAssistantContentForStatus(runResult.status) : content;

    await this.publishChannelMessage(state.sessionId, "chat.agent.done", requestId, {
      content: finalizedContent,
      ...(messageId > 0 ? { message_id: messageId } : {}),
      meta: {
        source: this.options.runtimeSource,
        run_id: runResult.runId,
        status: runResult.status,
        text_source: runResult.textSource,
        signal_id: signal.id,
        generated_at: new Date().toISOString()
      }
    });
  }

  private collectInboundChunk(
    state: SessionState,
    frame: InboundChunkFrame
  ): {
    status: "pending" | "ready" | "error";
    requestId: string | null;
    payload: JsonObject;
    error: string;
  } {
    const chunkBufferKey = `${frame.channelType}:${frame.chunkId}`;
    const nowMs = Date.now();
    let buffer = state.inboundChunkBuffers.get(chunkBufferKey);

    if (!buffer) {
      buffer = {
        channelType: frame.channelType,
        chunkId: frame.chunkId,
        chunkTotal: frame.chunkTotal,
        requestId: frame.requestId,
        chunks: new Map(),
        updatedAtMs: nowMs
      };
      state.inboundChunkBuffers.set(chunkBufferKey, buffer);
    }

    if (buffer.chunkTotal !== frame.chunkTotal) {
      state.inboundChunkBuffers.delete(chunkBufferKey);
      return {
        status: "error",
        requestId: frame.requestId,
        payload: {},
        error: "I received conflicting chunk metadata for this request. Please retry."
      };
    }

    buffer.updatedAtMs = nowMs;
    if (!buffer.requestId && frame.requestId) {
      buffer.requestId = frame.requestId;
    }
    buffer.chunks.set(frame.chunkIndex, frame.data);

    if (buffer.chunks.size < buffer.chunkTotal) {
      return {
        status: "pending",
        requestId: buffer.requestId,
        payload: {},
        error: ""
      };
    }

    const orderedChunks: string[] = [];
    for (let index = 1; index <= buffer.chunkTotal; index += 1) {
      const chunk = buffer.chunks.get(index);
      if (typeof chunk !== "string") {
        return {
          status: "pending",
          requestId: buffer.requestId,
          payload: {},
          error: ""
        };
      }

      orderedChunks.push(chunk);
    }

    state.inboundChunkBuffers.delete(chunkBufferKey);
    const payloadBase64 = orderedChunks.join("");
    const decodedPayload = decodeChunkedPayloadObject(payloadBase64);
    if (!decodedPayload) {
      return {
        status: "error",
        requestId: buffer.requestId,
        payload: {},
        error: "I could not decode the chunked user message. Please retry."
      };
    }

    const requestId =
      valueAsString(decodedPayload.request_id)?.trim() ||
      buffer.requestId ||
      null;

    return {
      status: "ready",
      requestId,
      payload: decodedPayload,
      error: ""
    };
  }

  private pruneInboundChunkBuffers(state: SessionState): void {
    const nowMs = Date.now();
    const ttlMs = Math.max(5_000, this.options.duplicateTtlMs);
    for (const [key, buffer] of state.inboundChunkBuffers.entries()) {
      if (!Number.isFinite(buffer.updatedAtMs) || nowMs - buffer.updatedAtMs > ttlMs) {
        state.inboundChunkBuffers.delete(key);
      }
    }
  }

  private async runAgentChat(input: AgentRuntimeRunInput): Promise<OpenClawRunResult> {
    if (this.options.runAgent) {
      const result = await this.options.runAgent(input);
      return {
        requestId: input.requestId,
        runId: valueAsString(result.runId)?.trim() || `agentmc-${input.sessionId}-${input.requestId}`,
        status: result.status,
        textSource: result.textSource,
        content: String(result.content ?? "")
      };
    }

    return this.runOpenClawChat(input);
  }

  private async runOpenClawChat(input: {
    sessionId: number;
    requestId: string;
    userText: string;
  }): Promise<OpenClawRunResult> {
    const fallbackRunId = `agentmc-${input.sessionId}-${input.requestId}`;
    let runId = fallbackRunId;
    const sessionKey = `agent:${this.options.openclawAgent}:agentmc:${input.sessionId}`;
    const timeoutMs = this.resolveOpenClawAgentCommandTimeout();
    let commandStatus: "ok" | "error" | "timeout" = "ok";
    let commandErrorMessage: string | null = null;

    const commandOptions = {
      cwd: this.options.runtimeWorkingDirectory,
      encoding: "utf8" as const,
      maxBuffer: this.options.openclawMaxBufferBytes,
      env: buildAgentRuntimeCommandEnv({
        apiKey: this.options.agentmcApiKey,
        apiBaseUrl: this.options.agentmcBaseUrl,
        openApiUrl: this.options.agentmcOpenApiUrl
      })
    };

    try {
      const output = await execFileWithTimeoutAndKill(
        this.options.openclawCommand,
        ["agent", "--agent", this.options.openclawAgent, "--message", input.userText],
        {
          ...commandOptions,
          timeoutMs,
          forceKillGraceMs: DEFAULT_OPENCLAW_FORCE_KILL_GRACE_MS
        }
      );
      const commandResult =
        parseJsonUnknownOutput(output.stdout) ??
        parseJsonUnknownOutput(output.stderr) ??
        null;
      runId = resolveOpenClawRunId(commandResult) ?? fallbackRunId;

      const directText = sanitizeAssistantOutputText(
        parseExternalAgentOutput(output.stdout) || parseExternalAgentOutput(output.stderr)
      );
      if (directText !== "") {
        return {
          requestId: input.requestId,
          runId,
          status: "ok",
          textSource: "wait",
          content: directText
        };
      }
    } catch (error) {
      const objectError = valueAsObject(error);
      const stdout = execOutputToString(objectError?.stdout);
      const stderr = execOutputToString(objectError?.stderr);
      const commandResult = parseJsonUnknownOutput(stdout) ?? parseJsonUnknownOutput(stderr) ?? null;
      runId = resolveOpenClawRunId(commandResult) ?? runId;

      const directText = sanitizeAssistantOutputText(
        parseExternalAgentOutput(stdout) || parseExternalAgentOutput(stderr)
      );
      if (directText !== "") {
        return {
          requestId: input.requestId,
          runId,
          status: "ok",
          textSource: "wait",
          content: directText
        };
      }

      commandErrorMessage = normalizeError(error).message;
      commandStatus =
        isCommandTimeoutError(error, commandErrorMessage)
          ? "timeout"
          : "error";
    }

    const historyText = await this.readLatestAssistantText(sessionKey);
    const sanitizedHistoryText = historyText ? sanitizeAssistantOutputText(historyText) : "";
    if (sanitizedHistoryText !== "") {
      return {
        requestId: input.requestId,
        runId,
        status: "ok",
        textSource: "session_history",
        content: sanitizedHistoryText
      };
    }

    if (commandStatus === "error") {
      return {
        requestId: input.requestId,
        runId,
        status: "error",
        textSource: "error",
        content: `I hit an error in the OpenClaw run: ${commandErrorMessage ?? "unknown error"}`
      };
    }

    if (commandStatus === "timeout") {
      return {
        requestId: input.requestId,
        runId,
        status: "timeout",
        textSource: "fallback",
        content: "I finished waiting for the run, but no assistant text was found before timeout."
      };
    }

    return {
      requestId: input.requestId,
      runId,
      status: "ok",
      textSource: "fallback",
      content: "I finished the run, but no assistant text was found."
    };
  }

  private resolveOpenClawAgentCommandTimeout(): number {
    const preferred = Math.max(this.options.openclawSubmitTimeoutMs, this.options.openclawWaitTimeoutMs);
    const bounded = Math.min(this.options.openclawGatewayTimeoutMs, preferred);
    return Math.max(1_000, bounded);
  }

  private async readLatestAssistantText(sessionKey: string): Promise<string | null> {
    try {
      const raw = JSON.parse(await readFile(this.options.openclawSessionsPath, "utf8"));
      const sessions = sessionsFromStore(raw);
      const session = sessions.find((candidate) => {
        const key =
          valueAsString(candidate.key)?.trim() ||
          valueAsString(candidate.sessionKey)?.trim() ||
          valueAsString(candidate.session_key)?.trim() ||
          "";
        return key === sessionKey;
      });

      if (!session) {
        return null;
      }

      const messages = messagesFromSession(session);
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const text = extractAssistantTextFromEntry(messages[index]);
        if (text) {
          return text;
        }
      }

      const sessionFile =
        valueAsString(session.sessionFile)?.trim() ||
        valueAsString(session.session_file)?.trim() ||
        "";
      if (sessionFile === "") {
        return null;
      }

      for (const candidatePath of resolveSessionFilePaths(
        sessionFile,
        this.options.openclawSessionsPath,
        this.options.runtimeWorkingDirectory
      )) {
        const text = await readLatestAssistantTextFromJsonl(candidatePath);
        if (text) {
          return text;
        }
      }
    } catch {
      return null;
    }

    return null;
  }

  private async handleSnapshotRequest(
    state: SessionState,
    envelope: JsonObject,
    payload: JsonObject
  ): Promise<void> {
    const requestId =
      valueAsString(payload.request_id)?.trim() ||
      valueAsString(envelope.request_id)?.trim() ||
      `snapshot-${state.sessionId}-${Date.now().toString(36)}`;

    const reason =
      valueAsString(payload.reason)?.trim() ||
      valueAsString(envelope.reason)?.trim() ||
      "snapshot_request";

    await this.sendSnapshotResponse(state.sessionId, requestId, reason);
  }

  private async handleFileSave(state: SessionState, envelope: JsonObject, payload: JsonObject): Promise<void> {
    const requestIdFromPayload =
      valueAsString(payload.request_id)?.trim() ||
      valueAsString(envelope.request_id)?.trim() ||
      "";
    const requestId = requestIdFromPayload || `file-save-${state.sessionId}-${Date.now().toString(36)}`;
    const fileId = normalizeDocId(valueAsString(payload.file_id) ?? valueAsString(payload.doc_id));
    const dedupeKey = `file.save:${requestId}:${fileId ?? "unknown"}`;

    if (!shouldProcessInboundKey(state, dedupeKey, this.options.duplicateTtlMs)) {
      return;
    }

    if (!requestIdFromPayload) {
      await this.publishChannelMessage(state.sessionId, "file.save.error", requestId, {
        ...buildFileIdPayload(fileId ?? ""),
        code: "invalid_request",
        error: "request_id is required"
      });
      return;
    }

    if (!fileId) {
      await this.publishChannelMessage(state.sessionId, "file.save.error", requestId, {
        ...buildFileIdPayload(""),
        code: "invalid_request",
        error: "file_id is required"
      });
      return;
    }

    if (!this.options.runtimeDocIds.includes(fileId)) {
      await this.publishChannelMessage(state.sessionId, "file.save.error", requestId, {
        ...buildFileIdPayload(fileId),
        code: "invalid_file_id",
        error: "file_id is not allowed for this runtime"
      });
      return;
    }

    const baseHash = valueAsString(payload.base_hash)?.trim() || "";
    const title = valueAsString(payload.title)?.trim() || fileId;
    const bodyMarkdown = valueAsString(payload.body_markdown) ?? "";

    try {
      const current = await this.readRuntimeDoc(fileId);

      if (current && baseHash !== current.base_hash) {
        await this.publishChannelMessage(state.sessionId, "file.save.error", requestId, {
          ...buildFileIdPayload(fileId),
          code: "conflict",
          error: "base_hash mismatch",
          current_hash: current.base_hash
        });
        return;
      }

      if (!current && baseHash !== "") {
        await this.publishChannelMessage(state.sessionId, "file.save.error", requestId, {
          ...buildFileIdPayload(fileId),
          code: "conflict",
          error: "base_hash mismatch",
          current_hash: null
        });
        return;
      }

      await writeFile(this.resolveRuntimeDocPath(fileId), bodyMarkdown, "utf8");
      const next = await this.readRuntimeDoc(fileId);

      if (!next) {
        throw new Error(`Failed to read runtime file ${fileId} after save.`);
      }

      await this.publishChannelMessage(state.sessionId, "file.save.ok", requestId, {
        ...buildFileIdPayload(fileId),
        doc: {
          id: fileId,
          title: title || next.title,
          body_markdown: next.body_markdown,
          base_hash: next.base_hash
        }
      });
    } catch (error) {
      const normalized = normalizeError(error);
      await this.emitError(normalized);

      try {
        await this.publishChannelMessage(state.sessionId, "file.save.error", requestId, {
          ...buildFileIdPayload(fileId),
          code: "save_failed",
          error: "failed to save file"
        });
      } catch (publishError) {
        await this.emitError(normalizeError(publishError));
      }
    }
  }

  private async handleFileDelete(state: SessionState, envelope: JsonObject, payload: JsonObject): Promise<void> {
    const requestIdFromPayload =
      valueAsString(payload.request_id)?.trim() ||
      valueAsString(envelope.request_id)?.trim() ||
      "";
    const requestId = requestIdFromPayload || `file-delete-${state.sessionId}-${Date.now().toString(36)}`;
    const fileId = normalizeDocId(valueAsString(payload.file_id) ?? valueAsString(payload.doc_id));
    const dedupeKey = `file.delete:${requestId}:${fileId ?? "unknown"}`;

    if (!shouldProcessInboundKey(state, dedupeKey, this.options.duplicateTtlMs)) {
      return;
    }

    if (!requestIdFromPayload) {
      await this.publishChannelMessage(state.sessionId, "file.delete.error", requestId, {
        ...buildFileIdPayload(fileId ?? ""),
        code: "invalid_request",
        error: "request_id is required"
      });
      return;
    }

    if (!fileId) {
      await this.publishChannelMessage(state.sessionId, "file.delete.error", requestId, {
        ...buildFileIdPayload(""),
        code: "invalid_request",
        error: "file_id is required"
      });
      return;
    }

    if (!this.options.runtimeDocIds.includes(fileId)) {
      await this.publishChannelMessage(state.sessionId, "file.delete.error", requestId, {
        ...buildFileIdPayload(fileId),
        code: "invalid_file_id",
        error: "file_id is not allowed for this runtime"
      });
      return;
    }

    try {
      const current = await this.readRuntimeDoc(fileId);
      if (!current) {
        await this.publishChannelMessage(state.sessionId, "file.delete.error", requestId, {
          ...buildFileIdPayload(fileId),
          code: "not_found",
          error: "file not found"
        });
        return;
      }

      const baseHash = valueAsString(payload.base_hash)?.trim() || "";
      if (baseHash !== current.base_hash) {
        await this.publishChannelMessage(state.sessionId, "file.delete.error", requestId, {
          ...buildFileIdPayload(fileId),
          code: "conflict",
          error: "base_hash mismatch",
          current_hash: current.base_hash
        });
        return;
      }

      await rm(this.resolveRuntimeDocPath(fileId), { force: false });

      await this.publishChannelMessage(state.sessionId, "file.delete.ok", requestId, {
        ...buildFileIdPayload(fileId)
      });
    } catch (error) {
      const normalized = normalizeError(error);
      await this.emitError(normalized);

      try {
        await this.publishChannelMessage(state.sessionId, "file.delete.error", requestId, {
          ...buildFileIdPayload(fileId),
          code: "delete_failed",
          error: "failed to delete file"
        });
      } catch (publishError) {
        await this.emitError(normalizeError(publishError));
      }
    }
  }

  private async handleAgentProfileUpdate(
    state: SessionState,
    envelope: JsonObject,
    payload: JsonObject
  ): Promise<void> {
    const requestIdFromPayload =
      valueAsString(payload.request_id)?.trim() ||
      valueAsString(envelope.request_id)?.trim() ||
      "";
    const requestId = requestIdFromPayload || `agent-profile-${state.sessionId}-${Date.now().toString(36)}`;
    const hasName = hasOwn(envelope, "name") || hasOwn(payload, "name");
    const hasEmoji = hasOwn(envelope, "emoji") || hasOwn(payload, "emoji");
    const rawName = valueAsString(payload.name) ?? valueAsString(envelope.name);
    const rawEmoji = valueAsString(payload.emoji) ?? valueAsString(envelope.emoji);
    const name = normalizeAgentProfileName(rawName);
    const emoji = normalizeAgentProfileEmoji(rawEmoji);
    const dedupeKey = `agent.profile.update:${requestId}`;

    await this.emitDebug("agent.profile.update.received", {
      session_id: state.sessionId,
      request_id: requestIdFromPayload || null,
      generated_request_id: requestIdFromPayload ? null : requestId,
      has_name: hasName,
      has_emoji: hasEmoji,
      normalized_name: name,
      normalized_emoji: emoji
    });

    if (!shouldProcessInboundKey(state, dedupeKey, this.options.duplicateTtlMs)) {
      await this.emitDebug("agent.profile.update.deduped", {
        session_id: state.sessionId,
        request_id: requestId
      });
      return;
    }

    if (!requestIdFromPayload) {
      await this.emitDebug("agent.profile.update.rejected", {
        session_id: state.sessionId,
        request_id: requestId,
        reason: "request_id_missing"
      });
      await this.publishChannelMessage(state.sessionId, "agent.profile.error", requestId, {
        code: "invalid_request",
        error: "request_id is required"
      });
      return;
    }

    if (!hasName && !hasEmoji) {
      await this.emitDebug("agent.profile.update.rejected", {
        session_id: state.sessionId,
        request_id: requestId,
        reason: "name_or_emoji_required"
      });
      await this.publishChannelMessage(state.sessionId, "agent.profile.error", requestId, {
        code: "invalid_request",
        error: "name or emoji is required"
      });
      return;
    }

    if (hasName && !name) {
      await this.emitDebug("agent.profile.update.rejected", {
        session_id: state.sessionId,
        request_id: requestId,
        reason: "name_invalid"
      });
      await this.publishChannelMessage(state.sessionId, "agent.profile.error", requestId, {
        code: "invalid_request",
        error: "name must be a non-empty string when provided"
      });
      return;
    }

    if (hasEmoji && rawEmoji === null) {
      await this.emitDebug("agent.profile.update.rejected", {
        session_id: state.sessionId,
        request_id: requestId,
        reason: "emoji_invalid"
      });
      await this.publishChannelMessage(state.sessionId, "agent.profile.error", requestId, {
        code: "invalid_request",
        error: "emoji must be a string when provided"
      });
      return;
    }

    try {
      await this.emitDebug("agent.profile.update.exec.start", {
        session_id: state.sessionId,
        request_id: requestId,
        openclaw_command: this.options.openclawCommand,
        openclaw_agent: this.options.openclawAgent,
        timeout_ms: this.options.openclawProfileUpdateTimeoutMs
      });
      const updatedProfile = await this.updateOpenClawAgentIdentity({
        ...(hasName ? { name: name ?? null } : {}),
        ...(hasEmoji ? { emoji } : {})
      }, requestId);

      await this.publishChannelMessage(state.sessionId, "agent.profile.updated", requestId, {
        provider: "openclaw",
        agent_key: this.options.openclawAgent,
        profile: {
          name: updatedProfile.name,
          emoji: updatedProfile.emoji
        },
        message: "Profile updated on runtime. Heartbeat sync pending."
      });
      await this.emitDebug("agent.profile.update.ack.sent", {
        session_id: state.sessionId,
        request_id: requestId,
        channel_type: "agent.profile.updated"
      });
    } catch (error) {
      const normalized = normalizeError(error);
      await this.emitDebug("agent.profile.update.exec.failed", {
        session_id: state.sessionId,
        request_id: requestId,
        error: normalized.message
      });
      await this.publishChannelMessage(state.sessionId, "agent.profile.error", requestId, {
        code: "command_failed",
        error: normalized.message
      });
      await this.emitDebug("agent.profile.update.ack.sent", {
        session_id: state.sessionId,
        request_id: requestId,
        channel_type: "agent.profile.error",
        error: normalized.message
      });
      await this.emitError(normalized);
    }
  }

  private async updateOpenClawAgentIdentity(input: {
    name?: string | null;
    emoji?: string | null;
  }, requestId: string): Promise<{ name: string | null; emoji: string | null }> {
    const fieldArgs: string[] = [];

    if (typeof input.name === "string" && input.name.trim() !== "") {
      fieldArgs.push("--name", input.name);
    }

    if (Object.prototype.hasOwnProperty.call(input, "emoji")) {
      fieldArgs.push("--emoji", input.emoji ?? "");
    }

    if (fieldArgs.length === 0) {
      throw new Error("agent profile update requires at least one field.");
    }

    const startedAtMs = Date.now();
    const identityPayload = {
      name: typeof input.name === "string" && input.name.trim() !== "" ? input.name : null,
      emoji: Object.prototype.hasOwnProperty.call(input, "emoji") ? input.emoji ?? null : null
    };
    let attempt = 0;

    const executeForAgent = async (
      targetAgent: string
    ): Promise<{ ok: true } | { ok: false; error: Error; rawError: unknown }> => {
      const argsWithNonInteractive = [
        "agents",
        "set-identity",
        "--non-interactive",
        "--agent",
        targetAgent,
        ...fieldArgs
      ];
      const argsWithoutNonInteractive = [
        "agents",
        "set-identity",
        "--agent",
        targetAgent,
        ...fieldArgs
      ];

      attempt += 1;
      await this.emitDebug("agent.profile.update.exec.command", {
        request_id: requestId,
        command: this.options.openclawCommand,
        args: argsWithNonInteractive,
        attempt,
        agent: targetAgent
      });

      try {
        const result = await execFileAsync(this.options.openclawCommand, argsWithNonInteractive, {
          cwd: this.options.runtimeWorkingDirectory,
          timeout: this.options.openclawProfileUpdateTimeoutMs,
          maxBuffer: this.options.openclawMaxBufferBytes
        });
        await this.emitDebug("agent.profile.update.exec.command_result", {
          request_id: requestId,
          duration_ms: Date.now() - startedAtMs,
          stdout_preview: previewText(result.stdout),
          stderr_preview: previewText(result.stderr),
          attempt,
          agent: targetAgent
        });

        return { ok: true };
      } catch (error) {
        if (isUnknownNonInteractiveOptionError(error)) {
          await this.emitDebug("agent.profile.update.exec.command.retry_without_non_interactive", {
            request_id: requestId,
            duration_ms: Date.now() - startedAtMs,
            attempt,
            agent: targetAgent
          });

          attempt += 1;
          await this.emitDebug("agent.profile.update.exec.command", {
            request_id: requestId,
            command: this.options.openclawCommand,
            args: argsWithoutNonInteractive,
            attempt,
            agent: targetAgent
          });

          try {
            const retryResult = await execFileAsync(this.options.openclawCommand, argsWithoutNonInteractive, {
              cwd: this.options.runtimeWorkingDirectory,
              timeout: this.options.openclawProfileUpdateTimeoutMs,
              maxBuffer: this.options.openclawMaxBufferBytes
            });

            await this.emitDebug("agent.profile.update.exec.command_result", {
              request_id: requestId,
              duration_ms: Date.now() - startedAtMs,
              stdout_preview: previewText(retryResult.stdout),
              stderr_preview: previewText(retryResult.stderr),
              attempt,
              agent: targetAgent
            });

            return { ok: true };
          } catch (retryError) {
            const normalizedRetryExec = normalizeProfileUpdateExecError(
              retryError,
              this.options.openclawProfileUpdateTimeoutMs,
              this.options.openclawCommand,
              argsWithoutNonInteractive
            );
            await this.emitDebug("agent.profile.update.exec.command_failed", {
              request_id: requestId,
              duration_ms: Date.now() - startedAtMs,
              error: normalizedRetryExec.message,
              attempt,
              agent: targetAgent
            });

            return { ok: false, error: normalizedRetryExec, rawError: retryError };
          }
        }

        const normalizedExec = normalizeProfileUpdateExecError(
          error,
          this.options.openclawProfileUpdateTimeoutMs,
          this.options.openclawCommand,
          argsWithNonInteractive
        );
        await this.emitDebug("agent.profile.update.exec.command_failed", {
          request_id: requestId,
          duration_ms: Date.now() - startedAtMs,
          error: normalizedExec.message,
          attempt,
          agent: targetAgent
        });

        return { ok: false, error: normalizedExec, rawError: error };
      }
    };

    const primaryAgent = this.options.openclawAgent;
    const primaryResult = await executeForAgent(primaryAgent);
    if (primaryResult.ok) {
      return identityPayload;
    }

    if (primaryAgent !== "main" && isUnknownOpenClawAgentError(primaryResult.rawError, primaryAgent)) {
      await this.emitDebug("agent.profile.update.exec.command.retry_with_agent_main", {
        request_id: requestId,
        duration_ms: Date.now() - startedAtMs,
        previous_agent: primaryAgent,
        fallback_agent: "main"
      });

      const mainResult = await executeForAgent("main");
      if (mainResult.ok) {
        return identityPayload;
      }

      throw mainResult.error;
    }

    throw primaryResult.error;
  }

  private async sendInitialSnapshot(state: SessionState, reason: string): Promise<void> {
    const requestId = `snapshot-${state.sessionId}-${Date.now().toString(36)}`;
    await this.sendSnapshotResponse(state.sessionId, requestId, reason);
  }

  private async sendSnapshotResponse(sessionId: number, requestId: string, reason: string): Promise<void> {
    const docs = await this.readRuntimeDocs();
    await this.publishChannelMessage(sessionId, "snapshot.response", requestId, {
      reason,
      docs,
      generated_at: new Date().toISOString()
    });
  }

  private async publishChannelMessage(
    sessionId: number,
    channelType: string,
    requestId: string,
    payload: JsonObject
  ): Promise<void> {
    const payloadWithRequestId: JsonObject = {
      request_id: requestId,
      ...payload
    };

    const maxAttempts = 3;
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt += 1;

      try {
        await this.publishRealtimeMessageWithTimeout(
          (signal) =>
            this.options.client.publishRealtimeMessage({
              agent: this.options.agent,
              session: sessionId,
              channelType,
              requestId,
              payload: payloadWithRequestId,
              signal,
            }),
          sessionId,
          channelType,
          requestId,
          attempt
        );
        return;
      } catch (error) {
        const normalizedError = normalizeError(error);
        if (shouldIgnorePublishRealtimeMessageError(normalizedError, this.stopRequested, this.sessions.has(sessionId))) {
          return;
        }

        if (!this.shouldRetryPublishRealtimeMessageError(normalizedError, attempt, maxAttempts)) {
          throw normalizedError;
        }

        const backoffMs = this.publishRetryBackoffMs(attempt);
        await this.emitDebug("realtime.publish.retry", {
          session_id: sessionId,
          channel_type: channelType,
          request_id: requestId,
          attempt,
          next_retry_in_ms: backoffMs,
          error: normalizedError.message
        });
        await sleep(backoffMs);
      }
    }
  }

  private async publishRealtimeMessageWithTimeout(
    send: (signal: AbortSignal) => Promise<unknown>,
    sessionId: number,
    channelType: string,
    requestId: string,
    attempt: number
  ): Promise<void> {
    const abortController = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    try {
      await Promise.race([
        send(abortController.signal),
        new Promise<never>((_resolve, reject) => {
          timeoutHandle = setTimeout(() => {
            abortController.abort();
            reject(
              new Error(
                `publishRealtimeMessage timed out after ${DEFAULT_REALTIME_PUBLISH_TIMEOUT_MS}ms ` +
                  `(session=${sessionId}, channel=${channelType}, request_id=${requestId}, attempt=${attempt}).`
              )
            );
          }, DEFAULT_REALTIME_PUBLISH_TIMEOUT_MS);
        })
      ]);
    } finally {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private publishRetryBackoffMs(attempt: number): number {
    if (attempt <= 1) {
      return 150;
    }

    if (attempt === 2) {
      return 500;
    }

    return 1_200;
  }

  private shouldRetryPublishRealtimeMessageError(error: Error, attempt: number, maxAttempts: number): boolean {
    if (attempt >= maxAttempts) {
      return false;
    }

    const message = String(error.message || "").toLowerCase();
    if (message === "") {
      return false;
    }

    if (/\b(429|408|500|502|503|504)\b/.test(message)) {
      return true;
    }

    return (
      message.includes("timeout") ||
      message.includes("timed out") ||
      message.includes("aborterror") ||
      message.includes("aborted") ||
      message.includes("etimedout") ||
      message.includes("econnreset") ||
      message.includes("econnrefused") ||
      message.includes("enotfound") ||
      message.includes("network") ||
      message.includes("socket hang up") ||
      message.includes("fetch failed") ||
      message.includes("temporarily unavailable")
    );
  }

  private async readRuntimeDocs(): Promise<OpenClawRuntimeDocRecord[]> {
    const docs: OpenClawRuntimeDocRecord[] = [];

    for (const docId of this.options.runtimeDocIds) {
      const doc = await this.readRuntimeDoc(docId);
      if (doc) {
        docs.push(doc);
        continue;
      }

      if (this.options.includeMissingRuntimeDocs) {
        docs.push({
          id: docId,
          title: docTitle(docId),
          body_markdown: "",
          base_hash: sha256("")
        });
      }
    }

    return docs;
  }

  private async readRuntimeDoc(docId: string): Promise<OpenClawRuntimeDocRecord | null> {
    const path = this.resolveRuntimeDocPath(docId);
    const exists = await fileExists(path);
    if (!exists) {
      return null;
    }

    const bodyMarkdown = await readFile(path, "utf8");
    return {
      id: docId,
      title: docTitle(docId),
      body_markdown: bodyMarkdown,
      base_hash: sha256(bodyMarkdown)
    };
  }

  private resolveRuntimeDocPath(docId: string): string {
    const safeId = normalizeDocId(docId);
    if (!safeId) {
      throw new Error(`Invalid runtime doc id: ${String(docId)}`);
    }

    return resolve(this.options.runtimeDocsDirectory, safeId);
  }

  private startSessionActivityPulse(state: Pick<SessionState, "closed" | "lastHealthActivityAtMs">): () => void {
    state.lastHealthActivityAtMs = Date.now();

    const timer = setInterval(() => {
      if (state.closed || this.stopRequested) {
        clearInterval(timer);
        return;
      }

      state.lastHealthActivityAtMs = Date.now();
    }, 5_000);

    return () => {
      clearInterval(timer);
    };
  }

  private startChatStatusPulse(
    state: Pick<SessionState, "sessionId" | "closed">,
    requestId: string,
    messageId: number
  ): () => void {
    if (!this.options.sendThinkingDelta) {
      return () => {};
    }

    const startedAtMs = Date.now();
    let stopped = false;
    let sentInProgressUpdate = false;
    const statusDeltaId = `agent-status-${requestId}`;

    const publishDelta = (delta: string): void => {
      if (stopped || state.closed || this.stopRequested) {
        return;
      }

      void this.publishChannelMessage(state.sessionId, "chat.agent.delta", requestId, {
        delta,
        delta_id: statusDeltaId,
        delta_kind: "status",
        delta_mode: "replace",
        ...(messageId > 0 ? { message_id: messageId } : {})
      }).catch(async (error) => {
        await this.emitError(normalizeError(error));
      });
    };

    publishDelta(this.options.thinkingText);

    const timer = setInterval(() => {
      if (stopped || state.closed || this.stopRequested) {
        clearInterval(timer);
        return;
      }

      if (sentInProgressUpdate) {
        clearInterval(timer);
        return;
      }

      sentInProgressUpdate = true;
      publishDelta(buildInProgressStatusDelta(Date.now() - startedAtMs));
      clearInterval(timer);
    }, DEFAULT_CHAT_STATUS_DELTA_INTERVAL_MS);
    timer.unref?.();

    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  private async maybeSelfHealSession(state: SessionState, nowMs: number): Promise<void> {
    if (!this.options.selfHealEnabled || state.closed) {
      return;
    }

    if (nowMs - state.createdAtMs < this.options.selfHealMinSessionAgeMs) {
      return;
    }

    if (isFallbackConnectionState(state.connectionState)) {
      const fallbackMs = nowMs - state.lastConnectionStateChangeAtMs;
      const healthStaleMs = nowMs - state.lastHealthActivityAtMs;
      if (
        fallbackMs >= this.options.selfHealConnectionStaleMs &&
        healthStaleMs >= this.options.selfHealConnectionStaleMs
      ) {
        const reason = `session_self_heal_${state.connectionState}_stale`;
        await this.emitError(
          new Error(
            `Self-heal recycling session ${state.sessionId}: ${state.connectionState} for ${fallbackMs}ms with no health activity for ${healthStaleMs}ms.`
          )
        );
        state.closeReason = reason;
        await this.closeSession(state, reason, this.options.selfHealCloseRemote, true, "failed");
        return;
      }
    }

    const inactivityMs = nowMs - state.lastHealthActivityAtMs;
    if (inactivityMs < this.options.selfHealActivityStaleMs) {
      return;
    }

    const reason = "session_self_heal_activity_stale";
    await this.emitError(
      new Error(`Self-heal recycling session ${state.sessionId}: no health activity for ${inactivityMs}ms.`)
    );
    state.closeReason = reason;
    await this.closeSession(state, reason, this.options.selfHealCloseRemote, true, "failed");
  }

  private async closeSession(
    state: SessionState,
    reason: string,
    closeRemote: boolean,
    forceRemoteClose = false,
    closeStatusOverride?: "closed" | "failed"
  ): Promise<void> {
    if (state.closed) {
      return;
    }

    state.closed = true;
    state.closeReason = reason;

    if (state.subscription) {
      try {
        await state.subscription.disconnect();
      } catch {
        // Best-effort local disconnect.
      }
    }

    if (closeRemote && (this.options.closeSessionOnStop || forceRemoteClose)) {
      const resolvedStatus = closeStatusOverride ?? this.options.closeStatus;
      try {
        await this.closeRemoteSession(state.sessionId, reason, resolvedStatus);
      } catch (closeError) {
        await this.emitError(normalizeError(closeError));
      }
    }

    this.sessions.delete(state.sessionId);
    if (this.options.realtimeSessionsEnabled && this.sessions.size === 0) {
      this.nextSessionAcquireAtMs = Math.min(this.nextSessionAcquireAtMs, Date.now() + 250);
    }
    await callOptionalHandler(this.options.onSessionClosed, state.sessionId, this.options.onError, reason);
  }

  private async closeRemoteSession(
    sessionId: number,
    reason: string,
    status: "closed" | "failed"
  ): Promise<void> {
    const response = await this.options.client.operations.closeAgentRealtimeSession({
      params: {
        path: {
          session: sessionId
        }
      },
      headers: {
        "X-Agent-Id": String(this.options.agent)
      },
      body: {
        reason,
        status
      }
    });

    if (response.error) {
      await this.emitError(createOperationError("closeAgentRealtimeSession", response.status, response.error));
    }
  }

  private async emitError(error: Error): Promise<void> {
    await callErrorHandler(this.options.onError, error);
  }

  private async emitDebug(event: string, details: JsonObject = {}): Promise<void> {
    await callOptionalHandler(
      this.options.onDebug,
      {
        event,
        at: new Date().toISOString(),
        details
      },
      this.options.onError
    );
  }

  private shouldProcessNotificationKey(key: string): boolean {
    return shouldProcessCacheKey(this.processedNotificationKeys, key, this.options.duplicateTtlMs);
  }

  private resolveNotificationSessionState(
    sessionId: number | undefined
  ): Pick<SessionState, "sessionId" | "session" | "closed"> | null {
    const preferredSessionId = toPositiveInteger(sessionId);
    if (preferredSessionId > 0) {
      const preferred = this.sessions.get(preferredSessionId);
      if (preferred && !preferred.closed) {
        return preferred;
      }
    }

    let best: SessionState | null = null;
    for (const state of this.sessions.values()) {
      if (state.closed) {
        continue;
      }

      if (!best) {
        best = state;
        continue;
      }

      const bestConnected = best.connectionState === "connected";
      const stateConnected = state.connectionState === "connected";
      if (stateConnected && !bestConnected) {
        best = state;
        continue;
      }

      if (stateConnected === bestConnected) {
        if (state.lastHealthActivityAtMs > best.lastHealthActivityAtMs) {
          best = state;
          continue;
        }

        if (
          state.lastHealthActivityAtMs === best.lastHealthActivityAtMs &&
          state.sessionId > best.sessionId
        ) {
          best = state;
        }
      }
    }

    return best;
  }

  private buildSyntheticNotificationSignal(
    sessionId: number,
    notification: JsonObject,
    index: number
  ): AgentRealtimeSignalMessage {
    const timestampId = Math.max(1, Date.now() + Math.max(0, index));
    const createdAt = valueAsString(notification.created_at) ?? new Date().toISOString();

    return {
      id: timestampId,
      session_id: sessionId,
      sender: "agent",
      type: "message",
      payload: {
        type: "notification.api_fallback",
        payload: {
          notification
        }
      },
      created_at: createdAt
    };
  }
}

export type AgentRuntimeOptions = OpenClawAgentRuntimeOptions;
export type AgentRuntimeStatus = OpenClawAgentRuntimeStatus;
export type AgentRuntimeDocRecord = OpenClawRuntimeDocRecord;
export type AgentRuntimeSignalEvent = OpenClawRuntimeSignalEvent;
export type AgentRuntimeNotificationEvent = OpenClawRuntimeNotificationEvent;
export type AgentRuntimeNotificationBridgeEvent = OpenClawRuntimeNotificationBridgeEvent;
export type AgentRuntimeNotificationBridgeRunResult = OpenClawRuntimeNotificationBridgeRunResult;
export type AgentRuntimeUnhandledMessageEvent = OpenClawRuntimeUnhandledMessageEvent;
export type AgentRuntimeConnectionStateEvent = OpenClawRuntimeConnectionStateEvent;
export type AgentRuntimeDebugEvent = OpenClawRuntimeDebugEvent;

export class AgentRuntime extends OpenClawAgentRuntime {}

function resolveOptions(options: OpenClawAgentRuntimeOptions): ResolvedOptions {
  const agent = toPositiveInteger(options.agent);
  if (agent < 1) {
    throw new Error("options.agent must be a positive integer.");
  }

  const runtimeDocsDirectory = resolve(options.runtimeDocsDirectory ?? process.cwd());
  const runtimeWorkingDirectory = resolve(options.runtimeWorkingDirectory ?? runtimeDocsDirectory);
  const openclawAgent = normalizeOpenClawAgent(options.openclawAgent);
  const defaultSessionsPath = resolve(
    homedir(),
    ".openclaw",
    "agents",
    openclawAgent,
    "sessions",
    "sessions.json"
  );

  const runtimeDocIds = normalizeRuntimeDocIds(options.runtimeDocIds);
  const chatRealtimeEnabled = options.chatRealtimeEnabled !== false;
  const filesRealtimeEnabled = typeof options.filesRealtimeEnabled === "boolean"
    ? options.filesRealtimeEnabled
    : options.docsRealtimeEnabled !== false;
  const docsRealtimeEnabled = filesRealtimeEnabled;
  const notificationsRealtimeEnabled = options.notificationsRealtimeEnabled !== false;
  const hasRealtimeCallbacks = Boolean(
    options.onSessionReady ||
      options.onSessionClosed ||
      options.onSignal ||
      options.onConnectionStateChange ||
      options.onUnhandledMessage
  );
  const realtimeSessionsEnabled = typeof options.realtimeSessionsEnabled === "boolean"
    ? options.realtimeSessionsEnabled
    : chatRealtimeEnabled || filesRealtimeEnabled || notificationsRealtimeEnabled || hasRealtimeCallbacks;
  const sessionPollingEnabled = options.sessionPollingEnabled !== false;
  const agentmcApiKey = sanitizeRuntimeContextValue(
    valueAsString(options.agentmcApiKey) ??
      readClientConfiguredValue(options.client, "getConfiguredApiKey") ??
      valueAsString(process.env.AGENTMC_API_KEY),
    512
  );
  const agentmcBaseUrl = normalizeAgentMcApiBaseUrl(
    valueAsString(options.agentmcBaseUrl) ??
      readClientConfiguredValue(options.client, "getBaseUrl") ??
      DEFAULT_AGENTMC_API_BASE_URL
  );
  const agentmcOpenApiUrl = normalizeAgentMcOpenApiUrl(
    valueAsString(options.agentmcOpenApiUrl) ?? readClientConfiguredValue(options.client, "getOpenApiUrl"),
    agentmcBaseUrl
  );

  return {
    client: options.client,
    agent,
    agentmcApiKey,
    agentmcBaseUrl,
    agentmcOpenApiUrl,
    realtimeSessionsEnabled,
    sessionPollingEnabled,
    chatRealtimeEnabled,
    filesRealtimeEnabled,
    docsRealtimeEnabled,
    notificationsRealtimeEnabled,
    requestedSessionLimit: normalizePositiveInt(options.requestedSessionLimit, DEFAULT_REQUESTED_SESSION_LIMIT),
    requestPollMs: normalizePositiveInt(options.requestPollMs, DEFAULT_REQUEST_POLL_MS),
    duplicateTtlMs: normalizePositiveInt(options.duplicateTtlMs, DEFAULT_DUPLICATE_TTL_MS),
    sendThinkingDelta: options.sendThinkingDelta !== false,
    thinkingText: valueAsString(options.thinkingText)?.trim() || "Thinking...",
    bridgeNotificationsToAi: options.bridgeNotificationsToAi !== false,
    bridgeReadNotifications: options.bridgeReadNotifications === true,
    bridgeNotificationTypes: normalizeNotificationTypeFilter(options.bridgeNotificationTypes),
    closeSessionOnStop: options.closeSessionOnStop === true,
    closeReason: valueAsString(options.closeReason)?.trim() || "runtime_stopped",
    closeStatus: options.closeStatus ?? "closed",
    includeInitialSnapshot: options.includeInitialSnapshot !== false,
    runtimeDocsDirectory,
    runtimeWorkingDirectory,
    runtimeDocIds,
    includeMissingRuntimeDocs: options.includeMissingRuntimeDocs === true,
    openclawCommand: valueAsString(options.openclawCommand)?.trim() || "openclaw",
    openclawAgent,
    openclawSessionsPath: valueAsString(options.openclawSessionsPath)?.trim() || defaultSessionsPath,
    openclawGatewayTimeoutMs: normalizePositiveInt(options.openclawGatewayTimeoutMs, DEFAULT_GATEWAY_TIMEOUT_MS),
    openclawSubmitTimeoutMs: normalizePositiveInt(options.openclawSubmitTimeoutMs, DEFAULT_OPENCLAW_SUBMIT_TIMEOUT_MS),
    openclawWaitTimeoutMs: normalizePositiveInt(options.openclawWaitTimeoutMs, DEFAULT_OPENCLAW_WAIT_TIMEOUT_MS),
    openclawProfileUpdateTimeoutMs: normalizePositiveInt(
      options.openclawProfileUpdateTimeoutMs,
      DEFAULT_OPENCLAW_PROFILE_UPDATE_TIMEOUT_MS
    ),
    openclawMaxBufferBytes: normalizePositiveInt(options.openclawMaxBufferBytes, DEFAULT_OPENCLAW_MAX_BUFFER_BYTES),
    selfHealEnabled: options.selfHealEnabled !== false,
    selfHealConnectionStaleMs: normalizePositiveInt(
      options.selfHealConnectionStaleMs,
      DEFAULT_SELF_HEAL_CONNECTION_STALE_MS
    ),
    selfHealActivityStaleMs: normalizePositiveInt(
      options.selfHealActivityStaleMs,
      DEFAULT_SELF_HEAL_ACTIVITY_STALE_MS
    ),
    selfHealMinSessionAgeMs: normalizePositiveInt(
      options.selfHealMinSessionAgeMs,
      DEFAULT_SELF_HEAL_MIN_SESSION_AGE_MS
    ),
    selfHealCloseRemote: options.selfHealCloseRemote !== false,
    runtimeSource: valueAsString(options.runtimeSource)?.trim() || "agent-runtime",
    runAgent: options.runAgent,
    onSessionReady: options.onSessionReady,
    onSessionClosed: options.onSessionClosed,
    onSignal: options.onSignal,
    onNotification: options.onNotification,
    onNotificationBridge: options.onNotificationBridge,
    onConnectionStateChange: options.onConnectionStateChange,
    onUnhandledMessage: options.onUnhandledMessage,
    onDebug: options.onDebug,
    onError: options.onError
  };
}

function readClientConfiguredValue(
  client: AgentMCApi,
  key: "getConfiguredApiKey" | "getBaseUrl" | "getOpenApiUrl"
): string | null {
  const candidate = client as unknown as Record<string, unknown>;
  const value = candidate[key];
  if (typeof value !== "function") {
    return null;
  }

  try {
    const resolved = (value as () => unknown).call(client);
    return valueAsString(resolved);
  } catch {
    return null;
  }
}

function normalizeAgentMcApiBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/api/v1")) {
    return trimmed;
  }

  return `${trimmed}/api/v1`;
}

function normalizeAgentMcOpenApiUrl(value: string | null, apiBaseUrl: string): string {
  const normalized = sanitizeRuntimeContextValue(value, 1024);
  if (normalized) {
    return normalized;
  }

  return `${apiBaseUrl.slice(0, -"/api/v1".length)}/api/openapi.json`;
}

function sanitizeRuntimeContextValue(value: string | null, maxLength: number): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/[\r\n\t]+/g, " ").trim();
  if (normalized === "") {
    return null;
  }

  return normalized.slice(0, maxLength);
}

function buildAgentRuntimeCommandEnv(context: BridgedAgentMcRuntimeContext): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  if (context.apiKey) {
    env.AGENTMC_API_KEY = context.apiKey;
  }

  return env;
}

async function callOptionalHandler<Input, Extra>(
  handler: ((value: Input, extra: Extra) => MaybePromise) | ((value: Input) => MaybePromise) | undefined,
  value: Input,
  onError: ((error: Error) => MaybePromise) | undefined,
  extra?: Extra
): Promise<void> {
  if (!handler) {
    return;
  }

  try {
    if (extra === undefined) {
      await (handler as (value: Input) => MaybePromise)(value);
    } else {
      await (handler as (value: Input, extra: Extra) => MaybePromise)(value, extra);
    }
  } catch (error) {
    await callErrorHandler(onError, normalizeError(error));
  }
}

async function callErrorHandler(
  handler: ((error: Error) => MaybePromise) | undefined,
  error: Error
): Promise<void> {
  if (!handler) {
    return;
  }

  try {
    await handler(error);
  } catch {
    // Never rethrow user-provided error handlers.
  }
}

function normalizeOpenClawAgent(value: unknown): string {
  const trimmed = valueAsString(value)?.trim() || "main";
  if (!/^[a-zA-Z0-9_.-]+$/.test(trimmed)) {
    throw new Error("options.openclawAgent may only include letters, numbers, underscore, dot, and hyphen.");
  }

  return trimmed;
}

function normalizeRuntimeDocIds(value: readonly string[] | undefined): string[] {
  const source = value ?? DEFAULT_OPENCLAW_DOC_IDS;
  const normalized = source
    .map((entry) => normalizeDocId(entry))
    .filter((entry): entry is string => entry !== null);

  if (normalized.length === 0) {
    throw new Error("At least one runtime doc id is required.");
  }

  return Array.from(new Set(normalized));
}

function normalizeDocId(value: unknown): string | null {
  const text = valueAsString(value)?.trim() || "";
  if (text === "") {
    return null;
  }

  if (!/^[A-Za-z0-9._-]+$/.test(text) || text.includes("/") || text.includes("\\")) {
    return null;
  }

  return text;
}

function docTitle(id: string): string {
  const withoutExtension = id.replace(/\.md$/i, "");
  const compact = withoutExtension.replace(/[_-]+/g, " ").trim();
  if (compact === "") {
    return id;
  }

  return compact.replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function buildFileIdPayload(fileId: string): { file_id: string; doc_id: string } {
  return {
    file_id: fileId,
    doc_id: fileId
  };
}

function hasOwn(value: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeAgentProfileName(value: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }

  return trimmed.slice(0, 255);
}

function normalizeAgentProfileEmoji(value: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }

  return trimmed.slice(0, 32);
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0) {
    return value;
  }

  return fallback;
}

function withJitter(baseMs: number, maxJitterMs: number): number {
  const normalizedBase = Math.max(1, Math.floor(baseMs));
  const normalizedJitter = Math.max(0, Math.floor(maxJitterMs));
  if (normalizedJitter < 1) {
    return normalizedBase;
  }

  return normalizedBase + Math.floor(Math.random() * (normalizedJitter + 1));
}

function resolveBackoffJitterMs(baseMs: number): number {
  return Math.min(5_000, Math.max(250, Math.floor(Math.max(1, baseMs) * 0.2)));
}

function parseRetryAfterMs(response: Response | undefined): number | null {
  const retryAfter = response?.headers.get("retry-after");
  if (!retryAfter) {
    return null;
  }

  const seconds = Number.parseInt(retryAfter, 10);
  if (Number.isInteger(seconds) && seconds > 0) {
    return seconds * 1_000;
  }

  const timestampMs = Date.parse(retryAfter);
  if (Number.isFinite(timestampMs)) {
    const remainingMs = timestampMs - Date.now();
    if (remainingMs > 0) {
      return Math.ceil(remainingMs);
    }
  }

  return null;
}

function normalizeLowercase(value: unknown): string {
  return valueAsString(value)?.trim().toLowerCase() || "";
}

function previewText(value: unknown, max = 220): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }

  if (trimmed.length <= max) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(1, max - 3))}...`;
}

function resolveOpenClawRunId(value: unknown): string | null {
  const direct = valueAsRunId(valueAsObject(value)?.runId) ?? valueAsRunId(valueAsObject(value)?.run_id);
  if (direct) {
    return direct;
  }

  const queue: unknown[] = [];
  const root = valueAsObject(value);
  if (root) {
    queue.push(root.result, root.payload, root.response, root.data);
  }

  const visited = new Set<unknown>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === null || current === undefined || visited.has(current)) {
      continue;
    }
    visited.add(current);

    const objectValue = valueAsObject(current);
    if (!objectValue) {
      continue;
    }

    const runId = valueAsRunId(objectValue.runId) ?? valueAsRunId(objectValue.run_id);
    if (runId) {
      return runId;
    }

    queue.push(objectValue.result, objectValue.payload, objectValue.response, objectValue.data);
  }

  return null;
}

function looksLikeTimeoutError(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (normalized === "") {
    return false;
  }

  return (
    normalized.includes("timed out") ||
    normalized.includes("timeout") ||
    normalized.includes("etimedout") ||
    normalized.includes("sigterm") ||
    normalized.includes("sigkill") ||
    normalized.includes("aborterror") ||
    normalized.includes("aborted")
  );
}

function isAbortLikeError(value: unknown): boolean {
  const objectValue = valueAsObject(value);
  const code = normalizeLowercase(objectValue?.code);
  const name = normalizeLowercase(objectValue?.name);
  const errorMessage =
    valueAsString(objectValue?.message) ??
    (value instanceof Error ? value.message : null) ??
    "";
  const normalizedMessage = errorMessage.trim().toLowerCase();

  return (
    code === "abort_err" ||
    code === "aborted" ||
    name === "aborterror" ||
    normalizedMessage.includes("aborterror") ||
    normalizedMessage.includes("aborted")
  );
}

function isCommandTimeoutError(error: unknown, normalizedErrorMessage: string): boolean {
  const objectValue = valueAsObject(error);
  if (valueAsBoolean(objectValue?.timedOut) === true) {
    return true;
  }

  const code = normalizeLowercase(objectValue?.code);
  if (code === "etimedout" || code === "timeout") {
    return true;
  }

  return isAbortLikeError(error) || looksLikeTimeoutError(normalizedErrorMessage);
}

async function execFileWithTimeoutAndKill(
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    encoding: "utf8";
    maxBuffer: number;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    forceKillGraceMs: number;
  }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let forceKillHandle: ReturnType<typeof setTimeout> | null = null;

    const cleanup = (): void => {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      if (forceKillHandle !== null) {
        clearTimeout(forceKillHandle);
        forceKillHandle = null;
      }
    };

    const child = execFile(
      command,
      [...args],
      {
        cwd: options.cwd,
        encoding: options.encoding,
        maxBuffer: options.maxBuffer,
        env: options.env
      },
      (error, stdout, stderr) => {
        cleanup();
        const normalizedStdout = execOutputToString(stdout);
        const normalizedStderr = execOutputToString(stderr);

        if (!error) {
          resolve({
            stdout: normalizedStdout,
            stderr: normalizedStderr
          });
          return;
        }

        const enrichedError = error as NodeJS.ErrnoException & { stdout?: unknown; stderr?: unknown };
        if (typeof enrichedError.stdout === "undefined") {
          enrichedError.stdout = normalizedStdout;
        }
        if (typeof enrichedError.stderr === "undefined") {
          enrichedError.stderr = normalizedStderr;
        }
        if (timedOut) {
          enrichedError.code = "ETIMEDOUT";
          (
            enrichedError as NodeJS.ErrnoException & {
              timedOut?: boolean;
            }
          ).timedOut = true;
        }
        reject(enrichedError);
      }
    );

    const timeoutMs = Math.max(1_000, Math.floor(options.timeoutMs));
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {
        // Ignore local process kill failures; callback/rejection handles lifecycle.
      }

      const graceMs = Math.max(250, Math.floor(options.forceKillGraceMs));
      forceKillHandle = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Ignore local process kill failures; callback/rejection handles lifecycle.
        }
      }, graceMs);
      forceKillHandle.unref?.();
    }, timeoutMs);
    timeoutHandle.unref?.();
  });
}

function parseJsonUnknownOutput(value: unknown): unknown | null {
  const text = execOutputToString(value).trim();
  if (text === "") {
    return null;
  }

  const direct = parseJsonUnknownCandidate(text);
  if (direct !== null) {
    return direct;
  }

  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== "");
  if (firstLine) {
    const lineParsed = parseJsonUnknownCandidate(firstLine);
    if (lineParsed !== null) {
      return lineParsed;
    }
  }

  const candidate = extractFirstJsonCandidate(text);
  if (!candidate) {
    return null;
  }

  return parseJsonUnknownCandidate(candidate);
}

function parseJsonUnknownCandidate(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractFirstJsonCandidate(value: string): string | null {
  const text = String(value ?? "");
  for (let start = 0; start < text.length; start += 1) {
    const startChar = text[start];
    if (startChar !== "{" && startChar !== "[") {
      continue;
    }

    const stack: string[] = [startChar === "{" ? "}" : "]"];
    let inString = false;
    let escaped = false;

    for (let index = start + 1; index < text.length; index += 1) {
      const char = text[index];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
        continue;
      }

      if (char === "{" || char === "[") {
        stack.push(char === "{" ? "}" : "]");
        continue;
      }

      if (char === "}" || char === "]") {
        const expected = stack.pop();
        if (!expected || expected !== char) {
          break;
        }

        if (stack.length === 0) {
          return text.slice(start, index + 1);
        }
      }
    }
  }

  return null;
}

function valueAsRunId(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function execOutputToString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Buffer) {
    return value.toString("utf8");
  }

  return "";
}

function parseExternalAgentOutput(value: unknown): string {
  const trimmed = valueAsString(value)?.trim() ?? "";
  if (trimmed === "") {
    return "";
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "string") {
      return parsed;
    }

    if (parsed && typeof parsed === "object") {
      const object = parsed as JsonObject;
      const text =
        extractText(object.content) ??
        extractText(object.output) ??
        extractText(object.text) ??
        extractText(object.message) ??
        extractText(object.response);
      if (text) {
        return text;
      }
    }
  } catch {
    // Keep plain text fallback.
  }

  return trimmed;
}

function extractText(value: unknown, depth = 0): string | null {
  if (depth > 6 || value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }

  if (Array.isArray(value)) {
    const parts = value.map((entry) => extractText(entry, depth + 1)).filter((entry): entry is string => !!entry);
    if (parts.length > 0) {
      return parts.join(" ");
    }
    return null;
  }

  const object = valueAsObject(value);
  if (!object) {
    return null;
  }

  const preferredKeys = ["content", "text", "output_text", "final_text", "message", "response", "delta"];
  for (const key of preferredKeys) {
    const next = extractText(object[key], depth + 1);
    if (next) {
      return next;
    }
  }

  for (const nested of Object.values(object)) {
    const next = extractText(nested, depth + 1);
    if (next) {
      return next;
    }
  }

  return null;
}

function sessionsFromStore(rawStore: unknown): JsonObject[] {
  if (Array.isArray(rawStore)) {
    return rawStore.map((entry) => valueAsObject(entry)).filter((entry): entry is JsonObject => !!entry);
  }

  const store = valueAsObject(rawStore);
  if (!store) {
    return [];
  }

  const sessionsArray = store.sessions;
  if (Array.isArray(sessionsArray)) {
    return sessionsArray
      .map((entry) => valueAsObject(entry))
      .filter((entry): entry is JsonObject => !!entry);
  }

  const sessionsObject = valueAsObject(sessionsArray);
  if (sessionsObject) {
    return sessionsFromObjectMap(sessionsObject);
  }

  const nestedSessions = valueAsObject(store.data)?.sessions;
  if (Array.isArray(nestedSessions)) {
    return nestedSessions
      .map((entry) => valueAsObject(entry))
      .filter((entry): entry is JsonObject => !!entry);
  }

  const nestedSessionsObject = valueAsObject(nestedSessions);
  if (nestedSessionsObject) {
    return sessionsFromObjectMap(nestedSessionsObject);
  }

  const topLevelSessions = sessionsFromTopLevelMap(store);
  if (topLevelSessions.length > 0) {
    return topLevelSessions;
  }

  return [];
}

function messagesFromSession(session: JsonObject): unknown[] {
  const candidates = [session.messages, session.history, session.events];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  return [];
}

function sessionsFromObjectMap(map: JsonObject): JsonObject[] {
  return Object.entries(map)
    .map(([sessionKey, entry]) => {
      const session = valueAsObject(entry);
      if (!session) {
        return null;
      }
      return withInferredSessionKey(session, sessionKey);
    })
    .filter((entry): entry is JsonObject => !!entry);
}

function sessionsFromTopLevelMap(store: JsonObject): JsonObject[] {
  const entries = Object.entries(store);
  if (entries.length === 0) {
    return [];
  }

  const sessions: JsonObject[] = [];
  for (const [sessionKey, entry] of entries) {
    const session = valueAsObject(entry);
    if (!session || !looksLikeSessionObject(session)) {
      continue;
    }

    sessions.push(withInferredSessionKey(session, sessionKey));
  }

  return sessions;
}

function withInferredSessionKey(session: JsonObject, sessionKey: string): JsonObject {
  const normalizedSessionKey = sessionKey.trim();
  if (normalizedSessionKey === "") {
    return session;
  }

  const hasKey = (valueAsString(session.key)?.trim() || "") !== "";
  const hasSessionKey = (valueAsString(session.sessionKey)?.trim() || "") !== "";
  const hasSnakeCaseSessionKey = (valueAsString(session.session_key)?.trim() || "") !== "";
  if (hasKey && hasSessionKey && hasSnakeCaseSessionKey) {
    return session;
  }

  return {
    ...session,
    ...(hasKey ? {} : { key: normalizedSessionKey }),
    ...(hasSessionKey ? {} : { sessionKey: normalizedSessionKey }),
    ...(hasSnakeCaseSessionKey ? {} : { session_key: normalizedSessionKey })
  };
}

function looksLikeSessionObject(session: JsonObject): boolean {
  const hasInlineMessages =
    Array.isArray(session.messages) || Array.isArray(session.history) || Array.isArray(session.events);
  if (hasInlineMessages) {
    return true;
  }

  const hasSessionFile =
    (valueAsString(session.sessionFile)?.trim() || "") !== "" ||
    (valueAsString(session.session_file)?.trim() || "") !== "";
  if (hasSessionFile) {
    return true;
  }

  const hasSessionKey =
    (valueAsString(session.key)?.trim() || "") !== "" ||
    (valueAsString(session.sessionKey)?.trim() || "") !== "" ||
    (valueAsString(session.session_key)?.trim() || "") !== "";
  if (hasSessionKey) {
    return true;
  }

  const hasSessionIdentifier =
    (valueAsString(session.sessionId)?.trim() || "") !== "" ||
    (valueAsString(session.session_id)?.trim() || "") !== "";
  return hasSessionIdentifier;
}

function resolveSessionFilePaths(sessionFilePath: string, sessionsJsonPath: string, runtimeBase: string): string[] {
  const trimmed = sessionFilePath.trim();
  if (trimmed === "") {
    return [];
  }

  if (isAbsolute(trimmed)) {
    return [trimmed];
  }

  const sessionsStoreDir = dirname(resolve(sessionsJsonPath));
  const safeRuntimeBase = resolve(runtimeBase);
  const candidates = [resolve(sessionsStoreDir, trimmed), resolve(safeRuntimeBase, trimmed)];

  return Array.from(new Set(candidates));
}

async function readLatestAssistantTextFromJsonl(sessionFilePath: string): Promise<string | null> {
  let raw = "";
  try {
    raw = await readFile(sessionFilePath, "utf8");
  } catch {
    return null;
  }

  const lines = raw.split(/\r?\n/g);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }

    try {
      const parsed = JSON.parse(line);
      const assistantText = extractAssistantTextFromEntry(parsed);
      if (assistantText) {
        return assistantText;
      }
    } catch {
      // Ignore malformed JSONL lines and keep scanning older entries.
    }
  }

  return null;
}

function extractAssistantTextFromEntry(entry: unknown, depth = 0): string | null {
  if (depth > 8 || entry === null || entry === undefined) {
    return null;
  }

  if (Array.isArray(entry)) {
    for (let index = entry.length - 1; index >= 0; index -= 1) {
      const nestedText = extractAssistantTextFromEntry(entry[index], depth + 1);
      if (nestedText) {
        return nestedText;
      }
    }
    return null;
  }

  const object = valueAsObject(entry);
  if (!object) {
    return null;
  }

  const directText = assistantTextFromMessage(object);
  if (directText) {
    return directText;
  }

  const preferredKeys = ["payload", "data", "event", "item", "entry", "message", "response", "output", "content", "delta"];
  for (const key of preferredKeys) {
    const nestedText = extractAssistantTextFromEntry(object[key], depth + 1);
    if (nestedText) {
      return nestedText;
    }
  }

  for (const nested of Object.values(object)) {
    const nestedText = extractAssistantTextFromEntry(nested, depth + 1);
    if (nestedText) {
      return nestedText;
    }
  }

  return null;
}

function assistantTextFromMessage(message: JsonObject): string | null {
  const role = normalizeLowercase(
    valueAsString(message.role) ||
      valueAsString(valueAsObject(message.author)?.role) ||
      valueAsString(message.sender)
  );
  if (role !== "assistant") {
    return null;
  }

  const visibleFromContent = extractVisibleAssistantText(message.content, 0);
  if (visibleFromContent) {
    return visibleFromContent;
  }

  const fallbackFields = [message.message, message.text, message.output, message.output_text, message.response, message.delta];
  for (const field of fallbackFields) {
    const visibleFromField = extractVisibleAssistantText(field, 0);
    if (visibleFromField) {
      return visibleFromField;
    }
  }

  const text =
    extractText(message.content) ??
    extractText(message.message) ??
    extractText(message.text) ??
    extractText(message.output) ??
    extractText(message.output_text) ??
    extractText(message.response) ??
    extractText(message.delta) ??
    null;
  if (!text) {
    return null;
  }

  const sanitized = sanitizeAssistantOutputText(text);
  return sanitized === "" ? null : sanitized;
}

function extractVisibleAssistantText(value: unknown, depth: number): string | null {
  if (depth > 8 || value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    const sanitized = sanitizeAssistantOutputText(value);
    return sanitized === "" ? null : sanitized;
  }

  if (Array.isArray(value)) {
    const visibleParts: string[] = [];

    for (const entry of value) {
      const objectEntry = valueAsObject(entry);
      if (!objectEntry) {
        const inlineText = extractVisibleAssistantText(entry, depth + 1);
        if (inlineText) {
          visibleParts.push(inlineText);
        }
        continue;
      }

      const blockType = normalizeLowercase(objectEntry.type ?? objectEntry.kind ?? objectEntry.block_type);
      if (isThinkingBlockType(blockType)) {
        continue;
      }

      const inlineText =
        extractVisibleAssistantText(objectEntry.text, depth + 1) ??
        extractVisibleAssistantText(objectEntry.output_text, depth + 1) ??
        extractVisibleAssistantText(objectEntry.final_text, depth + 1) ??
        extractVisibleAssistantText(objectEntry.content, depth + 1) ??
        extractVisibleAssistantText(objectEntry.value, depth + 1) ??
        null;
      if (inlineText) {
        visibleParts.push(inlineText);
      }
    }

    if (visibleParts.length > 0) {
      return visibleParts.join(" ").trim();
    }

    for (let index = value.length - 1; index >= 0; index -= 1) {
      const nested = extractVisibleAssistantText(value[index], depth + 1);
      if (nested) {
        return nested;
      }
    }

    return null;
  }

  const object = valueAsObject(value);
  if (!object) {
    return null;
  }

  const blockType = normalizeLowercase(object.type ?? object.kind ?? object.block_type);
  if (isThinkingBlockType(blockType)) {
    return null;
  }

  const preferredKeys = [
    "text",
    "output_text",
    "final_text",
    "content",
    "value",
    "message",
    "response",
    "delta",
    "payload",
    "data",
    "event",
    "item",
    "entry"
  ] as const;

  for (const key of preferredKeys) {
    const nested = extractVisibleAssistantText(object[key], depth + 1);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function isThinkingBlockType(value: string): boolean {
  return (
    value.includes("thinking") ||
    value.includes("reasoning") ||
    value.includes("analysis") ||
    value.includes("debug")
  );
}

function sanitizeAssistantOutputText(value: string): string {
  let text = value.trim();
  if (text === "") {
    return "";
  }

  const replyToCurrentPattern = /^\s*\[\[\s*reply_to_current\s*\]\]\s*/i;
  const replyToPattern = /^\s*\[\[\s*reply_to\s*:\s*[^\]]+\]\]\s*/i;

  while (true) {
    const stripped = text
      .replace(replyToCurrentPattern, "")
      .replace(replyToPattern, "");
    if (stripped === text) {
      break;
    }
    text = stripped;
  }

  return sanitizeAssistantReply(text);
}

function sanitizeAssistantReply(value: string): string {
  let text = value.trim();
  if (text === "") {
    return "";
  }

  text = text
    .replace(/^```(?:assistant|response|reply)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/^(assistant|response|reply)\s*[:>\-]\s*/i, "")
    .replace(/^`+\s*/, "");

  return text.trim();
}

function fallbackAssistantContentForStatus(status: OpenClawRunResult["status"]): string {
  if (status === "timeout") {
    return "I'm still working on that. Please retry in a moment.";
  }

  if (status === "error") {
    return "I hit an OpenClaw bridge error and could not produce assistant output.";
  }

  return "I finished the run, but no assistant text was found.";
}

function buildInProgressStatusDelta(elapsedMs: number): string {
  const totalSeconds = Math.max(1, Math.floor(Math.max(0, elapsedMs) / 1_000));
  if (totalSeconds < 60) {
    return `Still working... (${totalSeconds}s elapsed)`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    if (remainingSeconds <= 0) {
      return `Still working... (${totalMinutes}m elapsed)`;
    }
    return `Still working... (${totalMinutes}m ${remainingSeconds}s elapsed)`;
  }

  const totalHours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  if (remainingMinutes <= 0) {
    return `Still working... (${totalHours}h elapsed)`;
  }
  return `Still working... (${totalHours}h ${remainingMinutes}m elapsed)`;
}

function shouldProcessInboundKey(state: SessionState, key: string, ttlMs: number): boolean {
  return shouldProcessCacheKey(state.processedInboundKeys, key, ttlMs);
}

function shouldProcessCacheKey(cache: Map<string, number>, key: string, ttlMs: number): boolean {
  if (!key || key.trim() === "") {
    return true;
  }

  const nowMs = Date.now();
  const ttl = Math.max(5_000, ttlMs);
  for (const [cachedKey, processedAtMs] of cache.entries()) {
    if (!Number.isFinite(processedAtMs) || nowMs - processedAtMs > ttl) {
      cache.delete(cachedKey);
    }
  }

  if (cache.has(key)) {
    return false;
  }

  cache.set(key, nowMs);
  return true;
}

function parseInboundChunkFrame(channelType: string, payload: JsonObject): InboundChunkFrame | null {
  const chunkId = valueAsString(payload.chunk_id)?.trim() || "";
  if (chunkId === "") {
    return null;
  }

  const chunkIndex = toPositiveInteger(payload.chunk_index);
  const chunkTotal = toPositiveInteger(payload.chunk_total);
  if (chunkIndex < 1 || chunkTotal < 1 || chunkIndex > chunkTotal) {
    return null;
  }

  const encoding = normalizeLowercase(payload.chunk_encoding);
  if (encoding !== "base64json") {
    return null;
  }

  const data = extractInboundChunkData(payload);
  if (!data) {
    return null;
  }

  const requestId = valueAsString(payload.request_id)?.trim() || null;
  return {
    channelType,
    chunkId,
    chunkIndex,
    chunkTotal,
    requestId,
    data
  };
}

function extractInboundChunkData(payload: JsonObject): string | null {
  const direct = valueAsString(payload.chunk_data)?.trim();
  if (direct) {
    return direct;
  }

  const reservedKeys = new Set([
    "chunk_id",
    "chunk_index",
    "chunk_total",
    "chunk_encoding",
    "request_id",
    "message_id",
    "content",
    "message"
  ]);
  const candidateKey = Object.keys(payload).find((key) => {
    if (reservedKeys.has(key)) {
      return false;
    }

    const value = valueAsString(payload[key]);
    return Boolean(value && value.trim() !== "");
  });
  if (!candidateKey) {
    return null;
  }

  const candidate = valueAsString(payload[candidateKey])?.trim();
  return candidate || null;
}

function decodeChunkedPayloadObject(payloadBase64: string): JsonObject | null {
  try {
    const decodedJson = Buffer.from(payloadBase64, "base64").toString("utf8");
    const parsed = JSON.parse(decodedJson);
    return valueAsObject(parsed);
  } catch {
    return null;
  }
}

function buildAgentMcBridgeMessage(input: { userText: string }): string {
  return input.userText;
}

function buildNotificationBridgeUserText(input: {
  notification: JsonObject;
  notificationType: MaybeNotificationType;
  channelType: string | null;
  signalId: number;
}): string {
  const notificationId = valueAsString(input.notification.id)?.trim() || "unknown";
  const notificationType =
    normalizeLowercase(input.notificationType) ||
    normalizeLowercase(input.notification.notification_type) ||
    "unknown";
  const subjectType = valueAsString(input.notification.subject_type)?.trim() || "unknown";
  const subjectId = valueAsString(input.notification.subject_id) ?? String(toPositiveInteger(input.notification.subject_id) || "unknown");
  const subjectLabel = valueAsString(input.notification.subject_label)?.trim() || "unknown";
  const actorName = valueAsString(input.notification.actor_name)?.trim() || "unknown";
  const message =
    valueAsString(input.notification.message)?.trim() ||
    valueAsString(input.notification.comment)?.trim() ||
    "(no notification message)";
  const isRead = valueAsBoolean(input.notification.is_read);
  const responseAction = valueAsObject(input.notification.response_action);

  const lines = [
    "You received an AgentMC realtime notification.",
    "Treat it like an actionable request and execute AgentMC operations when needed.",
    "If response_action is present and valid, use it as the primary action path.",
    "If no action should be taken, explain why briefly.",
    "",
    "[Notification Context]",
    `notification_id=${notificationId}`,
    `notification_type=${notificationType}`,
    `channel_type=${input.channelType ?? "unknown"}`,
    `signal_id=${input.signalId}`,
    `subject_type=${subjectType}`,
    `subject_id=${subjectId}`,
    `subject_label=${subjectLabel}`,
    `actor_name=${actorName}`,
    `is_read=${isRead === true ? "true" : isRead === false ? "false" : "unknown"}`,
    "",
    "message:",
    message
  ];

  if (responseAction) {
    lines.push("", "response_action JSON:", "```json", toPromptJson(responseAction), "```");
  }

  lines.push("", "notification JSON:", "```json", toPromptJson(input.notification), "```");

  return lines.join("\n");
}

function normalizeOptionalBridgeToken(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/[\r\n\t]+/g, " ").trim();
  if (normalized === "") {
    return null;
  }

  return normalized.slice(0, 160);
}

function normalizeNotificationTypeFilter(value: readonly string[] | undefined): Set<string> | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const normalized = value.map((entry) => normalizeLowercase(entry)).filter((entry) => entry !== "");
  if (normalized.length === 0) {
    return null;
  }

  return new Set(normalized);
}

function shouldBridgeNotificationType(filter: Set<string> | null, notificationType: MaybeNotificationType): boolean {
  if (!filter) {
    return true;
  }

  const normalized = normalizeLowercase(notificationType);
  if (normalized === "") {
    return false;
  }

  return filter.has(normalized);
}

function notificationDedupeKey(notification: JsonObject, signalId: number): string {
  const notificationId = normalizeOptionalBridgeToken(valueAsString(notification.id));
  if (notificationId) {
    return `notification:id:${notificationId}:v:${notificationVersionToken(notification)}`;
  }

  const updatedAt = normalizeOptionalBridgeToken(valueAsString(notification.updated_at));
  if (updatedAt) {
    return `notification:signal:${signalId}:updated_at:${updatedAt}`;
  }

  return `notification:signal:${signalId}`;
}

function notificationEventDedupeKey(notification: JsonObject, signalId: number): string {
  const notificationId = normalizeOptionalBridgeToken(valueAsString(notification.id));
  if (notificationId) {
    return `notification:event:id:${notificationId}:v:${notificationVersionToken(notification)}`;
  }

  return `notification:event:signal:${Math.max(1, signalId)}`;
}

function notificationVersionToken(notification: JsonObject): string {
  return (
    normalizeOptionalBridgeToken(valueAsString(notification.updated_at)) ||
    normalizeOptionalBridgeToken(valueAsString(notification.read_at)) ||
    normalizeOptionalBridgeToken(valueAsString(notification.created_at)) ||
    "unknown"
  );
}

function notificationRequestId(notification: JsonObject, signalId: number, sessionId: number): string {
  const notificationId = normalizeOptionalBridgeToken(valueAsString(notification.id));
  if (notificationId) {
    const safeToken = toSafeRequestToken(notificationId);
    if (safeToken !== "") {
      return `notification-${safeToken}`;
    }
  }

  return `notification-${sessionId}-${Math.max(1, signalId)}`;
}

function toSafeRequestToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function firstPositiveInteger(...values: unknown[]): number {
  for (const value of values) {
    const normalized = toPositiveInteger(value);
    if (normalized > 0) {
      return normalized;
    }
  }

  return 0;
}

function toPositiveInteger(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return 0;
}

function createOperationError(operationId: string, status: number, _errorPayload: unknown): Error {
  const resolvedStatus = Number.isInteger(status) && status > 0 ? status : null;
  const statusSuffix = resolvedStatus === null ? "unknown status" : `status ${resolvedStatus}`;

  return new Error(`${operationId} failed with ${statusSuffix}.`);
}

async function readJsonResponseObject(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return valueAsObject(await response.clone().json());
  } catch {
    return null;
  }
}

function operationErrorStatus(error: Error): number | null {
  const match = /status\s+(\d{3})/i.exec(error.message);
  if (!match?.[1]) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function isSessionClaimFailureError(error: Error): boolean {
  const status = operationErrorStatus(error);
  if (status !== 404 && status !== 409 && status !== 410 && status !== 422) {
    return false;
  }

  return error.message.toLowerCase().includes("claimagentrealtimesession");
}

function shouldIgnorePublishRealtimeMessageError(
  error: Error,
  stopRequested: boolean,
  sessionStillTracked: boolean
): boolean {
  const status = operationErrorStatus(error);
  if (status !== 404 && status !== 409 && status !== 410 && status !== 422) {
    return false;
  }

  const message = error.message.toLowerCase();
  const isSignalPublishError =
    message.includes("createagentrealtimesignal") || message.includes("publishrealtimemessage");

  if (!isSignalPublishError) {
    return false;
  }

  return stopRequested || !sessionStillTracked;
}

function toCompactJson(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    return serialized ?? "No error details provided.";
  } catch {
    return String(value ?? "No error details provided.");
  }
}

function normalizeError(value: unknown, fallbackMessage = "Unexpected OpenClaw runtime error."): Error {
  if (value instanceof Error) {
    return new Error(formatErrorMessage(value, fallbackMessage));
  }

  const objectValue = valueAsObject(value);
  const root = valueAsObject(objectValue?.error) ?? objectValue;
  const data = valueAsObject(root?.data);
  const message =
    valueAsString(root?.message) ??
    valueAsString(data?.message) ??
    fallbackMessage;
  const details = extractErrorDetails(root, data);

  return details.length > 0
    ? new Error(`${message} (${details.join(", ")})`)
    : new Error(message);
}

function formatErrorMessage(error: Error, fallback: string): string {
  const baseMessage = valueAsString(error.message)?.trim() || fallback;
  const causeObject = valueAsObject((error as Error & { cause?: unknown }).cause);
  if (!causeObject) {
    return baseMessage;
  }

  const details = extractErrorDetails(causeObject, valueAsObject(causeObject.cause));
  if (details.length === 0) {
    return baseMessage;
  }

  return `${baseMessage} (${details.join(", ")})`;
}

function extractErrorDetails(...sources: Array<Record<string, unknown> | null>): string[] {
  const details = new Set<string>();
  for (const source of sources) {
    if (!source) {
      continue;
    }

    const code = valueAsString(source.code)?.trim();
    if (code) {
      details.add(`code=${code}`);
    }

    const errno = valueAsString(source.errno)?.trim();
    if (errno) {
      details.add(`errno=${errno}`);
    }

    const syscall = valueAsString(source.syscall)?.trim();
    if (syscall) {
      details.add(`syscall=${syscall}`);
    }

    const address = valueAsString(source.address)?.trim();
    if (address) {
      details.add(`address=${address}`);
    }

    const message = valueAsString(source.message)?.trim();
    if (message) {
      details.add(`cause=${message}`);
    }
  }

  return Array.from(details);
}

function normalizeProfileUpdateExecError(
  value: unknown,
  timeoutMs: number,
  command: string,
  args: readonly string[]
): Error {
  const objectValue = valueAsObject(value);
  const code = valueAsString(objectValue?.code)?.trim().toUpperCase() || "";
  const signal = valueAsString(objectValue?.signal)?.trim().toUpperCase() || "";
  const killed = valueAsBoolean(objectValue?.killed) === true;
  const commandLabel = [command, ...args].join(" ").trim();

  if (code === "ETIMEDOUT" || signal === "SIGTERM" || killed) {
    return new Error(
      `OpenClaw profile update timed out after ${timeoutMs}ms while running "${commandLabel}". ` +
      "Ensure OpenClaw can run in the runtime environment (auth/session configured)."
    );
  }

  return normalizeError(value);
}

function isUnknownNonInteractiveOptionError(value: unknown): boolean {
  const candidates = extractCommandErrorText(value);

  if (!candidates.includes("--non-interactive")) {
    return false;
  }

  return (
    candidates.includes("unknown option") ||
    candidates.includes("unknown argument") ||
    candidates.includes("unrecognized option")
  );
}

function isUnknownOpenClawAgentError(value: unknown, agentKey: string): boolean {
  const candidates = extractCommandErrorText(value);
  if (candidates === "") {
    return false;
  }

  const normalizedAgentKey = String(agentKey || "").trim().toLowerCase();
  const hasAgentContext =
    candidates.includes("agent") ||
    candidates.includes("--agent") ||
    (normalizedAgentKey !== "" && candidates.includes(normalizedAgentKey));
  if (!hasAgentContext) {
    return false;
  }

  const hasLookupFailure =
    candidates.includes("unknown agent") ||
    candidates.includes("agent not found") ||
    candidates.includes("no such agent") ||
    candidates.includes("not found") ||
    candidates.includes("does not exist") ||
    candidates.includes("cannot find") ||
    (candidates.includes("invalid value") && candidates.includes("--agent"));

  return hasLookupFailure;
}

function extractCommandErrorText(value: unknown): string {
  const objectValue = valueAsObject(value);
  const candidates = [
    valueAsString(objectValue?.message),
    valueAsString(objectValue?.stderr),
    valueAsString(objectValue?.stdout),
    valueAsString(objectValue?.shortMessage),
    value instanceof Error ? value.message : null
  ]
    .filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
    .join("\n")
    .toLowerCase();

  return candidates;
}

function valueAsObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as JsonObject;
}

function valueAsString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function valueAsBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no") {
      return false;
    }
  }

  return null;
}

function toPromptJson(value: unknown): string {
  try {
    const serialized = JSON.stringify(value, null, 2) ?? "{}";
    if (serialized.length <= 10_000) {
      return serialized;
    }
    return `${serialized.slice(0, 10_000)}\n... [truncated]`;
  } catch {
    return toCompactJson(value);
  }
}

function extractNotification(payload: JsonObject, channelType: string | null): JsonObject | null {
  const nested = valueAsObject(payload.notification);
  if (nested) {
    return nested;
  }

  if (looksLikeNotification(payload)) {
    return payload;
  }

  if (channelType?.includes("notification")) {
    return payload;
  }

  return null;
}

function looksLikeNotification(value: JsonObject): boolean {
  return (
    "notification_type" in value ||
    "subject_type" in value ||
    "response_action" in value ||
    "is_read" in value
  );
}

function isFallbackConnectionState(state: AgentRealtimeConnectionState): boolean {
  return state === "failed" || state === "disconnected" || state === "unavailable";
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
