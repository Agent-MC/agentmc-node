import type { AgentMCApi } from "./client";
import type { components } from "./generated/schema";

type MaybePromise = void | Promise<void>;
type JsonObject = Record<string, unknown>;

interface PusherAuthorizer {
  authorize(socketId: string, callback: (error: boolean, data: unknown) => void): void;
}

interface PusherChannel {
  name: string;
  bind(eventName: string, callback: (payload: unknown) => void): void;
  unbind?(eventName?: string, callback?: (payload: unknown) => void): void;
}

interface PusherConnection {
  bind(eventName: string, callback: (payload: unknown) => void): void;
  unbind?(eventName?: string, callback?: (payload: unknown) => void): void;
}

interface PusherClient {
  subscribe(channelName: string): PusherChannel;
  unsubscribe(channelName: string): void;
  disconnect(): void;
  connection: PusherConnection;
}

interface PusherOptions {
  wsHost: string;
  wsPort: number;
  wssPort: number;
  forceTLS: boolean;
  enabledTransports: ("ws" | "wss")[];
  disableStats: boolean;
  cluster: string;
  wsPath?: string;
  authorizer: (channel: PusherChannel) => PusherAuthorizer;
}

type PusherConstructor = new (key: string, options: PusherOptions) => PusherClient;
let pusherConstructorPromise: Promise<PusherConstructor> | null = null;

const DEFAULT_REALTIME_SIGNAL_TYPE = "message";
const DEFAULT_REALTIME_MAX_PAYLOAD_BYTES = 9_000;
const DEFAULT_REALTIME_MAX_ENVELOPE_BYTES = 10_000;
const DEFAULT_REALTIME_CHUNK_FIELD = "chunk_data";
const DEFAULT_REALTIME_CHUNK_ENCODING = "base64json";
const DEFAULT_REALTIME_READY_TIMEOUT_MS = 45_000;
const DEFAULT_RESUBSCRIBE_BACKOFF_MS = 1_000;
const MAX_RESUBSCRIBE_BACKOFF_MS = 12_000;
const DEFAULT_SENDER_FOR_ENVELOPE_ESTIMATE = "agent";
const DEFAULT_ENVELOPE_TIMESTAMP = "2026-01-01T00:00:00Z";
const TEXT_ENCODER = new TextEncoder();

export type AgentRealtimeSessionRecord = components["schemas"]["AgentRealtimeSession"];
export type AgentRealtimeConnectionState =
  | "initialized"
  | "connecting"
  | "connected"
  | "unavailable"
  | "failed"
  | "disconnected";

export interface AgentRealtimeSignalMessage {
  id: number;
  session_id: number;
  sender: string;
  type: string;
  payload: JsonObject;
  created_at: string | null;
}

export interface AgentRealtimeNotificationEvent {
  signal: AgentRealtimeSignalMessage;
  notification: JsonObject;
  notificationType: string | null;
  channelType: string | null;
}

export interface AgentRealtimeNotificationsOptions {
  agent: number;
  session?: number;
  requestedSessionLimit?: number;
  readyTimeoutMs?: number;
  autoCloseSession?: boolean;
  closeReason?: string;
  closeStatus?: "closed" | "failed";
  onReady?: (session: AgentRealtimeSessionRecord) => MaybePromise;
  onSignal?: (signal: AgentRealtimeSignalMessage) => MaybePromise;
  onNotification?: (event: AgentRealtimeNotificationEvent) => MaybePromise;
  onConnectionStateChange?: (state: AgentRealtimeConnectionState) => MaybePromise;
  onError?: (error: Error) => MaybePromise;
}

export interface AgentRealtimeNotificationsSubscription {
  readonly session: AgentRealtimeSessionRecord;
  readonly channel: string;
  readonly event: string;
  readonly ready: Promise<void>;
  publishMessage(
    options: Omit<AgentRealtimePublishMessageOptions, "agent" | "session">
  ): Promise<AgentRealtimePublishMessageResult>;
  disconnect(): Promise<void>;
}

