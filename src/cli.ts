import { Command } from "commander";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { arch, cpus, hostname, networkInterfaces, platform, release, totalmem, uptime } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

import { detectRuntimeAgents, type DiscoveredRuntimeAgent } from "./agent-discovery";
import { AgentMCApi } from "./client";
import { operationsById, type OperationId } from "./generated/operations";
import { AgentRuntimeProgram } from "./runtime-program";

function parseJson(value: string | undefined, flagName: string): unknown {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid JSON for ${flagName}: ${(error as Error).message}`);
  }
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function assertOperation(operationId: string): asserts operationId is OperationId {
  if (!(operationId in operationsById)) {
    throw new Error(`Unknown operationId: ${operationId}`);
  }
}

function operationDocPath(operationId: OperationId): string {
  const cliFilePath = fileURLToPath(import.meta.url);
  const packageRoot = resolve(dirname(cliFilePath), "..");
  return resolve(packageRoot, "docs/operations", `${operationId}.md`);
}

interface RuntimeWorkerConfig {
  agentId: number | null;
  apiKey: string;
  workspaceDir: string;
  statePath: string;
  localKey: string;
  openclawAgent?: string;
  localName?: string;
  provider?: string;
}

interface RuntimeEntry {
  worker: RuntimeWorkerConfig;
  runtimeEnv: NodeJS.ProcessEnv;
}

interface HostHeartbeatAgentRow {
  id: number;
  runtimeKey: string | null;
  name: string | null;
}

type HostHeartbeatRuntimeProvider = "openclaw" | "external" | "host-runtime";

const DEFAULT_WORKER_RESTART_DELAY_MS = 2_000;
const DEFAULT_WORKER_RESTART_MAX_DELAY_MS = 30_000;
const WORKER_RESTART_RESET_WINDOW_MS = 60_000;
const DEFAULT_HOST_HEARTBEAT_INTERVAL_SECONDS = 300;
const DEFAULT_HOST_REQUESTED_SESSION_LIMIT = 20;
const DEFAULT_HOST_REQUEST_POLL_MS = 250;
const OPENCLAW_MODELS_STATUS_COMMAND: readonly string[] = ["models", "--status-json"];
const OPENCLAW_MODELS_STATUS_FALLBACK_COMMAND: readonly string[] = ["models", "status", "--json"];
const OPENCLAW_MODEL_PLACEHOLDER_TOKENS = new Set([
  "openclaw/default",
  "openclaw:default",
  "default",
  "unknown",
  "n/a",
  "none",
  "null"
]);

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

function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
    return null;
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

function parseCommaSeparatedList(value: unknown): string[] {
  const raw = nonEmpty(value);
  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

async function runMultiAgentRuntimeFromEnv(env: NodeJS.ProcessEnv): Promise<boolean> {
  const hostApiKey = nonEmpty(env.AGENTMC_API_KEY);
  if (!hostApiKey) {
    return false;
  }

  const workerRestartDelayMs = toPositiveInt(env.AGENTMC_WORKER_RESTART_DELAY_MS) ?? DEFAULT_WORKER_RESTART_DELAY_MS;
  const workerRestartMaxDelayMs = Math.max(
    workerRestartDelayMs,
    toPositiveInt(env.AGENTMC_WORKER_RESTART_MAX_DELAY_MS) ?? DEFAULT_WORKER_RESTART_MAX_DELAY_MS
  );

  let stopping = false;
  const activeRuntimes = new Map<string, AgentRuntimeProgram>();
  let hostHeartbeatLoopPromise: Promise<void> | null = null;
  let hostRequestedSessionLoopPromise: Promise<void> | null = null;

  const stopAll = async (): Promise<void> => {
    if (stopping) {
      return;
    }

    stopping = true;
    await Promise.allSettled(Array.from(activeRuntimes.values()).map((runtime) => runtime.stop()));
  };

  const handleSignal = (signal: NodeJS.Signals): void => {
    process.stderr.write(`[agentmc-runtime] received ${signal}, stopping worker runtimes...\n`);
    void stopAll();
  };

  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);

  try {
    const baseUrl = nonEmpty(env.AGENTMC_BASE_URL) ?? undefined;
    const explicitAgentId = toPositiveInt(env.AGENTMC_AGENT_ID);
    if (explicitAgentId !== null) {
      const runtimeEnv: NodeJS.ProcessEnv = {
        ...env,
        AGENTMC_API_KEY: hostApiKey,
        AGENTMC_AGENT_ID: String(explicitAgentId)
      };
      const entry: RuntimeEntry = {
        worker: {
          agentId: explicitAgentId,
          apiKey: hostApiKey,
          workspaceDir: nonEmpty(runtimeEnv.AGENTMC_WORKSPACE_DIR) ?? process.cwd(),
          statePath:
            nonEmpty(runtimeEnv.AGENTMC_STATE_PATH) ??
            resolve(process.cwd(), ".agentmc", `state.agent-${explicitAgentId}.json`),
          localKey: `agent-${explicitAgentId}`,
          localName: `agent-${explicitAgentId}`,
          provider: normalizeRuntimeProvider(env.AGENTMC_RUNTIME_PROVIDER)
        },
        runtimeEnv
      };

      if (toBoolean(env.AGENTMC_DISABLE_HEARTBEAT) !== true) {
        process.stderr.write(
          "[agentmc-runtime] explicit AGENTMC_AGENT_ID mode enabled; per-agent heartbeat remains enabled.\n"
        );
      }

      await runRuntimeEntryWithRestart({
        entry,
        activeRuntimes,
        workerRestartDelayMs,
        workerRestartMaxDelayMs,
        shouldStop: () => stopping
      });

      return true;
    }

    const runtimeProvider = normalizeRuntimeProvider(env.AGENTMC_RUNTIME_PROVIDER);
    const discoveredAgents = await detectRuntimeAgents({
      runtimeProvider,
      workspaceDir: process.cwd(),
      env
    });
    if (discoveredAgents.length === 0) {
      throw new Error("Runtime bootstrap failed. No runtime agents detected from OpenClaw config/discovery.");
    }

    const resolved = resolveWorkerConfigs({
      hostApiKey,
      discoveredAgents
    });
    if (resolved.workers.length === 0) {
      throw new Error("Detected runtime agents but failed to build worker runtime configs.");
    }

    const hostHeartbeatIntervalSeconds =
      toPositiveInt(env.AGENTMC_HOST_HEARTBEAT_INTERVAL_SECONDS) ??
      toPositiveInt(env.AGENTMC_HEARTBEAT_INTERVAL_SECONDS) ??
      DEFAULT_HOST_HEARTBEAT_INTERVAL_SECONDS;
    const hostRequestPollMs = Math.max(
      150,
      toPositiveInt(env.AGENTMC_REQUEST_POLL_MS) ?? DEFAULT_HOST_REQUEST_POLL_MS
    );
    const hostRequestedSessionLimit = Math.max(
      1,
      Math.min(100, toPositiveInt(env.AGENTMC_REQUESTED_SESSION_LIMIT) ?? DEFAULT_HOST_REQUESTED_SESSION_LIMIT)
    );

    const heartbeatClient = new AgentMCApi({
      baseUrl,
      apiKey: hostApiKey
    });
    const hostFingerprint = resolveHostFingerprint(env);

    const initialHeartbeat = await sendHostHeartbeat(heartbeatClient, env, resolved.workers, hostFingerprint);
    applyHeartbeatAgentMapping(resolved.workers, initialHeartbeat);

    const unresolvedWorkers = resolved.workers.filter((worker) => worker.agentId === null);
    if (unresolvedWorkers.length > 0) {
      const unresolved = unresolvedWorkers.map((worker) => worker.localKey).join(", ");
      throw new Error(`Host heartbeat did not resolve AgentMC ids for runtime agents: ${unresolved}`);
    }

    for (const warning of resolved.warnings) {
      process.stderr.write(`[agentmc-runtime] ${warning}\n`);
    }

    process.stderr.write(
      `[agentmc-runtime] host heartbeat active interval=${hostHeartbeatIntervalSeconds}s host=${hostFingerprint}\n`
    );
    process.stderr.write(
      `[agentmc-runtime] host realtime requested-session poll active interval=${hostRequestPollMs}ms limit=${hostRequestedSessionLimit}\n`
    );

    const runtimeEntries: RuntimeEntry[] = resolved.workers.map((worker) => ({
      worker,
      runtimeEnv: buildRuntimeEnv(env, worker, true)
    }));
    const runtimeEntriesByLocalKey = new Map(runtimeEntries.map((entry) => [entry.worker.localKey, entry]));

    hostHeartbeatLoopPromise = runHostHeartbeatLoop({
      client: heartbeatClient,
      env,
      workers: resolved.workers,
      hostFingerprint,
      intervalSeconds: hostHeartbeatIntervalSeconds,
      onAgentMappingChanged: async (changedWorkerKeys) => {
        if (changedWorkerKeys.length === 0) {
          return;
        }

        for (const workerKey of changedWorkerKeys) {
          const entry = runtimeEntriesByLocalKey.get(workerKey);
          if (!entry) {
            continue;
          }

          entry.runtimeEnv = buildRuntimeEnv(env, entry.worker, true);
          const runtime = activeRuntimes.get(workerKey);
          if (!runtime) {
            continue;
          }

          process.stderr.write(
            `[agentmc-runtime] worker mapping changed; restarting runtime local=${workerKey} agent=${entry.worker.agentId ?? "unresolved"}\n`
          );
          try {
            await runtime.stop();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            process.stderr.write(`[agentmc-runtime] worker restart after mapping change failed: ${message}\n`);
          }
        }
      },
      shouldStop: () => stopping
    });
    hostRequestedSessionLoopPromise = runHostRequestedSessionLoop({
      client: heartbeatClient,
      workers: resolved.workers,
      activeRuntimes,
      pollMs: hostRequestPollMs,
      sessionLimit: hostRequestedSessionLimit,
      shouldStop: () => stopping
    });

    await Promise.all(
      [
        ...runtimeEntries.map((entry) =>
          runRuntimeEntryWithRestart({
            entry,
            activeRuntimes,
            workerRestartDelayMs,
            workerRestartMaxDelayMs,
            shouldStop: () => stopping
          })
        ),
        hostHeartbeatLoopPromise,
        hostRequestedSessionLoopPromise
      ]
    );

    return true;
  } finally {
    stopping = true;
    if (hostHeartbeatLoopPromise) {
      await Promise.allSettled([hostHeartbeatLoopPromise]);
    }
    if (hostRequestedSessionLoopPromise) {
      await Promise.allSettled([hostRequestedSessionLoopPromise]);
    }
    await stopAll();
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
  }
}

async function runHostHeartbeatLoop(input: {
  client: AgentMCApi;
  env: NodeJS.ProcessEnv;
  workers: RuntimeWorkerConfig[];
  hostFingerprint: string;
  intervalSeconds: number;
  onAgentMappingChanged?: (changedWorkerKeys: string[]) => Promise<void> | void;
  shouldStop: () => boolean;
}): Promise<void> {
  while (!input.shouldStop()) {
    await sleepWithStop(Math.max(1_000, input.intervalSeconds * 1000), input.shouldStop);
    if (input.shouldStop()) {
      break;
    }

    try {
      const heartbeat = await sendHostHeartbeat(input.client, input.env, input.workers, input.hostFingerprint);
      const changedWorkerKeys = applyHeartbeatAgentMapping(input.workers, heartbeat);
      if (input.onAgentMappingChanged && changedWorkerKeys.length > 0) {
        await input.onAgentMappingChanged(changedWorkerKeys);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[agentmc-runtime] host heartbeat failed: ${message}\n`);
    }
  }
}

