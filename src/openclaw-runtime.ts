import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, rm, writeFile } from "node:fs/promises";
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
const DEFAULT_REQUEST_POLL_MS = 1_200;
const DEFAULT_FALLBACK_SIGNAL_POLL_MS = 1_000;
const DEFAULT_CATCHUP_SIGNAL_POLL_MS = 15_000;
const DEFAULT_SIGNAL_POLL_LIMIT = 100;
const DEFAULT_DUPLICATE_TTL_MS = 45_000;
const DEFAULT_GATEWAY_TIMEOUT_MS = 120_000;
const DEFAULT_OPENCLAW_SUBMIT_TIMEOUT_MS = 30_000;
const DEFAULT_OPENCLAW_WAIT_TIMEOUT_MS = 90_000;
const DEFAULT_OPENCLAW_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const DEFAULT_SELF_HEAL_CONNECTION_STALE_MS = 45_000;
const DEFAULT_SELF_HEAL_ACTIVITY_STALE_MS = 120_000;
const DEFAULT_SELF_HEAL_MIN_SESSION_AGE_MS = 20_000;

const DEFAULT_OPENCLAW_DOC_IDS = [
  "AGENTS.md",
  "SOUL.md",
  "TOOLS.md",
  "IDENTITY.md",
  "USER.md",
  "HEARTBEAT.md",
  "BOOTSTRAP.md",
  "MEMORY.md"
] as const;

type JsonObject = Record<string, unknown>;
type MaybePromise = void | Promise<void>;
type SessionSignalSource = "websocket" | "poll";
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

export interface AgentRuntimeRunInput {
  sessionId: number;
  requestId: string;
  userText: string;
}

export type AgentRuntimeRunResult = OpenClawRuntimeNotificationBridgeRunResult;

export interface OpenClawAgentRuntimeOptions {
  client: AgentMCApi;
  agent: number;
  realtimeSessionsEnabled?: boolean;
  chatRealtimeEnabled?: boolean;
  docsRealtimeEnabled?: boolean;
  notificationsRealtimeEnabled?: boolean;
  requestedSessionLimit?: number;
  requestPollMs?: number;
  fallbackSignalPollMs?: number;
  catchupSignalPollMs?: number;
  signalPollLimit?: number;
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
  runtimeDocIds?: readonly string[];
  includeMissingRuntimeDocs?: boolean;
  openclawCommand?: string;
  openclawAgent?: string;
  openclawSessionsPath?: string;
  openclawGatewayTimeoutMs?: number;
  openclawSubmitTimeoutMs?: number;
  openclawWaitTimeoutMs?: number;
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
  onError?: (error: Error) => MaybePromise;
}

export interface OpenClawAgentRuntimeStatus {
  running: boolean;
  activeSessions: number[];
  realtimeSessionsEnabled: boolean;
  chatRealtimeEnabled: boolean;
  docsRealtimeEnabled: boolean;
  notificationsRealtimeEnabled: boolean;
}

interface ResolvedOptions {
  client: AgentMCApi;
  agent: number;
  realtimeSessionsEnabled: boolean;
  chatRealtimeEnabled: boolean;
  docsRealtimeEnabled: boolean;
  notificationsRealtimeEnabled: boolean;
  requestedSessionLimit: number;
  requestPollMs: number;
  fallbackSignalPollMs: number;
  catchupSignalPollMs: number;
  signalPollLimit: number;
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
  runtimeDocIds: string[];
  includeMissingRuntimeDocs: boolean;
  openclawCommand: string;
  openclawAgent: string;
  openclawSessionsPath: string;
  openclawGatewayTimeoutMs: number;
  openclawSubmitTimeoutMs: number;
  openclawWaitTimeoutMs: number;
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
  lastSignalPollAtMs: number;
  nextSignalPollAtMs: number;
  lastSignalRateLimitLogAtMs: number;
  sawConnectedState: boolean;
  createdAtMs: number;
  lastHealthActivityAtMs: number;
  lastConnectionStateChangeAtMs: number;
  processedInboundKeys: Map<string, number>;
}

interface OpenClawRunResult extends OpenClawRuntimeNotificationBridgeRunResult {}