export interface AgentRealtimePublishMessageOptions {
  agent: number;
  session: number;
  channelType: string;
  payload: JsonObject;
  signalType?: string;
  requestId?: string;
  maxPayloadBytes?: number;
  maxEnvelopeBytes?: number;
  chunkFieldName?: string;
  chunkId?: string;
}

export interface AgentRealtimePublishMessageResult {
  signalIds: number[];
  chunked: boolean;
  chunkCount: number;
  chunkId: string | null;
  signalType: string;
  channelType: string;
}

export async function prewarmRealtimeTransport(): Promise<void> {
  await loadPusherConstructor();
}

class RealtimeNotificationsSubscription implements AgentRealtimeNotificationsSubscription {
  readonly session: AgentRealtimeSessionRecord;
  readonly channel: string;
  readonly event: string;
  readonly ready: Promise<void>;

  private readonly client: AgentMCApi;
  private readonly options: AgentRealtimeNotificationsOptions;
  private readonly pusher: PusherClient;
  private readonly onBeforeDisconnect?: () => void;
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  private readySettled = false;
  private disconnected = false;

  constructor(args: {
    client: AgentMCApi;
    options: AgentRealtimeNotificationsOptions;
    session: AgentRealtimeSessionRecord;
    channel: string;
    event: string;
    pusher: PusherClient;
    onBeforeDisconnect?: () => void;
  }) {
    this.client = args.client;
    this.options = args.options;
    this.session = args.session;
    this.channel = args.channel;
    this.event = args.event;
    this.pusher = args.pusher;
    this.onBeforeDisconnect = args.onBeforeDisconnect;
    this.ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
  }

  markReady(): void {
    if (this.readySettled) {
      return;
    }

    this.readySettled = true;
    this.readyResolve();
  }

  markReadyError(error: Error): void {
    if (this.readySettled) {
      return;
    }

    this.readySettled = true;
    this.readyReject(error);
  }

  async publishMessage(
    options: Omit<AgentRealtimePublishMessageOptions, "agent" | "session">
  ): Promise<AgentRealtimePublishMessageResult> {
    return publishRealtimeMessage(this.client, {
      ...options,
      agent: this.options.agent,
      session: this.session.id
    });
  }

  async disconnect(): Promise<void> {
    if (this.disconnected) {
      return;
    }

    this.disconnected = true;
    this.onBeforeDisconnect?.();

    try {
      this.pusher.unsubscribe(this.channel);
      this.pusher.disconnect();
    } catch {
      // Best-effort teardown; ignore local socket cleanup failures.
    }

    if (!this.readySettled) {
      this.markReadyError(new Error("Realtime subscription disconnected before it was ready."));
    }

    if (!this.options.autoCloseSession) {
      return;
    }

    const closeResult = await this.client.operations.closeAgentRealtimeSession({
      params: {
        path: {
          session: this.session.id
        }
      },
      body: {
        reason: this.options.closeReason ?? "sdk_disconnect",
        status: this.options.closeStatus ?? "closed"
      }
    });

    if (closeResult.error) {
      await callErrorHandler(
        this.options.onError,
        createOperationError("closeAgentRealtimeSession", closeResult.status, closeResult.error)
      );
    }
  }
}

