import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, statfs, writeFile } from "node:fs/promises";
import { arch, cpus, homedir, hostname, networkInterfaces, platform, release, totalmem, uptime } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

import { AgentMCApi } from "./client";
import {
  AgentRuntime,
  type AgentRuntimeRunInput,
  type AgentRuntimeRunResult,
  type OpenClawRuntimeApiNotificationIngestResult
} from "./openclaw-runtime";
import { AGENTMC_NODE_PACKAGE_VERSION } from "./package-version";

const execFileAsync = promisify(execFile);
const OPENCLAW_TELEMETRY_COMMAND_CANDIDATES: readonly string[][] = [
  ["status", "--json", "--usage"],
  ["status", "--json"],
  ["health", "--json"]
];
const OPENCLAW_MODELS_TELEMETRY_COMMAND: readonly string[] = ["models", "status", "--json"];
const OPENCLAW_TELEMETRY_TIMEOUT_MS = 4_000;
const OPENCLAW_AGENT_DISCOVERY_TIMEOUT_MS = 10_000;
const DEFAULT_AGENTMC_API_BASE_URL = "https://agentmc.ai/api/v1";
const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 60;
const DEFAULT_HEARTBEAT_NOTIFICATION_CATCHUP_PER_PAGE = 50;
const DEFAULT_HEARTBEAT_NOTIFICATION_CATCHUP_MAX_PAGES = 100;
const DEFAULT_RECURRING_TASK_POLL_INTERVAL_SECONDS = 30;
const DEFAULT_RECURRING_TASK_POLL_LIMIT = 5;
const DEFAULT_RECURRING_TASK_WAIT_TIMEOUT_MS = 600_000;
const DEFAULT_RECURRING_TASK_GATEWAY_TIMEOUT_MS = 720_000;
const RECURRING_TASK_GATEWAY_TIMEOUT_BUFFER_MS = 30_000;
const RECURRING_TASK_SUMMARY_MAX_LENGTH = 4_000;
const RECURRING_TASK_AGENT_RESPONSE_MAX_BYTES = 24_000;
const DEFAULT_OPENCLAW_COMMAND = "openclaw";
const DEFAULT_PUBLIC_IP_ENDPOINT_CANDIDATES: readonly string[] = [
  "https://api.ipify.org?format=json",
  "https://ifconfig.me/ip"
];
const OPENCLAW_COMMAND_FALLBACK_PATHS: readonly string[] = [
  "/usr/bin/openclaw",
  "/usr/local/bin/openclaw",
  "/opt/homebrew/bin/openclaw",
  "/bin/openclaw"
];
const OPENCLAW_MODEL_PLACEHOLDER_TOKENS = new Set([
  "openclaw/default",
  "openclaw:default",
  "default",
  "unknown",
  "n/a",
  "none",
  "null"
]);
const MAX_OPENCLAW_STATUS_LABEL_LENGTH = 255;

type JsonObject = Record<string, unknown>;

type RuntimeProviderKind = "openclaw" | "external";

type HeartbeatBody = {
  meta: JsonObject;
  host: {
    fingerprint: string;
    name: string;
    meta: JsonObject;
  };
  agent: {
    id?: number;
    name: string;
    type: string;
    identity: JsonObject | string;
    emoji?: string | null;
  };
};
type CompleteRecurringTaskRunBody = {
  status: "success" | "error";
  claim_token: string;
  summary: string | null;
  error_message: string | null;
  started_at: string;
  finished_at: string;
  runtime_meta: JsonObject;
};
type DueRecurringTaskRunsResult = { data: unknown[] };
type ApiOperationResult = { data?: unknown; error?: unknown; response: Response; status: number };
type ApiOperationHandler = (options?: unknown) => Promise<ApiOperationResult>;

interface RuntimeMachineIdentitySnapshot {
  name: string | null;
  identity: JsonObject | string | null;
  emoji: string | null;
}

type RuntimeMachineIdentityResolver = (
  fallbackName: string,
  fallbackIdentity: JsonObject | string
) => Promise<RuntimeMachineIdentitySnapshot | null>;

interface RuntimeProviderDescriptor {
  kind: RuntimeProviderKind;
  name: string;
  version: string;
  build: string | null;
  mode: string;
  models: string[];
  machineIdentityResolver?: RuntimeMachineIdentityResolver;
  runAgent?: (input: AgentRuntimeRunInput) => Promise<AgentRuntimeRunResult>;
}

interface ClaimedRecurringTaskRun {
  runId: number;
  taskId: number;
  prompt: string;
  scheduledFor: string | null;
  claimToken: string;
  agentId: number | null;
}

interface RecurringTaskExecutionResult {
  status: "success" | "error";
  summary: string | null;
  errorMessage: string | null;
  runtimeMeta: JsonObject;
}

interface AgentMcPromptContext {
  apiKey: string | null;
  apiBaseUrl: string;
  openApiUrl: string;
}

export interface AgentRuntimeProgramOptions {
  client?: AgentMCApi;
  baseUrl?: string;
  apiKey?: string;
  workspaceDir?: string;
  statePath?: string;
  agentId?: number;
  heartbeatEnabled?: boolean;
  realtimeSessionsEnabled?: boolean;
  realtimeSessionPollingEnabled?: boolean;
  heartbeatIntervalSeconds?: number;
  runtimeProvider?: "auto" | RuntimeProviderKind;
  runtimeCommand?: string;
  runtimeCommandArgs?: readonly string[];
  runtimeVersionCommand?: string;
  runtimeName?: string;
  runtimeVersion?: string;
  runtimeBuild?: string;
  runtimeModels?: readonly string[];
  openclawCommand?: string;
  openclawConfigPath?: string;
  openclawAgent?: string;
  openclawSessionsPath?: string;
  agentName?: string;
  agentType?: string;
  agentEmoji?: string;
  publicIp?: string;
  publicIpEndpoint?: string;
  hostFingerprint?: string;
  hostName?: string;
  recurringTaskWaitTimeoutMs?: number;
  recurringTaskGatewayTimeoutMs?: number;
  onInfo?: (message: string, meta?: JsonObject) => void;
  onError?: (error: Error, meta?: JsonObject) => void;
}

interface RuntimeState {
  agent_id?: number;
  last_heartbeat_at?: string;
  [key: string]: unknown;
}

interface AgentProfile {
  id: number | null;
  name: string;
  type: string;
  identity: JsonObject | string;
  emoji?: string | null;
}

interface HeartbeatDefaults {
  heartbeat_interval_seconds?: number;
  heartbeatIntervalSeconds?: number;
}

export class AgentRuntimeProgram {
  private readonly options: AgentRuntimeProgramOptions;
  private readonly workspaceDir: string;
  private readonly statePath: string;

  private readonly client: AgentMCApi;
  private readonly initialAgentId: number | null;
  private readonly heartbeatEnabled: boolean;
  private readonly agentMcApiKey: string | null;
  private readonly agentMcApiBaseUrl: string;
  private readonly agentMcOpenApiUrl: string;

  private running = false;
  private stopRequested = false;
  private loopPromise: Promise<void> | null = null;
  private realtimeRuntime: AgentRuntime | null = null;

  private state: RuntimeState = {};
  private runtimeProvider: RuntimeProviderDescriptor | null = null;
  private agentProfile: AgentProfile | null = null;
  private heartbeatIntervalSeconds: number | null;
  private readonly recurringTaskPollIntervalSeconds: number;
  private readonly recurringTaskPollLimit: number;
  private readonly recurringTaskWaitTimeoutMs: number;
  private readonly recurringTaskGatewayTimeoutMs: number;
  private cachedOpenClawTelemetryCommandArgs: string[] | null = null;
  private lastOpenClawTelemetryError: string | null = null;
  private lastOpenClawIdentityError: string | null = null;
  private resolvedOpenClawCommand: string | null = null;
  private pendingImmediateHeartbeatReason: string | null = null;

  constructor(options: AgentRuntimeProgramOptions = {}) {
    this.options = options;
    this.workspaceDir = resolve(options.workspaceDir ?? process.cwd());
    this.statePath = resolve(options.statePath ?? resolve(this.workspaceDir, ".agentmc/state.json"));
    this.initialAgentId = toPositiveInt(options.agentId);
    this.heartbeatEnabled = options.heartbeatEnabled !== false;
    this.heartbeatIntervalSeconds = toPositiveInt(options.heartbeatIntervalSeconds);
    this.recurringTaskPollIntervalSeconds = DEFAULT_RECURRING_TASK_POLL_INTERVAL_SECONDS;
    this.recurringTaskPollLimit = DEFAULT_RECURRING_TASK_POLL_LIMIT;
    const configuredRecurringWaitTimeoutMs = toPositiveInt(options.recurringTaskWaitTimeoutMs);
    this.recurringTaskWaitTimeoutMs = configuredRecurringWaitTimeoutMs ?? DEFAULT_RECURRING_TASK_WAIT_TIMEOUT_MS;
    const configuredRecurringGatewayTimeoutMs = toPositiveInt(options.recurringTaskGatewayTimeoutMs);
    this.recurringTaskGatewayTimeoutMs = Math.max(
      configuredRecurringGatewayTimeoutMs ?? DEFAULT_RECURRING_TASK_GATEWAY_TIMEOUT_MS,
      this.recurringTaskWaitTimeoutMs + RECURRING_TASK_GATEWAY_TIMEOUT_BUFFER_MS
    );

    if (options.client) {
      this.client = options.client;
    } else {
      const apiKey = requireNonEmpty(options.apiKey, "options.apiKey");
      const baseUrl = normalizeApiBaseUrl(nonEmpty(options.baseUrl) ?? DEFAULT_AGENTMC_API_BASE_URL);
      this.client = new AgentMCApi({
        baseUrl,
        apiKey
      });
    }

    this.agentMcApiKey = sanitizeRuntimeContextValue(
      nonEmpty(options.apiKey) ??
        readClientStringValue(this.client, "getConfiguredApiKey") ??
        nonEmpty(process.env.AGENTMC_API_KEY),
      512
    );
    this.agentMcApiBaseUrl = normalizeApiBaseUrl(
      nonEmpty(options.baseUrl) ??
        readClientStringValue(this.client, "getBaseUrl") ??
        DEFAULT_AGENTMC_API_BASE_URL
    );
    this.agentMcOpenApiUrl =
      sanitizeRuntimeContextValue(readClientStringValue(this.client, "getOpenApiUrl"), 1024) ??
      `${this.agentMcApiBaseUrl.slice(0, -"/api/v1".length)}/api/openapi.json`;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): AgentRuntimeProgram {
    const hostKey = nonEmpty(env.AGENTMC_API_KEY);

    if (!hostKey) {
      throw new Error("AGENTMC_API_KEY is required. Set one host-level API key.");
    }

    return new AgentRuntimeProgram({
      apiKey: hostKey,
      baseUrl: DEFAULT_AGENTMC_API_BASE_URL,
      heartbeatEnabled: true,
      realtimeSessionPollingEnabled: true,
      heartbeatIntervalSeconds: DEFAULT_HEARTBEAT_INTERVAL_SECONDS
    });
  }

  isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.stopRequested = false;
    this.running = true;
    this.loopPromise = this.runLoop();