async function runHostRequestedSessionLoop(input: {
  client: AgentMCApi;
  workers: RuntimeWorkerConfig[];
  activeRuntimes: Map<string, AgentRuntimeProgram>;
  pollMs: number;
  sessionLimit: number;
  shouldStop: () => boolean;
}): Promise<void> {
  let nextPollAtMs = 0;
  let lastRateLimitLogAtMs = 0;

  while (!input.shouldStop()) {
    const nowMs = Date.now();
    if (nowMs < nextPollAtMs) {
      await sleepWithStop(Math.min(1_000, nextPollAtMs - nowMs), input.shouldStop);
      continue;
    }

    try {
      const response = await input.client.operations.listAgentRealtimeRequestedSessions({
        params: {
          query: {
            limit: input.sessionLimit
          }
        }
      });

      if (response.error) {
        const status = Number(response.status || 0);
        if (status === 429) {
          const backoffMs = Math.max(input.pollMs * 3, 4_000);
          nextPollAtMs = Date.now() + backoffMs;
          if (Date.now() - lastRateLimitLogAtMs >= 5_000) {
            lastRateLimitLogAtMs = Date.now();
            process.stderr.write(
              `[agentmc-runtime] listAgentRealtimeRequestedSessions rate limited (429); backing off for ${backoffMs}ms.\n`
            );
          }
          continue;
        }

        const summary = summarizeApiError(response.error);
        throw new Error(
          `listAgentRealtimeRequestedSessions failed with status ${response.status}${summary ? ` (${summary})` : ""}`
        );
      }

      nextPollAtMs = Date.now() + input.pollMs;

      const sessions = Array.isArray(response.data?.data) ? response.data.data : [];
      const orderedSessions = [...sessions].sort(
        (left, right) => (toPositiveInt((right as { id?: unknown }).id) ?? 0) - (toPositiveInt((left as { id?: unknown }).id) ?? 0)
      );
      const workersByAgentId = new Map<number, RuntimeWorkerConfig>();
      for (const worker of input.workers) {
        if (worker.agentId !== null && worker.agentId > 0 && !workersByAgentId.has(worker.agentId)) {
          workersByAgentId.set(worker.agentId, worker);
        }
      }

      for (const session of orderedSessions) {
        const row = valueAsObject(session);
        if (!row) {
          continue;
        }

        const sessionId = toPositiveInt(row.id);
        const agentId = toPositiveInt(row.agent_id ?? row.agentId);
        if (sessionId === null || agentId === null) {
          continue;
        }

        const worker = workersByAgentId.get(agentId);
        if (!worker) {
          continue;
        }

        const runtime = input.activeRuntimes.get(worker.localKey);
        if (!runtime) {
          continue;
        }

        runtime.enqueueRequestedRealtimeSession(sessionId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[agentmc-runtime] host realtime requested-session poll failed: ${message}\n`);
      nextPollAtMs = Date.now() + Math.max(input.pollMs, 1_000);
    }

    const waitMs = Math.max(150, Math.min(1_000, Math.max(0, nextPollAtMs - Date.now())));
    await sleepWithStop(waitMs, input.shouldStop);
  }
}

async function sleepWithStop(totalMs: number, shouldStop: () => boolean): Promise<void> {
  let remaining = Math.max(0, totalMs);
  while (remaining > 0 && !shouldStop()) {
    const stepMs = Math.min(1_000, remaining);
    await sleep(stepMs);
    remaining -= stepMs;
  }
}

async function sendHostHeartbeat(
  client: AgentMCApi,
  env: NodeJS.ProcessEnv,
  workers: RuntimeWorkerConfig[],
  hostFingerprint: string
): Promise<HostHeartbeatAgentRow[]> {
  const privateIp = resolvePrivateIp();
  const configuredPublicIp = nonEmpty(env.AGENTMC_PUBLIC_IP);
  const publicIp = configuredPublicIp ?? privateIp ?? "127.0.0.1";
  const configuredRuntimeProvider = normalizeRuntimeProvider(env.AGENTMC_RUNTIME_PROVIDER);
  const resolvedRuntimeProvider = resolveHostHeartbeatRuntimeProvider(configuredRuntimeProvider, workers);
  const runtimeIdentity = resolveHostHeartbeatRuntimeIdentity(env, configuredRuntimeProvider, resolvedRuntimeProvider);
  const models = resolveHostHeartbeatModels(env, workers, resolvedRuntimeProvider, runtimeIdentity.modelPrefix);

  const payload = {
    meta: {
      runtime: {
        name: runtimeIdentity.name,
        version: runtimeIdentity.version,
        ...(runtimeIdentity.build ? { build: runtimeIdentity.build } : {}),
        mode: runtimeIdentity.mode
      },
      type: runtimeIdentity.type,
      runtime_mode: runtimeIdentity.mode,
      models: models.length > 0 ? models : [`${runtimeIdentity.modelPrefix}/default`],
      ...(runtimeIdentity.openclawVersion ? { openclaw_version: runtimeIdentity.openclawVersion } : {}),
      ...(runtimeIdentity.openclawBuild ? { openclaw_build: runtimeIdentity.openclawBuild } : {})
    },
    host: {
      fingerprint: hostFingerprint,
      name: nonEmpty(env.AGENTMC_HOST_NAME) ?? hostname(),
      meta: {
        hostname: hostname(),
        ip: privateIp ?? publicIp,
        network: {
          private_ip: privateIp ?? publicIp,
          public_ip: publicIp
        },
        os: platform(),
        os_version: release(),
        arch: arch(),
        cpu: {
          model: cpus()[0]?.model ?? "unknown"
        },
        cpu_cores: Math.max(1, cpus().length),
        ram_gb: Number((totalmem() / (1024 ** 3)).toFixed(2)),
        disk: {
          total_bytes: 0,
          free_bytes: 0
        },
        uptime_seconds: Math.max(0, Math.trunc(uptime())),
        runtime: {
          name: runtimeIdentity.name,
          version: runtimeIdentity.version
        }
      }
    },
    agents: workers.map((worker) => ({
      ...(worker.agentId !== null ? { id: worker.agentId } : {}),
      name: worker.localName ?? worker.localKey,
      type: worker.provider ?? "runtime",
      identity: {
        name: worker.localName ?? worker.localKey,
        agent_key: worker.localKey,
        openclaw_agent: worker.openclawAgent ?? worker.localKey
      }
    }))
  };

  const response = await client.request("agentHeartbeat", {
    body: payload as never
  });

  if (response.error) {
    const summary = summarizeApiError(response.error);
    throw new Error(`agentHeartbeat failed with status ${response.status}${summary ? ` (${summary})` : ""}`);
  }

  const responseData = valueAsObject(response.data);
  const responseAgents = Array.isArray(responseData?.agents)
    ? responseData.agents
    : responseData?.agent
      ? [responseData.agent]
      : [];

  const rows: HostHeartbeatAgentRow[] = [];
  for (const row of responseAgents) {
    const objectRow = valueAsObject(row);
    const id = toPositiveInt(objectRow?.id);
    if (id === null) {
      continue;
    }

    rows.push({
      id,
      runtimeKey:
        nonEmpty(objectRow?.runtime_key) ??
        nonEmpty(objectRow?.runtimeKey) ??
        nonEmpty(objectRow?.agent_key) ??
        null,
      name: nonEmpty(objectRow?.name)
    });
  }

  process.stderr.write(
    `[agentmc-runtime] host heartbeat sent agents=${workers.length} resolved=${rows.length}\n`
  );

  return rows;
}

function resolveHostHeartbeatRuntimeProvider(
  configuredProvider: "auto" | "openclaw" | "external",
  workers: RuntimeWorkerConfig[]
): HostHeartbeatRuntimeProvider {
  const workerProviders = new Set<string>();
  for (const worker of workers) {
    const provider = nonEmpty(worker.provider)?.toLowerCase();
    if (provider === "openclaw" || provider === "external") {
      workerProviders.add(provider);
    }
  }

  if (workerProviders.size === 1) {
    return Array.from(workerProviders)[0] as HostHeartbeatRuntimeProvider;
  }

  if (configuredProvider === "openclaw" || configuredProvider === "external") {
    return configuredProvider;
  }

  return "host-runtime";
}

function resolveHostHeartbeatRuntimeIdentity(
  env: NodeJS.ProcessEnv,
  configuredProvider: "auto" | "openclaw" | "external",
  resolvedProvider: HostHeartbeatRuntimeProvider
): {
  type: string;
  mode: string;
  name: string;
  version: string;
  build: string | null;
  modelPrefix: string;
  openclawVersion: string | null;
  openclawBuild: string | null;
} {
  const configuredRuntimeVersion = nonEmpty(env.AGENTMC_RUNTIME_VERSION);
  const configuredRuntimeBuild = nonEmpty(env.AGENTMC_RUNTIME_BUILD);

  if (resolvedProvider === "openclaw") {
    const openclawIdentity = resolveOpenClawVersionIdentity(env);
    const version = configuredRuntimeVersion ?? openclawIdentity?.version ?? "unknown";
    const build = configuredRuntimeBuild ?? openclawIdentity?.build ?? null;

    return {
      type: "openclaw",
      mode: "openclaw",
      name: "openclaw",
      version,
      build,
      modelPrefix: "openclaw",
      openclawVersion: version,
      openclawBuild: build ?? version
    };
  }

  const mode = resolvedProvider === "external" ? "external" : configuredProvider;

  return {
    type: "host-runtime",
    mode,
    name: nonEmpty(env.AGENTMC_RUNTIME_NAME) ?? "agentmc-node-host",
    version: configuredRuntimeVersion ?? process.version,
    build: configuredRuntimeBuild ?? null,
    modelPrefix: resolvedProvider === "external" ? "external" : mode,
    openclawVersion: null,
    openclawBuild: null
  };
}

function resolveOpenClawVersionIdentity(
  env: NodeJS.ProcessEnv
): {
  version: string;
  build: string | null;
} | null {
  const command = nonEmpty(env.OPENCLAW_CMD) ?? "openclaw";
  const output = readCommandVersionOutput(command, ["--version"]);
  if (!output) {
    return null;
  }

  const version = extractVersionToken(output) ?? output.trim();
  if (!version) {
    return null;
  }

  return {
    version,
    build: extractBuildToken(output)
  };
}

function readCommandVersionOutput(command: string, args: readonly string[]): string | null {
  try {
    const stdout = execFileSync(command, [...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return firstNonEmptyLine(stdout);
  } catch (error) {
    const normalizedError = error as { stdout?: string | Buffer; stderr?: string | Buffer };
    const stdout = firstNonEmptyLine(execOutputToString(normalizedError.stdout));
    if (stdout) {
      return stdout;
    }

    return firstNonEmptyLine(execOutputToString(normalizedError.stderr));
  }
}

function execOutputToString(value: string | Buffer | undefined): string {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Buffer) {
    return value.toString("utf8");
  }

  return "";
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

function resolveHostHeartbeatModels(
  env: NodeJS.ProcessEnv,
  workers: RuntimeWorkerConfig[],
  resolvedProvider: HostHeartbeatRuntimeProvider,
  modelPrefix: string
): string[] {
  const configured = parseCommaSeparatedList(env.AGENTMC_MODELS);
  if (configured.length > 0) {
    return dedupeModelIdentifiers(configured);
  }

  if (resolvedProvider !== "openclaw") {
    return [`${modelPrefix}/default`];
  }

  const command = nonEmpty(env.OPENCLAW_CMD) ?? "openclaw";
  const openclawAgents = new Set<string>();
  for (const worker of workers) {
    if (worker.provider?.toLowerCase() !== "openclaw") {
      continue;
    }

    const key = nonEmpty(worker.openclawAgent) ?? nonEmpty(worker.localKey);
    if (key) {
      openclawAgents.add(key);
    }
  }

  const configuredOpenClawAgent = nonEmpty(env.OPENCLAW_AGENT);
  if (configuredOpenClawAgent) {
    openclawAgents.add(configuredOpenClawAgent);
  }

  const discovered: string[] = [];
  for (const agentKey of openclawAgents) {
    const status = readOpenClawModelStatus(command, agentKey);
    if (!status) {
      continue;
    }

    discovered.push(...extractOpenClawModelIdentifiers(status));
  }

  if (discovered.length === 0) {
    const sharedStatus = readOpenClawModelStatus(command, null);
    if (sharedStatus) {
      discovered.push(...extractOpenClawModelIdentifiers(sharedStatus));
    }
  }

  const normalized = dedupeModelIdentifiers(discovered);
  if (normalized.length > 0) {
    return normalized;
  }

  return [`${modelPrefix}/default`];
}

function readOpenClawModelStatus(command: string, agentKey: string | null): Record<string, unknown> | null {
  const commands: string[][] = [];
  if (agentKey) {
    commands.push(["models", "--agent", agentKey, "--status-json"]);
    commands.push([...OPENCLAW_MODELS_STATUS_FALLBACK_COMMAND, "--agent", agentKey]);
    commands.push(["models", "status", "--agent", agentKey, "--json"]);
  } else {
    commands.push([...OPENCLAW_MODELS_STATUS_COMMAND]);
    commands.push([...OPENCLAW_MODELS_STATUS_FALLBACK_COMMAND]);
  }

  for (const args of commands) {
    const parsed = readCommandJsonObjectOutput(command, args);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function readCommandJsonObjectOutput(command: string, args: readonly string[]): Record<string, unknown> | null {
  try {
    const stdout = execFileSync(command, [...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return parseJsonObjectOutput(stdout);
  } catch (error) {
    const normalizedError = error as { stdout?: string | Buffer; stderr?: string | Buffer };
    const stdout = parseJsonObjectOutput(execOutputToString(normalizedError.stdout));
    if (stdout) {
      return stdout;
    }

    return parseJsonObjectOutput(execOutputToString(normalizedError.stderr));
  }
}

function parseJsonObjectOutput(value: string): Record<string, unknown> | null {
  const trimmed = String(value ?? "").trim();
  if (trimmed === "") {
    return null;
  }

  const direct = parseJsonObjectCandidate(trimmed);
  if (direct) {
    return direct;
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return null;
  }

  return parseJsonObjectCandidate(trimmed.slice(firstBrace, lastBrace + 1));
}

function parseJsonObjectCandidate(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return valueAsObject(parsed);
  } catch {
    return null;
  }
}

function extractOpenClawModelIdentifiers(status: Record<string, unknown>): string[] {
  const models: string[] = [];
  const add = (candidate: unknown): void => {
    const normalized = normalizeModelIdentifier(candidate);
    if (normalized) {
      models.push(normalized);
    }
  };

  add(status.resolvedDefault);
  add(status.resolved_default);
  add(status.defaultModel);
  add(status.default_model);
  add(status.model);

  const allowed = Array.isArray(status.allowed) ? status.allowed : [];
  for (const row of allowed) {
    add(row);
  }

  const fallbacks = Array.isArray(status.fallbacks) ? status.fallbacks : [];
  for (const row of fallbacks) {
    add(row);
  }

  const aliases = valueAsObject(status.aliases);
  if (aliases) {
    for (const aliasTarget of Object.values(aliases)) {
      add(aliasTarget);
    }
  }

  return dedupeModelIdentifiers(models);
}

function dedupeModelIdentifiers(models: readonly unknown[]): string[] {
  const values: string[] = [];
  const seen = new Set<string>();

  for (const model of models) {
    const normalized = normalizeModelIdentifier(model);
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    values.push(normalized);
  }

  return values;
}

function normalizeModelIdentifier(value: unknown): string | null {
  const text = nonEmpty(value);
  if (!text) {
    return null;
  }

  const normalized = text.trim();
  if (normalized === "" || /\s/.test(normalized)) {
    return null;
  }

  if (OPENCLAW_MODEL_PLACEHOLDER_TOKENS.has(normalized.toLowerCase())) {
    return null;
  }

  return normalized;
}

function applyHeartbeatAgentMapping(workers: RuntimeWorkerConfig[], rows: HostHeartbeatAgentRow[]): string[] {
  const byRuntimeKey = new Map<string, number>();
  const byName = new Map<string, number>();
  const changedWorkerKeys: string[] = [];

  for (const row of rows) {
    if (row.runtimeKey) {
      byRuntimeKey.set(row.runtimeKey.toLowerCase(), row.id);
    }
    if (row.name) {
      byName.set(row.name.toLowerCase(), row.id);
    }
  }

  for (const worker of workers) {
    const resolvedFromKey =
      byRuntimeKey.get(worker.localKey.toLowerCase()) ??
      (worker.openclawAgent ? byRuntimeKey.get(worker.openclawAgent.toLowerCase()) : undefined);
    const resolvedFromName = worker.localName ? byName.get(worker.localName.toLowerCase()) : undefined;
    const resolvedId = resolvedFromKey ?? resolvedFromName ?? null;
    if (resolvedId !== null && resolvedId > 0 && worker.agentId !== resolvedId) {
      worker.agentId = resolvedId;
      changedWorkerKeys.push(worker.localKey);
    }
  }

  return changedWorkerKeys;
}

function resolveHostFingerprint(env: NodeJS.ProcessEnv): string {
  const configured = nonEmpty(env.AGENTMC_HOST_FINGERPRINT);
  if (configured && configured.length >= 64) {
    return configured.slice(0, 128);
  }

  const seed = [
    hostname(),
    platform(),
    arch(),
    String(cpus().length),
    nonEmpty(env.AGENTMC_BASE_URL) ?? "",
    process.cwd()
  ].join("|");

  return createHash("sha256").update(seed).digest("hex");
}

function resolvePrivateIp(): string | null {
  const interfaces = networkInterfaces();
  for (const rows of Object.values(interfaces)) {
    for (const row of rows ?? []) {
      if (!row || row.internal || row.family !== "IPv4") {
        continue;
      }
      if (nonEmpty(row.address)) {
        return row.address;
      }
    }
  }

  return null;
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

function buildRuntimeEnv(baseEnv: NodeJS.ProcessEnv, worker: RuntimeWorkerConfig, disableHeartbeat = false): NodeJS.ProcessEnv {
  const runtimeEnv: NodeJS.ProcessEnv = {
    ...baseEnv,
    AGENTMC_API_KEY: worker.apiKey,
    AGENTMC_WORKSPACE_DIR: worker.workspaceDir,
    AGENTMC_STATE_PATH: worker.statePath
  };

  if (worker.agentId !== null) {
    runtimeEnv.AGENTMC_AGENT_ID = String(worker.agentId);
  } else {
    delete runtimeEnv.AGENTMC_AGENT_ID;
  }

  if (worker.openclawAgent) {
    runtimeEnv.OPENCLAW_AGENT = worker.openclawAgent;
  }

  if (disableHeartbeat) {
    runtimeEnv.AGENTMC_DISABLE_HEARTBEAT = "1";
    runtimeEnv.AGENTMC_DISABLE_REQUESTED_SESSION_POLLING = "1";
  } else {
    delete runtimeEnv.AGENTMC_DISABLE_HEARTBEAT;
    delete runtimeEnv.AGENTMC_DISABLE_REQUESTED_SESSION_POLLING;
  }

  return runtimeEnv;
}

async function runRuntimeEntryWithRestart(input: {
  entry: RuntimeEntry;
  activeRuntimes: Map<string, AgentRuntimeProgram>;
  workerRestartDelayMs: number;
  workerRestartMaxDelayMs: number;
  shouldStop: () => boolean;
}): Promise<void> {
  const { entry, activeRuntimes, shouldStop } = input;
  let consecutiveFailures = 0;

  while (!shouldStop()) {
    const workerLabel =
      `agent=${entry.worker.agentId ?? `auto:${entry.worker.localKey}`} provider=${entry.worker.provider ?? "unknown"} ` +
      `local=${entry.worker.localName ?? "unknown"} workspace=${entry.worker.workspaceDir}`;
    const runtime = AgentRuntimeProgram.fromEnv(entry.runtimeEnv);
    activeRuntimes.set(entry.worker.localKey, runtime);
    const startedAtMs = Date.now();
    process.stderr.write(`[agentmc-runtime] worker start ${workerLabel}\n`);

    try {
      await runtime.run();

      if (shouldStop()) {
        break;
      }

      process.stderr.write(`[agentmc-runtime] worker exited unexpectedly; restarting ${workerLabel}\n`);
    } catch (error) {
      if (shouldStop()) {
        break;
      }

      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[agentmc-runtime] worker crashed ${workerLabel}: ${message}\n`);
    } finally {
      if (activeRuntimes.get(entry.worker.localKey) === runtime) {
        activeRuntimes.delete(entry.worker.localKey);
      }
    }

    if (shouldStop()) {
      break;
    }

    const uptimeMs = Date.now() - startedAtMs;
    if (uptimeMs >= WORKER_RESTART_RESET_WINDOW_MS) {
      consecutiveFailures = 0;
    } else {
      consecutiveFailures = Math.min(consecutiveFailures + 1, 8);
    }

    const backoffMs = Math.min(
      input.workerRestartMaxDelayMs,
      input.workerRestartDelayMs * 2 ** consecutiveFailures
    );
    process.stderr.write(`[agentmc-runtime] worker restart scheduled in ${backoffMs}ms (${workerLabel})\n`);
    await sleep(backoffMs);
  }
}

function normalizeRuntimeProvider(value: unknown): "auto" | "openclaw" | "external" {
  const normalized = nonEmpty(value)?.toLowerCase();
  if (normalized === "openclaw" || normalized === "external" || normalized === "auto") {
    return normalized;
  }
  return "auto";
}

function resolveWorkerConfigs(input: {
  hostApiKey: string;
  discoveredAgents: DiscoveredRuntimeAgent[];
}): { workers: RuntimeWorkerConfig[]; warnings: string[] } {
  const warnings: string[] = [];
  const workers: RuntimeWorkerConfig[] = [];
  const usedLocalKeys = new Set<string>();
  const cwd = process.cwd();

  for (const local of input.discoveredAgents) {
    const localKey = nonEmpty(local.key) ?? nonEmpty(local.name) ?? `agent-${workers.length + 1}`;
    const normalizedKey = localKey.replace(/[^A-Za-z0-9_.-]/g, "-").toLowerCase();

    if (usedLocalKeys.has(normalizedKey)) {
      warnings.push(
        `Skipping local agent "${local.key || local.name || "unknown"}" because its runtime key is duplicated.`
      );
      continue;
    }

    usedLocalKeys.add(normalizedKey);
    workers.push(buildWorkerConfig(input.hostApiKey, local, null, cwd, normalizedKey));
  }

  return { workers, warnings };
}

function buildWorkerConfig(
  hostApiKey: string,
  local: DiscoveredRuntimeAgent,
  agentId: number | null,
  cwd: string,
  normalizedKey?: string
): RuntimeWorkerConfig {
  const localKey = nonEmpty(local.key) ?? (agentId !== null ? `agent-${agentId}` : "agent");
  const safeKey = normalizedKey ?? localKey.replace(/[^A-Za-z0-9_.-]/g, "-").toLowerCase();
  const workspaceDir = nonEmpty(local.workspaceDir) ?? resolve(cwd, ".agentmc", "workspaces", safeKey);
  const statePath = resolve(workspaceDir, ".agentmc", `state.${safeKey}.json`);

  return {
    agentId,
    apiKey: hostApiKey,
    workspaceDir,
    statePath,
    localKey: safeKey,
    openclawAgent: local.provider === "openclaw" ? local.key : undefined,
    localName: local.name,
    provider: local.provider
  };
}
function valueAsObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") {
      process.exit(0);
    }

    throw error;
  });

  const program = new Command();

  program
    .name("agentmc-api")
    .description("AgentMC API SDK + docs CLI")
    .showHelpAfterError();

  program
    .command("list-operations")
    .description("List all available operations")
    .option("--json", "print full JSON payload", false)
    .action((options: { json: boolean }) => {
      if (options.json) {
        print(Object.values(operationsById));
        return;
      }

      for (const operation of Object.values(operationsById)) {
        process.stdout.write(`${operation.operationId}  ${operation.method.toUpperCase()} ${operation.path}\n`);
      }
    });

  program
    .command("show-operation")
    .description("Show operation details")
    .argument("<operationId>")
    .action((operationId: string) => {
      assertOperation(operationId);
      print(operationsById[operationId]);
    });

  program
    .command("show-doc")
    .description("Print generated markdown docs for an operation")
    .argument("<operationId>")
    .option("--path-only", "print only the markdown file path", false)
    .action((operationId: string, options: { pathOnly: boolean }) => {
      assertOperation(operationId);
      const docPath = operationDocPath(operationId);

      if (options.pathOnly) {
        process.stdout.write(`${docPath}\n`);
        return;
      }

      if (!existsSync(docPath)) {
        throw new Error(
          `Operation markdown not found at ${docPath}. Ensure docs/operations is included in the package.`
        );
      }

      process.stdout.write(readFileSync(docPath, "utf8"));
    });

  program
    .command("runtime:start")
    .description("Start the unified AgentMC host runtime supervisor (realtime + heartbeat + recurring tasks)")
    .action(async () => {
      const multiRuntimeRan = await runMultiAgentRuntimeFromEnv(process.env);
      if (!multiRuntimeRan) {
        throw new Error("Runtime bootstrap failed. Set AGENTMC_API_KEY (host key).");
      }
    });

  program
    .command("call")
    .description("Call an operation by operationId")
    .argument("<operationId>")
    .option("--base-url <url>", "override API base URL")
    .option("--api-key <key>", "Host/team API key credential")
    .option("--params <json>", "JSON for params.{path|query|header|cookie}")
    .option("--body <json>", "JSON request body")
    .option("--headers <json>", "JSON request headers")
    .action(async (operationId: string, options) => {
      assertOperation(operationId);

      const client = new AgentMCApi({
        baseUrl: options.baseUrl,
        apiKey: options.apiKey
      });

      const params = parseJson(options.params, "--params");
      const body = parseJson(options.body, "--body");
      const headers = parseJson(options.headers, "--headers");

      const result = await client.request(operationId, {
        params: params as never,
        body: body as never,
        headers: headers as HeadersInit | undefined
      });

      print({
        operationId,
        status: result.status,
        data: result.data,
        error: result.error
      });
    });

  await program.parseAsync(argv);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