export async function subscribeToRealtimeNotifications(
  client: AgentMCApi,
  options: AgentRealtimeNotificationsOptions
): Promise<AgentRealtimeNotificationsSubscription> {
  assertPositiveInteger(options.agent, "options.agent");

  const session = await resolveAndClaimSession(client, options);
  const socket = session.socket;
  const connection = socket?.connection;

  if (!socket || !connection) {
    throw new Error(`Realtime session ${session.id} is missing socket connection metadata.`);
  }

  const channelName = valueAsString(socket.channel)?.trim();
  if (!channelName) {
    throw new Error(`Realtime session ${session.id} did not include a socket channel name.`);
  }

  const eventName = valueAsString(socket.event)?.trim() || "agent.realtime.signal";
  const appKey = valueAsString(connection.key)?.trim();
  const host = valueAsString(connection.host)?.trim();
  const scheme = normalizeScheme(valueAsString(connection.scheme));

  if (!appKey || !host) {
    throw new Error(`Realtime session ${session.id} did not include a valid socket key/host.`);
  }

  const forceTLS = scheme === "https";
  const resolvedPort =
    typeof connection.port === "number" && Number.isInteger(connection.port) && connection.port > 0
      ? connection.port
      : forceTLS
        ? 443
        : 80;

  const wsPath = normalizeWebsocketPath(valueAsString(connection.path));
  const cluster = valueAsString(connection.cluster)?.trim() || "mt1";
  const Pusher = await loadPusherConstructor();

  let disconnected = false;
  let currentConnectionState: AgentRealtimeConnectionState = "initialized";
  let boundChannel: PusherChannel | null = null;
  let resubscribeTimerHandle: ReturnType<typeof setTimeout> | null = null;
  let readyTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let resubscribeAttempt = 0;

  const clearResubscribeTimer = (): void => {
    if (resubscribeTimerHandle !== null) {
      clearTimeout(resubscribeTimerHandle);
      resubscribeTimerHandle = null;
    }
  };

  const clearReadyTimeout = (): void => {
    if (readyTimeoutHandle !== null) {
      clearTimeout(readyTimeoutHandle);
      readyTimeoutHandle = null;
    }
  };

  const pusher = new Pusher(appKey, {
    wsHost: host,
    wsPort: resolvedPort,
    wssPort: resolvedPort,
    forceTLS,
    enabledTransports: ["ws", "wss"],
    disableStats: true,
    cluster,
    ...(wsPath ? { wsPath } : {}),
    authorizer: (channel) => ({
      authorize: (socketId, callback) => {
        void (async () => {
          const authResult = await client.operations.authenticateAgentRealtimeSocket({
            params: {
              path: {
                session: session.id
              }
            },
            body: {
              socket_id: socketId,
              channel_name: channel.name
            }
          });

          if (authResult.error || !authResult.data) {
            const error = createOperationError(
              "authenticateAgentRealtimeSocket",
              authResult.status,
              authResult.error ?? { message: "Missing auth payload in response." }
            );
            callback(true, { error: error.message });
            await callErrorHandler(options.onError, error);
            return;
          }

          callback(false, authResult.data);
        })().catch(async (error) => {
          callback(true, { error: normalizeError(error).message });
          await callErrorHandler(options.onError, normalizeError(error));
        });
      }
    })
  });

  const readyTimeoutMs = normalizeReadyTimeoutMs(options.readyTimeoutMs);

  const subscription = new RealtimeNotificationsSubscription({
    client,
    options,
    session,
    channel: channelName,
    event: eventName,
    pusher,
    onBeforeDisconnect: () => {
      disconnected = true;
      clearReadyTimeout();
      clearResubscribeTimer();
      if (boundChannel) {
        unbindChannel(
          boundChannel,
          eventName,
          onSubscriptionSucceeded,
          onSubscriptionError,
          onSignalEvent
        );
        boundChannel = null;
      }
    }
  });

  const onSignalEvent = (payload: unknown): void => {
    const signal = normalizeSignal(payload, session.id);
    if (!signal) {
      return;
    }

    void callOptionalHandler(options.onSignal, signal, options.onError);

    const channelType = extractChannelType(signal.payload);
    const body = extractEventBody(signal.payload);
    const notification = extractNotification(body, channelType);

    if (notification && options.onNotification) {
      const notificationType = valueAsString(notification.notification_type)?.toLowerCase() ?? null;
      void callOptionalHandler(
        options.onNotification,
        {
          signal,
          notification,
          notificationType,
          channelType
        },
        options.onError
      );
    }
  };

  const onSubscriptionSucceeded = (): void => {
    clearReadyTimeout();
    clearResubscribeTimer();
    resubscribeAttempt = 0;
    subscription.markReady();
    void callOptionalHandler(options.onReady, session, options.onError);
  };

  const onSubscriptionError = (payload: unknown): void => {
    const error = normalizeError(payload, "Realtime channel subscription failed.");
    void callErrorHandler(options.onError, error);

    if (disconnected) {
      return;
    }

    if (!isRetryableSubscriptionError(payload)) {
      clearReadyTimeout();
      clearResubscribeTimer();
      subscription.markReadyError(error);
      currentConnectionState = "failed";
      if (options.onConnectionStateChange) {
        void callOptionalHandler(options.onConnectionStateChange, "failed", options.onError);
      }
      void subscription.disconnect().catch(async (disconnectError) => {
        await callErrorHandler(options.onError, normalizeError(disconnectError));
      });
      return;
    }

    const backoffMs = resolveResubscribeBackoffMs(resubscribeAttempt);
    resubscribeAttempt += 1;
    clearResubscribeTimer();
    if (currentConnectionState !== "connecting") {
      currentConnectionState = "connecting";
      if (options.onConnectionStateChange) {
        void callOptionalHandler(options.onConnectionStateChange, "connecting", options.onError);
      }
    }
    resubscribeTimerHandle = setTimeout(() => {
      if (disconnected) {
        return;
      }

      try {
        if (boundChannel) {
          unbindChannel(
            boundChannel,
            eventName,
            onSubscriptionSucceeded,
            onSubscriptionError,
            onSignalEvent
          );
          boundChannel = null;
        }

        pusher.unsubscribe(channelName);
      } catch {
        // Best-effort local cleanup.
      }

      boundChannel = subscribeAndBindChannel(
        pusher,
        channelName,
        eventName,
        onSubscriptionSucceeded,
        onSubscriptionError,
        onSignalEvent
      );
    }, backoffMs);
  };

  boundChannel = subscribeAndBindChannel(
    pusher,
    channelName,
    eventName,
    onSubscriptionSucceeded,
    onSubscriptionError,
    onSignalEvent
  );

  readyTimeoutHandle = setTimeout(() => {
    const error = new Error(
      `Realtime subscription was not ready after ${readyTimeoutMs}ms for session ${session.id}.`
    );
    subscription.markReadyError(error);
    void callErrorHandler(options.onError, error);
  }, readyTimeoutMs);

  pusher.connection.bind("state_change", (statePayload) => {
    const state = valueAsObject(statePayload);
    const current = valueAsString(state?.current)?.toLowerCase();
    if (!current) {
      return;
    }

    if (isConnectionState(current) && options.onConnectionStateChange) {
      void callOptionalHandler(options.onConnectionStateChange, current, options.onError);
    }

    if (isConnectionState(current)) {
      currentConnectionState = current;
      if (current === "connected") {
        clearResubscribeTimer();
        resubscribeAttempt = 0;
      }
    }
  });

  pusher.connection.bind("error", (payload) => {
    const error = normalizeError(payload, "Realtime websocket connection error.");
    void callErrorHandler(options.onError, error);
  });

  pusher.connection.bind("disconnected", () => {
    currentConnectionState = "disconnected";
    if (options.onConnectionStateChange) {
      void callOptionalHandler(options.onConnectionStateChange, "disconnected", options.onError);
    }
  });

  return subscription;
}

