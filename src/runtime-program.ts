import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, statfs, writeFile } from "node:fs/promises";
import { arch, cpus, hostname, networkInterfaces, platform, release, totalmem, uptime } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

import { AgentMCApi } from "./client";
import { AgentRuntime, type AgentRuntimeRunInput, type AgentRuntimeRunResult } from "./openclaw-runtime";
import type { RequestOptionsById } from "./types";

const execFileAsync = promisify(execFile);
const OPENCLAW_TELEMETRY_COMMAND_CANDIDATES: readonly string[][] = [
  ["status", "--json", "--usage"],
  ["status", "--json"],
  ["health", "--json"]
];
const OPENCLAW_MODELS_TELEMETRY_COMMAND: readonly string[] = ["models", "status", "--json"];
const OPENCLAW_TELEMETRY_TIMEOUT_MS = 4_000;

type JsonObject = Record<string, unknown>;

type RuntimeProviderKind = "openclaw" | "external";

type HeartbeatBody = NonNullable<RequestOptionsById<"agentHeartbeat">["body"]>;

interface RuntimeProviderDescriptor {
  kind: RuntimeProviderKind;
  name: string;
  version: string;
  build: string | null;
  mode: string;
  models: string[];
  runAgent?: (input: AgentRuntimeRunInput) => Promise<AgentRuntimeRunResult>;
}

export interface AgentRuntimeProgramOptions {
  client?: AgentMCApi;
  baseUrl?: string;
  apiKey?: string;
  workspaceDir?: string;
  statePath?: string;
  agentId?: number;
  heartbeatIntervalSeconds?: number;
  runtimeProvider?: "auto" | RuntimeProviderKind;
  runtimeCommand?: string;
  runtimeCommandArgs?: readonly string[];
  runtimeVersionCommand?: string;
  runtimeModels?: readonly string[];
  openclawCommand?: string;
  openclawAgent?: string;
  openclawSessionsPath?: string;
  publicIp?: string;
  publicIpEndpoint?: string;
  hostFingerprint?: string;
  hostName?: string;
  onInfo?: (message: string, meta?: JsonObject) => void;
  onError?: (error: Error, meta?: JsonObject) => void;
}

interface RuntimeState {
  agent_id?: number;
  bundle_version?: string;
  last_skill_sync_at?: string;
  last_heartbeat_at?: string;
  [key: string]: unknown;
}

interface AgentProfile {
  id: number;
  name: string;
  type: string;
  identity: JsonObject | string;
}

export class AgentRuntimeProgram {
  private readonly options: AgentRuntimeProgramOptions;
  private readonly workspaceDir: string;
  private readonly statePath: string;

  private readonly client: AgentMCApi;
  private readonly initialAgentId: number | null;

  private running = false;
  private stopRequested = false;
  private loopPromise: Promise<void> | null = null;
  private realtimeRuntime: AgentRuntime | null = null;

  private state: RuntimeState = {};
  private runtimeProvider: RuntimeProviderDescriptor | null = null;
  private agentProfile: AgentProfile | null = null;
  private heartbeatIntervalSeconds: number | null;
  private cachedOpenClawTelemetryCommandArgs: string[] | null = null;
  private lastOpenClawTelemetryError: string | null = null;