interface BridgedAgentMcContext {
  source: string;
  intentScope: string;
  timezone: string | null;
  actorUserId: number;
  defaultAssigneeUserId: number;
}

export class OpenClawAgentRuntime {
  private readonly options: ResolvedOptions;
  private readonly sessions = new Map<number, SessionState>();
  private readonly processedNotificationKeys = new Map<string, number>();
  private stopRequested = false;
  private runPromise: Promise<void> | null = null;
  private nextRequestedPollAtMs = 0;
  private lastRequestedRateLimitLogAtMs = 0;

  constructor(options: OpenClawAgentRuntimeOptions) {
    this.options = resolveOptions(options);
  }

  getStatus(): OpenClawAgentRuntimeStatus {
    return {
      running: this.runPromise !== null && !this.stopRequested,
      activeSessions: Array.from(this.sessions.keys()).sort((left, right) => left - right),
      realtimeSessionsEnabled: this.options.realtimeSessionsEnabled,
      chatRealtimeEnabled: this.options.chatRealtimeEnabled,
      docsRealtimeEnabled: this.options.docsRealtimeEnabled,
      notificationsRealtimeEnabled: this.options.notificationsRealtimeEnabled
    };
  }

  async run(): Promise<void> {
    if (this.runPromise) {
      return this.runPromise;
    }

    this.stopRequested = false;
    this.nextRequestedPollAtMs = 0;
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
    this.nextRequestedPollAtMs = 0;
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
    while (!this.stopRequested) {
      const nowMs = Date.now();
      if (this.options.realtimeSessionsEnabled && nowMs >= this.nextRequestedPollAtMs) {
        try {
          await this.pollRequestedSessions();
        } catch (error) {
          await this.emitError(normalizeError(error));
        }
      }

      await sleep(this.resolveLoopDelayMs());
    }
  }

  private async pollRequestedSessions(): Promise<void> {
    const response = await this.options.client.operations.listAgentRealtimeRequestedSessions({
      params: {
        query: {
          limit: this.options.requestedSessionLimit
        }
      }
    });

    if (response.error) {
      const status = Number(response.status || 0);
      if (status === 429) {
        const nowMs = Date.now();
        this.nextRequestedPollAtMs = nowMs + Math.max(this.options.requestPollMs * 3, 4_000);
        if (nowMs - this.lastRequestedRateLimitLogAtMs >= 5_000) {
          this.lastRequestedRateLimitLogAtMs = nowMs;
          await this.emitError(
            new Error(
              `listAgentRealtimeRequestedSessions rate limited (429); backing off for ${this.nextRequestedPollAtMs - nowMs}ms.`
            )
          );
        }
        return;
      }

      throw createOperationError("listAgentRealtimeRequestedSessions", response.status, response.error);
    }

    this.nextRequestedPollAtMs = Date.now() + this.options.requestPollMs;

    const sessions = Array.isArray(response.data?.data) ? response.data.data : [];
    const orderedSessions = [...sessions].sort(
      (left, right) => toPositiveInteger(right?.id) - toPositiveInteger(left?.id)
    );

    for (const session of orderedSessions) {
      const sessionId = toPositiveInteger(session?.id);
      if (sessionId < 1 || this.sessions.has(sessionId)) {
        continue;
      }

      this.startSessionLoop(sessionId);
    }
  }