export async function publishRealtimeMessage(
  client: AgentMCApi,
  options: AgentRealtimePublishMessageOptions
): Promise<AgentRealtimePublishMessageResult> {
  assertPositiveInteger(options.agent, "options.agent");
  assertPositiveInteger(options.session, "options.session");

  const channelType = valueAsString(options.channelType)?.trim();
  if (!channelType) {
    throw new Error("options.channelType is required.");
  }

  const signalType = valueAsString(options.signalType)?.trim() || DEFAULT_REALTIME_SIGNAL_TYPE;
  const maxPayloadBytes = normalizeMaxBytes(options.maxPayloadBytes, DEFAULT_REALTIME_MAX_PAYLOAD_BYTES);
  const maxEnvelopeBytes = normalizeMaxBytes(options.maxEnvelopeBytes, DEFAULT_REALTIME_MAX_ENVELOPE_BYTES);
  const chunkFieldName = normalizeChunkFieldName(options.chunkFieldName);
  const requestId = valueAsString(options.requestId)?.trim() || undefined;

  const singleSignalPayload = buildRealtimeMessagePayload(channelType, options.payload);
  if (fitsSignalPayloadLimits(signalType, singleSignalPayload, maxPayloadBytes, maxEnvelopeBytes)) {
    const signalId = await createRealtimeSignal(client, {
      session: options.session,
      signalType,
      payload: singleSignalPayload
    });

    return {
      signalIds: [signalId],
      chunked: false,
      chunkCount: 1,
      chunkId: null,
      signalType,
      channelType
    };
  }

  const payloadJson = serializeJson(options.payload, "options.payload");
  const payloadBytes = TEXT_ENCODER.encode(payloadJson);
  const payloadBase64 = Buffer.from(payloadBytes).toString("base64");
  const chunkId = valueAsString(options.chunkId)?.trim() || generateChunkId();

  const chunks = buildChunkFrames({
    signalType,
    channelType,
    requestId,
    chunkId,
    chunkFieldName,
    payloadBase64,
    maxPayloadBytes,
    maxEnvelopeBytes
  });

  const signalIds: number[] = [];
  for (const chunkPayload of chunks) {
    const signalId = await createRealtimeSignal(client, {
      session: options.session,
      signalType,
      payload: chunkPayload
    });
    signalIds.push(signalId);
  }

  return {
    signalIds,
    chunked: true,
    chunkCount: chunks.length,
    chunkId,
    signalType,
    channelType
  };
}