    this.loopPromise.finally(() => {
      this.running = false;
      this.loopPromise = null;
    });
  }

  async run(): Promise<void> {
    await this.start();
    if (this.loopPromise) {
      await this.loopPromise;
    }
  }

  async stop(): Promise<void> {
    this.stopRequested = true;

    if (this.realtimeRuntime) {
      try {
        await this.realtimeRuntime.stop();
      } catch (error) {
        this.emitError(normalizeError(error), { source: "realtime.stop" });
      }
    }

    if (this.loopPromise) {
      await this.loopPromise;
    }
  }

  attachRealtimeSession(sessionId: number): boolean {
    const resolvedSessionId = toPositiveInt(sessionId);
    if (resolvedSessionId === null) {
      return false;
    }

    const runtime = this.realtimeRuntime as AgentRuntime & {
      attachSession?: (id: number) => boolean;
    };
    if (!runtime || typeof runtime.attachSession !== "function") {
      return false;
    }

    return runtime.attachSession(resolvedSessionId);
  }

  private async runLoop(): Promise<void> {
    await mkdir(this.workspaceDir, { recursive: true });
    await this.loadState();

    if (this.heartbeatEnabled) {
      this.heartbeatIntervalSeconds = this.heartbeatIntervalSeconds ?? DEFAULT_HEARTBEAT_INTERVAL_SECONDS;
      if (!this.heartbeatIntervalSeconds || this.heartbeatIntervalSeconds < 1) {
        throw new Error("Heartbeat interval is missing.");
      }
    }

    let agentId = this.resolveAgentId();
    if (!this.heartbeatEnabled && agentId === null) {
      throw new Error("Agent id is required when heartbeat is disabled.");
    }
    if (agentId !== null) {
      await this.persistState({
        agent_id: agentId
      });
    }
    this.runtimeProvider = await this.resolveRuntimeProvider();
    this.agentProfile = await this.resolveAgentProfile(agentId, this.runtimeProvider);
    const recurringPollIntervalMs = this.recurringTaskPollIntervalSeconds * 1000;
    let nextRecurringPollAtMs = Date.now();

    if (this.heartbeatEnabled) {
      try {
        const heartbeatBody = await this.buildHeartbeatBody();
        const resolvedAgentId = await this.sendHeartbeat(heartbeatBody);
        if (resolvedAgentId !== null) {
          const previousAgentId = agentId;
          const nextAgentId = await this.applyResolvedAgentId(agentId, resolvedAgentId);
          const shouldRestartRealtime =
            previousAgentId !== null &&
            nextAgentId !== previousAgentId &&
            this.runtimeProvider !== null &&
            this.realtimeRuntime !== null;
          agentId = nextAgentId;
          if (shouldRestartRealtime) {
            await this.restartRealtimeRuntime(nextAgentId, this.runtimeProvider as RuntimeProviderDescriptor);
          }
        }
      } catch (error) {
        this.emitError(normalizeError(error), { source: "heartbeat.startup" });
      }
    }

    if (agentId !== null && this.runtimeProvider && this.realtimeRuntime === null) {
      await this.startRealtimeRuntime(agentId, this.runtimeProvider);
    }
    if (agentId !== null) {
      await this.catchUpNotificationsDuringHeartbeat(agentId);
    }

    let nextHeartbeatAtMs = this.heartbeatEnabled
      ? Date.now() + (this.heartbeatIntervalSeconds ?? 1) * 1000
      : Number.POSITIVE_INFINITY;

    while (!this.stopRequested) {
      const cycleNowMs = Date.now();

      if (this.heartbeatEnabled && this.pendingImmediateHeartbeatReason !== null) {
        nextHeartbeatAtMs = Math.min(nextHeartbeatAtMs, cycleNowMs);
      }

      if (cycleNowMs >= nextRecurringPollAtMs) {
        if (agentId !== null) {
          try {
            await this.pollRecurringTaskRuns(agentId, this.runtimeProvider);
          } catch (error) {
            this.emitError(normalizeError(error), { source: "recurring.poll" });
          } finally {
            nextRecurringPollAtMs = Date.now() + recurringPollIntervalMs;
          }
        } else {
          nextRecurringPollAtMs = Date.now() + recurringPollIntervalMs;
        }
      }

      if (this.heartbeatEnabled && cycleNowMs >= nextHeartbeatAtMs) {
        const immediateReason = this.pendingImmediateHeartbeatReason;
        this.pendingImmediateHeartbeatReason = null;

        try {
          const heartbeatBody = await this.buildHeartbeatBody();
          const resolvedAgentId = await this.sendHeartbeat(heartbeatBody);
          if (resolvedAgentId !== null) {
            const previousAgentId = agentId;
            const nextAgentId = await this.applyResolvedAgentId(agentId, resolvedAgentId);
            const shouldRestartRealtime =
              previousAgentId !== null &&
              nextAgentId !== previousAgentId &&
              this.runtimeProvider !== null &&
              this.realtimeRuntime !== null;
            agentId = nextAgentId;
            if (shouldRestartRealtime) {
              await this.restartRealtimeRuntime(nextAgentId, this.runtimeProvider as RuntimeProviderDescriptor);
            }
          }
          if (agentId !== null && this.runtimeProvider && this.realtimeRuntime === null) {
            await this.startRealtimeRuntime(agentId, this.runtimeProvider);
          }
          if (agentId !== null) {
            await this.catchUpNotificationsDuringHeartbeat(agentId);
          }

          if (immediateReason) {
            this.emitInfo("Immediate heartbeat sync completed", {
              reason: immediateReason
            });
          }
        } catch (error) {
          if (immediateReason !== null) {
            this.pendingImmediateHeartbeatReason = immediateReason;
          }
          this.emitError(normalizeError(error), { source: "heartbeat.cycle" });
        } finally {
          nextHeartbeatAtMs = Date.now() + (this.heartbeatIntervalSeconds ?? 1) * 1000;
        }
      }

      const nowMs = Date.now();
      const delayToHeartbeatMs = Number.isFinite(nextHeartbeatAtMs)
        ? Math.max(0, nextHeartbeatAtMs - nowMs)
        : recurringPollIntervalMs;
      const delayToRecurringMs = Math.max(0, nextRecurringPollAtMs - nowMs);
      // Keep the loop responsive so immediate heartbeat sync requests are applied quickly.
      const waitMs = Math.max(250, Math.min(delayToHeartbeatMs, delayToRecurringMs, 1000));
      await sleep(waitMs);
    }
  }

  private async restartRealtimeRuntime(agentId: number, provider: RuntimeProviderDescriptor): Promise<void> {
    if (this.realtimeRuntime) {
      await this.realtimeRuntime.stop();
      this.realtimeRuntime = null;
    }

    await this.startRealtimeRuntime(agentId, provider);
  }

  private requestImmediateHeartbeatSync(reason: string): void {
    if (!this.heartbeatEnabled) {
      return;
    }

    this.pendingImmediateHeartbeatReason = nonEmpty(reason) ?? "runtime_update";
  }

  private async loadState(): Promise<void> {
    if (!existsSync(this.statePath)) {
      this.state = {};
      return;
    }

    const raw = await readFile(this.statePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Invalid state file JSON at ${this.statePath}.`);
    }

    this.state = parsed as RuntimeState;
  }

  private async persistState(patch: RuntimeState): Promise<void> {
    const merged: RuntimeState = {
      ...this.state,
      ...patch
    };

    await mkdir(dirname(this.statePath), { recursive: true });
    await writeFile(this.statePath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
    this.state = merged;
  }

  private resolveAgentId(): number | null {
    const fromState = toPositiveInt(this.state.agent_id);
    const resolved = this.initialAgentId ?? fromState ?? null;

    if (resolved !== null && fromState !== resolved) {
      this.state.agent_id = resolved;
    }

    return resolved;
  }

  private resolveRuntimeCommandCwd(): string | undefined {
    return existsSync(this.workspaceDir) ? this.workspaceDir : undefined;
  }

  private async applyResolvedAgentId(currentAgentId: number | null, nextAgentId: number): Promise<number> {
    if (currentAgentId === nextAgentId) {
      return currentAgentId;
    }

    await this.persistState({
      agent_id: nextAgentId
    });

    if (this.agentProfile) {
      this.agentProfile = {
        ...this.agentProfile,
        id: nextAgentId
      };
    }

    this.emitInfo("Resolved agent id from heartbeat", {
      agent_id: nextAgentId
    });

    return nextAgentId;
  }

  private async resolveRuntimeProvider(): Promise<RuntimeProviderDescriptor> {
    const configured = this.options.runtimeProvider ?? "auto";

    if (configured === "external") {
      return this.resolveExternalProvider(true);
    }

    if (configured === "openclaw") {
      return this.resolveOpenClawProvider();
    }

    try {
      return await this.resolveOpenClawProvider();
    } catch (openclawError) {
      this.emitInfo("OpenClaw auto-detect skipped", {
        reason: normalizeError(openclawError).message
      });
    }

    if (!nonEmpty(this.options.runtimeCommand)) {
      throw new Error(
        "Unable to resolve runtime provider automatically. Install OpenClaw or pass options.runtimeCommand (and options.runtimeModels) for external mode."
      );
    }

    return this.resolveExternalProvider(true);
  }

  private async resolveOpenClawProvider(): Promise<RuntimeProviderDescriptor> {
    const command = await this.resolveOpenClawCommand({ strict: true });
    if (!command) {
      throw new Error("OpenClaw command resolution returned no executable command.");
    }

    const versionOutput = await execCapture(command, ["--version"], {
      cwd: this.resolveRuntimeCommandCwd()
    });
    const versionLine = firstNonEmptyLine(versionOutput.stdout) ?? firstNonEmptyLine(versionOutput.stderr);

    if (!versionLine) {
      throw new Error("Unable to resolve OpenClaw version output.");
    }

    const version = extractVersionToken(versionLine) ?? versionLine.trim();
    const build = extractBuildToken(versionLine);

    const models = await this.resolveOpenClawModels(command);

    if (models.length === 0) {
      throw new Error("OpenClaw model inventory is empty. Configure at least one OpenClaw model.");
    }

    return {
      kind: "openclaw",
      name: "openclaw",
      version,
      build,
      mode: "openclaw",
      models,
      machineIdentityResolver: (fallbackName, fallbackIdentity) =>
        this.resolveOpenClawMachineIdentitySnapshot(fallbackName, fallbackIdentity)
    };
  }

  private async resolveOpenClawCommand(options: { strict?: boolean } = {}): Promise<string | null> {
    if (this.resolvedOpenClawCommand) {
      return this.resolvedOpenClawCommand;
    }

    const configured = nonEmpty(this.options.openclawCommand);
    const runtimeCommandHint = nonEmpty(this.options.runtimeCommand);
    const candidates = resolveOpenClawCommandCandidates(configured, runtimeCommandHint);

    for (const candidate of candidates) {
      if (!(await canExecute(candidate, ["--version"]))) {
        continue;
      }

      this.resolvedOpenClawCommand = candidate;
      if (configured && candidate !== configured) {
        this.emitInfo("Configured options.openclawCommand is unavailable; using discovered OpenClaw command", {
          configured_command: configured,
          resolved_command: candidate
        });
      }
      return candidate;
    }

    const checked = candidates.length > 0 ? candidates.join(", ") : "(none)";
    if (options.strict) {
      throw new Error(
        `OpenClaw command is not available. Checked: ${checked}. Install OpenClaw or pass options.openclawCommand with an executable path.`
      );
    }

    return null;
  }

  private async resolveOpenClawModels(command: string): Promise<string[]> {
    const fromEnv = normalizeModelList(this.options.runtimeModels ?? []);
    if (fromEnv.length > 0) {
      return fromEnv;
    }

    for (const args of this.resolveOpenClawModelsStatusCommands()) {
      try {
        const output = await execCapture(command, args, {
          cwd: this.resolveRuntimeCommandCwd()
        });
        const parsed = parseJsonUnknown(output.stdout) ?? parseJsonUnknown(output.stderr);
        const models = normalizeModelList(extractModelStrings(parsed));
        if (models.length > 0) {
          return models;
        }
      } catch {
        // Keep trying fallback command variants.
      }
    }

    return [];
  }

  private resolveExternalProvider(strict: boolean): RuntimeProviderDescriptor {
    const runtimeCommand = nonEmpty(this.options.runtimeCommand);
    if (!runtimeCommand) {
      throw new Error("External runtime mode requires options.runtimeCommand.");
    }

    const versionCommand = nonEmpty(this.options.runtimeVersionCommand) ?? runtimeCommand;
    const versionArgs = versionCommand === runtimeCommand ? ["--version"] : [];

    const versionText = this.readCommandVersion(versionCommand, versionArgs);
    const runtimeName = nonEmpty(this.options.runtimeName) ?? basename(runtimeCommand);
    const runtimeVersion = versionText ?? nonEmpty(this.options.runtimeVersion);
    const runtimeBuild = nonEmpty(this.options.runtimeBuild);

    if (!runtimeVersion) {
      throw new Error(
        "Unable to resolve runtime version for external provider. Provide a runnable --version command or set options.runtimeVersion."
      );
    }

    const models = normalizeModelList(this.options.runtimeModels ?? []);
    if (strict && models.length === 0) {
      throw new Error("External runtime mode requires options.runtimeModels with at least one model identifier.");
    }

    const runtimeArgs = [...(this.options.runtimeCommandArgs ?? [])];

    return {
      kind: "external",
      name: runtimeName,
      version: runtimeVersion,
      build: runtimeBuild ?? null,
      mode: "external",
      models,
      runAgent: async (input) => {
        const payload = JSON.stringify({
          session_id: input.sessionId,
          request_id: input.requestId,
          message: input.userText
        });

        const result = await execCapture(runtimeCommand, [...runtimeArgs, "--agentmc-input", payload], {
          cwd: this.resolveRuntimeCommandCwd(),
          env: this.buildAgentCommandEnv()
        });
        const text = parseExternalAgentOutput(result.stdout);

        return {
          requestId: input.requestId,
          runId: `agentmc-${input.sessionId}-${input.requestId}`,
          status: "ok",
          textSource: "wait",
          content: text
        };
      }
    };
  }

  private readCommandVersion(command: string, args: string[]): string | null {
    try {
      const result = execFileSync(command, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      }) as string;

      const line = firstNonEmptyLine(result);
      if (!line) {
        return null;
      }

      return extractVersionToken(line) ?? line.trim();
    } catch {
      return null;
    }
  }

  private async resolveAgentProfile(agentId: number | null, provider: RuntimeProviderDescriptor): Promise<AgentProfile> {
    const configuredName = nonEmpty(this.options.agentName);
    const configuredType = nonEmpty(this.options.agentType);
    const configuredEmoji = nonEmpty(this.options.agentEmoji);

    const nameHint = configuredName;
    const fallbackName = nameHint ?? (agentId !== null ? `agent-${agentId}` : "agent");
    const fallbackIdentity = this.resolveIdentityFromWorkspace(fallbackName);
    const machineSnapshot = await this.resolveMachineIdentitySnapshot(
      provider,
      fallbackName,
      fallbackIdentity
    );

    const profileName = nonEmpty(machineSnapshot?.name) ?? fallbackName;
    const resolvedType = configuredType ?? resolveAgentTypeFromProvider(provider);
    const fallbackEmoji = configuredEmoji ?? extractIdentityEmoji(fallbackIdentity);
    const identityCandidate = machineSnapshot?.identity ?? fallbackIdentity;
    const profileEmoji = machineSnapshot?.emoji ?? fallbackEmoji ?? extractIdentityEmoji(identityCandidate);
    const profileIdentity = ensureIdentityPayload(identityCandidate, profileName, profileEmoji);

    const usingFallbackName = !configuredName && !nonEmpty(machineSnapshot?.name);
    const usingFallbackType = !configuredType;
    if (usingFallbackName || usingFallbackType) {
      this.emitInfo("Agent profile fallback metadata applied", {
        fallback_name: usingFallbackName ? profileName : null,
        fallback_type: usingFallbackType ? resolvedType : null,
        guidance: "Pass options.agentName and options.agentType to override resolved profile values."
      });
    }

    return {
      id: agentId,
      name: profileName,
      type: resolvedType,
      identity: profileIdentity,
      emoji: profileEmoji
    };
  }

  private async refreshAgentProfileFromMachine(): Promise<void> {
    const provider = this.runtimeProvider;
    const profile = this.agentProfile;
    if (!provider || !profile) {
      return;
    }

    const machineSnapshot = await this.resolveMachineIdentitySnapshot(
      provider,
      profile.name,
      profile.identity
    );
    if (!machineSnapshot) {
      return;
    }

    const resolvedName = nonEmpty(machineSnapshot.name) ?? profile.name;
    const hasMachineIdentity = machineSnapshot.identity !== null;
    const resolvedIdentityCandidate = hasMachineIdentity ? machineSnapshot.identity : profile.identity;
    const machineDerivedEmoji =
      machineSnapshot.emoji ??
      (hasMachineIdentity ? extractIdentityEmoji(machineSnapshot.identity) : null);
    const resolvedEmoji =
      machineDerivedEmoji ??
      (hasMachineIdentity ? null : profile.emoji ?? extractIdentityEmoji(resolvedIdentityCandidate));
    const resolvedIdentity = ensureIdentityPayload(resolvedIdentityCandidate, resolvedName, resolvedEmoji);

    this.agentProfile = {
      ...profile,
      name: resolvedName,
      identity: resolvedIdentity,
      emoji: resolvedEmoji
    };
  }

  private async resolveMachineIdentitySnapshot(
    provider: RuntimeProviderDescriptor,
    fallbackName: string,
    fallbackIdentity: JsonObject | string
  ): Promise<RuntimeMachineIdentitySnapshot | null> {
    if (!provider.machineIdentityResolver) {
      return null;
    }

    return provider.machineIdentityResolver(fallbackName, fallbackIdentity);
  }

  private async resolveOpenClawMachineIdentitySnapshot(
    fallbackName: string,
    fallbackIdentity: JsonObject | string
  ): Promise<RuntimeMachineIdentitySnapshot | null> {
    const configuredOpenClawAgent = normalizeOpenClawAgentName(this.options.openclawAgent);
    const preferredPaths = resolveOpenClawAgentSelectionPaths(this.workspaceDir, this.options.openclawSessionsPath);

    try {
      const command = await this.resolveOpenClawCommand();
      const rows = await this.resolveOpenClawAgentRows(command);
      if (rows.length === 0) {
        return null;
      }

      const matched = findOpenClawAgentRow(rows, {
        agentKey: configuredOpenClawAgent,
        fallbackName,
        preferredPaths,
        preferPathMatch: !configuredOpenClawAgent
      });
      if (!matched) {
        return null;
      }

      const identityFromRow = valueAsObject(matched.identity) ?? null;
      const resolvedNameFromRow = resolveOpenClawAgentRowName(matched, identityFromRow);
      const resolvedName = resolvedNameFromRow ?? fallbackName;
      const hasNameFromRow = resolvedNameFromRow !== null;
      const resolvedEmoji =
        extractIdentityEmoji(matched) ??
        extractIdentityEmoji(identityFromRow);
      const identitySource =
        identityFromRow ??
        (hasNameFromRow ? ({ name: resolvedName } satisfies JsonObject) : fallbackIdentity);
      const resolvedIdentity = ensureIdentityPayload(
        identitySource,
        resolvedName,
        resolvedEmoji
      );

      this.lastOpenClawIdentityError = null;

      return {
        name: resolvedName,
        identity: resolvedIdentity,
        emoji: resolvedEmoji
      };
    } catch (error) {
      const message = normalizeError(error).message;
      if (this.lastOpenClawIdentityError !== message) {
        this.lastOpenClawIdentityError = message;
        this.emitInfo("OpenClaw agent identity unavailable; using current profile", {
          reason: message
        });
      }

      return null;
    }
  }

  private async resolveOpenClawAgentRows(command: string | null): Promise<JsonObject[]> {
    const discoveryCommands: Array<{ args: string[]; label: string }> = [
      { args: ["agents", "list", "--json"], label: "agents list --json" },
      { args: ["gateway", "call", "agents.list", "--json"], label: "gateway call agents.list --json" },
      {
        args: ["gateway", "call", "agents.list", "--json", "--params", "{}"],
        label: "gateway call agents.list --json --params {}"
      },
      { args: ["gateway", "call", "config.get", "--json"], label: "gateway call config.get --json" }
    ];
    const errors: string[] = [];

    if (command) {
      for (const candidate of discoveryCommands) {
        try {
          const output = await execCapture(command, candidate.args, {
            cwd: this.resolveRuntimeCommandCwd(),
            timeoutMs: OPENCLAW_AGENT_DISCOVERY_TIMEOUT_MS
          });
          const parsed = parseJsonUnknown(output.stdout) ?? parseJsonUnknown(output.stderr);
          if (parsed === null) {
            errors.push(`${candidate.label}: command output did not contain parseable JSON.`);
            continue;
          }

          const rows = extractOpenClawAgentRows(parsed);
          if (rows.length > 0) {
            return rows;
          }

          errors.push(`${candidate.label}: no agent rows found in JSON output.`);
        } catch (error) {
          errors.push(`${candidate.label}: ${normalizeError(error).message}`);
        }
      }
    } else {
      errors.push("openclaw command was not executable in runtime environment; skipping command-based discovery.");
    }

    const configPathCandidates = resolveOpenClawConfigPathCandidates(
      this.options.openclawConfigPath,
      this.options.openclawSessionsPath,
      this.workspaceDir
    );
    for (const configPath of configPathCandidates) {
      try {
        const raw = await readFile(configPath, "utf8");
        const parsed = parseJsonUnknown(raw);
        if (parsed === null) {
          errors.push(`${configPath}: file did not contain parseable JSON.`);
          continue;
        }

        const rows = extractOpenClawAgentRows(parsed);
        if (rows.length > 0) {
          return rows;
        }

        errors.push(`${configPath}: no agent rows found in config JSON.`);
      } catch (error) {
        const normalized = normalizeError(error);
        if ((normalized as NodeJS.ErrnoException).code === "ENOENT") {
          continue;
        }
        errors.push(`${configPath}: ${normalized.message}`);
      }
    }

    const reason =
      errors.length > 0
        ? errors.join(" | ")
        : "No supported OpenClaw discovery command returned agent rows.";
    throw new Error(reason);
  }

  private resolveIdentityFromWorkspace(agentName: string): JsonObject {
    const identityPath = resolve(this.workspaceDir, "IDENTITY.md");
    if (!existsSync(identityPath)) {
      return { name: agentName };
    }

    try {
      const text = readFileSync(identityPath, "utf8");
      const name = parseIdentityField(text, "Name") ?? agentName;
      const creature = parseIdentityField(text, "Creature");
      const vibe = parseIdentityField(text, "Vibe");

      const identity: JsonObject = { name };
      if (creature) {
        identity.creature = creature;
      }
      if (vibe) {
        identity.vibe = vibe;
      }

      return identity;
    } catch {
      return { name: agentName };
    }
  }

  private async startRealtimeRuntime(agentId: number, provider: RuntimeProviderDescriptor): Promise<void> {
    const runtimeDocsDirectory = this.resolveRuntimeDocsDirectory();
    await mkdir(runtimeDocsDirectory, { recursive: true });

    const runtime = new AgentRuntime({
      client: this.client,
      agent: agentId,
      agentmcApiKey: this.agentMcApiKey ?? undefined,
      agentmcBaseUrl: this.agentMcApiBaseUrl,
      agentmcOpenApiUrl: this.agentMcOpenApiUrl,
      realtimeSessionsEnabled: this.options.realtimeSessionsEnabled !== false,
      sessionPollingEnabled: this.options.realtimeSessionPollingEnabled !== false,
      runtimeDocsDirectory,
      runtimeWorkingDirectory: this.workspaceDir,
      includeMissingRuntimeDocs: true,
      openclawCommand: this.options.openclawCommand,
      openclawAgent: this.options.openclawAgent,
      openclawSessionsPath: this.options.openclawSessionsPath,
      runAgent: provider.runAgent,
      runtimeSource: "agent-runtime",
      closeSessionOnStop: true,
      onError: (error) => {
        this.emitError(error, { source: "realtime.runtime" });
      },
      onSessionReady: (session) => {
        this.emitInfo("Realtime session ready", {
          session_id: toPositiveInt(valueAsObject(session)?.id)
        });
      },
      onSessionClosed: (sessionId, reason) => {
        this.emitInfo("Realtime session closed", { session_id: sessionId, reason });
      },
      onSignal: (event) => {
        const described = describeRealtimeSignalEvent(event);
        if (!described) {
          return;
        }

        this.emitInfo(described.message, described.meta);
      },
      onNotification: (event) => {
        this.emitInfo("Notification received", summarizeRealtimeNotificationEvent(event));
      },
      onNotificationBridge: (event) => {
        this.emitInfo("Notification sent to agent", summarizeRealtimeNotificationBridgeEvent(event));
      },
      onConnectionStateChange: (event) => {
        this.emitInfo("Realtime connection state changed", {
          session_id: event.sessionId,
          state: event.state
        });
      },
      onUnhandledMessage: (event) => {
        this.emitInfo("Realtime message ignored", summarizeRealtimeUnhandledMessageEvent(event));
      },
      onDebug: (event) => {
        const runtimeEvent = describeRealtimeRuntimeDebugEvent(event);
        if (runtimeEvent) {
          this.emitInfo(runtimeEvent.message, runtimeEvent.meta);
          return;
        }

        if (!event.event.startsWith("agent.profile.update")) {
          return;
        }

        const details = valueAsObject(event.details) ?? {};
        if (
          event.event === "agent.profile.update.ack.sent" &&
          String(details.channel_type ?? "").trim().toLowerCase() === "agent.profile.updated"
        ) {
          this.requestImmediateHeartbeatSync("agent_profile_updated");
        }

        this.emitInfo("Agent profile update runtime event", {
          event: event.event,
          details
        });
      }
    });

    this.realtimeRuntime = runtime;
    await runtime.start();

    this.emitInfo("Realtime runtime started", {
      provider: provider.kind,
      status: runtime.getStatus()
    });
  }

  private resolveRuntimeDocsDirectory(): string {
    // OpenClaw managed docs live at workspace root (AGENTS.md, TOOLS.md, etc).
    return this.workspaceDir;
  }

  private async resolveRuntimeHeartbeatTelemetry(provider: RuntimeProviderDescriptor): Promise<JsonObject> {
    if (provider.kind !== "openclaw") {
      return {};
    }

    return this.resolveOpenClawHeartbeatTelemetry(provider);
  }

  private async resolveOpenClawHeartbeatTelemetry(provider: RuntimeProviderDescriptor): Promise<JsonObject> {
    const command = await this.resolveOpenClawCommand();
    const snapshots = await this.loadOpenClawTelemetrySnapshots(command ?? DEFAULT_OPENCLAW_COMMAND);
    if (snapshots.length === 0) {
      return {};
    }

    const openclawAgent = normalizeOpenClawAgentName(this.options.openclawAgent);
    const telemetry: JsonObject = {};
    for (const snapshot of snapshots) {
      mergeHeartbeatTelemetry(
        telemetry,
        extractHeartbeatTelemetryFromRuntimeSnapshot(snapshot, { openclawAgent })
      );
    }

    if (!nonEmpty(telemetry.openclaw_version)) {
      telemetry.openclaw_version = provider.version;
    }

    if (!nonEmpty(telemetry.openclaw_build) && provider.build) {
      telemetry.openclaw_build = provider.build;
    }

    const runtimeIdentity = valueAsObject(telemetry.runtime);
    if (runtimeIdentity) {
      if (!nonEmpty(runtimeIdentity.name)) {
        runtimeIdentity.name = provider.name;
      }
      if (!nonEmpty(runtimeIdentity.version)) {
        runtimeIdentity.version = provider.version;
      }
      if (!nonEmpty(runtimeIdentity.build) && provider.build) {
        runtimeIdentity.build = provider.build;
      }
      if (!nonEmpty(runtimeIdentity.mode)) {
        runtimeIdentity.mode = provider.mode;
      }
    }

    return telemetry;
  }

  private async loadOpenClawTelemetrySnapshots(command: string): Promise<JsonObject[]> {
    const snapshots: JsonObject[] = [];
    const errors: string[] = [];

    const primary = await this.executeOpenClawTelemetryCommand(command, errors);
    if (primary) {
      snapshots.push(primary);
    }

    for (const args of this.resolveOpenClawModelsStatusCommands()) {
      try {
        const output = await execCapture(command, args, {
          cwd: this.resolveRuntimeCommandCwd(),
          timeoutMs: OPENCLAW_TELEMETRY_TIMEOUT_MS
        });
        const parsed = parseJsonUnknown(output.stdout) ?? parseJsonUnknown(output.stderr);
        const object = valueAsObject(parsed);
        if (object) {
          snapshots.push(object);
          break;
        }
      } catch (error) {
        errors.push(
          `${args.join(" ")}: ${normalizeError(error).message}`
        );
      }
    }

    if (snapshots.length > 0) {
      this.lastOpenClawTelemetryError = null;
      return snapshots;
    }

    const errorSignature = errors[0] ?? "OpenClaw telemetry command returned no parseable JSON.";
    if (this.lastOpenClawTelemetryError !== errorSignature) {
      this.lastOpenClawTelemetryError = errorSignature;
      this.emitInfo("OpenClaw telemetry unavailable for heartbeat enrichment", {
        reason: errorSignature
      });
    }

    return [];
  }

  private resolveOpenClawModelsStatusCommands(): string[][] {
    const openclawAgent = normalizeOpenClawAgentName(this.options.openclawAgent);
    if (!openclawAgent) {
      return [
        [...OPENCLAW_MODELS_TELEMETRY_COMMAND],
        ["models", "--status-json"]
      ];
    }

    return [
      ["models", "--agent", openclawAgent, "--status-json"],
      [...OPENCLAW_MODELS_TELEMETRY_COMMAND, "--agent", openclawAgent],
      ["models", "status", "--agent", openclawAgent, "--json"]
    ];
  }

  private async executeOpenClawTelemetryCommand(command: string, errors: string[]): Promise<JsonObject | null> {
    const candidates = this.cachedOpenClawTelemetryCommandArgs
      ? [this.cachedOpenClawTelemetryCommandArgs, ...OPENCLAW_TELEMETRY_COMMAND_CANDIDATES]
      : [...OPENCLAW_TELEMETRY_COMMAND_CANDIDATES];

    const seen = new Set<string>();

    for (const args of candidates) {
      const signature = args.join(" ");
      if (seen.has(signature)) {
        continue;
      }
      seen.add(signature);

      try {
        const output = await execCapture(command, args, {
          cwd: this.resolveRuntimeCommandCwd(),
          timeoutMs: OPENCLAW_TELEMETRY_TIMEOUT_MS
        });

        const parsed = parseJsonUnknown(output.stdout) ?? parseJsonUnknown(output.stderr);
        const object = valueAsObject(parsed);
        if (!object) {
          errors.push(`${signature}: command output did not contain a JSON object.`);
          continue;
        }

        this.cachedOpenClawTelemetryCommandArgs = [...args];
        return object;
      } catch (error) {
        errors.push(`${signature}: ${normalizeError(error).message}`);
      }
    }

    this.cachedOpenClawTelemetryCommandArgs = null;
    return null;
  }

  private async buildHeartbeatBody(): Promise<HeartbeatBody> {
    await this.refreshAgentProfileFromMachine();

    const provider = this.runtimeProvider;
    const profile = this.agentProfile;

    if (!provider || !profile) {
      throw new Error("Runtime provider and agent profile must be initialized before heartbeat.");
    }

    const hostName = this.options.hostName ?? hostname();
    const privateIp = resolvePrivateIp();
    const publicIp = await resolvePublicIp(this.options.publicIp, this.options.publicIpEndpoint, privateIp);

    const hostFingerprint =
      nonEmpty(this.options.hostFingerprint) ??
      createHash("sha256")
        .update([hostName, privateIp, publicIp, platform(), arch()].join("|"))
        .digest("hex");

    const disk = await resolveDiskInfo();

    const runtimeVersion = provider.version;
    const runtimeBuild = provider.build;
    const runtimeTelemetry = await this.resolveRuntimeHeartbeatTelemetry(provider);

    const runtimeModels = normalizeHeartbeatModels(runtimeTelemetry.models);
    const models = runtimeModels.length > 0 ? runtimeModels : provider.models;

    if (models.length === 0) {
      const guidance = provider.kind === "openclaw"
        ? "Configure OpenClaw models so `openclaw models status --json` returns at least one model."
        : "Provide options.runtimeModels with at least one runtime model identifier.";
      throw new Error(`Heartbeat requires runtime model inventory in meta.models. ${guidance}`);
    }

    const runtimeStatus = this.realtimeRuntime?.getStatus();
    const metaType = provider.kind === "openclaw" ? "openclaw" : provider.name;
    const profileEmoji = nonEmpty(profile.emoji) ?? extractIdentityEmoji(profile.identity);
    const profileIdentity = ensureIdentityPayload(profile.identity, profile.name, profileEmoji);

    const heartbeatMeta: JsonObject = {
      type: metaType,
      runtime: {
        name: provider.name,
        version: runtimeVersion,
        ...(runtimeBuild ? { build: runtimeBuild } : {})
      },
      models,
      runtime_mode: provider.mode,
      node_version: process.version,
      ...(AGENTMC_NODE_PACKAGE_VERSION ? { agentmc_node_package_version: AGENTMC_NODE_PACKAGE_VERSION } : {}),
      tool_availability: {
        chat_realtime: runtimeStatus?.chatRealtimeEnabled ?? false,
        files_realtime:
          runtimeStatus?.filesRealtimeEnabled ?? runtimeStatus?.docsRealtimeEnabled ?? false,
        notifications_realtime: runtimeStatus?.notificationsRealtimeEnabled ?? false
      }
    };

    if (provider.kind === "openclaw") {
      heartbeatMeta.openclaw_version = runtimeVersion;
      heartbeatMeta.openclaw_build = runtimeBuild ?? runtimeVersion;
    }
    if (profileEmoji) {
      heartbeatMeta.emoji = profileEmoji;
    }

    for (const [key, value] of Object.entries(runtimeTelemetry)) {
      if (key === "models" || key === "type") {
        continue;
      }
      if (key === "runtime") {
        const incomingRuntime = valueAsObject(value);
        if (!incomingRuntime) {
          continue;
        }

        const existingRuntime = valueAsObject(heartbeatMeta.runtime) ?? {};
        heartbeatMeta.runtime = {
          ...incomingRuntime,
          ...existingRuntime
        };
        continue;
      }
      if (provider.kind === "openclaw" && (key === "openclaw_version" || key === "openclaw_build")) {
        continue;
      }
      heartbeatMeta[key] = value;
    }

    const agentPayload: NonNullable<HeartbeatBody["agent"]> & { emoji?: string | null } = {
      name: profile.name,
      type: profile.type,
      identity: profileIdentity
    };
    if (profile.id !== null) {
      agentPayload.id = profile.id;
    }
    if (profileEmoji) {
      agentPayload.emoji = profileEmoji;
    }

    const openclawAgentKey = normalizeOpenClawAgentName(this.options.openclawAgent);
    if (provider.kind === "openclaw" && openclawAgentKey) {
      const identityObject = valueAsObject(agentPayload.identity) ?? {};
      agentPayload.identity = {
        ...identityObject,
        agent_key: openclawAgentKey,
        openclaw_agent: openclawAgentKey
      };
    }

    return {
      meta: heartbeatMeta as HeartbeatBody["meta"],
      host: {
        fingerprint: hostFingerprint,
        name: hostName,
        meta: {
          hostname: hostName,
          ip: privateIp,
          network: {
            private_ip: privateIp,
            public_ip: publicIp
          },
          os: platform(),
          os_version: release(),
          arch: arch(),
          cpu: cpus()[0]?.model ?? "unknown",
          cpu_cores: cpus().length,
          ram_gb: Number((totalmem() / 1024 / 1024 / 1024).toFixed(2)),
          disk,
          uptime_seconds: Math.floor(uptime()),
          runtime: {
            name: provider.name,
            version: runtimeVersion
          }
        }
      },
      agent: agentPayload
    };
  }

  private async sendHeartbeat(body: HeartbeatBody): Promise<number | null> {
    const hostFingerprint = nonEmpty(body.host?.fingerprint);
    if (!hostFingerprint) {
      throw new Error("Heartbeat host fingerprint is missing.");
    }

    const sendHeartbeatOperation = this.getOptionalOperation("agentHeartbeat");
    if (!sendHeartbeatOperation) {
      throw new Error("agentHeartbeat operation is not available.");
    }

    const response = await sendHeartbeatOperation({
      params: {
        header: {
          "X-Host-Fingerprint": hostFingerprint
        }
      },
      body
    });

    if (response.error) {
      throw createOperationFailureError("agentHeartbeat", response);
    }

    const responsePayload = valueAsObject(response.data);
    const responseDefaults = valueAsObject(responsePayload?.defaults) as HeartbeatDefaults | null;
    const responseHost = valueAsObject(responsePayload?.host);
    const responseAgent = valueAsObject(responsePayload?.agent);
    const responseAgentId = toPositiveInt(responseAgent?.id);
    const serverHeartbeatIntervalSeconds = toPositiveInt(
      responseDefaults?.heartbeat_interval_seconds ?? responseDefaults?.heartbeatIntervalSeconds
    );
    if (
      serverHeartbeatIntervalSeconds !== null &&
      serverHeartbeatIntervalSeconds !== this.heartbeatIntervalSeconds
    ) {
      this.heartbeatIntervalSeconds = serverHeartbeatIntervalSeconds;
      this.emitInfo("Heartbeat interval updated", {
        interval_seconds: serverHeartbeatIntervalSeconds,
        source: "server_defaults"
      });
    }
    const nowIso = new Date().toISOString();
    await this.persistState({
      last_heartbeat_at: nowIso
    });

    this.emitInfo("Heartbeat sent", {
      at: nowIso,
      host_status: typeof responseHost?.status === "string" ? responseHost.status : null,
      agent_id: responseAgentId,
      runtime: valueAsObject(body.meta)?.runtime ?? null
    });

    return responseAgentId;
  }

  private getOptionalOperation(operationId: string): ApiOperationHandler | null {
    const operation = valueAsObject(this.client.operations)?.[operationId];
    return typeof operation === "function" ? (operation as ApiOperationHandler) : null;
  }

  private async catchUpNotificationsDuringHeartbeat(agentId: number): Promise<void> {
    if (!this.heartbeatEnabled || this.stopRequested) {
      return;
    }

    const runtime = this.realtimeRuntime as AgentRuntime & {
      ingestNotificationsFromApi?: (
        notifications: readonly unknown[],
        options?: { source?: "api_poll" }
      ) => Promise<OpenClawRuntimeApiNotificationIngestResult>;
    };
    if (!runtime || typeof runtime.ingestNotificationsFromApi !== "function") {
      return;
    }

    const listNotifications = this.getOptionalOperation("listNotifications");
    if (!listNotifications) {
      return;
    }

    try {
      let page = 1;
      let totalReceived = 0;
      let processed = 0;
      let skipped = 0;
      let sessionId: number | null = null;

      while (!this.stopRequested && page <= DEFAULT_HEARTBEAT_NOTIFICATION_CATCHUP_MAX_PAGES) {
        const response = await listNotifications({
          params: {
            query: {
              unread: true,
              per_page: DEFAULT_HEARTBEAT_NOTIFICATION_CATCHUP_PER_PAGE,
              page
            }
          },
          headers: {
            "X-Agent-Id": String(agentId)
          }
        });

        if (response.error) {
          throw createOperationFailureError("listNotifications", response);
        }

        const payload = valueAsObject(response.data) ?? (await readJsonResponseObject(response.response)) ?? {};
        const rows = Array.isArray(payload.data) ? payload.data : [];
        if (rows.length === 0) {
          break;
        }

        const ingestResult = await runtime.ingestNotificationsFromApi(rows, { source: "api_poll" });
        totalReceived += ingestResult.totalReceived;
        processed += ingestResult.processed;
        skipped += ingestResult.skipped;
        sessionId = ingestResult.sessionId ?? sessionId;

        const meta = valueAsObject(payload.meta);
        const currentPage = toPositiveInt(meta?.current_page) ?? 0;
        const lastPage = toPositiveInt(meta?.last_page) ?? 0;
        if (
          (currentPage > 0 && lastPage > 0 && currentPage >= lastPage) ||
          (currentPage === 0 && rows.length < DEFAULT_HEARTBEAT_NOTIFICATION_CATCHUP_PER_PAGE)
        ) {
          break;
        }

        page += 1;
      }

      if (processed > 0) {
        this.emitInfo("Heartbeat notification catch-up processed notifications", {
          source: "api_poll",
          session_id: sessionId,
          total_received: totalReceived,
          processed,
          skipped
        });
      }
    } catch (error) {
      this.emitError(normalizeError(error), {
        source: "heartbeat.notifications.catchup",
        agent_id: agentId
      });
    }
  }

  private async pollRecurringTaskRuns(agentId: number, provider: RuntimeProviderDescriptor): Promise<void> {
    const listDueRecurringTaskRuns = this.getOptionalOperation("listDueRecurringTaskRuns");
    if (!listDueRecurringTaskRuns) {
      return;
    }

    const response = await listDueRecurringTaskRuns({
      params: {
        query: {
          limit: this.recurringTaskPollLimit
        }
      },
      headers: {
        "X-Agent-Id": String(agentId)
      }
    });

    if (response.error) {
      throw createOperationFailureError("listDueRecurringTaskRuns", response);
    }

    const payload = (valueAsObject(response.data) ?? (await readJsonResponseObject(response.response)) ?? {
      data: []
    }) as DueRecurringTaskRunsResult;
    const rows = Array.isArray(payload.data) ? payload.data : [];
    if (rows.length === 0) {
      return;
    }

    this.emitInfo("Claimed recurring task runs", {
      count: rows.length,
      limit: this.recurringTaskPollLimit
    });

    for (const row of rows) {
      const claimed = parseClaimedRecurringTaskRun(row);
      if (!claimed) {
        this.emitError(new Error("Skipping malformed recurring task run payload."), {
          source: "recurring.claim"
        });
        continue;
      }

      if (claimed.agentId !== null && claimed.agentId !== agentId) {
        this.emitError(new Error("Skipping recurring task run for unexpected agent id."), {
          source: "recurring.claim",
          expected_agent_id: agentId,
          actual_agent_id: claimed.agentId,
          run_id: claimed.runId
        });
        continue;
      }

      try {
        await this.executeRecurringTaskRun(agentId, provider, claimed);
      } catch (error) {
        this.emitError(normalizeError(error), {
          source: "recurring.run",
          run_id: claimed.runId,
          task_id: claimed.taskId
        });
      }
    }
  }

  private async executeRecurringTaskRun(
    agentId: number,
    provider: RuntimeProviderDescriptor,
    claimed: ClaimedRecurringTaskRun
  ): Promise<void> {
    const startedAtIso = new Date().toISOString();

    let execution: RecurringTaskExecutionResult;
    try {
      execution = await this.runRecurringTaskPrompt(provider, claimed);
    } catch (error) {
      execution = {
        status: "error",
        summary: null,
        errorMessage: normalizeError(error).message,
        runtimeMeta: {
          provider: provider.name,
          provider_kind: provider.kind,
          provider_version: provider.version
        }
      };
    }

    const body: CompleteRecurringTaskRunBody = {
      status: execution.status,
      claim_token: claimed.claimToken,
      summary: execution.summary,
      error_message: execution.errorMessage,
      started_at: startedAtIso,
      finished_at: new Date().toISOString(),
      runtime_meta: execution.runtimeMeta
    };

    const completeRecurringTaskRun = this.getOptionalOperation("completeRecurringTaskRun");
    if (!completeRecurringTaskRun) {
      return;
    }

    const response = await completeRecurringTaskRun({
      params: {
        path: {
          run: claimed.runId
        }
      },
      headers: {
        "X-Agent-Id": String(agentId)
      },
      body
    });

    if (response.error) {
      throw createOperationFailureError("completeRecurringTaskRun", response);
    }

    this.emitInfo("Recurring task run completed", {
      run_id: claimed.runId,
      task_id: claimed.taskId,
      status: execution.status
    });
  }

  private async runRecurringTaskPrompt(
    provider: RuntimeProviderDescriptor,
    claimed: ClaimedRecurringTaskRun
  ): Promise<RecurringTaskExecutionResult> {
    const requestId = `recurring-${claimed.runId}-${Date.now().toString(36)}`;
    const prompt = claimed.prompt.trim();

    if (prompt === "") {
      return {
        status: "error",
        summary: null,
        errorMessage: "Recurring task prompt is empty.",
        runtimeMeta: {
          request_id: requestId,
          provider: provider.name,
          provider_kind: provider.kind
        }
      };
    }

    const runInput: AgentRuntimeRunInput = {
      sessionId: claimed.taskId,
      requestId,
      userText: buildRecurringTaskAgentMcMessage(prompt)
    };

    let runResult: AgentRuntimeRunResult;
    if (provider.runAgent) {
      runResult = await provider.runAgent(runInput);
    } else if (provider.kind === "openclaw") {
      runResult = await this.runOpenClawRecurringPrompt(runInput, claimed);
    } else {
      throw new Error(`Runtime provider ${provider.kind} does not support recurring task execution.`);
    }

    const runtimeMeta: JsonObject = {
      request_id: requestId,
      run_id: nonEmpty(runResult.runId) ?? `agentmc-recurring-${claimed.runId}`,
      runtime_status: runResult.status,
      text_source: runResult.textSource,
      provider: provider.name,
      provider_kind: provider.kind,
      provider_version: provider.version,
      scheduled_for: claimed.scheduledFor,
      task_id: claimed.taskId
    };
    const rawAgentResponse = String(runResult.content ?? "");
    const storedAgentResponse = truncateUtf8(rawAgentResponse, RECURRING_TASK_AGENT_RESPONSE_MAX_BYTES);
    if (storedAgentResponse.value !== null) {
      runtimeMeta.agent_response = storedAgentResponse.value;
      runtimeMeta.agent_response_bytes = storedAgentResponse.bytes;
      runtimeMeta.agent_response_truncated = storedAgentResponse.truncated;
    }

    if (runResult.status === "ok") {
      return {
        status: "success",
        summary: summarizeRecurringRunText(rawAgentResponse),
        errorMessage: null,
        runtimeMeta
      };
    }

    return {
      status: "error",
      summary: null,
      errorMessage:
        summarizeRecurringRunText(rawAgentResponse) ??
        `Runtime execution returned status "${runResult.status}".`,
      runtimeMeta
    };
  }

  private async runOpenClawRecurringPrompt(
    input: AgentRuntimeRunInput,
    claimed: ClaimedRecurringTaskRun
  ): Promise<AgentRuntimeRunResult> {
    const command = await this.resolveOpenClawCommand({ strict: true });
    if (!command) {
      throw new Error("OpenClaw command resolution returned no executable command.");
    }
    const openclawAgent = normalizeOpenClawAgentName(this.options.openclawAgent) ?? "main";
    const recurringExecutionId = `agentmc-recurring-${claimed.runId}`;
    const sessionKey = `agent:${openclawAgent}:agentmc:recurring:${claimed.taskId}`;
    const timeoutMs = Math.max(this.recurringTaskWaitTimeoutMs, this.recurringTaskGatewayTimeoutMs);

    try {
      const output = await execCapture(
        command,
        ["agent", "--agent", openclawAgent, "--message", input.userText],
        {
          cwd: this.resolveRuntimeCommandCwd(),
          timeoutMs,
          env: this.buildAgentCommandEnv()
        }
      );
      const directTextRaw = parseExternalAgentOutput(output.stdout) || parseExternalAgentOutput(output.stderr);
      const directText = sanitizeAssistantOutputText(directTextRaw);
      if (directText !== "") {
        return {
          requestId: input.requestId,
          runId: recurringExecutionId,
          status: "ok",
          textSource: "wait",
          content: directText
        };
      }
    } catch (error) {
      const message = normalizeError(error).message;
      return {
        requestId: input.requestId,
        runId: recurringExecutionId,
        status: "error",
        textSource: "error",
        content: `OpenClaw recurring execution failed: ${message}`
      };
    }

    const historyText = await this.resolveRecurringAssistantTextFromSessionHistory(sessionKey);
    if (historyText !== null) {
      return {
        requestId: input.requestId,
        runId: recurringExecutionId,
        status: "ok",
        textSource: "session_history",
        content: historyText
      };
    }

    return {
      requestId: input.requestId,
      runId: recurringExecutionId,
      status: "ok",
      textSource: "fallback",
      content: "Recurring task run completed, but no assistant response text was returned."
    };
  }

  private async resolveRecurringAssistantTextFromSessionHistory(sessionKey: string): Promise<string | null> {
    const runtime = this.realtimeRuntime as
      | { readLatestAssistantText?: (key: string) => Promise<string | null> }
      | null;

    if (!runtime || typeof runtime.readLatestAssistantText !== "function") {
      return null;
    }

    try {
      const text = await runtime.readLatestAssistantText(sessionKey);
      const normalized = nonEmpty(text);
      if (!normalized) {
        return null;
      }

      const sanitized = sanitizeAssistantOutputText(normalized);
      return sanitized === "" ? null : sanitized;
    } catch (error) {
      this.emitInfo("Unable to read recurring session history text", {
        session_key: sessionKey,
        reason: normalizeError(error).message
      });
      return null;
    }
  }

  private resolveAgentMcPromptContext(): AgentMcPromptContext {
    return {
      apiKey: this.agentMcApiKey,
      apiBaseUrl: this.agentMcApiBaseUrl,
      openApiUrl: this.agentMcOpenApiUrl
    };
  }

  private buildAgentCommandEnv(): NodeJS.ProcessEnv {
    return buildAgentCommandEnv(this.resolveAgentMcPromptContext());
  }

  private emitInfo(message: string, meta?: JsonObject): void {
    if (this.options.onInfo) {
      this.options.onInfo(message, meta);
      return;
    }

    const suffix = meta ? ` ${JSON.stringify(meta)}` : "";
    process.stdout.write(`[agentmc-runtime] ${message}${suffix}\n`);
  }

  private emitError(error: Error, meta?: JsonObject): void {
    if (this.options.onError) {
      this.options.onError(error, meta);
      return;
    }

    const suffix = meta ? ` ${JSON.stringify(meta)}` : "";
    process.stderr.write(`[agentmc-runtime:error] ${error.message}${suffix}\n`);
  }
}

function normalizeApiBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/api/v1")) {
    return trimmed;
  }

  return `${trimmed}/api/v1`;
}

function readClientStringValue(
  client: AgentMCApi,
  key: "getConfiguredApiKey" | "getBaseUrl" | "getOpenApiUrl"
): string | null {
  const candidate = client as unknown as Record<string, unknown>;
  const value = candidate[key];
  if (typeof value !== "function") {
    return null;
  }

  try {
    return nonEmpty((value as () => unknown).call(client));
  } catch {
    return null;
  }
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

function buildAgentCommandEnv(context: AgentMcPromptContext): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  if (context.apiKey) {
    env.AGENTMC_API_KEY = context.apiKey;
  }

  return env;
}

function normalizeOpenClawAgentName(value: unknown): string | null {
  const resolved = nonEmpty(value);
  if (!resolved) {
    return null;
  }

  if (!/^[A-Za-z0-9_.-]+$/.test(resolved)) {
    throw new Error("options.openclawAgent may only include letters, numbers, underscore, dot, and hyphen.");
  }

  return resolved;
}

function buildRecurringTaskAgentMcMessage(userPrompt: string): string {
  const normalizedPrompt = String(userPrompt ?? "").trim();
  return normalizedPrompt;
}

function summarizeRecurringRunText(value: unknown): string | null {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized === "") {
    return null;
  }

  const maxLength = RECURRING_TASK_SUMMARY_MAX_LENGTH;
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function truncateUtf8(
  value: string,
  maxBytes: number
): { value: string | null; bytes: number; truncated: boolean } {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return {
      value: null,
      bytes: 0,
      truncated: false
    };
  }

  const encoder = new TextEncoder();
  const encoded = encoder.encode(normalized);
  if (encoded.length <= maxBytes) {
    return {
      value: normalized,
      bytes: encoded.length,
      truncated: false
    };
  }

  let end = normalized.length;
  let candidate = normalized;
  while (end > 0) {
    end -= 1;
    candidate = normalized.slice(0, end);
    if (encoder.encode(candidate).length <= maxBytes) {
      break;
    }
  }

  return {
    value: candidate.trimEnd(),
    bytes: encoder.encode(candidate).length,
    truncated: true
  };
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

function parseClaimedRecurringTaskRun(value: unknown): ClaimedRecurringTaskRun | null {
  const object = valueAsObject(value);
  if (!object) {
    return null;
  }

  const runId = toPositiveInt(object.run_id);
  const taskId = toPositiveInt(object.task_id);
  const claimToken = nonEmpty(object.claim_token);
  const prompt = typeof object.prompt === "string" ? object.prompt : null;

  if (!runId || !taskId || !claimToken || prompt === null) {
    return null;
  }

  return {
    runId,
    taskId,
    prompt,
    scheduledFor: nonEmpty(object.scheduled_for),
    claimToken,
    agentId: toPositiveInt(object.agent_id)
  };
}

async function canExecute(command: string, args: string[]): Promise<boolean> {
  try {
    await execCapture(command, args);
    return true;
  } catch {
    return false;
  }
}

function resolveOpenClawCommandCandidates(configured: string | null, runtimeCommandHint: string | null): string[] {
  const candidates = new Set<string>();

  const add = (value: string | null): void => {
    const command = nonEmpty(value);
    if (!command) {
      return;
    }
    candidates.add(command);
  };

  add(configured);
  if (looksLikeOpenClawCommand(runtimeCommandHint)) {
    add(runtimeCommandHint);
  }

  for (const command of resolveExecutablePathsFromEnvPath(DEFAULT_OPENCLAW_COMMAND)) {
    add(command);
  }

  add(DEFAULT_OPENCLAW_COMMAND);

  for (const command of OPENCLAW_COMMAND_FALLBACK_PATHS) {
    add(command);
  }

  return Array.from(candidates);
}

function looksLikeOpenClawCommand(value: string | null): boolean {
  const command = nonEmpty(value);
  if (!command) {
    return false;
  }

  if (command.toLowerCase() === DEFAULT_OPENCLAW_COMMAND) {
    return true;
  }

  const normalizedBaseName = basename(command).replace(/\.[^.]+$/, "").toLowerCase();
  return normalizedBaseName.includes("openclaw");
}

function resolveExecutablePathsFromEnvPath(commandName: string): string[] {
  const pathValue = nonEmpty(process.env.PATH);
  if (!pathValue) {
    return [];
  }

  const candidates = new Set<string>();
  const executableNames = resolveExecutableNameVariants(commandName);

  for (const rawDir of pathValue.split(delimiter)) {
    const dir = rawDir.trim();
    if (!dir) {
      continue;
    }

    for (const executableName of executableNames) {
      const fullPath = join(dir, executableName);
      if (existsSync(fullPath)) {
        candidates.add(fullPath);
      }
    }
  }

  return Array.from(candidates);
}

function resolveExecutableNameVariants(commandName: string): string[] {
  const normalized = nonEmpty(commandName);
  if (!normalized) {
    return [];
  }

  if (process.platform !== "win32") {
    return [normalized];
  }

  const candidates = new Set<string>([normalized]);
  const pathExt = nonEmpty(process.env.PATHEXT) ?? ".EXE;.CMD;.BAT;.COM";

  for (const ext of pathExt.split(";")) {
    const suffix = ext.trim();
    if (!suffix) {
      continue;
    }

    const lowerSuffix = suffix.toLowerCase();
    if (normalized.toLowerCase().endsWith(lowerSuffix)) {
      candidates.add(normalized);
      continue;
    }

    candidates.add(`${normalized}${lowerSuffix}`);
  }

  return Array.from(candidates);
}

async function execCapture(
  command: string,
  args: readonly string[],
  options: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}
): Promise<{ stdout: string; stderr: string }> {
  const output = await execFileAsync(command, [...args], {
    ...(nonEmpty(options.cwd) ? { cwd: options.cwd } : {}),
    maxBuffer: 10 * 1024 * 1024,
    ...(options.timeoutMs && options.timeoutMs > 0 ? { timeout: options.timeoutMs } : {}),
    ...(options.env ? { env: options.env } : {})
  });

  return {
    stdout: String(output.stdout ?? ""),
    stderr: String(output.stderr ?? "")
  };
}

function parseExternalAgentOutput(stdout: string): string {
  const trimmed = String(stdout ?? "").trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "string") {
      return parsed;
    }

    if (parsed && typeof parsed === "object") {
      const object = parsed as JsonObject;
      const direct = nonEmpty(object.content) ?? nonEmpty(object.output) ?? nonEmpty(object.text) ?? null;
      if (direct) {
        return direct;
      }
    }
  } catch {
    // Keep plain text output path.
  }

  return trimmed;
}

function parseIdentityField(content: string, label: string): string | null {
  const regex = new RegExp(`^-\\s*\\*\\*${escapeRegExp(label)}:\\*\\*\\s*(.+)$`, "mi");
  const match = content.match(regex)?.[1]?.trim();
  if (!match) {
    return null;
  }

  if (match === "_(optional)_" || match.startsWith("_(")) {
    return null;
  }

  return match;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
}

async function resolveDiskInfo(): Promise<{ total_bytes: number; free_bytes: number }> {
  try {
    const stats = await statfs("/");
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);

    return {
      total_bytes: Number.isFinite(totalBytes) ? totalBytes : 0,
      free_bytes: Number.isFinite(freeBytes) ? freeBytes : 0
    };
  } catch {
    return {
      total_bytes: 0,
      free_bytes: 0
    };
  }
}

function resolvePrivateIp(): string {
  const interfaces = networkInterfaces();

  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (!address || address.internal || address.family !== "IPv4") {
        continue;
      }

      return address.address;
    }
  }

  throw new Error("Unable to resolve private IPv4 address from host network interfaces.");
}

async function resolvePublicIp(explicit: string | undefined, endpoint: string | undefined, privateIp: string): Promise<string> {
  const direct = nonEmpty(explicit);
  if (direct) {
    return direct;
  }

  const interfaces = networkInterfaces();
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (!address || address.internal || address.family !== "IPv4") {
        continue;
      }

      if (!isPrivateIpv4(address.address)) {
        return address.address;
      }
    }
  }

  const endpointCandidates = endpoint
    ? [endpoint]
    : [...DEFAULT_PUBLIC_IP_ENDPOINT_CANDIDATES];
  const endpointErrors: string[] = [];

  for (const candidateEndpoint of endpointCandidates) {
    try {
      const response = await fetch(candidateEndpoint, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
        },
        signal: AbortSignal.timeout(4_000)
      });

      if (!response.ok) {
        endpointErrors.push(`${candidateEndpoint}: HTTP ${response.status}`);
        continue;
      }

      const text = (await response.text()).trim();
      if (isIpv4(text)) {
        return text;
      }

      try {
        const parsed = JSON.parse(text);
        const parsedObject = valueAsObject(parsed);
        const ipCandidate = nonEmpty(parsedObject?.ip) ?? nonEmpty(parsedObject?.public_ip);
        if (ipCandidate && isIpv4(ipCandidate)) {
          return ipCandidate;
        }
      } catch {
        // Keep parse fallback.
      }

      endpointErrors.push(`${candidateEndpoint}: response did not include a valid IPv4 address.`);
    } catch (error) {
      endpointErrors.push(`${candidateEndpoint}: ${normalizeError(error).message}`);
    }
  }

  const endpointSummary = endpointErrors.length > 0 ? ` Endpoint checks: ${endpointErrors.join(" | ")}` : "";
  throw new Error(`Unable to resolve public IP address. Private IP was ${privateIp}.${endpointSummary}`);
}

function isPrivateIpv4(value: string): boolean {
  const parts = value.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const octet0 = parts[0] ?? -1;
  const octet1 = parts[1] ?? -1;

  if (octet0 === 10) {
    return true;
  }

  if (octet0 === 172 && octet1 >= 16 && octet1 <= 31) {
    return true;
  }

  if (octet0 === 192 && octet1 === 168) {
    return true;
  }

  if (octet0 === 127) {
    return true;
  }

  return false;
}

function isIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) {
    return false;
  }

  for (const part of parts) {
    const number = Number.parseInt(part, 10);
    if (!Number.isInteger(number) || number < 0 || number > 255) {
      return false;
    }
  }

  return true;
}

function ensureIdentityPayload(identity: unknown, fallbackName: string, emoji: string | null): JsonObject {
  const objectIdentity = valueAsObject(identity) ?? {};
  const normalizedIdentity: JsonObject = { ...objectIdentity };

  if (!nonEmpty(normalizedIdentity.name)) {
    normalizedIdentity.name = fallbackName;
  }
  if (emoji && !nonEmpty(normalizedIdentity.emoji)) {
    normalizedIdentity.emoji = emoji;
  }

  return normalizedIdentity;
}

function extractIdentityEmoji(value: unknown): string | null {
  const objectValue = valueAsObject(value);
  if (!objectValue) {
    return null;
  }

  const direct =
    nonEmpty(objectValue.emoji) ??
    nonEmpty(objectValue.avatar_emoji) ??
    nonEmpty(objectValue.avatarEmoji) ??
    nonEmpty(objectValue.profile_emoji) ??
    nonEmpty(objectValue.profileEmoji) ??
    nonEmpty(objectValue.icon_emoji) ??
    nonEmpty(objectValue.iconEmoji) ??
    nonEmpty(objectValue.icon) ??
    nonEmpty(objectValue.avatar) ??
    nonEmpty(objectValue.symbol) ??
    nonEmpty(objectValue.glyph);
  if (direct) {
    return direct;
  }

  const nestedIdentity = valueAsObject(objectValue.identity);
  if (!nestedIdentity) {
    return null;
  }

  return (
    nonEmpty(nestedIdentity.emoji) ??
    nonEmpty(nestedIdentity.avatar_emoji) ??
    nonEmpty(nestedIdentity.avatarEmoji) ??
    nonEmpty(nestedIdentity.profile_emoji) ??
    nonEmpty(nestedIdentity.profileEmoji) ??
    nonEmpty(nestedIdentity.icon_emoji) ??
    nonEmpty(nestedIdentity.iconEmoji) ??
    nonEmpty(nestedIdentity.icon) ??
    nonEmpty(nestedIdentity.avatar) ??
    nonEmpty(nestedIdentity.symbol) ??
    nonEmpty(nestedIdentity.glyph) ??
    null
  );
}

function extractOpenClawAgentRows(payload: unknown): JsonObject[] {
  const visited = new Set<JsonObject>();
  const visitedArrays = new Set<unknown[]>();
  const queue: JsonObject[] = [];
  const arrayQueue: unknown[][] = [];
  const coerceRows = (candidate: unknown): JsonObject[] => {
    if (Array.isArray(candidate)) {
      const rows = candidate
        .map((entry) => valueAsObject(entry))
        .filter((entry): entry is JsonObject => entry !== null)
        .filter((entry) => isLikelyOpenClawAgentRow(entry));
      return rows;
    }

    const objectCandidate = valueAsObject(candidate);
    if (!objectCandidate) {
      return [];
    }

    const rows = Object.entries(objectCandidate)
      .map(([mapKey, entry]) => {
        const objectEntry = valueAsObject(entry);
        if (!objectEntry) {
          return null;
        }

        if (
          nonEmpty(objectEntry.key) ??
          nonEmpty(objectEntry.id) ??
          nonEmpty(objectEntry.agent_key) ??
          nonEmpty(objectEntry.agentKey)
        ) {
          return objectEntry;
        }

        if (!isLikelyOpenClawAgentRow(objectEntry)) {
          return null;
        }

        return {
          key: mapKey,
          ...objectEntry
        } satisfies JsonObject;
      })
      .filter((entry): entry is JsonObject => entry !== null)
      .filter((entry) => isLikelyOpenClawAgentRow(entry));

    return rows;
  };

  const enqueue = (value: unknown): void => {
    if (Array.isArray(value)) {
      if (visitedArrays.has(value)) {
        return;
      }
      visitedArrays.add(value);
      arrayQueue.push(value);
      return;
    }

    const object = valueAsObject(value);
    if (!object || visited.has(object)) {
      return;
    }
    visited.add(object);
    queue.push(object);
  };

  enqueue(payload);

  while (queue.length > 0 || arrayQueue.length > 0) {
    if (arrayQueue.length > 0) {
      const currentArray = arrayQueue.shift() as unknown[];
      const rows = coerceRows(currentArray);
      if (rows.length > 0) {
        return rows;
      }

      for (const item of currentArray) {
        enqueue(item);
      }
    }

    if (queue.length === 0) {
      continue;
    }

    const current = queue.shift() as JsonObject;
    const directCandidates: unknown[] = [
      current.list,
      current.agents,
      current.data,
      current.items,
      valueAsObject(current.list)?.agents,
      valueAsObject(current.agents)?.agents,
      valueAsObject(current.agents)?.list,
      valueAsObject(current.config)?.agents,
      valueAsObject(valueAsObject(current.config)?.agents)?.list,
      valueAsObject(current.parsed)?.agents,
      valueAsObject(valueAsObject(current.parsed)?.agents)?.list
    ];

    for (const candidate of directCandidates) {
      const rows = coerceRows(candidate);
      if (rows.length > 0) {
        return rows;
      }
    }

    enqueue(current.payload);
    enqueue(current.result);
    enqueue(current.response);
    enqueue(current.data);
    enqueue(current.config);
    enqueue(current.parsed);
    enqueue(current.agents);
  }

  return [];
}

function isLikelyOpenClawAgentRow(row: JsonObject): boolean {
  return (
    nonEmpty(row.id) ??
    nonEmpty(row.key) ??
    nonEmpty(row.agent) ??
    nonEmpty(row.slug) ??
    nonEmpty(row.agent_key) ??
    nonEmpty(row.agentKey) ??
    nonEmpty(row.name) ??
    nonEmpty(row.agent_name) ??
    nonEmpty(row.agentName) ??
    nonEmpty(row.identityName) ??
    nonEmpty(row.identity_name) ??
    nonEmpty(row.display_name) ??
    nonEmpty(row.displayName) ??
    nonEmpty(row.workspace) ??
    nonEmpty(row.workspace_path) ??
    nonEmpty(row.workspacePath) ??
    nonEmpty(row.agentDir) ??
    nonEmpty(row.agent_dir) ??
    nonEmpty(row.agentPath) ??
    valueAsObject(row.agent) ??
    valueAsObject(row.profile) ??
    valueAsObject(row.meta) ??
    valueAsObject(row.identity)
  ) !== null;
}

function resolveOpenClawConfigPathCandidates(
  configuredConfigPath: string | undefined,
  openclawSessionsPath: string | undefined,
  workspaceDir: string
): string[] {
  const candidates = new Set<string>();
  const add = (value: string | null): void => {
    const path = nonEmpty(value);
    if (!path) {
      return;
    }
    candidates.add(path);
  };

  add(nonEmpty(configuredConfigPath));
  add(`${homedir()}/.openclaw/openclaw.json`);
  add("/root/.openclaw/openclaw.json");
  add(`${workspaceDir}/.openclaw/openclaw.json`);

  const sessions = nonEmpty(openclawSessionsPath);
  if (sessions) {
    const sessionsDirectory = dirname(sessions);
    add(`${sessionsDirectory}/openclaw.json`);
  }

  return Array.from(candidates);
}

interface OpenClawAgentRowSelectionOptions {
  agentKey?: string | null;
  fallbackName: string;
  preferredPaths?: readonly string[];
  preferPathMatch?: boolean;
}

function findOpenClawAgentRow(rows: readonly JsonObject[], options: OpenClawAgentRowSelectionOptions): JsonObject | null {
  const { agentKey, fallbackName, preferredPaths = [], preferPathMatch = false } = options;
  if (rows.length === 0) {
    return null;
  }

  const exactWorkspaceMatch = findOpenClawAgentRowByExactWorkspace(rows, preferredPaths);
  if (preferPathMatch && exactWorkspaceMatch) {
    return exactWorkspaceMatch;
  }

  const pathMatch = findOpenClawAgentRowByPath(rows, preferredPaths);
  if (preferPathMatch && pathMatch) {
    return pathMatch;
  }

  const normalizedTargetKey = normalizeAgentLookupToken(agentKey);
  if (normalizedTargetKey) {
    const byKey = rows.find((row) => {
      const rowKey = normalizeAgentLookupToken(
        nonEmpty(row.key) ??
          nonEmpty(row.id) ??
          nonEmpty(row.agent) ??
          nonEmpty(row.agent_key) ??
          nonEmpty(row.agentKey) ??
          nonEmpty(row.slug) ??
          ""
      );

      return rowKey !== "" && rowKey === normalizedTargetKey;
    });
    if (byKey) {
      return byKey;
    }
  }

  if (pathMatch) {
    return pathMatch;
  }

  const normalizedFallbackName = normalizeAgentLookupToken(fallbackName);
  if (normalizedFallbackName) {
    const byName = rows.find((row) => {
      const rowName = normalizeAgentLookupToken(resolveOpenClawAgentRowName(row, valueAsObject(row.identity)) ?? "");

      return rowName !== "" && rowName === normalizedFallbackName;
    });
    if (byName) {
      return byName;
    }
  }

  if (rows.length === 1) {
    return rows[0] ?? null;
  }

  return null;
}

function findOpenClawAgentRowByPath(rows: readonly JsonObject[], preferredPaths: readonly string[]): JsonObject | null {
  const normalizedPaths = preferredPaths
    .map((entry) => normalizePathToken(entry))
    .filter((entry) => entry !== "");
  if (normalizedPaths.length === 0) {
    return null;
  }

  let bestRow: JsonObject | null = null;
  let bestScore = 0;

  for (const row of rows) {
    const rowAgentDir = normalizePathToken(nonEmpty(row.agentDir) ?? nonEmpty(row.agent_dir) ?? nonEmpty(row.agentPath));
    const rowWorkspace = normalizePathToken(
      nonEmpty(row.workspace) ?? nonEmpty(row.workspace_path) ?? nonEmpty(row.workspacePath)
    );

    let rowScore = 0;
    for (const candidatePath of normalizedPaths) {
      rowScore = Math.max(rowScore, scorePathRelationship(candidatePath, rowAgentDir, 6, 5, 4));
      rowScore = Math.max(rowScore, scorePathRelationship(candidatePath, rowWorkspace, 12, 3, 2));
    }

    if (rowScore > bestScore) {
      bestScore = rowScore;
      bestRow = row;
    }
  }

  return bestScore > 0 ? bestRow : null;
}

function findOpenClawAgentRowByExactWorkspace(rows: readonly JsonObject[], preferredPaths: readonly string[]): JsonObject | null {
  const normalizedPaths = preferredPaths
    .map((entry) => normalizePathToken(entry))
    .filter((entry) => entry !== "");
  if (normalizedPaths.length === 0) {
    return null;
  }

  for (const row of rows) {
    const rowWorkspace = normalizePathToken(
      nonEmpty(row.workspace) ?? nonEmpty(row.workspace_path) ?? nonEmpty(row.workspacePath)
    );
    if (rowWorkspace === "") {
      continue;
    }

    for (const candidatePath of normalizedPaths) {
      if (candidatePath === rowWorkspace) {
        return row;
      }
    }
  }

  return null;
}

function scorePathRelationship(
  candidatePath: string,
  rowPath: string,
  exactScore: number,
  candidateWithinRowScore: number,
  rowWithinCandidateScore: number
): number {
  if (candidatePath === "" || rowPath === "") {
    return 0;
  }

  if (candidatePath === rowPath) {
    return exactScore;
  }

  if (candidatePath.startsWith(`${rowPath}/`)) {
    return candidateWithinRowScore;
  }

  if (rowPath.startsWith(`${candidatePath}/`)) {
    return rowWithinCandidateScore;
  }

  return 0;
}

function resolveOpenClawAgentSelectionPaths(workspaceDir: string, openclawSessionsPath: string | undefined): string[] {
  const paths = new Set<string>();
  paths.add(workspaceDir);
  paths.add(process.cwd());

  const sessionsPath = nonEmpty(openclawSessionsPath);
  if (sessionsPath) {
    const sessionsDir = dirname(sessionsPath);
    paths.add(sessionsDir);
    paths.add(dirname(sessionsDir));
  }

  return Array.from(paths);
}

function resolveOpenClawAgentRowName(row: JsonObject, identityFromRow: JsonObject | null): string | null {
  const rowAgent = valueAsObject(row.agent);
  const rowProfile = valueAsObject(row.profile);
  const rowMeta = valueAsObject(row.meta);
  const identity = identityFromRow ?? valueAsObject(row.identity);
  const identityRaw = nonEmpty(row.identity);
  const identityNameFromMarkdown = identityRaw ? parseIdentityField(identityRaw, "Name") : null;

  return (
    nonEmpty(row.identityName) ??
    nonEmpty(row.identity_name) ??
    nonEmpty(row.name) ??
    nonEmpty(row.agent_name) ??
    nonEmpty(row.agentName) ??
    nonEmpty(row.display_name) ??
    nonEmpty(row.displayName) ??
    nonEmpty(rowProfile?.name) ??
    nonEmpty(rowAgent?.name) ??
    nonEmpty(rowMeta?.name) ??
    nonEmpty(identity?.name) ??
    identityNameFromMarkdown ??
    null
  );
}

function normalizePathToken(value: unknown): string {
  const text = nonEmpty(value);
  if (!text) {
    return "";
  }

  return text
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function resolveAgentTypeFromProvider(provider: RuntimeProviderDescriptor): string {
  if (provider.kind === "openclaw") {
    return "openclaw";
  }

  return provider.name;
}

function normalizeAgentLookupToken(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function normalizeModelList(models: readonly string[]): string[] {
  const normalized = models
    .map((entry) => normalizeModelToken(entry))
    .filter((entry) => entry !== "");

  return Array.from(new Set(normalized));
}

function normalizeModelToken(value: unknown): string {
  const trimmed = String(value ?? "").trim();
  if (trimmed === "") {
    return "";
  }

  const normalizedLower = trimmed.toLowerCase();
  if (OPENCLAW_MODEL_PLACEHOLDER_TOKENS.has(normalizedLower)) {
    return "";
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const unwrapped = trimmed.slice(1, -1).trim();
    if (unwrapped === "") {
      return "";
    }

    return OPENCLAW_MODEL_PLACEHOLDER_TOKENS.has(unwrapped.toLowerCase()) ? "" : unwrapped;
  }

  return trimmed;
}

function normalizeHeartbeatModels(value: unknown): (string | JsonObject)[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: (string | JsonObject)[] = [];
  const seenStrings = new Set<string>();

  for (const item of value) {
    const normalizedText = normalizeModelToken(item);
    if (normalizedText !== "") {
      const key = normalizedText.toLowerCase();
      if (!seenStrings.has(key)) {
        seenStrings.add(key);
        normalized.push(normalizedText);
      }
      continue;
    }

    const object = valueAsObject(item);
    if (object) {
      const objectModelLabel = firstHeartbeatModelObjectLabel(object);
      if (objectModelLabel !== null && normalizeModelToken(objectModelLabel) === "") {
        continue;
      }

      normalized.push(object);
    }
  }

  return normalized;
}

function firstHeartbeatModelObjectLabel(object: JsonObject): string | null {
  const keys = ["model_id", "modelId", "full_name", "fullName", "id", "model", "name", "label"] as const;
  for (const key of keys) {
    const value = nonEmpty(object[key]);
    if (value) {
      return value;
    }
  }

  return null;
}

function mergeHeartbeatTelemetry(target: JsonObject, patch: JsonObject): void {
  for (const [key, value] of Object.entries(patch)) {
    if (key === "runtime") {
      const incoming = valueAsObject(value);
      if (!incoming) {
        continue;
      }
      const existing = valueAsObject(target.runtime) ?? {};
      target.runtime = {
        ...existing,
        ...incoming
      };
      continue;
    }

    if (key === "tool_availability") {
      const incoming = valueAsObject(value);
      if (!incoming) {
        continue;
      }
      const existing = valueAsObject(target.tool_availability) ?? {};
      target.tool_availability = {
        ...existing,
        ...incoming
      };
      continue;
    }

    if (key === "models") {
      const models = normalizeHeartbeatModels(value);
      if (models.length > 0) {
        target.models = models;
      }
      continue;
    }

    target[key] = value;
  }
}

function extractHeartbeatTelemetryFromRuntimeSnapshot(
  snapshot: JsonObject,
  options: { openclawAgent?: string | null } = {}
): JsonObject {
  const telemetry: JsonObject = {};
  const lookup = createLookupMap(snapshot);

  const runtimeObject = firstObjectFromLookup(lookup, ["runtime", "runtime_info", "provider_runtime"]);
  const runtimeName =
    nonEmpty(runtimeObject?.name) ??
    nonEmpty(firstValueFromLookup(lookup, ["runtime_name", "provider_name", "provider"]));
  const runtimeVersion =
    nonEmpty(runtimeObject?.version) ??
    nonEmpty(firstValueFromLookup(lookup, ["openclaw_version", "runtime_version"]));
  const runtimeBuild =
    nonEmpty(runtimeObject?.build) ??
    nonEmpty(firstValueFromLookup(lookup, ["openclaw_build", "runtime_build", "build", "git_sha", "commit_hash"]));
  const runtimeMode =
    nonEmpty(runtimeObject?.mode) ??
    nonEmpty(firstValueFromLookup(lookup, ["runtime_mode", "provider_mode", "mode"]));

  const runtimeIdentity: JsonObject = {};
  if (runtimeName) {
    runtimeIdentity.name = runtimeName;
  }
  if (runtimeVersion) {
    runtimeIdentity.version = runtimeVersion;
  }
  if (runtimeBuild) {
    runtimeIdentity.build = runtimeBuild;
  }
  if (runtimeMode) {
    runtimeIdentity.mode = runtimeMode;
  }

  if (Object.keys(runtimeIdentity).length > 0) {
    telemetry.runtime = runtimeIdentity;
  }

  if (runtimeVersion) {
    telemetry.openclaw_version = runtimeVersion;
  }
  if (runtimeBuild) {
    telemetry.openclaw_build = runtimeBuild;
  }
  if (runtimeMode) {
    telemetry.runtime_mode = runtimeMode;
  }

  const telemetryModels = normalizeHeartbeatModels(
    runtimeObject?.models ?? firstValueFromLookup(lookup, ["models", "runtime_models", "model_inventory", "available_models"])
  );
  if (telemetryModels.length > 0) {
    telemetry.models = telemetryModels;
  }

  const openClawModelsStatus = normalizeOpenClawModelsStatusTelemetry(snapshot);
  if (openClawModelsStatus) {
    telemetry.openclaw_models_status = openClawModelsStatus;

    const derivedModels = normalizeHeartbeatModels([
      openClawModelsStatus.resolved_default,
      openClawModelsStatus.default_model,
      ...collectOpenClawAccessibleModels(snapshot)
    ]);
    if (derivedModels.length > 0) {
      telemetry.models = normalizeHeartbeatModels([
        ...(Array.isArray(telemetry.models) ? telemetry.models : []),
        ...derivedModels
      ]);
    }

    const authSummary = resolveOpenClawAuthSummary(valueAsObject(snapshot.auth));
    if (authSummary && !nonEmpty(telemetry.auth)) {
      telemetry.auth = authSummary;
    }
  }

  const usage = firstObjectFromLookup(lookup, ["usage"]);
  applyStructuredUsageTelemetry(telemetry, usage);
  applyOpenClawUsageProviderTelemetry(telemetry, usage);

  assignIntegerTelemetryField(telemetry, "tokens_in", lookup, ["tokens_in", "input_tokens", "prompt_tokens"]);
  assignIntegerTelemetryField(telemetry, "tokens_out", lookup, ["tokens_out", "output_tokens", "completion_tokens"]);
  assignIntegerTelemetryField(telemetry, "cache_tokens_cached", lookup, [
    "cache_tokens_cached",
    "cached_tokens",
    "prompt_cache_tokens"
  ]);
  assignIntegerTelemetryField(telemetry, "cache_tokens_new", lookup, [
    "cache_tokens_new",
    "new_tokens",
    "uncached_tokens"
  ]);
  assignIntegerTelemetryField(telemetry, "context_tokens_used", lookup, [
    "context_tokens_used",
    "context_used_tokens",
    "context_used"
  ]);
  assignIntegerTelemetryField(telemetry, "context_tokens_max", lookup, [
    "context_tokens_max",
    "context_max_tokens",
    "context_window_max",
    "context_limit"
  ]);
  assignIntegerTelemetryField(telemetry, "context_compactions", lookup, [
    "context_compactions",
    "context_compaction_count",
    "compactions"
  ]);
  assignIntegerTelemetryField(telemetry, "queue_depth", lookup, ["queue_depth", "queue_size", "pending_count"]);

  assignNumberTelemetryField(telemetry, "cache_hit_rate_percent", lookup, [
    "cache_hit_rate_percent",
    "prompt_cache_hit_rate_percent"
  ]);
  const rawCacheHitRate = numberFromUnknown(
    firstValueFromLookup(lookup, ["cache_hit_rate", "prompt_cache_hit_rate"])
  );
  if (!("cache_hit_rate_percent" in telemetry) && rawCacheHitRate !== null) {
    telemetry.cache_hit_rate_percent = rawCacheHitRate <= 1 ? Number((rawCacheHitRate * 100).toFixed(2)) : rawCacheHitRate;
  }

  assignNumberTelemetryField(telemetry, "context_percent_used", lookup, [
    "context_percent_used",
    "context_usage_percent"
  ]);

  assignNumberTelemetryField(telemetry, "usage_window_percent_left", lookup, [
    "usage_window_percent_left",
    "window_percent_left"
  ]);
  assignNumberTelemetryField(telemetry, "usage_day_percent_left", lookup, [
    "usage_day_percent_left",
    "daily_percent_left"
  ]);

  assignStringTelemetryField(telemetry, "usage_window_time_left", lookup, ["usage_window_time_left", "window_time_left"]);
  assignStringTelemetryField(telemetry, "usage_day_time_left", lookup, ["usage_day_time_left", "daily_time_left"]);
  assignStringTelemetryField(telemetry, "session", lookup, ["session_id", "session"]);
  assignStringTelemetryField(telemetry, "queue", lookup, ["queue_name", "queue"]);
  assignStringTelemetryField(telemetry, "auth", lookup, ["auth_mode", "authentication", "auth"]);

  const thinkingModeRaw = firstValueFromLookup(lookup, ["thinking_mode", "reasoning_mode", "thinking"]);
  const thinkingModeBool = valueAsBoolean(thinkingModeRaw);
  if (thinkingModeBool !== null) {
    telemetry.thinking_mode = thinkingModeBool;
  } else {
    const thinkingModeText = nonEmpty(thinkingModeRaw);
    if (thinkingModeText) {
      telemetry.thinking_mode = thinkingModeText;
    }
  }

  const toolAvailability = valueAsObject(
    firstValueFromLookup(lookup, ["tool_availability", "toolavailability", "tools", "tool_status"])
  );
  if (toolAvailability) {
    const normalizedTools = extractBooleanMap(toolAvailability);
    if (Object.keys(normalizedTools).length > 0) {
      telemetry.tool_availability = normalizedTools;
    }
  }

  assignBooleanTelemetryField(telemetry, "browser_tool_available", lookup, ["browser_tool_available", "tools_browser", "browser"]);
  assignBooleanTelemetryField(telemetry, "exec_tool_available", lookup, ["exec_tool_available", "tools_exec", "exec"]);
  assignBooleanTelemetryField(telemetry, "nodes_tool_available", lookup, ["nodes_tool_available", "tools_nodes", "nodes"]);
  assignBooleanTelemetryField(telemetry, "messaging_tool_available", lookup, ["messaging_tool_available", "tools_messaging", "messaging"]);
  assignBooleanTelemetryField(telemetry, "sessions_tool_available", lookup, ["sessions_tool_available", "tools_sessions", "sessions"]);
  assignBooleanTelemetryField(telemetry, "memory_tool_available", lookup, ["memory_tool_available", "tools_memory", "memory"]);

  applyOpenClawSessionTelemetry(telemetry, snapshot, options.openclawAgent ?? null);
  applyTextTelemetryFallbacks(telemetry, snapshot);
  sanitizeTelemetryStringFields(telemetry);

  if (!("context_percent_used" in telemetry)) {
    const used = numberFromUnknown(telemetry.context_tokens_used);
    const max = numberFromUnknown(telemetry.context_tokens_max);
    if (used !== null && max !== null && max > 0) {
      telemetry.context_percent_used = Number(((used / max) * 100).toFixed(2));
    }
  }

  return telemetry;
}

function createLookupMap(source: JsonObject): Map<string, unknown[]> {
  const lookup = new Map<string, unknown[]>();
  const visit = (value: unknown, pathSegments: string[]): void => {
    if (pathSegments.length > 0) {
      for (let suffixLength = 1; suffixLength <= pathSegments.length; suffixLength += 1) {
        const key = normalizeLookupKey(pathSegments.slice(-suffixLength).join("_"));
        pushLookupValue(lookup, key, value);
      }
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, pathSegments);
      }
      return;
    }

    const objectValue = valueAsObject(value);
    if (!objectValue) {
      return;
    }

    for (const [childKey, childValue] of Object.entries(objectValue)) {
      visit(childValue, [...pathSegments, childKey]);
    }
  };

  visit(source, []);

  return lookup;
}

function firstValueFromLookup(lookup: Map<string, unknown[]>, keys: readonly string[]): unknown {
  for (const key of keys) {
    const values = lookup.get(normalizeLookupKey(key));
    if (values && values.length > 0) {
      return values[0];
    }
  }

  return undefined;
}

function firstObjectFromLookup(lookup: Map<string, unknown[]>, keys: readonly string[]): JsonObject | null {
  const candidate = firstValueFromLookup(lookup, keys);
  return valueAsObject(candidate);
}

function normalizeLookupKey(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function pushLookupValue(lookup: Map<string, unknown[]>, key: string, value: unknown): void {
  if (key === "") {
    return;
  }

  const bucket = lookup.get(key);
  if (bucket) {
    bucket.push(value);
    return;
  }

  lookup.set(key, [value]);
}

function normalizeOpenClawModelsStatusTelemetry(snapshot: JsonObject): JsonObject | null {
  const hasOpenClawModelStatusShape =
    nonEmpty(snapshot.defaultModel) !== null ||
    nonEmpty(snapshot.resolvedDefault) !== null;

  if (!hasOpenClawModelStatusShape) {
    return null;
  }

  const normalized: JsonObject = {};
  const defaultModel = limitHeartbeatText(snapshot.defaultModel, MAX_OPENCLAW_STATUS_LABEL_LENGTH);
  const resolvedDefault = limitHeartbeatText(snapshot.resolvedDefault, MAX_OPENCLAW_STATUS_LABEL_LENGTH);

  if (defaultModel) {
    normalized.default_model = defaultModel;
  }
  if (resolvedDefault) {
    normalized.resolved_default = resolvedDefault;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function collectOpenClawAccessibleModels(snapshot: JsonObject): (string | JsonObject)[] {
  const aliasTargets = valueAsObject(snapshot.aliases)
    ? Object.values(valueAsObject(snapshot.aliases) ?? {})
    : [];
  const fallbacks = Array.isArray(snapshot.fallbacks) ? snapshot.fallbacks : [];
  const imageFallbacks = Array.isArray(snapshot.imageFallbacks) ? snapshot.imageFallbacks : [];
  const allowed = Array.isArray(snapshot.allowed) ? snapshot.allowed : [];

  return normalizeHeartbeatModels([
    snapshot.defaultModel,
    snapshot.resolvedDefault,
    ...fallbacks,
    snapshot.imageModel,
    ...imageFallbacks,
    ...allowed,
    ...aliasTargets
  ]);
}

function resolveOpenClawAuthSummary(auth: JsonObject | null): string | null {
  if (!auth) {
    return null;
  }

  const oauth = valueAsObject(auth.oauth);
  const oauthProfiles = Array.isArray(oauth?.profiles) ? oauth.profiles : [];
  const firstOauthProfile = valueAsObject(oauthProfiles[0]);
  const firstOauthLabel =
    nonEmpty(firstOauthProfile?.label) ??
    nonEmpty(firstOauthProfile?.profileId);

  if (oauthProfiles.length === 1 && firstOauthLabel) {
    return `oauth (${firstOauthLabel})`;
  }
  if (oauthProfiles.length > 1) {
    return `oauth (${oauthProfiles.length} profiles)`;
  }

  const providers = Array.isArray(auth.providers) ? auth.providers : [];
  const firstProvider = valueAsObject(providers[0]);
  const firstProviderName = nonEmpty(firstProvider?.provider);
  const profiles = valueAsObject(firstProvider?.profiles);
  const oauthCount = integerFromUnknown(profiles?.oauth) ?? 0;
  const tokenCount = integerFromUnknown(profiles?.token) ?? 0;
  const apiKeyCount = integerFromUnknown(profiles?.apiKey) ?? 0;

  if (oauthCount > 0) {
    return firstProviderName ? `oauth (${firstProviderName})` : "oauth";
  }
  if (tokenCount > 0) {
    return firstProviderName ? `token (${firstProviderName})` : "token";
  }
  if (apiKeyCount > 0) {
    return firstProviderName ? `api key (${firstProviderName})` : "api key";
  }

  const providersWithOAuth = Array.isArray(auth.providersWithOAuth) ? auth.providersWithOAuth : [];
  const firstProviderWithOauth = nonEmpty(providersWithOAuth[0]);
  if (firstProviderWithOauth) {
    return `oauth (${firstProviderWithOauth})`;
  }

  return null;
}

function limitHeartbeatText(value: unknown, maxLength: number): string | null {
  const text = nonEmpty(value);
  if (!text) {
    return null;
  }

  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function extractBooleanMap(source: JsonObject): JsonObject {
  const map: JsonObject = {};

  for (const [key, value] of Object.entries(source)) {
    const bool = valueAsBoolean(value);
    if (bool !== null) {
      map[key] = bool;
    }
  }

  return map;
}

function applyTextTelemetryFallbacks(target: JsonObject, snapshot: JsonObject): void {
  const fragments = collectTelemetryTextFragments(snapshot);
  if (fragments.length === 0) {
    return;
  }

  for (const fragment of fragments) {
    const line = fragment.trim();
    if (line === "") {
      continue;
    }

    const tokensMatch = line.match(/\b([\d,]+)\s*in\b[^\d]+([\d,]+)\s*out\b/i);
    if (tokensMatch) {
      setTelemetryIfMissing(target, "tokens_in", parseIntegerToken(tokensMatch[1] ?? ""));
      setTelemetryIfMissing(target, "tokens_out", parseIntegerToken(tokensMatch[2] ?? ""));
    }

    const cacheMatch = line.match(/\b([\d.]+)\s*%\s*hit\b.*?\b([\d,]+)\s*cached\b.*?\b([\d,]+)\s*new\b/i);
    if (cacheMatch) {
      setTelemetryIfMissing(target, "cache_hit_rate_percent", parseNumberToken(cacheMatch[1] ?? ""));
      setTelemetryIfMissing(target, "cache_tokens_cached", parseIntegerToken(cacheMatch[2] ?? ""));
      setTelemetryIfMissing(target, "cache_tokens_new", parseIntegerToken(cacheMatch[3] ?? ""));
    }

    const contextMatch = line.match(/\b([\d,]+)\s*\/\s*([\d,]+)\s*\(\s*([\d.]+)\s*%\s*\)/i);
    if (contextMatch) {
      setTelemetryIfMissing(target, "context_tokens_used", parseIntegerToken(contextMatch[1] ?? ""));
      setTelemetryIfMissing(target, "context_tokens_max", parseIntegerToken(contextMatch[2] ?? ""));
      setTelemetryIfMissing(target, "context_percent_used", parseNumberToken(contextMatch[3] ?? ""));
    }

    const compactionsMatch = line.match(/\bcompactions?\b\s*[:=]?\s*([\d,]+)/i);
    if (compactionsMatch) {
      setTelemetryIfMissing(target, "context_compactions", parseIntegerToken(compactionsMatch[1] ?? ""));
    }

    applyUsageLineTelemetry(target, line);

    const queueDepthMatch = line.match(/\bqueue\s*depth\b\s*[:=]?\s*([\d,]+)/i);
    if (queueDepthMatch) {
      setTelemetryIfMissing(target, "queue_depth", parseIntegerToken(queueDepthMatch[1] ?? ""));
    }

    const runtimeModeMatch = line.match(/\bruntime\b\s*[:=]?\s*([a-z0-9._-]+)/i);
    if (runtimeModeMatch) {
      setTelemetryIfMissing(target, "runtime_mode", nonEmpty(runtimeModeMatch[1] ?? ""));
    }

    const thinkingModeMatch = line.match(/\bthink(?:ing)?\b\s*[:=]?\s*([a-z0-9._-]+)/i);
    if (thinkingModeMatch) {
      setTelemetryIfMissing(target, "thinking_mode", nonEmpty(thinkingModeMatch[1] ?? ""));
    }

    const sessionMatch = line.match(/\bsession\b\s*[:=]?\s*(.+)$/i);
    if (sessionMatch) {
      const value = nonEmpty(sessionMatch[1] ?? "");
      if (value && value.toLowerCase() !== "unknown") {
        setTelemetryIfMissing(target, "session", value);
      }
    }

    const queueNameMatch = line.match(/\bqueue\b\s*[:=]?\s*([a-z0-9._:-]+)/i);
    const queueName = nonEmpty(queueNameMatch?.[1] ?? "");
    if (queueName && queueName.toLowerCase() !== "depth") {
      setTelemetryIfMissing(target, "queue", queueName);
    }

    const authMatch = line.match(/\bauth\b\s*[:=]?\s*(.+)$/i);
    if (authMatch) {
      const value = nonEmpty(authMatch[1] ?? "");
      if (value && value.toLowerCase() !== "unknown") {
        setTelemetryIfMissing(target, "auth", value);
      }
    }

    const modelMatch = line.match(/\bmodel\b\s*[:=]?\s*(.+)$/i);
    if (modelMatch && !Object.prototype.hasOwnProperty.call(target, "models")) {
      const model = nonEmpty(modelMatch[1] ?? "");
      if (model && model.toLowerCase() !== "unknown") {
        target.models = [model];
      }
    }

    for (const [tool, field] of TOOL_FIELD_PAIRS) {
      const toolMatch = line.match(new RegExp(`\\b${tool}\\b\\s*(?:tool\\b\\s*)?(on|off|true|false|1|0|yes|no)\\b`, "i"));
      if (!toolMatch) {
        continue;
      }

      const enabled = valueAsBoolean(toolMatch[1]);
      if (enabled !== null) {
        setTelemetryIfMissing(target, field, enabled);
      }
    }
  }
}

function applyStructuredUsageTelemetry(target: JsonObject, usage: JsonObject | null): void {
  if (!usage) {
    return;
  }

  const window = valueAsObject(usage.window);
  if (window) {
    setTelemetryIfMissing(target, "usage_window_percent_left", numberFromUnknown(window.percent_left));
    setTelemetryIfMissing(target, "usage_window_time_left", nonEmpty(window.time_left));
    setTelemetryIfMissing(
      target,
      "usage_window_label",
      nonEmpty(window.label) ?? nonEmpty(window.name) ?? nonEmpty(window.window)
    );
  }

  const week = valueAsObject(usage.week);
  const day = valueAsObject(usage.day);
  const secondary = week ?? day;
  if (!secondary) {
    return;
  }

  setTelemetryIfMissing(
    target,
    "usage_day_percent_left",
    numberFromUnknown(secondary.percent_left)
  );
  setTelemetryIfMissing(
    target,
    "usage_day_time_left",
    nonEmpty(secondary.time_left)
  );
  setTelemetryIfMissing(
    target,
    "usage_day_label",
    week ? "Week" : nonEmpty(secondary.label) ?? nonEmpty(secondary.name) ?? "Day"
  );
}

function applyOpenClawUsageProviderTelemetry(target: JsonObject, usage: JsonObject | null): void {
  if (!usage) {
    return;
  }

  const providers = Array.isArray(usage.providers) ? usage.providers : [];
  if (providers.length === 0) {
    return;
  }

  const preferredProvider = providers
    .map((entry) => valueAsObject(entry))
    .find((entry) => Array.isArray(entry?.windows) && entry.windows.length > 0)
    ?? null;
  if (!preferredProvider) {
    return;
  }

  const windows = Array.isArray(preferredProvider.windows) ? preferredProvider.windows : [];
  const normalizedWindows = windows
    .map((entry) => normalizeOpenClawUsageWindow(entry))
    .filter(
      (entry): entry is { label: string | null; percentLeft: number | null; timeLeft: string | null } => entry !== null
    );

  const primary = normalizedWindows[0];
  if (primary) {
    setTelemetryIfMissing(target, "usage_window_label", primary.label);
    setTelemetryIfMissing(target, "usage_window_percent_left", primary.percentLeft);
    setTelemetryIfMissing(target, "usage_window_time_left", primary.timeLeft);
  }

  const secondary = normalizedWindows[1];
  if (secondary) {
    setTelemetryIfMissing(target, "usage_day_label", secondary.label);
    setTelemetryIfMissing(target, "usage_day_percent_left", secondary.percentLeft);
    setTelemetryIfMissing(target, "usage_day_time_left", secondary.timeLeft);
  }
}

function normalizeOpenClawUsageWindow(
  value: unknown
): { label: string | null; percentLeft: number | null; timeLeft: string | null } | null {
  const window = valueAsObject(value);
  if (!window) {
    return null;
  }

  const usedPercent = numberFromUnknown(window.usedPercent);
  const percentLeft =
    numberFromUnknown(window.percent_left) ??
    numberFromUnknown(window.percentLeft) ??
    (usedPercent !== null ? Math.max(0, Math.min(100, 100 - usedPercent)) : null);
  const label = nonEmpty(window.label) ?? nonEmpty(window.name);
  const timeLeft =
    nonEmpty(window.time_left) ??
    nonEmpty(window.timeLeft) ??
    formatResetTimeLeft(window.resetAt);

  if (label === null && percentLeft === null && timeLeft === null) {
    return null;
  }

  return { label, percentLeft, timeLeft };
}

function applyUsageLineTelemetry(target: JsonObject, line: string): void {
  const normalized = line.replace(/^usage\s*:\s*/i, "").trim();
  const segments = normalized
    .split(/\s*(?:\u00b7|\|)\s*/)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "");

  if (segments.length === 0) {
    return;
  }

  const parsedSegments = segments
    .map(parseUsageSegment)
    .filter((segment): segment is { label: string | null; percent: number | null; time: string | null } => segment !== null);

  const first = parsedSegments[0];
  if (first) {
    setTelemetryIfMissing(target, "usage_window_percent_left", first.percent);
    setTelemetryIfMissing(target, "usage_window_time_left", first.time);
    setTelemetryIfMissing(target, "usage_window_label", first.label);
  }

  const second = parsedSegments[1];
  if (second) {
    setTelemetryIfMissing(target, "usage_day_percent_left", second.percent);
    setTelemetryIfMissing(target, "usage_day_time_left", second.time);
    setTelemetryIfMissing(target, "usage_day_label", second.label);
  }

  const windowPercentMatch = line.match(/\bwindow\b[^0-9]*([\d.]+)\s*%\s*left\b/i);
  if (windowPercentMatch) {
    setTelemetryIfMissing(target, "usage_window_percent_left", parseNumberToken(windowPercentMatch[1] ?? ""));
    setTelemetryIfMissing(target, "usage_window_label", "Window");
  }

  const dayOrWeekPercentMatch = line.match(/\b(day|week)\b[^0-9]*([\d.]+)\s*%\s*left\b/i);
  if (dayOrWeekPercentMatch) {
    setTelemetryIfMissing(target, "usage_day_percent_left", parseNumberToken(dayOrWeekPercentMatch[2] ?? ""));
    setTelemetryIfMissing(target, "usage_day_label", nonEmpty(dayOrWeekPercentMatch[1] ?? ""));
  }

  const windowTimeMatch = line.match(/\bwindow\b.*?@\s*(.+?)(?:\s+(?:\u00b7|\|)\s+|\s+\b(?:day|week)\b|$)/i);
  if (windowTimeMatch) {
    const value = nonEmpty(windowTimeMatch[1] ?? "");
    if (value && value.toLowerCase() !== "unknown") {
      setTelemetryIfMissing(target, "usage_window_time_left", value);
      setTelemetryIfMissing(target, "usage_window_label", "Window");
    }
  }

  const dayOrWeekTimeMatch = line.match(/\b(day|week)\b.*?@\s*(.+?)(?:\s+(?:\u00b7|\|)\s+|$)/i);
  if (dayOrWeekTimeMatch) {
    const value = nonEmpty(dayOrWeekTimeMatch[2] ?? "");
    if (value && value.toLowerCase() !== "unknown") {
      setTelemetryIfMissing(target, "usage_day_time_left", value);
      setTelemetryIfMissing(target, "usage_day_label", nonEmpty(dayOrWeekTimeMatch[1] ?? ""));
    }
  }
}

function parseUsageSegment(
  segment: string
): { label: string | null; percent: number | null; time: string | null } | null {
  const match = segment.match(/^(.*?)\s*([\d.]+)\s*%\s*left(?:\s*@\s*(.+))?$/i);
  if (!match) {
    return null;
  }

  const rawLabel = nonEmpty(match[1] ?? "");
  const label = rawLabel ? rawLabel.replace(/:$/, "").trim() : null;
  const time = nonEmpty(match[3] ?? "");

  return {
    label,
    percent: parseNumberToken(match[2] ?? ""),
    time
  };
}

const TOOL_FIELD_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["browser", "browser_tool_available"],
  ["exec", "exec_tool_available"],
  ["nodes", "nodes_tool_available"],
  ["messaging", "messaging_tool_available"],
  ["sessions", "sessions_tool_available"],
  ["memory", "memory_tool_available"]
];

function collectTelemetryTextFragments(source: JsonObject): string[] {
  const fragments: string[] = [];
  const seen = new Set<string>();

  walk(source, (value) => {
    if (typeof value !== "string") {
      return;
    }

    const trimmed = value.trim();
    if (trimmed === "" || seen.has(trimmed)) {
      return;
    }

    seen.add(trimmed);
    fragments.push(trimmed);
  });

  return fragments;
}

function setTelemetryIfMissing(target: JsonObject, field: string, value: unknown): void {
  if (value === null || value === undefined) {
    return;
  }

  if (Object.prototype.hasOwnProperty.call(target, field)) {
    return;
  }

  target[field] = value;
}

function parseNumberToken(value: string): number | null {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/,/g, "");

  if (cleaned === "") {
    return null;
  }

  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseIntegerToken(value: string): number | null {
  const parsed = parseNumberToken(value);
  if (parsed === null) {
    return null;
  }

  return Math.trunc(parsed);
}

function sanitizeTelemetryStringFields(target: JsonObject): void {
  const session = nonEmpty(target.session);
  if (session) {
    target.session = stripTelemetryLabel(session, "session");
  }

  const auth = nonEmpty(target.auth);
  if (auth) {
    target.auth = stripTelemetryLabel(auth, "auth");
  }
}

function applyOpenClawSessionTelemetry(target: JsonObject, snapshot: JsonObject, openclawAgent: string | null): void {
  const session = selectOpenClawSessionSnapshot(snapshot, openclawAgent);
  if (!session) {
    return;
  }

  const totalTokens = integerFromUnknown(session.totalTokens);
  const outputTokens = integerFromUnknown(session.outputTokens);
  const cacheRead = integerFromUnknown(session.cacheRead);
  const cacheWrite = integerFromUnknown(session.cacheWrite);
  const contextTokens = integerFromUnknown(session.contextTokens);
  const percentUsed =
    numberFromUnknown(session.percentUsed) ??
    (totalTokens !== null && contextTokens !== null && contextTokens > 0
      ? Number(((totalTokens / contextTokens) * 100).toFixed(2))
      : null);

  if (totalTokens !== null) {
    target.tokens_in = totalTokens;
    target.context_tokens_used = totalTokens;
  }
  if (outputTokens !== null) {
    target.tokens_out = outputTokens;
  }
  if (contextTokens !== null) {
    target.context_tokens_max = contextTokens;
  }
  if (percentUsed !== null) {
    target.context_percent_used = percentUsed;
  }
  if (cacheRead !== null) {
    target.cache_tokens_cached = cacheRead;
  }
  if (cacheWrite !== null) {
    target.cache_tokens_new = cacheWrite;
  }
  if (
    !Object.prototype.hasOwnProperty.call(target, "cache_hit_rate_percent")
    && cacheRead !== null
    && totalTokens !== null
    && totalTokens > 0
  ) {
    target.cache_hit_rate_percent = Math.max(0, Math.min(100, Math.round((cacheRead / totalTokens) * 100)));
  }

  const runtimeMode = nonEmpty(session.kind);
  if (runtimeMode) {
    target.runtime_mode = runtimeMode;
  }

  const sessionKey = nonEmpty(session.key) ?? nonEmpty(session.sessionId);
  if (sessionKey) {
    target.session = sessionKey;
  }
}

function selectOpenClawSessionSnapshot(snapshot: JsonObject, openclawAgent: string | null): JsonObject | null {
  const sessions = valueAsObject(snapshot.sessions);
  if (!sessions) {
    return null;
  }

  const normalizedAgent = nonEmpty(openclawAgent)?.toLowerCase() ?? null;
  const candidates: JsonObject[] = [];

  const byAgent = Array.isArray(sessions.byAgent) ? sessions.byAgent : [];
  for (const entry of byAgent) {
    const byAgentEntry = valueAsObject(entry);
    if (!byAgentEntry) {
      continue;
    }

    const agentId = nonEmpty(byAgentEntry.agentId)?.toLowerCase() ?? null;
    if (normalizedAgent && agentId && agentId !== normalizedAgent) {
      continue;
    }

    const recent = Array.isArray(byAgentEntry.recent) ? byAgentEntry.recent : [];
    for (const row of recent) {
      const session = valueAsObject(row);
      if (session) {
        candidates.push(session);
      }
    }
  }

  if (candidates.length === 0) {
    const recent = Array.isArray(sessions.recent) ? sessions.recent : [];
    for (const row of recent) {
      const session = valueAsObject(row);
      if (!session) {
        continue;
      }

      const agentId = nonEmpty(session.agentId)?.toLowerCase() ?? null;
      if (normalizedAgent && agentId && agentId !== normalizedAgent) {
        continue;
      }

      candidates.push(session);
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    const rightUpdatedAt = integerFromUnknown(right.updatedAt) ?? 0;
    const leftUpdatedAt = integerFromUnknown(left.updatedAt) ?? 0;
    return rightUpdatedAt - leftUpdatedAt;
  });

  return candidates[0] ?? null;
}

function formatResetTimeLeft(value: unknown): string | null {
  const resetAt = integerFromUnknown(value);
  if (resetAt === null) {
    return null;
  }

  const deltaMs = Math.max(0, resetAt - Date.now());
  const totalMinutes = Math.floor(deltaMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];

  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0 || parts.length === 0) {
    parts.push(`${minutes}m`);
  }

  return parts.slice(0, 2).join(" ");
}

function stripTelemetryLabel(value: string, label: string): string {
  const stripped = value.replace(new RegExp(`^${label}\\s*[:=]\\s*`, "i"), "").trim();
  return stripped === "" ? value : stripped;
}

function numberFromUnknown(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function integerFromUnknown(value: unknown): number | null {
  const parsed = numberFromUnknown(value);
  if (parsed === null) {
    return null;
  }

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.trunc(parsed);
}

function assignIntegerTelemetryField(
  target: JsonObject,
  field: string,
  lookup: Map<string, unknown[]>,
  keys: readonly string[]
): void {
  const value = integerFromUnknown(firstValueFromLookup(lookup, keys));
  if (value !== null) {
    target[field] = value;
  }
}

function assignNumberTelemetryField(
  target: JsonObject,
  field: string,
  lookup: Map<string, unknown[]>,
  keys: readonly string[]
): void {
  const value = numberFromUnknown(firstValueFromLookup(lookup, keys));
  if (value !== null) {
    target[field] = value;
  }
}

function assignStringTelemetryField(
  target: JsonObject,
  field: string,
  lookup: Map<string, unknown[]>,
  keys: readonly string[]
): void {
  const value = nonEmpty(firstValueFromLookup(lookup, keys));
  if (value) {
    target[field] = value;
  }
}

function assignBooleanTelemetryField(
  target: JsonObject,
  field: string,
  lookup: Map<string, unknown[]>,
  keys: readonly string[]
): void {
  const value = valueAsBoolean(firstValueFromLookup(lookup, keys));
  if (value !== null) {
    target[field] = value;
  }
}

function extractModelStrings(value: unknown): string[] {
  const found = new Set<string>();
  const modelScalarKeys = new Set([
    "model",
    "modelid",
    "model_id",
    "modelname",
    "model_name",
    "primary",
    "default",
    "defaultmodel",
    "resolveddefault"
  ]);
  const modelCollectionKeys = new Set([
    "allowed",
    "models",
    "fallbacks",
    "availablemodels",
    "modelinventory",
    "runtime_models",
    "runtimemodels"
  ]);
  const modelCollectionFieldKeys = new Set([
    "id",
    "model",
    "modelid",
    "model_id",
    "name",
    "key",
    "slug",
    "identifier"
  ]);

  const addCandidate = (candidate: string): void => {
    const trimmed = candidate.trim();
    if (trimmed !== "") {
      found.add(trimmed);
    }
  };

  const isLikelyModelIdentifier = (candidate: string): boolean => {
    const text = candidate.trim();
    if (text === "" || text.length > 200 || /\s/.test(text)) {
      return false;
    }

    if (text.includes("/")) {
      return true;
    }

    return /(?:gpt|claude|gemini|llama|mistral|qwen|deepseek|sonnet|haiku|opus|o[134])/.test(text.toLowerCase());
  };

  const visit = (node: unknown, path: string[]): void => {
    if (typeof node === "string") {
      const normalizedKey = normalizeLookupKey(path[path.length - 1] ?? "");
      const inModelCollection = path
        .slice(0, -1)
        .some((segment) => modelCollectionKeys.has(normalizeLookupKey(segment)));

      if (modelScalarKeys.has(normalizedKey)) {
        addCandidate(node);
        return;
      }

      if (
        inModelCollection &&
        (modelCollectionFieldKeys.has(normalizedKey) || isLikelyModelIdentifier(node))
      ) {
        addCandidate(node);
      }
      return;
    }

    if (Array.isArray(node)) {
      node.forEach((item, index) => {
        visit(item, [...path, String(index)]);
      });
      return;
    }

    const object = valueAsObject(node);
    if (!object) {
      return;
    }

    for (const [key, child] of Object.entries(object)) {
      visit(child, [...path, key]);
    }
  };

  visit(value, []);

  return Array.from(found);
}

function walk(value: unknown, visit: (value: unknown, key: string | number | null) => void, key: string | number | null = null): void {
  visit(value, key);

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      walk(value[index], visit, index);
    }
    return;
  }

  if (value && typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value as JsonObject)) {
      walk(childValue, visit, childKey);
    }
  }
}

function parseJsonUnknown(value: string): unknown | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const firstLine = firstNonEmptyLine(trimmed);
    if (!firstLine) {
      return null;
    }

    try {
      return JSON.parse(firstLine);
    } catch {
      return null;
    }
  }
}

function requireNonEmpty(value: unknown, fieldName: string): string {
  const resolved = nonEmpty(value);
  if (!resolved) {
    throw new Error(`${fieldName} is required.`);
  }

  return resolved;
}

function nonEmpty(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

function toPositiveInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
}

function firstNonEmptyLine(value: string): string | null {
  const lines = String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");

  return lines[0] ?? null;
}

function extractVersionToken(line: string): string | null {
  const match = line.match(/\b\d+\.\d+(?:\.\d+)?(?:[-+][A-Za-z0-9._-]+)?\b/);
  return match?.[0] ?? null;
}

function extractBuildToken(line: string): string | null {
  const paren = line.match(/\(([A-Za-z0-9._-]{5,})\)/);
  if (paren?.[1]) {
    return paren[1];
  }

  const hash = line.match(/\b[a-f0-9]{7,40}\b/i);
  return hash?.[0] ?? null;
}

function valueAsObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as JsonObject;
}

function valueAsBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  return null;
}

function createOperationFailureError(
  operationId: string,
  response: { status: number; error?: unknown }
): Error {
  const summary = summarizeApiError(response.error);
  const suffix = summary ? ` (${summary})` : "";
  return new Error(`${operationId} failed with status ${response.status}${suffix}.`);
}

async function readJsonResponseObject(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return valueAsObject(await response.clone().json());
  } catch {
    return null;
  }
}

function summarizeApiError(error: unknown): string | null {
  const payload = valueAsObject(error);
  const root = valueAsObject(payload?.error) ?? payload;
  const code = nonEmpty(root?.code);
  const message = nonEmpty(root?.message);

  if (code && message) {
    return `${code}: ${message}`;
  }

  if (message) {
    return message;
  }

  return code;
}

function describeRealtimeSignalEvent(event: {
  sessionId: number;
  source: string;
  signal: unknown;
}): { message: string; meta: JsonObject } | null {
  const signal = valueAsObject(event.signal);
  const envelope = valueAsObject(signal?.payload);
  const payload = valueAsObject(envelope?.payload);
  const notification = valueAsObject(payload?.notification);
  const messageId = toPositiveInt(payload?.message_id ?? payload?.queued_message_id);
  const channelType = nonEmpty(envelope?.type);

  if (channelType === "chat.agent.delta" || channelType === "chat.agent.done") {
    return null;
  }

  if (channelType === "chat.user" || channelType === "chat.request") {
    return null;
  }

  if (channelType && channelType.startsWith("notification.")) {
    return null;
  }

  return {
    message: "Realtime signal received",
    meta: compactJsonObject({
      session_id: event.sessionId,
      source: nonEmpty(event.source),
      signal_id: toPositiveInt(signal?.id),
      signal_type: nonEmpty(signal?.type),
      sender: nonEmpty(signal?.sender),
      channel_type: channelType,
      request_id: nonEmpty(payload?.request_id) ?? nonEmpty(envelope?.request_id),
      message_id: messageId,
      notification_id: nonEmpty(notification?.id),
      created_at: nonEmpty(signal?.created_at)
    })
  };
}

function summarizeRealtimeNotificationEvent(event: {
  sessionId: number;
  source: string;
  signal: unknown;
  notification: unknown;
  notificationType: string | null;
  channelType: string | null;
}): JsonObject {
  const notification = valueAsObject(event.notification);
  const signal = valueAsObject(event.signal);

  return compactJsonObject({
    session_id: event.sessionId,
    source: nonEmpty(event.source),
    signal_id: toPositiveInt(signal?.id),
    channel_type: nonEmpty(event.channelType),
    notification_id: nonEmpty(notification?.id),
    notification_type: nonEmpty(event.notificationType) ?? nonEmpty(notification?.notification_type),
    is_read: valueAsBoolean(notification?.is_read)
  });
}

function summarizeRealtimeNotificationBridgeEvent(event: {
  sessionId: number;
  source: string;
  signal: unknown;
  notification: unknown;
  notificationType: string | null;
  channelType: string | null;
  requestId: string;
  run: {
    runId: string;
    status: string;
    textSource: string;
  };
}): JsonObject {
  const notification = valueAsObject(event.notification);
  const signal = valueAsObject(event.signal);

  return compactJsonObject({
    session_id: event.sessionId,
    source: nonEmpty(event.source),
    signal_id: toPositiveInt(signal?.id),
    channel_type: nonEmpty(event.channelType),
    notification_id: nonEmpty(notification?.id),
    notification_type: nonEmpty(event.notificationType) ?? nonEmpty(notification?.notification_type),
    request_id: nonEmpty(event.requestId),
    run_id: nonEmpty(event.run?.runId),
    status: nonEmpty(event.run?.status),
    text_source: nonEmpty(event.run?.textSource)
  });
}

function summarizeRealtimeUnhandledMessageEvent(event: {
  sessionId: number;
  source: string;
  signal: unknown;
  channelType: string | null;
}): JsonObject {
  const signal = valueAsObject(event.signal);

  return compactJsonObject({
    session_id: event.sessionId,
    source: nonEmpty(event.source),
    signal_id: toPositiveInt(signal?.id),
    signal_type: nonEmpty(signal?.type),
    sender: nonEmpty(signal?.sender),
    channel_type: nonEmpty(event.channelType)
  });
}

function describeRealtimeRuntimeDebugEvent(event: {
  event: string;
  details: unknown;
}): { message: string; meta: JsonObject } | null {
  const details = valueAsObject(event.details) ?? {};

  if (event.event === "chat.message.received") {
    return {
      message: "Chat message received",
      meta: compactJsonObject({
        session_id: toPositiveInt(details.session_id),
        request_id: nonEmpty(details.request_id),
        message_id: toPositiveInt(details.message_id),
        signal_id: toPositiveInt(details.signal_id),
        content_length: toPositiveInt(details.content_length),
        preview: nonEmpty(details.preview)
      })
    };
  }

  if (event.event === "chat.agent.dispatched") {
    return {
      message: "Sent chat message to agent",
      meta: compactJsonObject({
        session_id: toPositiveInt(details.session_id),
        request_id: nonEmpty(details.request_id),
        message_id: toPositiveInt(details.message_id),
        signal_id: toPositiveInt(details.signal_id),
        runtime_source: nonEmpty(details.runtime_source)
      })
    };
  }

  if (event.event === "chat.agent.completed") {
    return {
      message: "Agent finished response",
      meta: compactJsonObject({
        session_id: toPositiveInt(details.session_id),
        request_id: nonEmpty(details.request_id),
        message_id: toPositiveInt(details.message_id),
        run_id: nonEmpty(details.run_id),
        status: nonEmpty(details.status),
        text_source: nonEmpty(details.text_source),
        content_length: toPositiveInt(details.content_length),
        preview: nonEmpty(details.preview)
      })
    };
  }

  if (event.event === "chat.reply.sent") {
    return {
      message: "Sent agent reply to user",
      meta: compactJsonObject({
        session_id: toPositiveInt(details.session_id),
        request_id: nonEmpty(details.request_id),
        message_id: toPositiveInt(details.message_id),
        run_id: nonEmpty(details.run_id),
        status: nonEmpty(details.status),
        text_source: nonEmpty(details.text_source)
      })
    };
  }

  return null;
}

function compactJsonObject(value: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined));
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return new Error(formatErrorMessage(error));
  }

  const objectValue = valueAsObject(error);
  const root = valueAsObject(objectValue?.error) ?? objectValue;
  const data = valueAsObject(root?.data);
  const baseMessage =
    nonEmpty(root?.message) ??
    nonEmpty(data?.message) ??
    String(error);
  const details = extractErrorDetails(root, data);

  return details.length > 0
    ? new Error(`${baseMessage} (${details.join(", ")})`)
    : new Error(baseMessage);
}

function formatErrorMessage(error: Error): string {
  const baseMessage = nonEmpty(error.message) ?? "Unexpected runtime error.";
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

    const code = nonEmpty(source.code);
    if (code) {
      details.add(`code=${code}`);
    }

    const errno = nonEmpty(source.errno);
    if (errno) {
      details.add(`errno=${errno}`);
    }

    const syscall = nonEmpty(source.syscall);
    if (syscall) {
      details.add(`syscall=${syscall}`);
    }

    const address = nonEmpty(source.address);
    if (address) {
      details.add(`address=${address}`);
    }

    const message = nonEmpty(source.message);
    if (message) {
      details.add(`cause=${message}`);
    }
  }

  return Array.from(details);
}