  private resolveLoopDelayMs(): number {
    const nowMs = Date.now();
    const fallbackDelayMs = this.sessions.size > 0
      ? Math.max(this.options.requestPollMs, 3_000)
      : this.options.requestPollMs;
    const requestedDelayMs = this.options.realtimeSessionsEnabled
      ? Math.max(0, this.nextRequestedPollAtMs - nowMs)
      : fallbackDelayMs;

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
      lastSignalPollAtMs: 0,
      nextSignalPollAtMs: 0,
      lastSignalRateLimitLogAtMs: 0,
      sawConnectedState: false,
      createdAtMs: nowMs,
      lastHealthActivityAtMs: nowMs,
      lastConnectionStateChangeAtMs: nowMs,
      processedInboundKeys: new Map()
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

            if (this.options.includeInitialSnapshot && this.options.docsRealtimeEnabled) {
              const reason = state.sawConnectedState ? "reconnected" : "session_ready";
              await this.sendInitialSnapshot(state, reason);
            }

            state.sawConnectedState = true;
            await callOptionalHandler(this.options.onSessionReady, session, this.options.onError);
          },
          onSignal: async (signal) => {
            await this.handleSignal(state, signal, "websocket");
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
              this.options.docsRealtimeEnabled &&
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
        try {
          await subscription.ready;
        } catch (error) {
          const nowMs = Date.now();
          const normalizedError = normalizeError(error);

          state.connectionState = "unavailable";
          state.lastConnectionStateChangeAtMs = nowMs;
          state.lastHealthActivityAtMs = nowMs;
          state.nextSignalPollAtMs = 0;

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
              `Realtime websocket startup failed for session ${state.sessionId}; continuing with HTTP polling fallback. ${normalizedError.message}`
            )
          );
        }

        while (!this.stopRequested && !state.closed) {
          const nowMs = Date.now();
          await this.maybeSelfHealSession(state, nowMs);
          if (state.closed || this.stopRequested) {
            break;
          }
          const shouldFallbackPoll = isFallbackConnectionState(state.connectionState);
          const pollIntervalMs = shouldFallbackPoll
            ? this.options.fallbackSignalPollMs
            : this.options.catchupSignalPollMs;

          const canPoll =
            pollIntervalMs > 0 &&
            nowMs >= state.nextSignalPollAtMs &&
            (state.lastSignalPollAtMs <= 0 || nowMs - state.lastSignalPollAtMs >= pollIntervalMs);

          if (canPoll) {
            await this.pollSessionSignals(state, "poll");
            if (state.closed || this.stopRequested) {
              break;
            }
          }

          await sleep(150);
        }
      } catch (error) {
        await this.emitError(normalizeError(error));
      } finally {
        await this.closeSession(state, state.closeReason ?? "session_loop_ended", false);
      }
    })();
  }

  private async pollSessionSignals(state: SessionState, source: SessionSignalSource): Promise<void> {
    if (state.closed) {
      return;
    }

    state.lastSignalPollAtMs = Date.now();
    const response = await this.options.client.operations.listAgentRealtimeSignals({
      params: {
        path: {
          session: state.sessionId
        },
        query: {
          after_id: state.lastNonAgentSignalId > 0 ? state.lastNonAgentSignalId : undefined,
          exclude_sender: "agent",
          limit: this.options.signalPollLimit
        }
      }
    });

    if (response.error) {
      const status = Number(response.status || 0);

      if (status === 404 || status === 409 || status === 422) {
        state.closeReason = status === 422 ? "session_poll_invalid" : "session_poll_closed";
        await this.closeSession(state, state.closeReason, false);
        return;
      }

      if (status === 429) {
        const backoffMs = Math.max(this.options.fallbackSignalPollMs * 2, 2_500);
        state.nextSignalPollAtMs = Date.now() + backoffMs;

        if (Date.now() - state.lastSignalRateLimitLogAtMs >= 5_000) {
          state.lastSignalRateLimitLogAtMs = Date.now();
          await this.emitError(
            new Error(
              `listAgentRealtimeSignals rate limited (429) for session ${state.sessionId}; backing off for ${backoffMs}ms.`
            )
          );
        }
        return;
      }

      throw createOperationError("listAgentRealtimeSignals", response.status, response.error);
    }

    state.nextSignalPollAtMs = 0;
    state.lastHealthActivityAtMs = Date.now();
    const signals = Array.isArray(response.data?.data) ? response.data.data : [];

    for (const rawSignal of signals) {
      const signal = normalizeSignal(rawSignal, state.sessionId);
      if (!signal) {
        continue;
      }
      await this.handleSignal(state, signal, source);
      if (state.closed || this.stopRequested) {
        break;
      }
    }
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
      await this.handleChatUserSignal(state, signal, payload, channelPayload);
      return;
    }

    if (this.options.docsRealtimeEnabled && channelType === "snapshot.request") {
      await this.handleSnapshotRequest(state, payload, channelPayload);
      return;
    }

    if (this.options.docsRealtimeEnabled && channelType === "doc.save") {
      await this.handleDocSave(state, payload, channelPayload);
      return;
    }

    if (this.options.docsRealtimeEnabled && channelType === "doc.delete") {
      await this.handleDocDelete(state, payload, channelPayload);
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
  ): Promise<void> {
    const eventDedupeKey = notificationEventDedupeKey(input.notification, input.signal.id);
    if (!this.shouldProcessNotificationKey(eventDedupeKey)) {
      return;
    }

    await this.maybeBridgeNotificationToAi(state, input);

    if (!this.options.onNotification) {
      return;
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
    const bridgePayload = buildNotificationBridgePayload({
      signal: input.signal,
      notification: input.notification,
      notificationType: effectiveNotificationType
    });
    const userText = buildNotificationBridgeUserText({
      notification: input.notification,
      notificationType: effectiveNotificationType,
      channelType: input.channelType,
      signalId: input.signal.id
    });

    const bridgedUserText = buildAgentMcBridgeMessage({
      userText,
      payload: bridgePayload,
      session: state.session
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
    if (runResult.status !== "ok") {
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
        body: {}
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
    const requestId =
      valueAsString(payload.request_id)?.trim() ||
      valueAsString(envelope.request_id)?.trim() ||
      `req-${state.sessionId}-${Date.now().toString(36)}`;
    const messageId = toPositiveInteger(payload.message_id);
    const dedupeKey = messageId > 0 ? `chat:message:${messageId}` : `chat:request:${requestId}`;
    if (!shouldProcessInboundKey(state, dedupeKey, this.options.duplicateTtlMs)) {
      return;
    }

    const userText =
      valueAsString(payload.content)?.trim() ||
      valueAsString(payload.message)?.trim() ||
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

    if (this.options.sendThinkingDelta) {
      await this.publishChannelMessage(state.sessionId, "chat.agent.delta", requestId, {
        delta: this.options.thinkingText,
        ...(messageId > 0 ? { message_id: messageId } : {})
      });
    }

    const bridgedUserText = buildAgentMcBridgeMessage({
      userText,
      payload,
      session: state.session
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
    const runId = `agentmc-${input.sessionId}-${input.requestId}`;
    const sessionKey = `agent:${this.options.openclawAgent}:agentmc:${input.sessionId}`;

    const submitResponse = await this.gatewayCall("agent", {
      idempotencyKey: runId,
      sessionKey,
      message: input.userText
    }, this.options.openclawSubmitTimeoutMs);

    const submittedRunId =
      valueAsString(submitResponse.runId)?.trim() ||
      valueAsString(submitResponse.run_id)?.trim() ||
      valueAsString(submitResponse.id)?.trim() ||
      runId;

    const waitResponse = await this.gatewayCall("agent.wait", {
      runId: submittedRunId,
      timeoutMs: this.options.openclawWaitTimeoutMs
    }, this.options.openclawGatewayTimeoutMs);

    const waitStatus = normalizeLowercase(waitResponse.status) || "ok";
    if (waitStatus === "timeout") {
      return {
        requestId: input.requestId,
        runId: submittedRunId,
        status: "timeout",
        textSource: "wait",
        content: "I'm still working on that. Please retry in a moment."
      };
    }

    if (waitStatus !== "ok") {
      return {
        requestId: input.requestId,
        runId: submittedRunId,
        status: "error",
        textSource: "error",
        content: `I hit an error in the OpenClaw run: ${extractText(waitResponse.error) ?? "unknown error"}`
      };
    }

    const directText =
      extractText(waitResponse.content) ??
      extractText(waitResponse.output_text) ??
      extractText(waitResponse.text) ??
      extractText(waitResponse.message) ??
      extractText(waitResponse.response) ??
      null;

    const sanitizedDirectText = directText ? sanitizeAssistantOutputText(directText) : "";
    if (sanitizedDirectText !== "") {
      return {
        requestId: input.requestId,
        runId: submittedRunId,
        status: "ok",
        textSource: "wait",
        content: sanitizedDirectText
      };
    }

    const historyText = await this.readLatestAssistantText(sessionKey);
    const sanitizedHistoryText = historyText ? sanitizeAssistantOutputText(historyText) : "";
    if (sanitizedHistoryText !== "") {
      return {
        requestId: input.requestId,
        runId: submittedRunId,
        status: "ok",
        textSource: "session_history",
        content: sanitizedHistoryText
      };
    }

    return {
      requestId: input.requestId,
      runId: submittedRunId,
      status: "ok",
      textSource: "fallback",
      content: "I finished the run, but no assistant text was found."
    };
  }

  private async gatewayCall(method: string, params: JsonObject, timeoutMs: number): Promise<JsonObject> {
    const args = [
      "gateway",
      "call",
      method,
      "--json",
      "--timeout",
      String(toPositiveInteger(timeoutMs)),
      "--params",
      JSON.stringify(params)
    ];

    try {
      const { stdout } = await execFileAsync(this.options.openclawCommand, args, {
        maxBuffer: this.options.openclawMaxBufferBytes
      });
      const parsed = parseGatewayJson(stdout);
      if (hasTopLevelRunResponseShape(parsed)) {
        return parsed;
      }
      const unwrapped = unwrapGatewayPayload(parsed);
      if (unwrapped === parsed) {
        return parsed;
      }
      return {
        ...parsed,
        ...unwrapped
      };
    } catch (error) {
      throw new Error(`openclaw gateway call ${method} failed: ${normalizeError(error).message}`);
    }
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

      for (const candidatePath of resolveSessionFilePaths(sessionFile, this.options.openclawSessionsPath)) {
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

  private async handleDocSave(state: SessionState, envelope: JsonObject, payload: JsonObject): Promise<void> {
    const requestIdFromPayload =
      valueAsString(payload.request_id)?.trim() ||
      valueAsString(envelope.request_id)?.trim() ||
      "";
    const requestId = requestIdFromPayload || `doc-save-${state.sessionId}-${Date.now().toString(36)}`;
    const docId = normalizeDocId(valueAsString(payload.doc_id));
    const dedupeKey = `doc.save:${requestId}:${docId ?? "unknown"}`;

    if (!shouldProcessInboundKey(state, dedupeKey, this.options.duplicateTtlMs)) {
      return;
    }

    if (!requestIdFromPayload) {
      await this.publishChannelMessage(state.sessionId, "doc.save.error", requestId, {
        doc_id: docId ?? "",
        code: "invalid_request",
        error: "request_id is required"
      });
      return;
    }

    if (!docId) {
      await this.publishChannelMessage(state.sessionId, "doc.save.error", requestId, {
        doc_id: "",
        code: "invalid_request",
        error: "doc_id is required"
      });
      return;
    }

    if (!this.options.runtimeDocIds.includes(docId)) {
      await this.publishChannelMessage(state.sessionId, "doc.save.error", requestId, {
        doc_id: docId,
        code: "invalid_doc_id",
        error: "doc_id is not allowed for this runtime"
      });
      return;
    }

    const baseHash = valueAsString(payload.base_hash)?.trim() || "";
    const title = valueAsString(payload.title)?.trim() || docId;
    const bodyMarkdown = valueAsString(payload.body_markdown) ?? "";
    const current = await this.readRuntimeDoc(docId);

    if (current && baseHash !== current.base_hash) {
      await this.publishChannelMessage(state.sessionId, "doc.save.error", requestId, {
        doc_id: docId,
        code: "conflict",
        error: "base_hash mismatch",
        current_hash: current.base_hash
      });
      return;
    }

    if (!current && baseHash !== "") {
      await this.publishChannelMessage(state.sessionId, "doc.save.error", requestId, {
        doc_id: docId,
        code: "conflict",
        error: "base_hash mismatch",
        current_hash: null
      });
      return;
    }

    await writeFile(this.resolveRuntimeDocPath(docId), bodyMarkdown, "utf8");
    const next = await this.readRuntimeDoc(docId);

    if (!next) {
      throw new Error(`Failed to read runtime doc ${docId} after save.`);
    }

    await this.publishChannelMessage(state.sessionId, "doc.save.ok", requestId, {
      doc_id: docId,
      doc: {
        id: docId,
        title: title || next.title,
        body_markdown: next.body_markdown,
        base_hash: next.base_hash
      }
    });
  }

  private async handleDocDelete(state: SessionState, envelope: JsonObject, payload: JsonObject): Promise<void> {
    const requestIdFromPayload =
      valueAsString(payload.request_id)?.trim() ||
      valueAsString(envelope.request_id)?.trim() ||
      "";
    const requestId = requestIdFromPayload || `doc-delete-${state.sessionId}-${Date.now().toString(36)}`;
    const docId = normalizeDocId(valueAsString(payload.doc_id));
    const dedupeKey = `doc.delete:${requestId}:${docId ?? "unknown"}`;

    if (!shouldProcessInboundKey(state, dedupeKey, this.options.duplicateTtlMs)) {
      return;
    }

    if (!requestIdFromPayload) {
      await this.publishChannelMessage(state.sessionId, "doc.delete.error", requestId, {
        doc_id: docId ?? "",
        code: "invalid_request",
        error: "request_id is required"
      });
      return;
    }

    if (!docId) {
      await this.publishChannelMessage(state.sessionId, "doc.delete.error", requestId, {
        doc_id: "",
        code: "invalid_request",
        error: "doc_id is required"
      });
      return;
    }

    if (!this.options.runtimeDocIds.includes(docId)) {
      await this.publishChannelMessage(state.sessionId, "doc.delete.error", requestId, {
        doc_id: docId,
        code: "invalid_doc_id",
        error: "doc_id is not allowed for this runtime"
      });
      return;
    }

    const current = await this.readRuntimeDoc(docId);
    if (!current) {
      await this.publishChannelMessage(state.sessionId, "doc.delete.error", requestId, {
        doc_id: docId,
        code: "not_found",
        error: "document not found"
      });
      return;
    }

    const baseHash = valueAsString(payload.base_hash)?.trim() || "";
    if (baseHash !== current.base_hash) {
      await this.publishChannelMessage(state.sessionId, "doc.delete.error", requestId, {
        doc_id: docId,
        code: "conflict",
        error: "base_hash mismatch",
        current_hash: current.base_hash
      });
      return;
    }

    await rm(this.resolveRuntimeDocPath(docId), { force: false });

    await this.publishChannelMessage(state.sessionId, "doc.delete.ok", requestId, {
      doc_id: docId
    });
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

    await this.options.client.publishRealtimeMessage({
      agent: this.options.agent,
      session: sessionId,
      channelType,
      requestId,
      payload: payloadWithRequestId
    });
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
      const response = await this.options.client.operations.closeAgentRealtimeSession({
        params: {
          path: {
            session: state.sessionId
          }
        },
        body: {
          reason,
          status: closeStatusOverride ?? this.options.closeStatus
        }
      });

      if (response.error) {
        await this.emitError(createOperationError("closeAgentRealtimeSession", response.status, response.error));
      }
    }

    this.sessions.delete(state.sessionId);
    await callOptionalHandler(this.options.onSessionClosed, state.sessionId, this.options.onError, reason);
  }

  private async emitError(error: Error): Promise<void> {
    await callErrorHandler(this.options.onError, error);
  }

  private shouldProcessNotificationKey(key: string): boolean {
    return shouldProcessCacheKey(this.processedNotificationKeys, key, this.options.duplicateTtlMs);
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

export class AgentRuntime extends OpenClawAgentRuntime {}

function resolveOptions(options: OpenClawAgentRuntimeOptions): ResolvedOptions {
  const agent = toPositiveInteger(options.agent);
  if (agent < 1) {
    throw new Error("options.agent must be a positive integer.");
  }

  const runtimeDocsDirectory = resolve(options.runtimeDocsDirectory ?? process.cwd());
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
  const docsRealtimeEnabled = options.docsRealtimeEnabled !== false;
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
    : chatRealtimeEnabled || docsRealtimeEnabled || notificationsRealtimeEnabled || hasRealtimeCallbacks;

  return {
    client: options.client,
    agent,
    realtimeSessionsEnabled,
    chatRealtimeEnabled,
    docsRealtimeEnabled,
    notificationsRealtimeEnabled,
    requestedSessionLimit: normalizePositiveInt(options.requestedSessionLimit, DEFAULT_REQUESTED_SESSION_LIMIT),
    requestPollMs: normalizePositiveInt(options.requestPollMs, DEFAULT_REQUEST_POLL_MS),
    fallbackSignalPollMs: normalizePositiveInt(options.fallbackSignalPollMs, DEFAULT_FALLBACK_SIGNAL_POLL_MS),
    catchupSignalPollMs: normalizePositiveInt(options.catchupSignalPollMs, DEFAULT_CATCHUP_SIGNAL_POLL_MS),
    signalPollLimit: normalizePositiveInt(options.signalPollLimit, DEFAULT_SIGNAL_POLL_LIMIT),
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
    runtimeDocIds,
    includeMissingRuntimeDocs: options.includeMissingRuntimeDocs === true,
    openclawCommand: valueAsString(options.openclawCommand)?.trim() || "openclaw",
    openclawAgent,
    openclawSessionsPath: valueAsString(options.openclawSessionsPath)?.trim() || defaultSessionsPath,
    openclawGatewayTimeoutMs: normalizePositiveInt(options.openclawGatewayTimeoutMs, DEFAULT_GATEWAY_TIMEOUT_MS),
    openclawSubmitTimeoutMs: normalizePositiveInt(options.openclawSubmitTimeoutMs, DEFAULT_OPENCLAW_SUBMIT_TIMEOUT_MS),
    openclawWaitTimeoutMs: normalizePositiveInt(options.openclawWaitTimeoutMs, DEFAULT_OPENCLAW_WAIT_TIMEOUT_MS),
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
    onError: options.onError
  };
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

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0) {
    return value;
  }

  return fallback;
}

function normalizeLowercase(value: unknown): string {
  return valueAsString(value)?.trim().toLowerCase() || "";
}

function parseGatewayJson(stdout: string): JsonObject {
  const output = String(stdout || "").trim();
  if (output === "") {
    throw new Error("Empty OpenClaw gateway response.");
  }

  try {
    const parsed = JSON.parse(output);
    return valueAsObject(parsed) ?? {};
  } catch {
    const lines = output
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter((line) => line !== "");

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      if (line === undefined) {
        continue;
      }
      try {
        const parsed = JSON.parse(line);
        const object = valueAsObject(parsed);
        if (object) {
          return object;
        }
      } catch {
        // Keep scanning trailing lines.
      }
    }
  }

  throw new Error("OpenClaw gateway response was not parseable JSON.");
}

function unwrapGatewayPayload(payload: JsonObject): JsonObject {
  const result = valueAsObject(payload.result);
  if (result) {
    return result;
  }

  const data = valueAsObject(payload.data);
  if (data) {
    return data;
  }

  const nestedPayload = valueAsObject(payload.payload);
  if (nestedPayload) {
    return nestedPayload;
  }

  return payload;
}

function hasTopLevelRunResponseShape(payload: JsonObject): boolean {
  return (
    (valueAsString(payload.runId)?.trim() || "") !== "" ||
    (valueAsString(payload.run_id)?.trim() || "") !== ""
  );
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

function resolveSessionFilePaths(sessionFilePath: string, sessionsJsonPath: string): string[] {
  const trimmed = sessionFilePath.trim();
  if (trimmed === "") {
    return [];
  }

  if (isAbsolute(trimmed)) {
    return [trimmed];
  }

  const sessionsStoreDir = dirname(resolve(sessionsJsonPath));
  const safeRuntimeBase = process.cwd();
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

function buildAgentMcBridgeMessage(input: {
  userText: string;
  payload: JsonObject;
  session: AgentRealtimeSessionRecord | null;
}): string {
  const context = deriveBridgedAgentMcContext(input.payload, input.session);
  const lines = [
    "[AgentMC Context]",
    "app=AgentMC",
    `source=${context.source}`,
    `intent_scope=${context.intentScope}`,
    ...(context.timezone ? [`timezone=${context.timezone}`] : []),
    ...(context.actorUserId > 0 ? [`actor_user_id=${context.actorUserId}`] : []),
    ...(context.defaultAssigneeUserId > 0
      ? [`default_assignee_user_id=${context.defaultAssigneeUserId}`]
      : []),
    "routing_hint=Treat actions with no external app specified as AgentMC operations.",
    "assignment_hint=When the user says 'assign it to me', map 'me' to default_assignee_user_id.",
    "",
    input.userText
  ];

  return lines.join("\n");
}

function buildNotificationBridgePayload(input: {
  signal: AgentRealtimeSignalMessage;
  notification: JsonObject;
  notificationType: MaybeNotificationType;
}): JsonObject {
  const signalEnvelope = valueAsObject(input.signal.payload) ?? {};
  const signalPayload = valueAsObject(signalEnvelope.payload) ?? {};
  const notificationType =
    normalizeLowercase(input.notificationType) ||
    normalizeLowercase(input.notification.notification_type) ||
    "notification";

  const actorUserId = firstPositiveInteger(
    signalPayload.actor_user_id,
    signalEnvelope.actor_user_id,
    normalizeLowercase(input.notification.actor_type) === "user" ? input.notification.actor_id : undefined
  );
  const assigneeType = normalizeLowercase(input.notification.assignee_type);
  const defaultAssigneeUserId = firstPositiveInteger(
    signalPayload.default_assignee_user_id,
    signalEnvelope.default_assignee_user_id,
    assigneeType === "user" ? input.notification.assignee_id : undefined,
    actorUserId
  );

  return {
    ...signalEnvelope,
    ...signalPayload,
    source: normalizeBridgeToken(
      valueAsString(signalPayload.source) ?? valueAsString(signalEnvelope.source) ?? "agentmc_notification",
      "agentmc_notification"
    ),
    intent_scope: normalizeBridgeToken(
      valueAsString(signalPayload.intent_scope) ??
        valueAsString(signalEnvelope.intent_scope) ??
        "agentmc_notification",
      "agentmc_notification"
    ),
    timezone: valueAsString(signalPayload.timezone) ?? valueAsString(signalEnvelope.timezone),
    notification_type: notificationType,
    notification: input.notification,
    ...(actorUserId > 0 ? { actor_user_id: actorUserId } : {}),
    ...(defaultAssigneeUserId > 0 ? { default_assignee_user_id: defaultAssigneeUserId } : {})
  };
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

function deriveBridgedAgentMcContext(
  payload: JsonObject,
  session: AgentRealtimeSessionRecord | null
): BridgedAgentMcContext {
  const sessionRequesterUserId = toPositiveInteger(session?.requested_by_user_id);
  const actorUserId = firstPositiveInteger(
    payload.actor_user_id,
    payload.user_id,
    payload.requested_by_user_id,
    sessionRequesterUserId
  );
  const defaultAssigneeUserId = firstPositiveInteger(
    payload.default_assignee_user_id,
    payload.assigned_to_user_id,
    actorUserId
  );

  return {
    source: normalizeBridgeToken(valueAsString(payload.source), "agentmc_chat"),
    intentScope: normalizeBridgeToken(valueAsString(payload.intent_scope), "agentmc"),
    timezone: normalizeOptionalBridgeToken(valueAsString(payload.timezone)),
    actorUserId,
    defaultAssigneeUserId
  };
}

function normalizeBridgeToken(value: string | null, fallback: string): string {
  const normalized = normalizeOptionalBridgeToken(value);
  if (normalized) {
    return normalized;
  }
  return fallback;
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

function normalizeSignal(rawSignal: unknown, fallbackSessionId: number): AgentRealtimeSignalMessage | null {
  const parsed = valueAsObject(rawSignal);
  if (!parsed) {
    return null;
  }

  const id = toPositiveInteger(parsed.id);
  if (id < 1) {
    return null;
  }

  return {
    id,
    session_id: toPositiveInteger(parsed.session_id) || fallbackSessionId,
    sender: valueAsString(parsed.sender) ?? "system",
    type: valueAsString(parsed.type) ?? "message",
    payload: valueAsObject(parsed.payload) ?? {},
    created_at: valueAsString(parsed.created_at) ?? null
  };
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
    return value;
  }

  const objectValue = valueAsObject(value);
  const message = valueAsString(objectValue?.message) ?? fallbackMessage;
  return new Error(message);
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