async function resolveAndClaimSession(
  client: AgentMCApi,
  options: AgentRealtimeNotificationsOptions
): Promise<AgentRealtimeSessionRecord> {
  if (options.session !== undefined) {
    assertPositiveInteger(options.session, "options.session");
  }

  let sessionId = options.session;

  if (sessionId === undefined) {
    const requestedResult = await client.operations.listAgentRealtimeRequestedSessions({
      params: {
        query: {
          limit: options.requestedSessionLimit ?? 20
        }
      }
    });

    if (requestedResult.error) {
      throw createOperationError(
        "listAgentRealtimeRequestedSessions",
        requestedResult.status,
        requestedResult.error
      );
    }

    const sessions = requestedResult.data?.data ?? [];
    const selected = sessions[0];

    if (!selected) {
      throw new Error(`No requested realtime sessions are available for agent ${options.agent}.`);
    }

    sessionId = selected.id;
  }

  const claimResult = await client.operations.claimAgentRealtimeSession({
    params: {
      path: {
        session: sessionId
      }
    },
    body: {}
  });

  if (claimResult.error) {
    throw createOperationError("claimAgentRealtimeSession", claimResult.status, claimResult.error);
  }

  const session = claimResult.data?.data;
  if (!session) {
    throw new Error(`claimAgentRealtimeSession returned status ${claimResult.status} without session data.`);
  }

  return session;
}

async function loadPusherConstructor(): Promise<PusherConstructor> {
  if (pusherConstructorPromise) {
    return pusherConstructorPromise;
  }

  pusherConstructorPromise = (async () => {
    const fromNode = await import("pusher-js/node").catch(() => null);
    const pusherFromNode = maybePusherConstructor(fromNode);
    if (pusherFromNode) {
      return pusherFromNode;
    }

    const fromRoot = await import("pusher-js");
    const pusherFromRoot = maybePusherConstructor(fromRoot);
    if (pusherFromRoot) {
      return pusherFromRoot;
    }

    throw new Error("Unable to load pusher-js runtime. Ensure pusher-js is installed.");
  })();

  pusherConstructorPromise.catch(() => {
    pusherConstructorPromise = null;
  });

  return pusherConstructorPromise;
}

function maybePusherConstructor(moduleValue: unknown): PusherConstructor | null {
  const moduleObject = valueAsObject(moduleValue);
  const candidate = moduleObject?.default ?? moduleObject?.Pusher;

  return typeof candidate === "function" ? (candidate as PusherConstructor) : null;
}

function normalizeSignal(payload: unknown, fallbackSessionId: number): AgentRealtimeSignalMessage | null {
  const parsed = parsePayloadObject(payload);
  const id = valueAsPositiveInteger(parsed.id);

  if (id === null) {
    return null;
  }

  return {
    id,
    session_id: valueAsPositiveInteger(parsed.session_id) ?? fallbackSessionId,
    sender: valueAsString(parsed.sender) ?? "system",
    type: valueAsString(parsed.type) ?? "message",
    payload: valueAsObject(parsed.payload) ?? {},
    created_at: valueAsString(parsed.created_at) ?? null
  };
}

