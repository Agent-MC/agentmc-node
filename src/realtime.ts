import type { AgentMCApi } from "./client";

type MaybePromise = void | Promise<void>;
type JsonObject = Record<string, unknown>;
type ApiOperationResult = { data?: unknown; error?: unknown; response: Response; status: number };
type ApiOperationHandler = (options?: unknown) => Promise<ApiOperationResult>;

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

interface SharedPusherEntry {
  key: string;
  pusher: PusherClient;
  refCount: number;
  channelAuthorizers: Map<string, (socketId: string) => Promise<unknown>>;
}

const sharedPusherEntries = new Map<string, SharedPusherEntry>();

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

export interface AgentRealtimeSessionRecord {
  id: number;
  requested_by_user_id?: number | null;
  socket?: {
    channel?: string | null;
    event?: string | null;
    connection?: {
      key?: string | null;
      host?: string | null;
      scheme?: string | null;
      port?: number | null;
      path?: string | null;
      cluster?: string | null;
      [key: string]: unknown;
    } | null;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}
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

export interface HostRealtimeSocketPayload {
  connection?: {
    key?: string | null;
    host?: string | null;
    scheme?: string | null;
    port?: number | null;
    path?: string | null;
    cluster?: string | null;
    [key: string]: unknown;
  } | null;
  channel?: string | null;
  event?: string | null;
  auth_endpoint?: string | null;
  [key: string]: unknown;
}

export interface HostRealtimeSessionRequestedEvent {
  sessionId: number | null;
  agentId: number | null;
  payload: JsonObject;
}

export interface HostRealtimeSessionRequestsOptions {
  socket: HostRealtimeSocketPayload;
  readyTimeoutMs?: number;
  onReady?: () => MaybePromise;
  onSessionRequested?: (event: HostRealtimeSessionRequestedEvent) => MaybePromise;
  onConnectionStateChange?: (state: AgentRealtimeConnectionState) => MaybePromise;
  onError?: (error: Error) => MaybePromise;
}

export interface HostRealtimeSessionRequestsSubscription {
  readonly channel: string;
  readonly event: string;
  readonly ready: Promise<void>;
  disconnect(): Promise<void>;
}

export interface AgentRealtimePublishMessageOptions {
  agent: number;
  session: number;
  channelType: string;
  payload: JsonObject;
  signal?: AbortSignal;
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
  private readonly onTransportDisconnect?: () => void;
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
    onTransportDisconnect?: () => void;
  }) {
    this.client = args.client;
    this.options = args.options;
    this.session = args.session;
    this.channel = args.channel;
    this.event = args.event;
    this.pusher = args.pusher;
    this.onBeforeDisconnect = args.onBeforeDisconnect;
    this.onTransportDisconnect = args.onTransportDisconnect;
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
    } catch {
      // Best-effort teardown; ignore local socket cleanup failures.
    }

    try {
      if (this.onTransportDisconnect) {
        this.onTransportDisconnect();
      } else {
        this.pusher.disconnect();
      }
    } catch {
      // Best-effort teardown; ignore local socket cleanup failures.
    }

    if (!this.readySettled) {
      this.markReadyError(new Error("Realtime subscription disconnected before it was ready."));
    }

    if (!this.options.autoCloseSession) {
      return;
    }

    const closeResult = await invokeOperation(this.client, "closeAgentRealtimeSession", {
      params: {
        path: {
          session: this.session.id
        }
      },
      headers: {
        "X-Agent-Id": String(this.options.agent)
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

class HostRealtimeSessionRequestsSubscriptionImpl implements HostRealtimeSessionRequestsSubscription {
  readonly channel: string;
  readonly event: string;
  readonly ready: Promise<void>;

  private readonly pusher: PusherClient;
  private readonly onBeforeDisconnect?: () => void;
  private readonly onTransportDisconnect?: () => void;
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  private readySettled = false;
  private disconnected = false;

  constructor(args: {
    channel: string;
    event: string;
    pusher: PusherClient;
    onBeforeDisconnect?: () => void;
    onTransportDisconnect?: () => void;
  }) {
    this.channel = args.channel;
    this.event = args.event;
    this.pusher = args.pusher;
    this.onBeforeDisconnect = args.onBeforeDisconnect;
    this.onTransportDisconnect = args.onTransportDisconnect;
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

  async disconnect(): Promise<void> {
    if (this.disconnected) {
      return;
    }

    this.disconnected = true;
    this.onBeforeDisconnect?.();

    try {
      this.pusher.unsubscribe(this.channel);
    } catch {
      // Best-effort teardown; ignore local socket cleanup failures.
    }

    try {
      if (this.onTransportDisconnect) {
        this.onTransportDisconnect();
      } else {
        this.pusher.disconnect();
      }
    } catch {
      // Best-effort teardown; ignore local socket cleanup failures.
    }

    if (!this.readySettled) {
      this.markReadyError(new Error("Realtime host subscription disconnected before it was ready."));
    }
  }
}

export async function subscribeToRealtimeNotifications(
  client: AgentMCApi,
  options: AgentRealtimeNotificationsOptions
): Promise<AgentRealtimeNotificationsSubscription> {
  assertPositiveInteger(options.agent, "options.agent");

  let session: AgentRealtimeSessionRecord | null = null;
  let sharedTransportKey: string | null = null;
  let sharedTransportChannelName: string | null = null;
  let sharedTransportAcquired = false;

  try {
    session = await resolveAndClaimSession(client, options);
    const claimedSession = session;
    const socket = claimedSession.socket;
    const connection = socket?.connection;

    if (!socket || !connection) {
      throw new Error(`Realtime session ${claimedSession.id} is missing socket connection metadata.`);
    }

    const channelName = valueAsString(socket.channel)?.trim();
    if (!channelName) {
      throw new Error(`Realtime session ${claimedSession.id} did not include a socket channel name.`);
    }

    const eventName = valueAsString(socket.event)?.trim() || "agent.realtime.signal";
    const signalEventNames = [eventName];
    const appKey = valueAsString(connection.key)?.trim();
    const host = valueAsString(connection.host)?.trim();
    const scheme = normalizeScheme(valueAsString(connection.scheme));

    if (!appKey || !host) {
      throw new Error(`Realtime session ${claimedSession.id} did not include a valid socket key/host.`);
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
    sharedTransportKey = buildSharedTransportKey({
      appKey,
      host,
      resolvedPort,
      forceTLS,
      cluster,
      wsPath
    });
    const transportKey = sharedTransportKey;
    if (!transportKey) {
      throw new Error("Unable to resolve realtime shared transport key.");
    }
    sharedTransportChannelName = channelName;
    const authChannel = channelName;
    const authForChannel = async (socketId: string): Promise<unknown> => {
      const authResult = await invokeOperation(client, "authenticateAgentRealtimeSocket", {
        params: {
          path: {
            session: claimedSession.id
          }
        },
        headers: {
          "X-Agent-Id": String(options.agent)
        },
        body: {
          socket_id: socketId,
          channel_name: authChannel
        }
      });

      const authPayload = valueAsObject(authResult.data) ?? (await readJsonResponseObject(authResult.response));
      if (authResult.error || !authPayload) {
        throw createOperationError(
          "authenticateAgentRealtimeSocket",
          authResult.status,
          authResult.error ?? { message: "Missing auth payload in response." }
        );
      }

      return authPayload;
    };
    const pusher = await acquireSharedPusher({
      key: transportKey,
      appKey,
      host,
      resolvedPort,
      forceTLS,
      cluster,
      wsPath,
      channelName,
      authorize: authForChannel
    });
    sharedTransportAcquired = true;

    let disconnected = false;
    let currentConnectionState: AgentRealtimeConnectionState = "initialized";
    let boundChannel: PusherChannel | null = null;
    let resubscribeTimerHandle: ReturnType<typeof setTimeout> | null = null;
    let readyTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let resubscribeAttempt = 0;
    let eventQueue: Promise<void> = Promise.resolve();
    let hasSubscriptionReady = false;
    let lastDeliveredSignalId = 0;

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

    const readyTimeoutMs = normalizeReadyTimeoutMs(options.readyTimeoutMs);

    const enqueueEvent = (task: () => Promise<void>): void => {
      eventQueue = eventQueue
        .catch(() => {})
        .then(async () => {
          if (disconnected) {
            return;
          }

          await task();
        })
        .catch(async (error) => {
          await callErrorHandler(options.onError, normalizeError(error));
        });
    };

    const processSignal = async (signal: AgentRealtimeSignalMessage): Promise<void> => {
      if (!signal || signal.id <= 0) {
        return;
      }

      if (signal.id <= lastDeliveredSignalId) {
        return;
      }

      lastDeliveredSignalId = signal.id;
      await callOptionalHandler(options.onSignal, signal, options.onError);

      const channelType = extractChannelType(signal.payload);
      const body = extractEventBody(signal.payload);
      const notification = extractNotification(body, channelType);

      if (notification && options.onNotification) {
        const notificationType = valueAsString(notification.notification_type)?.toLowerCase() ?? null;
        await callOptionalHandler(
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

    const onConnectionStateEvent = (statePayload: unknown): void => {
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
    };

    const onConnectionErrorEvent = (payload: unknown): void => {
      const error = normalizeError(payload, "Realtime websocket connection error.");
      void callErrorHandler(options.onError, error);
    };

    const onConnectionDisconnectedEvent = (): void => {
      currentConnectionState = "disconnected";
      if (options.onConnectionStateChange) {
        void callOptionalHandler(options.onConnectionStateChange, "disconnected", options.onError);
      }
    };

    const unbindConnectionHandlers = (): void => {
      if (!pusher.connection.unbind) {
        return;
      }

      pusher.connection.unbind("state_change", onConnectionStateEvent);
      pusher.connection.unbind("error", onConnectionErrorEvent);
      pusher.connection.unbind("disconnected", onConnectionDisconnectedEvent);
    };

    const subscription = new RealtimeNotificationsSubscription({
      client,
      options,
      session: claimedSession,
      channel: channelName,
      event: eventName,
      pusher,
      onBeforeDisconnect: () => {
        disconnected = true;
        clearReadyTimeout();
        clearResubscribeTimer();
        unbindConnectionHandlers();
        if (boundChannel) {
          unbindChannel(
            boundChannel,
            signalEventNames,
            onSubscriptionSucceeded,
            onSubscriptionError,
            onSignalEvent
          );
          boundChannel = null;
        }
      },
      onTransportDisconnect: () => {
        releaseSharedPusher(transportKey, channelName);
        sharedTransportAcquired = false;
      }
    });

    const onSignalEvent = (payload: unknown): void => {
      const signal = normalizeSignal(payload, claimedSession.id);
      if (!signal) {
        return;
      }

      enqueueEvent(async () => {
        await processSignal(signal);
      });
    };

    const onSubscriptionSucceeded = (): void => {
      enqueueEvent(async () => {
        clearReadyTimeout();
        clearResubscribeTimer();
        resubscribeAttempt = 0;
        hasSubscriptionReady = true;
        subscription.markReady();
        await callOptionalHandler(options.onReady, claimedSession, options.onError);
      });
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
              signalEventNames,
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
          signalEventNames,
          onSubscriptionSucceeded,
          onSubscriptionError,
          onSignalEvent
        );
      }, backoffMs);
    };

    boundChannel = subscribeAndBindChannel(
      pusher,
      channelName,
      signalEventNames,
      onSubscriptionSucceeded,
      onSubscriptionError,
      onSignalEvent
    );

    readyTimeoutHandle = setTimeout(() => {
      if (disconnected) {
        return;
      }

      const error = new Error(
        `Realtime subscription was not ready after ${readyTimeoutMs}ms for session ${claimedSession.id}.`
      );

      if (currentConnectionState !== "failed") {
        currentConnectionState = "failed";
        if (options.onConnectionStateChange) {
          void callOptionalHandler(options.onConnectionStateChange, "failed", options.onError);
        }
      }

      subscription.markReadyError(error);
      void callErrorHandler(options.onError, error);
      void subscription.disconnect().catch(async (disconnectError) => {
        await callErrorHandler(options.onError, normalizeError(disconnectError));
      });
    }, readyTimeoutMs);

    pusher.connection.bind("state_change", onConnectionStateEvent);
    pusher.connection.bind("error", onConnectionErrorEvent);
    pusher.connection.bind("disconnected", onConnectionDisconnectedEvent);

    return subscription;
  } catch (error) {
    if (sharedTransportAcquired && sharedTransportKey && sharedTransportChannelName) {
      releaseSharedPusher(sharedTransportKey, sharedTransportChannelName);
      sharedTransportAcquired = false;
    }

    if (session !== null) {
      if (shouldCloseClaimedSessionOnSubscribeFailure(error)) {
        await closeClaimedSessionOnSubscribeFailure(client, options.agent, session.id, options.onError);
      } else {
        await callErrorHandler(
          options.onError,
          new Error(`Retaining claimed realtime session ${session.id} after transient subscribe failure.`)
        );
      }
    }

    throw normalizeError(error);
  }
}

export async function subscribeToHostRealtimeSessionRequests(
  client: AgentMCApi,
  options: HostRealtimeSessionRequestsOptions
): Promise<HostRealtimeSessionRequestsSubscription> {
  const socket = normalizeHostRealtimeSocketPayload(options.socket);
  if (!socket) {
    throw new Error("options.socket is required.");
  }

  let sharedTransportKey: string | null = null;
  let sharedTransportChannelName: string | null = null;
  let sharedTransportAcquired = false;

  try {
    const connection = socket.connection;
    const channelName = valueAsString(socket.channel)?.trim();
    if (!channelName) {
      throw new Error("Host realtime socket channel is required.");
    }

    const eventName = valueAsString(socket.event)?.trim() || "agent.realtime.host.session.requested";
    const appKey = valueAsString(connection?.key)?.trim();
    const host = valueAsString(connection?.host)?.trim();
    const scheme = normalizeScheme(valueAsString(connection?.scheme));

    if (!appKey || !host) {
      throw new Error("Host realtime socket connection key/host are required.");
    }

    const forceTLS = scheme === "https";
    const resolvedPort =
      typeof connection?.port === "number" && Number.isInteger(connection.port) && connection.port > 0
        ? connection.port
        : forceTLS
          ? 443
          : 80;

    const wsPath = normalizeWebsocketPath(valueAsString(connection?.path));
    const cluster = valueAsString(connection?.cluster)?.trim() || "mt1";
    sharedTransportKey = buildSharedTransportKey({
      appKey,
      host,
      resolvedPort,
      forceTLS,
      cluster,
      wsPath
    });
    const transportKey = sharedTransportKey;
    if (!transportKey) {
      throw new Error("Unable to resolve host realtime shared transport key.");
    }
    sharedTransportChannelName = channelName;
    const authChannel = channelName;
    const authForChannel = async (socketId: string): Promise<unknown> => {
      const authResult = await invokeOperation(client, "authenticateHostRealtimeSocket", {
        body: {
          socket_id: socketId,
          channel_name: authChannel
        }
      });

      const authPayload = valueAsObject(authResult.data) ?? (await readJsonResponseObject(authResult.response));
      if (authResult.error || !authPayload) {
        throw createOperationError(
          "authenticateHostRealtimeSocket",
          authResult.status,
          authResult.error ?? { message: "Missing auth payload in response." }
        );
      }

      return authPayload;
    };
    const pusher = await acquireSharedPusher({
      key: transportKey,
      appKey,
      host,
      resolvedPort,
      forceTLS,
      cluster,
      wsPath,
      channelName,
      authorize: authForChannel
    });
    sharedTransportAcquired = true;

    let disconnected = false;
    let currentConnectionState: AgentRealtimeConnectionState = "initialized";
    let boundChannel: PusherChannel | null = null;
    let resubscribeTimerHandle: ReturnType<typeof setTimeout> | null = null;
    let readyTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let resubscribeAttempt = 0;
    let eventQueue: Promise<void> = Promise.resolve();

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

    const readyTimeoutMs = normalizeReadyTimeoutMs(options.readyTimeoutMs);

    const enqueueEvent = (task: () => Promise<void>): void => {
      eventQueue = eventQueue
        .catch(() => {})
        .then(async () => {
          if (disconnected) {
            return;
          }

          await task();
        })
        .catch(async (error) => {
          await callErrorHandler(options.onError, normalizeError(error));
        });
    };

    const subscription = new HostRealtimeSessionRequestsSubscriptionImpl({
      channel: channelName,
      event: eventName,
      pusher,
      onBeforeDisconnect: () => {
        disconnected = true;
        clearReadyTimeout();
        clearResubscribeTimer();
        unbindConnectionHandlers();
        if (boundChannel) {
          unbindChannel(
            boundChannel,
            [eventName],
            onSubscriptionSucceeded,
            onSubscriptionError,
            onSessionRequestedEvent
          );
          boundChannel = null;
        }
      },
      onTransportDisconnect: () => {
        releaseSharedPusher(transportKey, channelName);
        sharedTransportAcquired = false;
      }
    });

    const onSessionRequestedEvent = (payload: unknown): void => {
      const event = normalizeHostRealtimeSessionRequestedEvent(payload);
      if (!event || !options.onSessionRequested) {
        return;
      }

      enqueueEvent(async () => {
        await callOptionalHandler(options.onSessionRequested, event, options.onError);
      });
    };

    const onConnectionStateEvent = (statePayload: unknown): void => {
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
    };

    const onConnectionErrorEvent = (payload: unknown): void => {
      const error = normalizeError(payload, "Realtime host websocket connection error.");
      void callErrorHandler(options.onError, error);
    };

    const onConnectionDisconnectedEvent = (): void => {
      currentConnectionState = "disconnected";
      if (options.onConnectionStateChange) {
        void callOptionalHandler(options.onConnectionStateChange, "disconnected", options.onError);
      }
    };

    const unbindConnectionHandlers = (): void => {
      if (!pusher.connection.unbind) {
        return;
      }

      pusher.connection.unbind("state_change", onConnectionStateEvent);
      pusher.connection.unbind("error", onConnectionErrorEvent);
      pusher.connection.unbind("disconnected", onConnectionDisconnectedEvent);
    };

    const onSubscriptionSucceeded = (): void => {
      enqueueEvent(async () => {
        clearReadyTimeout();
        clearResubscribeTimer();
        resubscribeAttempt = 0;
        subscription.markReady();
        await callOptionalHandler(options.onReady, undefined, options.onError);
      });
    };

    const onSubscriptionError = (payload: unknown): void => {
      const error = normalizeError(payload, "Realtime host channel subscription failed.");
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
              [eventName],
              onSubscriptionSucceeded,
              onSubscriptionError,
              onSessionRequestedEvent
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
          [eventName],
          onSubscriptionSucceeded,
          onSubscriptionError,
          onSessionRequestedEvent
        );
      }, backoffMs);
    };

    boundChannel = subscribeAndBindChannel(
      pusher,
      channelName,
      [eventName],
      onSubscriptionSucceeded,
      onSubscriptionError,
      onSessionRequestedEvent
    );

    readyTimeoutHandle = setTimeout(() => {
      if (disconnected) {
        return;
      }

      const error = new Error(`Host realtime subscription was not ready after ${readyTimeoutMs}ms.`);

      if (currentConnectionState !== "failed") {
        currentConnectionState = "failed";
        if (options.onConnectionStateChange) {
          void callOptionalHandler(options.onConnectionStateChange, "failed", options.onError);
        }
      }

      subscription.markReadyError(error);
      void callErrorHandler(options.onError, error);
      void subscription.disconnect().catch(async (disconnectError) => {
        await callErrorHandler(options.onError, normalizeError(disconnectError));
      });
    }, readyTimeoutMs);

    pusher.connection.bind("state_change", onConnectionStateEvent);
    pusher.connection.bind("error", onConnectionErrorEvent);
    pusher.connection.bind("disconnected", onConnectionDisconnectedEvent);

    return subscription;
  } catch (error) {
    if (sharedTransportAcquired && sharedTransportKey && sharedTransportChannelName) {
      releaseSharedPusher(sharedTransportKey, sharedTransportChannelName);
      sharedTransportAcquired = false;
    }

    throw normalizeError(error);
  }
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
      agent: options.agent,
      session: options.session,
      signalType,
      payload: singleSignalPayload,
      signal: options.signal,
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
      agent: options.agent,
      session: options.session,
      signalType,
      payload: chunkPayload,
      signal: options.signal,
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

  let candidateSessionIds: number[] = [];

  if (options.session !== undefined) {
    candidateSessionIds = [options.session];
  } else {
    const requestedResult = await invokeOperation(client, "listAgentRealtimeRequestedSessions", {
      params: {
        query: {
          limit: options.requestedSessionLimit ?? 20
        }
      },
      headers: {
        "X-Agent-Id": String(options.agent)
      },
    });

    if (requestedResult.error) {
      throw createOperationError(
        "listAgentRealtimeRequestedSessions",
        requestedResult.status,
        requestedResult.error
      );
    }

    const requestedPayload = valueAsObject(requestedResult.data) ?? (await readJsonResponseObject(requestedResult.response));
    const sessions = Array.isArray(requestedPayload?.data) ? requestedPayload.data : [];
    const orderedSessions = [...sessions].sort(
      (left, right) => (valueAsPositiveInteger(right?.id) ?? 0) - (valueAsPositiveInteger(left?.id) ?? 0)
    );
    const preferredSessions = orderedSessions.filter((session) => (valueAsPositiveInteger(session?.requested_by_user_id) ?? 0) >= 1);
    const fallbackSessions = orderedSessions.filter((session) => (valueAsPositiveInteger(session?.requested_by_user_id) ?? 0) < 1);
    const prioritized = [...preferredSessions, ...fallbackSessions];
    candidateSessionIds = prioritized
      .map((candidate) => valueAsPositiveInteger(candidate?.id))
      .filter((candidate): candidate is number => candidate !== null && candidate > 0);

    if (candidateSessionIds.length === 0) {
      throw new Error(`No requested realtime sessions are available for agent ${options.agent}.`);
    }
  }

  let lastClaimError: Error | null = null;
  const explicitSessionRequested = options.session !== undefined;

  for (const sessionId of candidateSessionIds) {
    const claimResult = await invokeOperation(client, "claimAgentRealtimeSession", {
      params: {
        path: {
          session: sessionId
        }
      },
      headers: {
        "X-Agent-Id": String(options.agent)
      },
      body: {}
    });

    if (claimResult.error) {
      const claimError = createOperationError("claimAgentRealtimeSession", claimResult.status, claimResult.error);
      if (!explicitSessionRequested && isRetryableClaimFailureStatus(claimResult.status)) {
        lastClaimError = claimError;
        continue;
      }
      throw claimError;
    }

    const claimPayload = valueAsObject(claimResult.data) ?? (await readJsonResponseObject(claimResult.response));
    const session = normalizeSessionRecord(claimPayload?.data);
    if (!session) {
      const missingDataError = new Error(
        `claimAgentRealtimeSession returned status ${claimResult.status} without session data.`
      );
      if (!explicitSessionRequested) {
        lastClaimError = missingDataError;
        continue;
      }
      throw missingDataError;
    }

    return session;
  }

  if (lastClaimError) {
    throw lastClaimError;
  }

  throw new Error(`No claimable realtime sessions are available for agent ${options.agent}.`);
}

function buildSharedTransportKey(input: {
  appKey: string;
  host: string;
  resolvedPort: number;
  forceTLS: boolean;
  cluster: string;
  wsPath?: string;
}): string {
  return [
    input.appKey,
    input.host,
    String(input.resolvedPort),
    input.forceTLS ? "tls" : "plain",
    input.cluster,
    input.wsPath ?? ""
  ].join("|");
}

async function acquireSharedPusher(input: {
  key: string;
  appKey: string;
  host: string;
  resolvedPort: number;
  forceTLS: boolean;
  cluster: string;
  wsPath?: string;
  channelName: string;
  authorize: (socketId: string) => Promise<unknown>;
}): Promise<PusherClient> {
  const existing = sharedPusherEntries.get(input.key);
  if (existing) {
    existing.refCount += 1;
    existing.channelAuthorizers.set(input.channelName, input.authorize);
    return existing.pusher;
  }

  const Pusher = await loadPusherConstructor();
  const channelAuthorizers = new Map<string, (socketId: string) => Promise<unknown>>();
  channelAuthorizers.set(input.channelName, input.authorize);

  const pusher = new Pusher(input.appKey, {
    wsHost: input.host,
    wsPort: input.resolvedPort,
    wssPort: input.resolvedPort,
    forceTLS: input.forceTLS,
    enabledTransports: ["ws", "wss"],
    disableStats: true,
    cluster: input.cluster,
    ...(input.wsPath ? { wsPath: input.wsPath } : {}),
    authorizer: (channel) => ({
      authorize: (socketId, callback) => {
        const authorizer = channelAuthorizers.get(channel.name);
        if (!authorizer) {
          callback(true, { error: `Missing channel authorizer for ${channel.name}` });
          return;
        }

        void authorizer(socketId)
          .then((result) => {
            callback(false, result);
          })
          .catch((error) => {
            callback(true, { error: normalizeError(error).message });
          });
      }
    })
  });

  sharedPusherEntries.set(input.key, {
    key: input.key,
    pusher,
    refCount: 1,
    channelAuthorizers
  });

  return pusher;
}

function releaseSharedPusher(key: string, channelName: string): void {
  const entry = sharedPusherEntries.get(key);
  if (!entry) {
    return;
  }

  entry.channelAuthorizers.delete(channelName);
  entry.refCount = Math.max(0, entry.refCount - 1);
  if (entry.refCount > 0) {
    return;
  }

  try {
    entry.pusher.disconnect();
  } catch {
    // Best-effort local cleanup.
  } finally {
    sharedPusherEntries.delete(key);
  }
}

export function closeSharedRealtimeTransports(): void {
  for (const [key, entry] of sharedPusherEntries.entries()) {
    try {
      entry.pusher.disconnect();
    } catch {
      // Best-effort cleanup.
    } finally {
      sharedPusherEntries.delete(key);
    }
  }
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

function normalizeHostRealtimeSocketPayload(value: unknown): HostRealtimeSocketPayload | null {
  const object = valueAsObject(value);
  if (!object) {
    return null;
  }

  return {
    ...object,
    connection: valueAsObject(object.connection) as HostRealtimeSocketPayload["connection"]
  };
}

function normalizeHostRealtimeSessionRequestedEvent(payload: unknown): HostRealtimeSessionRequestedEvent | null {
  const parsed = parsePayloadObject(payload);
  if (!parsed || Object.keys(parsed).length === 0) {
    return null;
  }

  const envelopePayload = valueAsObject(parsed.payload) ?? parsed;
  const session = valueAsObject(envelopePayload.session);
  const agent = valueAsObject(envelopePayload.agent);

  const sessionId =
    valueAsPositiveInteger(envelopePayload.session_id) ??
    valueAsPositiveInteger(parsed.session_id) ??
    valueAsPositiveInteger(session?.id) ??
    null;

  const agentId =
    valueAsPositiveInteger(envelopePayload.agent_id) ??
    valueAsPositiveInteger(parsed.agent_id) ??
    valueAsPositiveInteger(session?.agent_id) ??
    valueAsPositiveInteger(agent?.id) ??
    null;

  return {
    sessionId,
    agentId,
    payload: parsed
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
  eventNames: string[],
  onSubscriptionSucceeded: () => void,
  onSubscriptionError: (payload: unknown) => void,
  onSignalEvent: (payload: unknown) => void
): PusherChannel {
  const channel = pusher.subscribe(channelName);
  channel.bind("pusher:subscription_succeeded", onSubscriptionSucceeded);
  channel.bind("pusher:subscription_error", onSubscriptionError);
  for (const eventName of eventNames) {
    channel.bind(eventName, onSignalEvent);
  }
  return channel;
}

function unbindChannel(
  channel: PusherChannel,
  eventNames: string[],
  onSubscriptionSucceeded: () => void,
  onSubscriptionError: (payload: unknown) => void,
  onSignalEvent: (payload: unknown) => void
): void {
  if (!channel.unbind) {
    return;
  }

  channel.unbind("pusher:subscription_succeeded", onSubscriptionSucceeded);
  channel.unbind("pusher:subscription_error", onSubscriptionError);
  for (const eventName of eventNames) {
    channel.unbind(eventName, onSignalEvent);
  }
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

async function closeClaimedSessionOnSubscribeFailure(
  client: AgentMCApi,
  agentId: number,
  sessionId: number,
  onError: ((error: Error) => MaybePromise) | undefined
): Promise<void> {
  const closeResult = await invokeOperation(client, "closeAgentRealtimeSession", {
    params: {
      path: {
        session: sessionId
      }
    },
    headers: {
      "X-Agent-Id": String(agentId)
    },
    body: {
      reason: "sdk_subscribe_failed",
      status: "failed"
    }
  });

  if (closeResult.error) {
    await callErrorHandler(
      onError,
      createOperationError("closeAgentRealtimeSession", closeResult.status, closeResult.error)
    );
  }
}

function shouldCloseClaimedSessionOnSubscribeFailure(error: unknown): boolean {
  const status = extractStatusCode(error);
  if (status === null) {
    return false;
  }

  return status === 401 || status === 403 || status === 404 || status === 410 || status === 422;
}

function isRetryableClaimFailureStatus(status: number): boolean {
  return status === 404 || status === 409 || status === 410 || status === 422;
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
    agent: number;
    session: number;
    signalType: string;
    payload: JsonObject;
    signal?: AbortSignal;
  }
): Promise<number> {
  const response = await invokeOperation(client, "createAgentRealtimeSignal", {
    params: {
      path: {
        session: options.session
      }
    },
    headers: {
      "X-Agent-Id": String(options.agent)
    },
    body: {
      type: options.signalType,
      payload: options.payload
    },
    signal: options.signal,
  });

  if (response.error) {
    throw createOperationError("createAgentRealtimeSignal", response.status, response.error);
  }

  const responsePayload = valueAsObject(response.data) ?? (await readJsonResponseObject(response.response));
  const signalData = valueAsObject(responsePayload?.data);
  const signalId = valueAsPositiveInteger(signalData?.id);
  if (signalId === null) {
    throw new Error("createAgentRealtimeSignal succeeded but returned no valid signal id.");
  }

  return signalId;
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

function resolveOperation(client: AgentMCApi, operationId: string): ApiOperationHandler {
  const operation = valueAsObject(client.operations)?.[operationId];
  if (typeof operation !== "function") {
    throw new Error(`Operation ${operationId} is not available.`);
  }

  return operation as ApiOperationHandler;
}

async function invokeOperation(
  client: AgentMCApi,
  operationId: string,
  options?: unknown
): Promise<ApiOperationResult> {
  const operation = resolveOperation(client, operationId);
  return operation(options);
}

async function readJsonResponseObject(response: Response): Promise<JsonObject | null> {
  try {
    return valueAsObject(await response.clone().json());
  } catch {
    return null;
  }
}

function normalizeSessionRecord(value: unknown): AgentRealtimeSessionRecord | null {
  const object = valueAsObject(value);
  const id = valueAsPositiveInteger(object?.id);
  if (!object || id === null) {
    return null;
  }

  return {
    ...object,
    id,
    requested_by_user_id: valueAsPositiveInteger(object.requested_by_user_id),
    socket: valueAsObject(object.socket) as AgentRealtimeSessionRecord["socket"]
  };
}

function createOperationError(operationId: string, status: number, _errorPayload: unknown): Error {
  const resolvedStatus = Number.isInteger(status) && status > 0 ? status : null;
  const statusSuffix = resolvedStatus === null ? "unknown status" : `status ${resolvedStatus}`;

  return new Error(`${operationId} failed with ${statusSuffix}.`);
}

function normalizeError(value: unknown, fallbackMessage = "Unexpected realtime error."): Error {
  if (value instanceof Error) {
    const message = formatErrorMessage(value, fallbackMessage);
    return new Error(message);
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

function valueAsObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as JsonObject;
}

function valueAsString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
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

function extractErrorDetails(...sources: Array<JsonObject | null>): string[] {
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