  constructor(options: AgentRuntimeProgramOptions = {}) {
    this.options = options;
    this.workspaceDir = resolve(options.workspaceDir ?? process.cwd());
    this.statePath = resolve(options.statePath ?? resolve(this.workspaceDir, ".agentmc/state.json"));
    this.initialAgentId = toPositiveInt(options.agentId);
    this.heartbeatIntervalSeconds = toPositiveInt(options.heartbeatIntervalSeconds);

    if (options.client) {
      this.client = options.client;
    } else {
      const apiKey = requireNonEmpty(options.apiKey, "options.apiKey");
      const baseUrl = normalizeApiBaseUrl(requireNonEmpty(options.baseUrl, "options.baseUrl"));
      this.client = new AgentMCApi({
        baseUrl,
        apiKey
      });
    }
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): AgentRuntimeProgram {
    const baseUrl = requireNonEmpty(env.AGENTMC_BASE_URL, "AGENTMC_BASE_URL");
    const apiKey = requireNonEmpty(env.AGENTMC_API_KEY, "AGENTMC_API_KEY");

    const runtimeCommandArgs = parseRuntimeCommandArgs(env.AGENTMC_RUNTIME_COMMAND_ARGS);

    return new AgentRuntimeProgram({
      baseUrl,
      apiKey,
      workspaceDir: env.AGENTMC_WORKSPACE_DIR,
      statePath: env.AGENTMC_STATE_PATH,
      agentId: toPositiveInt(env.AGENTMC_AGENT_ID) ?? undefined,
      heartbeatIntervalSeconds: toPositiveInt(env.AGENTMC_HEARTBEAT_INTERVAL_SECONDS) ?? undefined,
      runtimeProvider: normalizeRuntimeProvider(env.AGENTMC_RUNTIME_PROVIDER),
      runtimeCommand: nonEmpty(env.AGENTMC_RUNTIME_COMMAND) ?? undefined,
      runtimeCommandArgs,
      runtimeVersionCommand: nonEmpty(env.AGENTMC_RUNTIME_VERSION_COMMAND) ?? undefined,
      runtimeModels: parseCsv(env.AGENTMC_MODELS),
      openclawCommand: nonEmpty(env.OPENCLAW_CMD) ?? undefined,
      openclawAgent: nonEmpty(env.OPENCLAW_AGENT) ?? undefined,
      openclawSessionsPath: nonEmpty(env.OPENCLAW_SESSIONS_PATH) ?? undefined,
      publicIp: nonEmpty(env.AGENTMC_PUBLIC_IP) ?? undefined,
      publicIpEndpoint: nonEmpty(env.AGENTMC_PUBLIC_IP_ENDPOINT) ?? undefined,
      hostFingerprint: nonEmpty(env.AGENTMC_HOST_FINGERPRINT) ?? undefined,
      hostName: nonEmpty(env.AGENTMC_HOSTNAME) ?? undefined
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

  private async runLoop(): Promise<void> {
    await this.loadState();

    const bootstrapSync = await this.syncInstructionBundle();
    if (bootstrapSync.heartbeatIntervalSeconds !== null) {
      this.heartbeatIntervalSeconds = bootstrapSync.heartbeatIntervalSeconds;
    }
    if (!this.heartbeatIntervalSeconds || this.heartbeatIntervalSeconds < 1) {
      throw new Error(
        "Heartbeat interval is missing. Set AGENTMC_HEARTBEAT_INTERVAL_SECONDS or ensure instructions defaults.heartbeat_interval_seconds is provided."
      );
    }

    const agentId = this.resolveAgentId(bootstrapSync.agentId);
    this.runtimeProvider = await this.resolveRuntimeProvider();
    this.agentProfile = await this.resolveAgentProfile(agentId);

    await this.startRealtimeRuntime(agentId, this.runtimeProvider);
    let skipNextLoopHeartbeat = false;

    try {
      const heartbeatBody = await this.buildHeartbeatBody();
      await this.sendHeartbeat(heartbeatBody);
      skipNextLoopHeartbeat = true;
    } catch (error) {
      this.emitError(normalizeError(error), { source: "heartbeat.startup" });
    }

    while (!this.stopRequested) {
      const cycleStartedAt = Date.now();
      try {
        const syncResult = await this.syncInstructionBundle();
        if (syncResult.heartbeatIntervalSeconds !== null) {
          this.heartbeatIntervalSeconds = syncResult.heartbeatIntervalSeconds;
        }

        if (syncResult.changed) {
          await this.restartRealtimeRuntime(agentId, this.runtimeProvider);
        }

        if (skipNextLoopHeartbeat) {
          skipNextLoopHeartbeat = false;
        } else {
          const heartbeatBody = await this.buildHeartbeatBody();
          await this.sendHeartbeat(heartbeatBody);
        }
      } catch (error) {
        this.emitError(normalizeError(error), { source: "heartbeat.cycle" });
      }

      const elapsedMs = Date.now() - cycleStartedAt;
      const heartbeatIntervalSeconds = this.heartbeatIntervalSeconds ?? 1;
      const waitMs = Math.max(250, heartbeatIntervalSeconds * 1000 - elapsedMs);
      await sleep(waitMs);
    }
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

  private resolveAgentId(agentIdFromInstructions?: number | null): number {
    const fromState = toPositiveInt(this.state.agent_id);
    const resolved = this.initialAgentId ?? fromState ?? agentIdFromInstructions ?? null;

    if (!resolved || resolved < 1) {
      throw new Error(
        `Agent id is missing. Set AGENTMC_AGENT_ID or ensure ${this.statePath} includes a valid agent_id.`
      );
    }

    if (fromState !== resolved) {
      this.state.agent_id = resolved;
    }

    return resolved;
  }

  private async resolveRuntimeProvider(): Promise<RuntimeProviderDescriptor> {
    const configured = this.options.runtimeProvider ?? "auto";

    if (configured === "external") {
      return this.resolveExternalProvider(true);
    }

    if (configured === "openclaw") {
      return this.resolveOpenClawProvider(true);
    }

    try {
      return await this.resolveOpenClawProvider(false);
    } catch (openclawError) {
      this.emitInfo("OpenClaw auto-detect skipped", {
        reason: normalizeError(openclawError).message
      });
    }

    return this.resolveExternalProvider(true);
  }

  private async resolveOpenClawProvider(strict: boolean): Promise<RuntimeProviderDescriptor> {
    const command = nonEmpty(this.options.openclawCommand) ?? "openclaw";
    const commandExists = await canExecute(command, ["--version"]);

    if (!commandExists) {
      throw new Error(`OpenClaw command is not available: ${command}`);
    }

    const versionOutput = await execCapture(command, ["--version"]);
    const versionLine = firstNonEmptyLine(versionOutput.stdout) ?? firstNonEmptyLine(versionOutput.stderr);

    if (!versionLine) {
      throw new Error("Unable to resolve OpenClaw version output.");
    }

    const version = extractVersionToken(versionLine) ?? versionLine.trim();
    const build = extractBuildToken(versionLine);

    const models = await this.resolveOpenClawModels(command);

    if (strict && models.length === 0) {
      throw new Error("OpenClaw model inventory is empty. Set AGENTMC_MODELS or configure models in OpenClaw.");
    }

    return {
      kind: "openclaw",
      name: "openclaw",
      version,
      build,
      mode: "openclaw",
      models
    };
  }

  private async resolveOpenClawModels(command: string): Promise<string[]> {
    const fromEnv = normalizeModelList(this.options.runtimeModels ?? []);
    if (fromEnv.length > 0) {
      return fromEnv;
    }

    try {
      const output = await execCapture(command, ["models", "status", "--json"]);
      const parsed = parseJsonObject(output.stdout);
      return normalizeModelList(extractModelStrings(parsed));
    } catch {
      return [];
    }
  }

  private resolveExternalProvider(strict: boolean): RuntimeProviderDescriptor {
    const runtimeCommand = nonEmpty(this.options.runtimeCommand);
    if (!runtimeCommand) {
      throw new Error("External runtime mode requires AGENTMC_RUNTIME_COMMAND.");
    }

    const versionCommand = nonEmpty(this.options.runtimeVersionCommand) ?? runtimeCommand;
    const versionArgs = versionCommand === runtimeCommand ? ["--version"] : [];

    const versionText = this.readCommandVersion(versionCommand, versionArgs);
    const runtimeName = nonEmpty(process.env.AGENTMC_RUNTIME_NAME) ?? basename(runtimeCommand);
    const runtimeVersion = versionText ?? nonEmpty(process.env.AGENTMC_RUNTIME_VERSION);
    const runtimeBuild = nonEmpty(process.env.AGENTMC_RUNTIME_BUILD);

    if (!runtimeVersion) {
      throw new Error(
        "Unable to resolve runtime version for external provider. Set AGENTMC_RUNTIME_VERSION or provide a runnable --version command."
      );
    }

    const models = normalizeModelList(this.options.runtimeModels ?? []);
    if (strict && models.length === 0) {
      throw new Error("External runtime mode requires AGENTMC_MODELS with at least one model identifier.");
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

        const result = await execCapture(runtimeCommand, [...runtimeArgs, "--agentmc-input", payload]);
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

  private async resolveAgentProfile(agentId: number): Promise<AgentProfile> {
    const listed = await this.resolveAgentProfileFromApi(agentId);
    if (listed) {
      return listed;
    }

    const envName = nonEmpty(process.env.AGENTMC_AGENT_NAME);
    const envType = nonEmpty(process.env.AGENTMC_AGENT_TYPE);

    if (!envName || !envType) {
      throw new Error(
        "Unable to resolve agent profile. Ensure listAgents is accessible or set AGENTMC_AGENT_NAME and AGENTMC_AGENT_TYPE."
      );
    }

    const identity = this.resolveIdentityFromWorkspace(envName);

    return {
      id: agentId,
      name: envName,
      type: envType,
      identity
    };
  }

  private async resolveAgentProfileFromApi(agentId: number): Promise<AgentProfile | null> {
    try {
      const response = await this.client.operations.listAgents({
        params: {
          query: {
            per_page: 200
          }
        }
      });

      if (response.error) {
        return null;
      }

      const items = Array.isArray(response.data?.data) ? response.data.data : [];
      const matched = items.find((entry) => toPositiveInt((entry as JsonObject)?.id) === agentId) as JsonObject | undefined;
      if (!matched) {
        return null;
      }

      const name = nonEmpty(matched.name) ?? null;
      const type = nonEmpty(matched.type) ?? null;

      if (!name || !type) {
        return null;
      }

      const identityFromMeta = valueAsObject((matched.meta as JsonObject | undefined)?.identity);
      const identity = identityFromMeta ?? this.resolveIdentityFromWorkspace(name);

      return {
        id: agentId,
        name,
        type,
        identity
      };
    } catch {
      return null;
    }
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
    const runtime = new AgentRuntime({
      client: this.client,
      agent: agentId,
      runtimeDocsDirectory: this.workspaceDir,
      openclawCommand: this.options.openclawCommand,
      openclawAgent: this.options.openclawAgent,
      openclawSessionsPath: this.options.openclawSessionsPath,
      runAgent: provider.runAgent,
      runtimeSource: "agent-runtime",
      onError: (error) => {
        this.emitError(error, { source: "realtime.runtime" });
      },
      onSessionReady: (session) => {
        this.emitInfo("Realtime session ready", { session_id: session.id });
      },
      onSessionClosed: (sessionId, reason) => {
        this.emitInfo("Realtime session closed", { session_id: sessionId, reason });
      }
    });

    this.realtimeRuntime = runtime;
    await runtime.start();

    this.emitInfo("Realtime runtime started", {
      provider: provider.kind,
      status: runtime.getStatus()
    });
  }

  private async restartRealtimeRuntime(agentId: number, provider: RuntimeProviderDescriptor): Promise<void> {
    if (this.realtimeRuntime) {
      await this.realtimeRuntime.stop();
      this.realtimeRuntime = null;
    }

    await this.startRealtimeRuntime(agentId, provider);
  }

  private async syncInstructionBundle(): Promise<{ changed: boolean; heartbeatIntervalSeconds: number | null; agentId: number | null }> {
    const currentBundleVersion = nonEmpty(this.state.bundle_version) ?? undefined;

    const response = await this.client.operations.getAgentInstructions({
      params: {
        query: {
          current_bundle_version: currentBundleVersion
        }
      }
    });

    if (response.error) {
      throw new Error(`getAgentInstructions failed with status ${response.status}.`);
    }

    const payload = valueAsObject(response.data) ?? {};
    const changed = valueAsBoolean(payload.changed) === true;
    const bundleVersion = nonEmpty(payload.bundle_version);
    const responseAgent = valueAsObject(payload.agent);
    const responseAgentId = toPositiveInt(responseAgent?.id ?? null);

    const defaults = valueAsObject(payload.defaults);
    const heartbeatIntervalSeconds = toPositiveInt(defaults?.heartbeat_interval_seconds ?? null);

    if (changed) {
      const files = Array.isArray(payload.files) ? payload.files : [];
      for (const file of files) {
        const row = valueAsObject(file);
        const relativePath = nonEmpty(row?.path);
        const content = typeof row?.content === "string" ? row.content : null;
        if (!relativePath || content === null) {
          continue;
        }

        await this.writeManagedFile(relativePath, content);
      }
    }

    await this.persistState({
      agent_id: responseAgentId ?? this.state.agent_id,
      bundle_version: bundleVersion ?? this.state.bundle_version,
      last_skill_sync_at: new Date().toISOString()
    });

    return {
      changed,
      heartbeatIntervalSeconds: heartbeatIntervalSeconds ?? null,
      agentId: responseAgentId ?? null
    };
  }

  private async writeManagedFile(relativePath: string, content: string): Promise<void> {
    const destination = resolve(this.workspaceDir, relativePath);
    const normalizedWorkspace = ensureTrailingSlash(this.workspaceDir);
    const normalizedDestination = destination;

    if (!normalizedDestination.startsWith(normalizedWorkspace) && normalizedDestination !== this.workspaceDir) {
      throw new Error(`Refusing to write managed file outside workspace: ${relativePath}`);
    }

    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content, "utf8");
  }

  private async resolveRuntimeHeartbeatTelemetry(provider: RuntimeProviderDescriptor): Promise<JsonObject> {
    if (provider.kind !== "openclaw") {
      return {};
    }

    return this.resolveOpenClawHeartbeatTelemetry(provider);
  }

  private async resolveOpenClawHeartbeatTelemetry(provider: RuntimeProviderDescriptor): Promise<JsonObject> {
    const command = nonEmpty(this.options.openclawCommand) ?? "openclaw";
    const snapshots = await this.loadOpenClawTelemetrySnapshots(command);
    if (snapshots.length === 0) {
      return {};
    }

    const telemetry: JsonObject = {};
    for (const snapshot of snapshots) {
      mergeHeartbeatTelemetry(telemetry, extractHeartbeatTelemetryFromRuntimeSnapshot(snapshot));
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

    try {
      const output = await execCapture(command, OPENCLAW_MODELS_TELEMETRY_COMMAND, {
        timeoutMs: OPENCLAW_TELEMETRY_TIMEOUT_MS
      });
      const parsed = parseJsonUnknown(output.stdout) ?? parseJsonUnknown(output.stderr);
      const object = valueAsObject(parsed);
      if (object) {
        snapshots.push(object);
      }
    } catch (error) {
      errors.push(
        `${OPENCLAW_MODELS_TELEMETRY_COMMAND.join(" ")}: ${normalizeError(error).message}`
      );
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

    const fallbackModels = provider.models.length > 0
      ? provider.models
      : normalizeModelList(this.options.runtimeModels ?? []);
    const runtimeModels = normalizeHeartbeatModels(runtimeTelemetry.models);
    const models = runtimeModels.length > 0 ? runtimeModels : fallbackModels;

    if (models.length === 0) {
      const guidance = provider.kind === "openclaw"
        ? "Set AGENTMC_MODELS (comma-separated) or configure OpenClaw models so `openclaw models status --json` returns at least one model."
        : "Set AGENTMC_MODELS (comma-separated) with at least one runtime model identifier.";
      throw new Error(`Heartbeat requires runtime model inventory in meta.models. ${guidance}`);
    }

    const runtimeStatus = this.realtimeRuntime?.getStatus();

    const heartbeatMeta: JsonObject = {
      runtime: {
        name: provider.name,
        version: runtimeVersion,
        ...(runtimeBuild ? { build: runtimeBuild } : {})
      },
      models,
      runtime_mode: provider.mode,
      node_version: process.version,
      tool_availability: {
        chat_realtime: runtimeStatus?.chatRealtimeEnabled ?? false,
        docs_realtime: runtimeStatus?.docsRealtimeEnabled ?? false,
        notifications_realtime: runtimeStatus?.notificationsRealtimeEnabled ?? false
      }
    };

    if (provider.kind === "openclaw") {
      heartbeatMeta.openclaw_version = runtimeVersion;
      heartbeatMeta.openclaw_build = runtimeBuild ?? runtimeVersion;
    }

    for (const [key, value] of Object.entries(runtimeTelemetry)) {
      if (key === "models") {
        continue;
      }
      heartbeatMeta[key] = value;
    }

    return {
      status: "online",
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
      agent: {
        id: profile.id,
        name: profile.name,
        type: profile.type,
        identity: profile.identity as HeartbeatBody["agent"]["identity"]
      }
    };
  }

  private async sendHeartbeat(body: HeartbeatBody): Promise<void> {
    const hostFingerprint = nonEmpty(body.host?.fingerprint);
    if (!hostFingerprint) {
      throw new Error("Heartbeat host fingerprint is missing.");
    }

    const response = await this.client.operations.agentHeartbeat({
      params: {
        header: {
          "X-Host-Fingerprint": hostFingerprint
        }
      },
      body
    });

    if (response.error) {
      throw new Error(`agentHeartbeat failed with status ${response.status}.`);
    }

    const nowIso = new Date().toISOString();
    await this.persistState({
      last_heartbeat_at: nowIso
    });

    this.emitInfo("Heartbeat sent", {
      at: nowIso,
      status: body.status,
      runtime: valueAsObject(body.meta)?.runtime ?? null
    });
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

function normalizeRuntimeProvider(value: string | undefined): "auto" | RuntimeProviderKind {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "openclaw" || normalized === "external") {
    return normalized;
  }

  return "auto";
}

function parseRuntimeCommandArgs(value: string | undefined): string[] {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return [];
  }

  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => String(entry));
      }
    } catch {
      // Fall through to whitespace splitting.
    }
  }

  return raw.split(/\s+/).filter(Boolean);
}

async function canExecute(command: string, args: string[]): Promise<boolean> {
  try {
    await execCapture(command, args);
    return true;
  } catch {
    return false;
  }
}

async function execCapture(
  command: string,
  args: readonly string[],
  options: { timeoutMs?: number } = {}
): Promise<{ stdout: string; stderr: string }> {
  const output = await execFileAsync(command, [...args], {
    maxBuffer: 10 * 1024 * 1024,
    ...(options.timeoutMs && options.timeoutMs > 0 ? { timeout: options.timeoutMs } : {})
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

  if (endpoint) {
    const response = await fetch(endpoint, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
      }
    });

    if (!response.ok) {
      throw new Error(`Unable to resolve public IP from ${endpoint}: HTTP ${response.status}`);
    }

    const text = (await response.text()).trim();
    if (isIpv4(text)) {
      return text;
    }

    try {
      const parsed = JSON.parse(text);
      const candidate = nonEmpty((parsed as JsonObject).ip) ?? nonEmpty((parsed as JsonObject).public_ip);
      if (candidate && isIpv4(candidate)) {
        return candidate;
      }
    } catch {
      // Keep parse fallback.
    }

    throw new Error(`Unable to parse public IP response from ${endpoint}.`);
  }

  throw new Error(
    `Unable to resolve public IP address. Set AGENTMC_PUBLIC_IP or AGENTMC_PUBLIC_IP_ENDPOINT. Private IP was ${privateIp}.`
  );
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

function normalizeModelList(models: readonly string[]): string[] {
  const normalized = models
    .map((entry) => String(entry ?? "").trim())
    .filter((entry) => entry !== "");

  return Array.from(new Set(normalized));
}

function normalizeHeartbeatModels(value: unknown): (string | JsonObject)[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: (string | JsonObject)[] = [];
  const seenStrings = new Set<string>();

  for (const item of value) {
    const text = nonEmpty(item);
    if (text) {
      if (!seenStrings.has(text)) {
        seenStrings.add(text);
        normalized.push(text);
      }
      continue;
    }

    const object = valueAsObject(item);
    if (object) {
      normalized.push(object);
    }
  }

  return normalized;
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

function extractHeartbeatTelemetryFromRuntimeSnapshot(snapshot: JsonObject): JsonObject {
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
  assignStringTelemetryField(telemetry, "session", lookup, ["session", "session_id"]);
  assignStringTelemetryField(telemetry, "queue", lookup, ["queue", "queue_name"]);
  assignStringTelemetryField(telemetry, "auth", lookup, ["auth", "auth_mode", "authentication"]);

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

  assignBooleanTelemetryField(telemetry, "browser_tool_available", lookup, ["browser_tool_available"]);
  assignBooleanTelemetryField(telemetry, "exec_tool_available", lookup, ["exec_tool_available"]);
  assignBooleanTelemetryField(telemetry, "nodes_tool_available", lookup, ["nodes_tool_available"]);
  assignBooleanTelemetryField(telemetry, "messaging_tool_available", lookup, ["messaging_tool_available"]);
  assignBooleanTelemetryField(telemetry, "sessions_tool_available", lookup, ["sessions_tool_available"]);
  assignBooleanTelemetryField(telemetry, "memory_tool_available", lookup, ["memory_tool_available"]);

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

  walk(source, (value, key) => {
    if (typeof key !== "string") {
      return;
    }

    const normalized = normalizeLookupKey(key);
    if (normalized === "") {
      return;
    }

    const bucket = lookup.get(normalized);
    if (bucket) {
      bucket.push(value);
      return;
    }

    lookup.set(normalized, [value]);
  });

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

  walk(value, (entry, key) => {
    if (typeof entry !== "string") {
      return;
    }

    const normalizedKey = String(key ?? "").toLowerCase();
    if (
      normalizedKey === "model" ||
      normalizedKey === "model_id" ||
      normalizedKey === "id" ||
      normalizedKey === "primary" ||
      normalizedKey === "default"
    ) {
      const trimmed = entry.trim();
      if (trimmed !== "") {
        found.add(trimmed);
      }
    }
  });

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

function parseCsv(raw: string | undefined): string[] {
  const text = String(raw ?? "").trim();
  if (!text) {
    return [];
  }

  return text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

function parseJsonObject(value: string): JsonObject {
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  return parsed as JsonObject;
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

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}