function parsePayloadObject(payload: unknown): JsonObject {
  if (valueAsObject(payload)) {
    return payload as JsonObject;
  }

  if (typeof payload !== "string") {
    return {};
  }

  const trimmed = payload.trim();
  if (trimmed === "") {
    return {};
  }

  try {
    const parsed = JSON.parse(trimmed);
    return valueAsObject(parsed) ?? {};
  } catch {
    return {};
  }
}

function extractChannelType(payload: JsonObject): string | null {
  return valueAsString(payload.type)?.toLowerCase() ?? null;
}

function extractEventBody(payload: JsonObject): JsonObject {
  return valueAsObject(payload.payload) ?? payload;
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

function normalizeWebsocketPath(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed === "") {
    return undefined;
  }

  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function normalizeScheme(value: string | null): "http" | "https" {
  return value?.toLowerCase() === "http" ? "http" : "https";
}

function subscribeAndBindChannel(
  pusher: PusherClient,
  channelName: string,
  eventName: string,
  onSubscriptionSucceeded: () => void,
  onSubscriptionError: (payload: unknown) => void,
  onSignalEvent: (payload: unknown) => void
): PusherChannel {
  const channel = pusher.subscribe(channelName);
  channel.bind("pusher:subscription_succeeded", onSubscriptionSucceeded);
  channel.bind("pusher:subscription_error", onSubscriptionError);
  channel.bind(eventName, onSignalEvent);
  return channel;
}

function unbindChannel(
  channel: PusherChannel,
  eventName: string,
  onSubscriptionSucceeded: () => void,
  onSubscriptionError: (payload: unknown) => void,
  onSignalEvent: (payload: unknown) => void
): void {
  if (!channel.unbind) {
    return;
  }

  channel.unbind("pusher:subscription_succeeded", onSubscriptionSucceeded);
  channel.unbind("pusher:subscription_error", onSubscriptionError);
  channel.unbind(eventName, onSignalEvent);
}

function resolveResubscribeBackoffMs(attempt: number): number {
  const safeAttempt = Number.isInteger(attempt) && attempt > 0 ? attempt : 0;
  return Math.min(DEFAULT_RESUBSCRIBE_BACKOFF_MS * 2 ** safeAttempt, MAX_RESUBSCRIBE_BACKOFF_MS);
}

function isRetryableSubscriptionError(payload: unknown): boolean {
  const status = extractStatusCode(payload);
  if (status === null) {
    return true;
  }

  if (status === 401 || status === 403 || status === 404 || status === 422) {
    return false;
  }

  return true;
}

function extractStatusCode(payload: unknown): number | null {
  const objectValue = valueAsObject(payload);
  if (!objectValue) {
    return extractStatusCodeFromText(valueAsString(payload));
  }

  const nestedError = valueAsObject(objectValue.error);
  const nestedData = valueAsObject(objectValue.data);
  const candidates = [
    objectValue.status,
    objectValue.status_code,
    objectValue.statusCode,
    nestedError?.status,
    nestedError?.status_code,
    nestedError?.statusCode,
    nestedData?.status,
    nestedData?.status_code,
    nestedData?.statusCode
  ];

  for (const candidate of candidates) {
    const status = normalizeStatusCode(candidate);
    if (status !== null) {
      return status;
    }
  }

  const textCandidates = [
    valueAsString(objectValue.message),
    valueAsString(objectValue.reason),
    valueAsString(nestedError?.message),
    valueAsString(nestedError?.reason),
    valueAsString(nestedError)
  ];

  for (const textCandidate of textCandidates) {
    const status = extractStatusCodeFromText(textCandidate);
    if (status !== null) {
      return status;
    }
  }

  return null;
}

function normalizeStatusCode(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

function extractStatusCodeFromText(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const patterns = [/\bstatus[^0-9]{0,6}(\d{3})\b/i, /\bhttp[^0-9]{0,6}(\d{3})\b/i, /\bcode[^0-9]{0,6}(\d{3})\b/i];

  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (!match) {
      continue;
    }

    const parsed = Number.parseInt(match[1] ?? "", 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

function normalizeReadyTimeoutMs(value: number | undefined): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1_000) {
    return value;
  }

  return DEFAULT_REALTIME_READY_TIMEOUT_MS;
}

function isConnectionState(value: string): value is AgentRealtimeConnectionState {
  return (
    value === "initialized" ||
    value === "connecting" ||
    value === "connected" ||
    value === "unavailable" ||
    value === "failed" ||
    value === "disconnected"
  );
}

async function createRealtimeSignal(
  client: AgentMCApi,
  options: {
    session: number;
    signalType: string;
    payload: JsonObject;
  }
): Promise<number> {
  const response = await client.operations.createAgentRealtimeSignal({
    params: {
      path: {
        session: options.session
      }
    },
    body: {
      type: options.signalType,
      payload: options.payload
    }
  });

  if (response.error) {
    throw createOperationError("createAgentRealtimeSignal", response.status, response.error);
  }

  return valueAsPositiveInteger(response.data?.data?.id) ?? 0;
}

function buildRealtimeMessagePayload(channelType: string, payload: JsonObject): JsonObject {
  return {
    type: channelType,
    payload
  };
}

function normalizeMaxBytes(value: number | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 1024) {
    return value;
  }

  return fallback;
}

function normalizeChunkFieldName(value: string | undefined): string {
  const trimmed = valueAsString(value)?.trim() ?? "";
  if (trimmed === "") {
    return DEFAULT_REALTIME_CHUNK_FIELD;
  }

  if (!/^[a-zA-Z0-9_.-]+$/.test(trimmed)) {
    throw new Error("options.chunkFieldName must contain only letters, numbers, underscore, dot, or hyphen.");
  }

  return trimmed;
}

function serializeJson(value: unknown, label: string): string {
  try {
    const encoded = JSON.stringify(value);
    if (typeof encoded !== "string") {
      throw new Error(`${label} must be JSON serializable.`);
    }
    return encoded;
  } catch (error) {
    throw new Error(`${label} must be JSON serializable. ${normalizeError(error).message}`);
  }
}

function jsonByteLength(value: unknown): number {
  return TEXT_ENCODER.encode(serializeJson(value, "value")).length;
}

function estimateSignalEnvelopeByteLength(signalType: string, payload: JsonObject): number {
  return jsonByteLength({
    id: 0,
    session_id: 0,
    sender: DEFAULT_SENDER_FOR_ENVELOPE_ESTIMATE,
    type: signalType,
    payload,
    created_at: DEFAULT_ENVELOPE_TIMESTAMP
  });
}

function fitsSignalPayloadLimits(
  signalType: string,
  payload: JsonObject,
  maxPayloadBytes: number,
  maxEnvelopeBytes: number
): boolean {
  if (jsonByteLength(payload) > maxPayloadBytes) {
    return false;
  }

  return estimateSignalEnvelopeByteLength(signalType, payload) <= maxEnvelopeBytes;
}

function buildChunkFrames(options: {
  signalType: string;
  channelType: string;
  requestId?: string;
  chunkId: string;
  chunkFieldName: string;
  payloadBase64: string;
  maxPayloadBytes: number;
  maxEnvelopeBytes: number;
}): JsonObject[] {
  let estimatedChunkCount = 1;

  for (let iteration = 0; iteration < 6; iteration += 1) {
    const maxChunkDataBytes = resolveChunkDataBudget({
      signalType: options.signalType,
      channelType: options.channelType,
      chunkId: options.chunkId,
      requestId: options.requestId,
      chunkFieldName: options.chunkFieldName,
      chunkCount: estimatedChunkCount,
      maxPayloadBytes: options.maxPayloadBytes,
      maxEnvelopeBytes: options.maxEnvelopeBytes
    });

    if (maxChunkDataBytes < 1) {
      throw new Error(
        "Realtime chunking failed: no available payload budget. Increase maxPayloadBytes/maxEnvelopeBytes or reduce payload size."
      );
    }

    const rawSegments = splitAsciiByBytes(options.payloadBase64, maxChunkDataBytes);
    const nextChunkCount = rawSegments.length;
    if (nextChunkCount === estimatedChunkCount) {
      const frames = rawSegments.map((segment, index) => {
        const payload = buildChunkEnvelope({
          channelType: options.channelType,
          requestId: options.requestId,
          chunkId: options.chunkId,
          chunkFieldName: options.chunkFieldName,
          chunkIndex: index + 1,
          chunkCount: nextChunkCount,
          data: segment
        });

        if (!fitsSignalPayloadLimits(options.signalType, payload, options.maxPayloadBytes, options.maxEnvelopeBytes)) {
          throw new Error(
            `Realtime chunk ${index + 1}/${nextChunkCount} still exceeds limits. Increase maxPayloadBytes/maxEnvelopeBytes.`
          );
        }

        return payload;
      });

      return frames;
    }

    estimatedChunkCount = nextChunkCount;
  }

  throw new Error("Realtime chunking did not converge for this payload.");
}

function resolveChunkDataBudget(options: {
  signalType: string;
  channelType: string;
  chunkId: string;
  requestId?: string;
  chunkFieldName: string;
  chunkCount: number;
  maxPayloadBytes: number;
  maxEnvelopeBytes: number;
}): number {
  const indexDigits = String(options.chunkCount).length;
  const skeletonPayload = buildChunkEnvelope({
    channelType: options.channelType,
    requestId: options.requestId,
    chunkId: options.chunkId,
    chunkFieldName: options.chunkFieldName,
    chunkIndex: Number.parseInt("9".repeat(indexDigits), 10),
    chunkCount: options.chunkCount,
    data: ""
  });

  const payloadBudget = options.maxPayloadBytes - jsonByteLength(skeletonPayload);
  const envelopeBudget = options.maxEnvelopeBytes - estimateSignalEnvelopeByteLength(options.signalType, skeletonPayload);

  return Math.min(payloadBudget, envelopeBudget);
}

function buildChunkEnvelope(options: {
  channelType: string;
  requestId?: string;
  chunkId: string;
  chunkFieldName: string;
  chunkIndex: number;
  chunkCount: number;
  data: string;
}): JsonObject {
  const chunkPayload: JsonObject = {
    chunk_id: options.chunkId,
    chunk_index: options.chunkIndex,
    chunk_total: options.chunkCount,
    chunk_encoding: DEFAULT_REALTIME_CHUNK_ENCODING,
    [options.chunkFieldName]: options.data
  };

  if (options.requestId) {
    chunkPayload.request_id = options.requestId;
  }

  return buildRealtimeMessagePayload(options.channelType, chunkPayload);
}

function splitAsciiByBytes(input: string, maxBytes: number): string[] {
  if (maxBytes < 1) {
    throw new Error("maxBytes must be at least 1.");
  }

  if (input.length <= maxBytes) {
    return [input];
  }

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < input.length) {
    chunks.push(input.slice(cursor, cursor + maxBytes));
    cursor += maxBytes;
  }

  return chunks;
}

function generateChunkId(): string {
  const entropy = Math.random().toString(36).slice(2, 10);
  return `chunk_${Date.now()}_${entropy}`;
}

async function callOptionalHandler<Input>(
  handler: ((value: Input) => MaybePromise) | undefined,
  value: Input,
  onError: ((error: Error) => MaybePromise) | undefined
): Promise<void> {
  if (!handler) {
    return;
  }

  try {
    await handler(value);
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
    // Never rethrow from user-provided error handlers.
  }
}

function createOperationError(operationId: string, status: number, _errorPayload: unknown): Error {
  const resolvedStatus = Number.isInteger(status) && status > 0 ? status : null;
  const statusSuffix = resolvedStatus === null ? "unknown status" : `status ${resolvedStatus}`;

  return new Error(`${operationId} failed with ${statusSuffix}.`);
}

function normalizeError(value: unknown, fallbackMessage = "Unexpected realtime error."): Error {
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

function valueAsPositiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
}
