import { Command } from "commander";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { setDefaultResultOrder } from "node:dns";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, hostname, networkInterfaces, platform, release, totalmem, uptime } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

import { detectRuntimeAgents, type DiscoveredRuntimeAgent } from "./agent-discovery";
import { AgentMCApi } from "./client";
import { operationsById, type OperationId } from "./generated/operations";
import { AGENTMC_NODE_PACKAGE_VERSION } from "./package-version";
import { closeSharedRealtimeTransports, type HostRealtimeSocketPayload } from "./realtime";
import { AgentRuntimeProgram, type AgentRuntimeProgramOptions } from "./runtime-program";

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
  localEmoji?: string;
  provider?: string;
}

interface RuntimeEntry {
  worker: RuntimeWorkerConfig;
  runtimeOptions: AgentRuntimeProgramOptions;
}

interface HostHeartbeatAgentRow {
  id: number;
  runtimeKey: string | null;
  name: string | null;
}

interface HostHeartbeatResult {
  agents: HostHeartbeatAgentRow[];
  hostRealtime: HostRealtimeSocketPayload | null;
  heartbeatIntervalSeconds: number | null;
  hostRuntimeCommands: HostRuntimeCommand[];
}

interface HostRuntimeCommand {
  id: number;
  type: string;
  provider: string | null;
  payload: Record<string, unknown>;
}

interface HostRuntimeCommandUpdate {
  id: number;
  status: "completed" | "failed";
  result?: Record<string, unknown>;
  error?: string;
}

type HostHeartbeatRuntimeProvider = "openclaw" | "external" | "host-runtime";
type RuntimeSupervisorMode = "multi-agent";
type RuntimeSupervisorStatus = "running" | "stopped";

type ApiErrorCarrier = Error & {
  status?: number;
  apiError?: unknown;
};

interface RuntimeSupervisorWorkerStatus {
  local_key: string;
  local_name: string | null;
  provider: string | null;
  agent_id: number | null;
  workspace_dir: string;
  state_path: string;
  openclaw_agent: string | null;
}

interface RuntimeSupervisorSnapshot {
  schema_version: 1;
  pid: number;
  status: RuntimeSupervisorStatus;
  mode: RuntimeSupervisorMode;
  started_at: string;
  updated_at: string;
  host_fingerprint: string | null;
  summary: string | null;
  workers: RuntimeSupervisorWorkerStatus[];
}

interface RuntimeWorkerStateSnapshot {
  exists: boolean;
  agentId: number | null;
  lastHeartbeatAt: string | null;
  heartbeatParseError: string | null;
  stateSizeBytes: number | null;
  stateUpdatedAt: string | null;
  stateAgeSeconds: number | null;
  error: string | null;
}

interface RuntimeWorkerStatusReport {
  local_key: string;
  local_name: string | null;
  provider: string | null;
  agent_id: number | null;
  workspace_dir: string;
  state_path: string;
  openclaw_agent: string | null;
  workspace_exists: boolean;
  state_exists: boolean;
  state_error: string | null;
  state_size_bytes: number | null;
  state_updated_at: string | null;
  state_age_seconds: number | null;
  last_heartbeat_at: string | null;
  heartbeat_parse_error: string | null;
  heartbeat_age_seconds: number | null;
}

interface RuntimeProcessStatusReport {
  pid: number;
  ppid: number | null;
  state: string | null;
  elapsed_seconds: number | null;
  cpu_percent: number | null;
  memory_percent: number | null;
  rss_kb: number | null;
  vsz_kb: number | null;
  command: string | null;
}

interface RuntimeServiceStatusReport {
  name: string;
  active_state: string | null;
  sub_state: string | null;
  main_pid: number | null;
  restarts: number | null;
  exec_main_status: number | null;
  active_enter_timestamp: string | null;
}

interface RuntimeStatusLogEntry {
  timestamp: string | null;
  message: string;
}

interface RuntimeStatusDiagnostics {
  status_stale: boolean;
  status_stale_threshold_seconds: number;
  heartbeat_stale_threshold_seconds: number;
  service_pid_mismatch: boolean | null;
  service_main_pid_not_alive: boolean | null;
  unresolved_workers: string[];
  workers_missing_workspace: string[];
  workers_stale_state: string[];
  workers_missing_heartbeat: string[];
  workers_stale_heartbeat: string[];
  workers_with_invalid_heartbeat_timestamp: string[];
  workers_with_state_errors: string[];
  hints: string[];
}

interface RuntimeStatusReport {
  status_path: string;
  file_exists: boolean;
  status: RuntimeSupervisorStatus | "unknown";
  mode: RuntimeSupervisorMode | "unknown";
  pid: number | null;
  process_alive: boolean;
  running: boolean;
  started_at: string | null;
  updated_at: string | null;
  updated_age_seconds: number | null;
  summary: string | null;
  workers: RuntimeWorkerStatusReport[];
  process: RuntimeProcessStatusReport | null;
  warnings: string[];
  service: RuntimeServiceStatusReport | null;
  recent_errors: RuntimeStatusLogEntry[];
  recent_errors_service_name: string | null;
  recent_errors_window_minutes: number;
  recent_errors_limit: number;
  diagnostics: RuntimeStatusDiagnostics;
}

const DEFAULT_WORKER_RESTART_DELAY_MS = 2_000;
const DEFAULT_WORKER_RESTART_MAX_DELAY_MS = 30_000;
const WORKER_RESTART_RESET_WINDOW_MS = 60_000;
const DEFAULT_HOST_HEARTBEAT_INTERVAL_SECONDS = 60;
const DEFAULT_HOST_REALTIME_ROUTE_INTERVAL_MS = 1_000;
const DEFAULT_HOST_REALTIME_ROUTE_LIMIT = 100;
const DEFAULT_HOST_REALTIME_CONNECTED_RECONCILE_POLL_MS = 60_000;
const DEFAULT_AUTO_UPDATE_INTERVAL_SECONDS = 300;
const DEFAULT_AUTO_UPDATE_INSTALL_TIMEOUT_MS = 120_000;
const DEFAULT_AUTO_UPDATE_PACKAGE_NAME = "@agentmc/api";
const DEFAULT_AUTO_UPDATE_REGISTRY_URL = "https://registry.npmjs.org/@agentmc%2Fapi/latest";
const INSTALLED_PACKAGE_PATH_MARKER = "/node_modules/@agentmc/api/";
const DEFAULT_RUNTIME_STATUS_PATH = ".agentmc/runtime-status.json";
const DEFAULT_RUNTIME_STATE_PATH = ".agentmc/state.json";
const DEFAULT_RUNTIME_SERVICE_NAME = "agentmc-host";
const DEFAULT_RUNTIME_STATUS_STALE_THRESHOLD_SECONDS = 120;
const DEFAULT_RUNTIME_ERROR_LOOKBACK_MINUTES = 30;
const DEFAULT_RUNTIME_ERROR_LIMIT = 20;
const DEFAULT_RUNTIME_LOG_LINES = 100;
const DEFAULT_RUNTIME_DNS_RESULT_ORDER = "ipv4first";
const DEFAULT_UNRESOLVED_WORKER_WAIT_MS = 10_000;
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

function buildEmptyRuntimeStatusDiagnostics(): RuntimeStatusDiagnostics {
  return {
    status_stale: false,
    status_stale_threshold_seconds: DEFAULT_RUNTIME_STATUS_STALE_THRESHOLD_SECONDS,
    heartbeat_stale_threshold_seconds: DEFAULT_HOST_HEARTBEAT_INTERVAL_SECONDS * 2 + 60,
    service_pid_mismatch: null,
    service_main_pid_not_alive: null,
    unresolved_workers: [],
    workers_missing_workspace: [],
    workers_stale_state: [],
    workers_missing_heartbeat: [],
    workers_stale_heartbeat: [],
    workers_with_invalid_heartbeat_timestamp: [],
    workers_with_state_errors: [],
    hints: []
  };
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

function toNonNegativeInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseBoundedPositiveInt(
  value: unknown,
  fallback: number,
  minValue: number,
  maxValue: number
): number {
  const parsed = toPositiveInt(value) ?? fallback;
  return Math.max(minValue, Math.min(maxValue, parsed));
}

function writeRuntimeLog(level: "info" | "error", message: string, meta?: Record<string, unknown>): void {
  const suffix = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
  if (level === "error") {
    process.stderr.write(`[agentmc-runtime:error] ${message}${suffix}\n`);
    return;
  }

  process.stderr.write(`[agentmc-runtime] ${message}${suffix}\n`);
}

function workerRuntimeLogMeta(
  worker: RuntimeWorkerConfig,
  meta?: Record<string, unknown>
): Record<string, unknown> {
  return {
    local_key: worker.localKey,
    ...(nonEmpty(worker.localName) ? { local_name: nonEmpty(worker.localName) } : {}),
    ...(worker.agentId ? { agent_id: worker.agentId } : {}),
    ...(nonEmpty(worker.provider) ? { provider: nonEmpty(worker.provider) } : {}),
    ...(nonEmpty(worker.openclawAgent) ? { openclaw_agent: nonEmpty(worker.openclawAgent) } : {}),
    ...(meta ?? {})
  };
}

function resolveRuntimeStatusPath(override?: string): string {
  const configured = nonEmpty(override);
  return resolve(configured ?? resolve(process.cwd(), DEFAULT_RUNTIME_STATUS_PATH));
}

function resolveRuntimeServiceName(override?: string): string {
  return nonEmpty(override) ?? DEFAULT_RUNTIME_SERVICE_NAME;
}

interface RuntimeAutoUpdateConfig {
  enabled: boolean;
  intervalSeconds: number;
  installTimeoutMs: number;
  npmCommand: string;
  installDir: string;
  registryUrl: string;
  packageName: string;
}

function resolveRuntimeAutoUpdateInstallDir(): string {
  const cliFilePath = fileURLToPath(import.meta.url);
  const normalizedCliFilePath = cliFilePath.replace(/\\/g, "/");
  const markerIndex = normalizedCliFilePath.lastIndexOf(INSTALLED_PACKAGE_PATH_MARKER);
  if (markerIndex >= 0) {
    return resolve(normalizedCliFilePath.slice(0, markerIndex));
  }

  // For non-node_modules layouts, prefer the package root near this CLI file
  // so `npm install` updates the active runtime installation instead of cwd.
  let cursor = dirname(cliFilePath);
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(resolve(cursor, "package.json"))) {
      return resolve(cursor);
    }

    const parent = dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }

  return process.cwd();
}

function isProductionServiceEnvironment(env: NodeJS.ProcessEnv): boolean {
  const nodeEnv = nonEmpty(env.NODE_ENV)?.toLowerCase();
  if (nodeEnv === "production") {
    return true;
  }

  // systemd sets these for long-lived services.
  return (
    nonEmpty(env.INVOCATION_ID) !== null ||
    nonEmpty(env.JOURNAL_STREAM) !== null ||
    nonEmpty(env.SYSTEMD_EXEC_PID) !== null
  );
}

function resolveRuntimeAutoUpdateConfig(env: NodeJS.ProcessEnv): RuntimeAutoUpdateConfig {
  const normalizedCliFilePath = fileURLToPath(import.meta.url).replace(/\\/g, "/");
  const defaultEnabled =
    normalizedCliFilePath.includes(INSTALLED_PACKAGE_PATH_MARKER) || isProductionServiceEnvironment(env);

  return {
    enabled: defaultEnabled,
    intervalSeconds: DEFAULT_AUTO_UPDATE_INTERVAL_SECONDS,
    installTimeoutMs: DEFAULT_AUTO_UPDATE_INSTALL_TIMEOUT_MS,
    npmCommand: "npm",
    installDir: resolveRuntimeAutoUpdateInstallDir(),
    registryUrl: DEFAULT_AUTO_UPDATE_REGISTRY_URL,
    packageName: DEFAULT_AUTO_UPDATE_PACKAGE_NAME
  };
}

function toRuntimeSupervisorWorkerStatus(worker: RuntimeWorkerConfig): RuntimeSupervisorWorkerStatus {
  return {
    local_key: worker.localKey,
    local_name: nonEmpty(worker.localName),
    provider: nonEmpty(worker.provider),
    agent_id: worker.agentId,
    workspace_dir: worker.workspaceDir,
    state_path: worker.statePath,
    openclaw_agent: nonEmpty(worker.openclawAgent)
  };
}

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function secondsSince(date: Date, now = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
}

async function writeRuntimeSupervisorSnapshot(
  statusPath: string,
  snapshot: RuntimeSupervisorSnapshot
): Promise<void> {
  await mkdir(dirname(statusPath), { recursive: true });
  await writeFile(statusPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

function readRuntimeWorkerStateSnapshot(statePath: string): RuntimeWorkerStateSnapshot {
  if (!existsSync(statePath)) {
    return {
      exists: false,
      agentId: null,
      lastHeartbeatAt: null,
      heartbeatParseError: null,
      stateSizeBytes: null,
      stateUpdatedAt: null,
      stateAgeSeconds: null,
      error: null
    };
  }

  const now = new Date();
  let stateSizeBytes: number | null = null;
  let stateUpdatedAt: string | null = null;
  let stateAgeSeconds: number | null = null;
  try {
    const stats = statSync(statePath);
    stateSizeBytes = stats.size;
    stateUpdatedAt = stats.mtime.toISOString();
    stateAgeSeconds = secondsSince(stats.mtime, now);
  } catch {
    // File stats are best-effort; keep reading JSON payload for useful diagnostics.
  }

  try {
    const raw = readFileSync(statePath, "utf8");
    const parsed = JSON.parse(raw);
    const object = valueAsObject(parsed);
    if (!object) {
      return {
        exists: true,
        agentId: null,
        lastHeartbeatAt: null,
        heartbeatParseError: null,
        stateSizeBytes,
        stateUpdatedAt,
        stateAgeSeconds,
        error: "invalid_state_json"
      };
    }

    const lastHeartbeatAt = nonEmpty(object.last_heartbeat_at);
    return {
      exists: true,
      agentId: toPositiveInt(object.agent_id),
      lastHeartbeatAt,
      heartbeatParseError: lastHeartbeatAt && !parseIsoDate(lastHeartbeatAt) ? "invalid_heartbeat_timestamp" : null,
      stateSizeBytes,
      stateUpdatedAt,
      stateAgeSeconds,
      error: null
    };
  } catch (error) {
    return {
      exists: true,
      agentId: null,
      lastHeartbeatAt: null,
      heartbeatParseError: null,
      stateSizeBytes,
      stateUpdatedAt,
      stateAgeSeconds,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function isPidAlive(pid: number | null): boolean {
  if (pid === null || !Number.isInteger(pid) || pid < 1) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

function readRuntimeStatusReport(statusPath: string): RuntimeStatusReport {
  const warnings: string[] = [];
  const now = new Date();

  if (!existsSync(statusPath)) {
    const fallbackStatePath = resolve(process.cwd(), DEFAULT_RUNTIME_STATE_PATH);
    const fallbackState = readRuntimeWorkerStateSnapshot(fallbackStatePath);
    const fallbackHeartbeatDate = parseIsoDate(fallbackState.lastHeartbeatAt);
    const fallbackWorkspaceDir = dirname(dirname(fallbackStatePath));
    const fallbackWorker: RuntimeWorkerStatusReport[] = fallbackState.exists
      ? [{
          local_key: "default",
          local_name: null,
          provider: null,
          agent_id: fallbackState.agentId,
          workspace_dir: fallbackWorkspaceDir,
          state_path: fallbackStatePath,
          openclaw_agent: null,
          workspace_exists: existsSync(fallbackWorkspaceDir),
          state_exists: fallbackState.exists,
          state_error: fallbackState.error,
          state_size_bytes: fallbackState.stateSizeBytes,
          state_updated_at: fallbackState.stateUpdatedAt,
          state_age_seconds: fallbackState.stateAgeSeconds,
          last_heartbeat_at: fallbackState.lastHeartbeatAt,
          heartbeat_parse_error: fallbackState.heartbeatParseError,
          heartbeat_age_seconds: fallbackHeartbeatDate ? secondsSince(fallbackHeartbeatDate, now) : null
        }]
      : [];

    warnings.push(`runtime status file not found at ${statusPath}`);
    if (fallbackState.exists) {
      warnings.push(`using fallback state file ${fallbackStatePath}`);
    }

    return {
      status_path: statusPath,
      file_exists: false,
      status: "unknown",
      mode: "unknown",
      pid: null,
      process_alive: false,
      running: false,
      started_at: null,
      updated_at: null,
      updated_age_seconds: null,
      summary: null,
      workers: fallbackWorker,
      process: null,
      warnings,
      service: null,
      recent_errors: [],
      recent_errors_service_name: null,
      recent_errors_window_minutes: DEFAULT_RUNTIME_ERROR_LOOKBACK_MINUTES,
      recent_errors_limit: DEFAULT_RUNTIME_ERROR_LIMIT,
      diagnostics: buildEmptyRuntimeStatusDiagnostics()
    };
  }

  let parsedSnapshot: RuntimeSupervisorSnapshot | null = null;
  try {
    const raw = readFileSync(statusPath, "utf8");
    const parsed = JSON.parse(raw);
    const object = valueAsObject(parsed);
    if (!object) {
      warnings.push("runtime status file is not a JSON object");
    } else {
      const workersValue = Array.isArray(object.workers) ? object.workers : [];
      const workers: RuntimeSupervisorWorkerStatus[] = workersValue
        .map((row) => {
          const objectRow = valueAsObject(row);
          if (!objectRow) {
            return null;
          }
          const localKey = nonEmpty(objectRow.local_key);
          const workspaceDir = nonEmpty(objectRow.workspace_dir);
          const statePath = nonEmpty(objectRow.state_path);
          if (!localKey || !workspaceDir || !statePath) {
            return null;
          }
          return {
            local_key: localKey,
            local_name: nonEmpty(objectRow.local_name),
            provider: nonEmpty(objectRow.provider),
            agent_id: toPositiveInt(objectRow.agent_id),
            workspace_dir: workspaceDir,
            state_path: statePath,
            openclaw_agent: nonEmpty(objectRow.openclaw_agent)
          };
        })
        .filter((row): row is RuntimeSupervisorWorkerStatus => row !== null);

      const status = nonEmpty(object.status);
      parsedSnapshot = {
        schema_version: 1,
        pid: toPositiveInt(object.pid) ?? 0,
        status: status === "running" || status === "stopped" ? status : "running",
        mode: "multi-agent",
        started_at: nonEmpty(object.started_at) ?? new Date(0).toISOString(),
        updated_at: nonEmpty(object.updated_at) ?? new Date(0).toISOString(),
        host_fingerprint: nonEmpty(object.host_fingerprint),
        summary: nonEmpty(object.summary),
        workers
      };
    }
  } catch (error) {
    warnings.push(`failed to parse runtime status file: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!parsedSnapshot) {
    return {
      status_path: statusPath,
      file_exists: true,
      status: "unknown",
      mode: "unknown",
      pid: null,
      process_alive: false,
      running: false,
      started_at: null,
      updated_at: null,
      updated_age_seconds: null,
      summary: null,
      workers: [],
      process: null,
      warnings,
      service: null,
      recent_errors: [],
      recent_errors_service_name: null,
      recent_errors_window_minutes: DEFAULT_RUNTIME_ERROR_LOOKBACK_MINUTES,
      recent_errors_limit: DEFAULT_RUNTIME_ERROR_LIMIT,
      diagnostics: buildEmptyRuntimeStatusDiagnostics()
    };
  }

  const updatedAtDate = parseIsoDate(parsedSnapshot.updated_at);
  const processAlive = isPidAlive(parsedSnapshot.pid);
  const workerReports: RuntimeWorkerStatusReport[] = parsedSnapshot.workers.map((worker) => {
    const state = readRuntimeWorkerStateSnapshot(worker.state_path);
    const lastHeartbeatDate = parseIsoDate(state.lastHeartbeatAt);
    return {
      ...worker,
      workspace_exists: existsSync(worker.workspace_dir),
      state_exists: state.exists,
      state_error: state.error,
      state_size_bytes: state.stateSizeBytes,
      state_updated_at: state.stateUpdatedAt,
      state_age_seconds: state.stateAgeSeconds,
      last_heartbeat_at: state.lastHeartbeatAt,
      heartbeat_parse_error: state.heartbeatParseError,
      heartbeat_age_seconds: lastHeartbeatDate ? secondsSince(lastHeartbeatDate, now) : null
    };
  });

  return {
    status_path: statusPath,
    file_exists: true,
    status: parsedSnapshot.status,
    mode: parsedSnapshot.mode,
    pid: parsedSnapshot.pid,
    process_alive: processAlive,
    running: parsedSnapshot.status === "running" && processAlive,
    started_at: parsedSnapshot.started_at,
    updated_at: parsedSnapshot.updated_at,
    updated_age_seconds: updatedAtDate ? secondsSince(updatedAtDate, now) : null,
    summary: parsedSnapshot.summary,
    workers: workerReports,
    process: null,
    warnings,
    service: null,
    recent_errors: [],
    recent_errors_service_name: null,
    recent_errors_window_minutes: DEFAULT_RUNTIME_ERROR_LOOKBACK_MINUTES,
    recent_errors_limit: DEFAULT_RUNTIME_ERROR_LIMIT,
    diagnostics: buildEmptyRuntimeStatusDiagnostics()
  };
}

function parseSystemdShowOutput(output: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of String(output ?? "").split(/\r?\n/)) {
    const separatorIndex = line.indexOf("=");
    if (separatorIndex < 1) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key !== "") {
      values[key] = value;
    }
  }
  return values;
}

function readSystemdServiceStatus(serviceName: string): {
  status: RuntimeServiceStatusReport | null;
  warnings: string[];
} {
  const warnings: string[] = [];
  if (platform() !== "linux") {
    return {
      status: null,
      warnings
    };
  }
  try {
    const output = execFileSync(
      "systemctl",
      [
        "show",
        serviceName,
        "--property=ActiveState",
        "--property=SubState",
        "--property=MainPID",
        "--property=NRestarts",
        "--property=ExecMainStatus",
        "--property=ActiveEnterTimestamp",
        "--no-pager"
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    const parsed = parseSystemdShowOutput(output);
    const parsedExecMainStatus =
      parsed.ExecMainStatus !== undefined ? Number.parseInt(parsed.ExecMainStatus, 10) : Number.NaN;
    return {
      status: {
        name: serviceName,
        active_state: nonEmpty(parsed.ActiveState),
        sub_state: nonEmpty(parsed.SubState),
        main_pid: toPositiveInt(parsed.MainPID),
        restarts: toPositiveInt(parsed.NRestarts),
        exec_main_status: Number.isInteger(parsedExecMainStatus) ? parsedExecMainStatus : null,
        active_enter_timestamp: nonEmpty(parsed.ActiveEnterTimestamp)
      },
      warnings
    };
  } catch (error) {
    const normalizedError = error as NodeJS.ErrnoException & { stderr?: string | Buffer };
    if (normalizedError.code === "ENOENT") {
      warnings.push("systemctl not found; service diagnostics unavailable");
      return {
        status: null,
        warnings
      };
    }

    const stderr = firstNonEmptyLine(execOutputToString(normalizedError.stderr)) ?? normalizedError.message;
    warnings.push(`failed to read systemd service status (${serviceName}): ${stderr}`);
    return {
      status: null,
      warnings
    };
  }
}

function parseJournalTimestamp(line: string): { timestamp: string | null; body: string } {
  const match = line.match(/^(\d{4}-\d{2}-\d{2}T\S+)\s+(.+)$/);
  if (!match) {
    return {
      timestamp: null,
      body: line
    };
  }
  const timestamp = nonEmpty(match[1]);
  const body = nonEmpty(match[2]) ?? line;
  return {
    timestamp,
    body
  };
}

function normalizeJournalMessage(body: string): string {
  const separator = body.indexOf(": ");
  if (separator === -1) {
    return body.trim();
  }
  return body.slice(separator + 2).trim();
}

function readRecentRuntimeErrors(input: {
  serviceName: string;
  windowMinutes: number;
  limit: number;
}): { entries: RuntimeStatusLogEntry[]; warnings: string[] } {
  const warnings: string[] = [];
  if (platform() !== "linux") {
    return {
      entries: [],
      warnings
    };
  }
  try {
    const output = execFileSync(
      "journalctl",
      [
        "-u",
        input.serviceName,
        "--since",
        `${input.windowMinutes} minutes ago`,
        "--priority=3",
        "--no-pager",
        "-o",
        "short-iso",
        "-n",
        String(input.limit)
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    const entries = String(output ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("-- "))
      .map((line): RuntimeStatusLogEntry => {
        const parsed = parseJournalTimestamp(line);
        return {
          timestamp: parsed.timestamp,
          message: normalizeJournalMessage(parsed.body)
        };
      });

    return {
      entries,
      warnings
    };
  } catch (error) {
    const normalizedError = error as NodeJS.ErrnoException & { stderr?: string | Buffer };
    if (normalizedError.code === "ENOENT") {
      warnings.push("journalctl not found; recent runtime error scan unavailable");
      return {
        entries: [],
        warnings
      };
    }

    const stderr = firstNonEmptyLine(execOutputToString(normalizedError.stderr)) ?? normalizedError.message;
    warnings.push(`failed to read recent runtime errors (${input.serviceName}): ${stderr}`);
    return {
      entries: [],
      warnings
    };
  }
}

async function streamRuntimeLogs(input: {
  serviceName: string;
  lines: number;
  sinceMinutes: number;
  follow: boolean;
  grep?: string;
  raw?: boolean;
}): Promise<void> {
  if (platform() !== "linux") {
    throw new Error(
      "runtime:logs requires Linux with journalctl/systemd. For foreground logs, run `agentmc-api runtime:start` directly."
    );
  }

  const args = [
    "-u",
    input.serviceName,
    "--no-pager",
    "-o",
    "short-iso",
    "--since",
    `${input.sinceMinutes} minutes ago`,
    "-n",
    String(input.lines)
  ];

  const grep = nonEmpty(input.grep);
  if (grep) {
    args.push("--grep", grep);
  }
  if (input.follow) {
    args.push("-f");
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn("journalctl", args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let interrupted = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";
    const handleSignal = (signal: NodeJS.Signals): void => {
      interrupted = true;
      child.kill(signal);
    };
    const cleanup = (): void => {
      process.off("SIGINT", handleSignal);
      process.off("SIGTERM", handleSignal);
    };

    process.once("SIGINT", handleSignal);
    process.once("SIGTERM", handleSignal);

    const flushBuffer = (buffer: string, isErrorStream: boolean): string => {
      const lines = buffer.split(/\r?\n/);
      const trailing = lines.pop() ?? "";
      for (const line of lines) {
        writeRuntimeLogStreamLine(line, { raw: input.raw === true, isErrorStream });
      }
      return trailing;
    };

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      stdoutBuffer = flushBuffer(stdoutBuffer, false);
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderrBuffer += chunk;
      stderrBuffer = flushBuffer(stderrBuffer, true);
    });

    child.once("error", (error) => {
      cleanup();
      const normalizedError = error as NodeJS.ErrnoException;
      if (normalizedError.code === "ENOENT") {
        reject(new Error("journalctl not found; runtime log streaming is unavailable."));
        return;
      }
      reject(normalizedError);
    });

    child.once("exit", (code, signal) => {
      cleanup();
      if (stdoutBuffer !== "") {
        writeRuntimeLogStreamLine(stdoutBuffer, { raw: input.raw === true, isErrorStream: false });
      }
      if (stderrBuffer !== "") {
        writeRuntimeLogStreamLine(stderrBuffer, { raw: input.raw === true, isErrorStream: true });
      }
      if (interrupted || signal === "SIGINT" || signal === "SIGTERM") {
        resolve();
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`journalctl exited with code ${code ?? "unknown"}.`));
    });
  });
}

function writeRuntimeLogStreamLine(
  line: string,
  options: { raw: boolean; isErrorStream: boolean }
): void {
  const target = options.isErrorStream ? process.stderr : process.stdout;
  const trimmed = line.trimEnd();
  if (trimmed === "") {
    return;
  }

  if (options.raw) {
    target.write(`${trimmed}\n`);
    return;
  }

  const formatted = formatRuntimeLogLine(trimmed);
  target.write(`${formatted}\n`);
}

function formatRuntimeLogLine(line: string): string {
  const parsedJournal = parseJournalRuntimeLine(line);
  if (!parsedJournal) {
    return line;
  }

  const parsedRuntime = parseRuntimeEnvelope(parsedJournal.message);
  if (!parsedRuntime) {
    return `${parsedJournal.timestamp} ${parsedJournal.message}`;
  }

  const workerLabel = resolveRuntimeLogWorkerLabel(parsedRuntime.meta);
  const details = formatRuntimeLogDetails(parsedRuntime.meta);
  const level = parsedRuntime.level === "error" ? "ERROR " : "";
  const prefix = workerLabel ? `${parsedJournal.timestamp} ${level}[${workerLabel}]` : `${parsedJournal.timestamp} ${level}`.trimEnd();
  return details ? `${prefix} ${parsedRuntime.message}  ${details}` : `${prefix} ${parsedRuntime.message}`;
}

function parseJournalRuntimeLine(line: string): { timestamp: string; message: string } | null {
  const match = line.match(/^(\d{4}-\d{2}-\d{2}T\S+)\s+\S+\s+[^:]+:\s+(.*)$/);
  if (!match) {
    return null;
  }

  const timestamp = match[1];
  const message = match[2];
  if (!timestamp || message === undefined) {
    return null;
  }

  return {
    timestamp,
    message
  };
}

function parseRuntimeEnvelope(
  message: string
): { level: "info" | "error"; message: string; meta: Record<string, unknown> | null } | null {
  const match = message.match(/^\[(agentmc-runtime(?::error)?)\]\s+(.+)$/);
  if (!match) {
    return null;
  }

  const envelope = match[1];
  const innerMessage = match[2];
  if (!envelope || innerMessage === undefined) {
    return null;
  }

  const level = envelope.endsWith(":error") ? "error" : "info";
  const split = splitRuntimeMessageAndMeta(innerMessage);
  return {
    level,
    message: normalizeRuntimeLogMessage(split.message, split.meta),
    meta: split.meta
  };
}

function splitRuntimeMessageAndMeta(
  message: string
): { message: string; meta: Record<string, unknown> | null } {
  const separatorIndex = message.lastIndexOf(" {");
  if (separatorIndex === -1) {
    return {
      message,
      meta: null
    };
  }

  const candidateText = message.slice(0, separatorIndex);
  const candidateMeta = message.slice(separatorIndex + 1);
  try {
    const parsed = JSON.parse(candidateMeta);
    const object = valueAsObject(parsed);
    if (!object) {
      throw new Error("not an object");
    }

    return {
      message: candidateText,
      meta: object
    };
  } catch {
    return {
      message,
      meta: null
    };
  }
}

function resolveRuntimeLogWorkerLabel(meta: Record<string, unknown> | null): string | null {
  if (!meta) {
    return null;
  }

  return nonEmpty(meta.local_name) ?? nonEmpty(meta.local_key);
}

function normalizeRuntimeLogMessage(message: string, meta: Record<string, unknown> | null): string {
  const localKey = nonEmpty(meta?.local_key);
  if (!localKey) {
    return message;
  }

  const prefix = `worker ${localKey} `;
  return message.startsWith(prefix) ? message.slice(prefix.length) : message;
}

function formatRuntimeLogDetails(meta: Record<string, unknown> | null): string {
  if (!meta) {
    return "";
  }

  const parts: string[] = [];
  const mappings: Array<{ key: string; label: string }> = [
    { key: "session_id", label: "session" },
    { key: "request_id", label: "req" },
    { key: "message_id", label: "msg" },
    { key: "run_id", label: "run" },
    { key: "task_id", label: "task" },
    { key: "notification_id", label: "notification" },
    { key: "notification_type", label: "type" },
    { key: "channel_type", label: "channel" },
    { key: "status", label: "status" },
    { key: "state", label: "state" },
    { key: "reason", label: "reason" },
    { key: "source", label: "source" },
    { key: "text_source", label: "text" },
    { key: "content_length", label: "chars" }
  ];

  for (const mapping of mappings) {
    const value = nonEmpty(meta[mapping.key]);
    if (value) {
      parts.push(`${mapping.label}=${value}`);
    }
  }

  const preview = nonEmpty(meta.preview);
  if (preview) {
    parts.push(`preview=${JSON.stringify(preview)}`);
  }

  return parts.join(" ");
}

function readRuntimeProcessStatus(pid: number | null): {
  status: RuntimeProcessStatusReport | null;
  warnings: string[];
} {
  const warnings: string[] = [];
  if (pid === null) {
    return {
      status: null,
      warnings
    };
  }

  try {
    const output = execFileSync(
      "ps",
      [
        "-p",
        String(pid),
        "-o",
        "ppid=",
        "-o",
        "stat=",
        "-o",
        "etimes=",
        "-o",
        "pcpu=",
        "-o",
        "pmem=",
        "-o",
        "rss=",
        "-o",
        "vsz=",
        "-o",
        "command="
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    const line = firstNonEmptyLine(output);
    if (!line) {
      warnings.push(`ps returned no process details for pid ${pid}`);
      return {
        status: null,
        warnings
      };
    }

    const values = line.trim().split(/\s+/);
    if (values.length < 8) {
      warnings.push(`unable to parse process details for pid ${pid}`);
      return {
        status: {
          pid,
          ppid: null,
          state: null,
          elapsed_seconds: null,
          cpu_percent: null,
          memory_percent: null,
          rss_kb: null,
          vsz_kb: null,
          command: line.trim()
        },
        warnings
      };
    }

    const [ppidText, state, elapsedSecondsText, cpuPercentText, memoryPercentText, rssKbText, vszKbText, ...command] = values;
    return {
      status: {
        pid,
        ppid: toPositiveInt(ppidText),
        state: nonEmpty(state),
        elapsed_seconds: toPositiveInt(elapsedSecondsText),
        cpu_percent: Number.isFinite(Number(cpuPercentText)) ? Number(cpuPercentText) : null,
        memory_percent: Number.isFinite(Number(memoryPercentText)) ? Number(memoryPercentText) : null,
        rss_kb: toPositiveInt(rssKbText),
        vsz_kb: toPositiveInt(vszKbText),
        command: nonEmpty(command.join(" "))
      },
      warnings
    };
  } catch (error) {
    const normalizedError = error as NodeJS.ErrnoException & { stderr?: string | Buffer };
    if (normalizedError.code === "ENOENT") {
      warnings.push("ps not found; process details unavailable");
      return {
        status: null,
        warnings
      };
    }

    const stderr = firstNonEmptyLine(execOutputToString(normalizedError.stderr)) ?? normalizedError.message;
    warnings.push(`failed to read process details for pid ${pid}: ${stderr}`);
    return {
      status: null,
      warnings
    };
  }
}

function buildRuntimeStatusDiagnostics(
  report: RuntimeStatusReport,
  service: RuntimeServiceStatusReport | null,
  recentErrors: RuntimeStatusLogEntry[]
): RuntimeStatusDiagnostics {
  const statusStaleThresholdSeconds = DEFAULT_RUNTIME_STATUS_STALE_THRESHOLD_SECONDS;
  const heartbeatIntervalSeconds = DEFAULT_HOST_HEARTBEAT_INTERVAL_SECONDS;
  const heartbeatStaleThresholdSeconds = Math.max(180, heartbeatIntervalSeconds * 2 + 60);

  let servicePidMismatch: boolean | null = null;
  let serviceMainPidNotAlive: boolean | null = null;
  const serviceMainPid = service?.main_pid ?? null;
  if (serviceMainPid !== null) {
    serviceMainPidNotAlive = !isPidAlive(serviceMainPid);
    if (report.pid !== null) {
      servicePidMismatch = report.pid !== serviceMainPid;
    }
  }

  const unresolvedWorkers: string[] = [];
  const workersMissingWorkspace: string[] = [];
  const workersStaleState: string[] = [];
  const workersMissingHeartbeat: string[] = [];
  const workersStaleHeartbeat: string[] = [];
  const workersWithInvalidHeartbeatTimestamp: string[] = [];
  const workersWithStateErrors: string[] = [];
  for (const worker of report.workers) {
    if (worker.agent_id === null) {
      unresolvedWorkers.push(worker.local_key);
    }
    if (!worker.workspace_exists) {
      workersMissingWorkspace.push(worker.local_key);
    }
    if (worker.state_age_seconds !== null && worker.state_age_seconds > heartbeatStaleThresholdSeconds) {
      workersStaleState.push(worker.local_key);
    }
    if (worker.heartbeat_parse_error) {
      workersWithInvalidHeartbeatTimestamp.push(worker.local_key);
    }
    if (!worker.state_exists || worker.state_error) {
      workersWithStateErrors.push(worker.local_key);
    }
    if (!worker.last_heartbeat_at) {
      workersMissingHeartbeat.push(worker.local_key);
      continue;
    }
    if (worker.heartbeat_age_seconds !== null && worker.heartbeat_age_seconds > heartbeatStaleThresholdSeconds) {
      workersStaleHeartbeat.push(worker.local_key);
    }
  }

  const statusStale =
    report.updated_age_seconds !== null && report.updated_age_seconds > statusStaleThresholdSeconds;
  const hints: string[] = [];

  if (!report.file_exists) {
    hints.push("Runtime status file is missing. Start the runtime or pass --status-path.");
  }
  if (report.status === "running" && !report.process_alive) {
    hints.push("Status says running but PID is not alive. Restart the runtime service.");
  }
  if (servicePidMismatch) {
    hints.push("Status PID does not match systemd MainPID. The status file may be stale or service restarted.");
  }
  if (serviceMainPidNotAlive) {
    hints.push("Systemd MainPID is not alive. Inspect unit logs and service restart behavior.");
  }
  if (statusStale) {
    hints.push("Supervisor status file appears stale. Check service health and restart if needed.");
  }
  if (unresolvedWorkers.length > 0) {
    hints.push("Some workers are unresolved in AgentMC. Check host heartbeat/API key and mapping logs.");
  }
  if (workersMissingWorkspace.length > 0) {
    hints.push("Some worker workspace directories are missing.");
  }
  if (workersStaleState.length > 0) {
    hints.push("Some worker state files are stale. Check runtime write permissions and heartbeat loops.");
  }
  if (workersMissingHeartbeat.length > 0) {
    hints.push("Some workers have not persisted heartbeats yet. Check recent heartbeat errors.");
  }
  if (workersStaleHeartbeat.length > 0) {
    hints.push("Some workers have stale heartbeats. Verify API reachability and runtime loops.");
  }
  if (workersWithInvalidHeartbeatTimestamp.length > 0) {
    hints.push("Some worker state files contain invalid heartbeat timestamps.");
  }
  if (workersWithStateErrors.length > 0) {
    hints.push("Some worker state files are missing or invalid JSON.");
  }
  if (service && service.active_state && service.active_state !== "active") {
    hints.push(`Systemd service ${service.name} is not active (${service.active_state}/${service.sub_state ?? "unknown"}).`);
  }
  if (recentErrors.length > 0) {
    hints.push(`Recent runtime errors found: ${recentErrors.length}.`);
  }

  return {
    status_stale: statusStale,
    status_stale_threshold_seconds: statusStaleThresholdSeconds,
    heartbeat_stale_threshold_seconds: heartbeatStaleThresholdSeconds,
    service_pid_mismatch: servicePidMismatch,
    service_main_pid_not_alive: serviceMainPidNotAlive,
    unresolved_workers: unresolvedWorkers,
    workers_missing_workspace: workersMissingWorkspace,
    workers_stale_state: workersStaleState,
    workers_missing_heartbeat: workersMissingHeartbeat,
    workers_stale_heartbeat: workersStaleHeartbeat,
    workers_with_invalid_heartbeat_timestamp: workersWithInvalidHeartbeatTimestamp,
    workers_with_state_errors: workersWithStateErrors,
    hints
  };
}

function enrichRuntimeStatusReport(
  report: RuntimeStatusReport,
  input: {
    serviceName: string;
    includeRecentErrors: boolean;
    recentErrorWindowMinutes: number;
    recentErrorLimit: number;
  }
): RuntimeStatusReport {
  const warnings = [...report.warnings];
  const serviceResult = readSystemdServiceStatus(input.serviceName);
  warnings.push(...serviceResult.warnings);

  const recentErrorResult = input.includeRecentErrors
    ? readRecentRuntimeErrors({
        serviceName: input.serviceName,
        windowMinutes: input.recentErrorWindowMinutes,
        limit: input.recentErrorLimit
      })
    : {
        entries: [],
        warnings: [] as string[]
      };
  warnings.push(...recentErrorResult.warnings);
  const processResult = readRuntimeProcessStatus(report.pid);
  warnings.push(...processResult.warnings);

  const enrichedReport: RuntimeStatusReport = {
    ...report,
    warnings,
    process: processResult.status,
    service: serviceResult.status,
    recent_errors: recentErrorResult.entries,
    recent_errors_service_name: input.includeRecentErrors ? input.serviceName : null,
    recent_errors_window_minutes: input.recentErrorWindowMinutes,
    recent_errors_limit: input.recentErrorLimit
  };

  return {
    ...enrichedReport,
    diagnostics: buildRuntimeStatusDiagnostics(enrichedReport, serviceResult.status, recentErrorResult.entries)
  };
}

function printRuntimeStatusReport(report: RuntimeStatusReport): void {
  const headline = report.running ? "RUNNING" : "NOT RUNNING";
  process.stdout.write(`AgentMC runtime status: ${headline}\n`);
  process.stdout.write(`Status file: ${report.status_path}\n`);
  process.stdout.write(`PID: ${report.pid ?? "unknown"} (${report.process_alive ? "alive" : "not alive"})\n`);
  process.stdout.write(`Mode: ${report.mode}\n`);
  process.stdout.write(`Updated: ${report.updated_at ?? "unknown"}`);
  if (report.updated_age_seconds !== null) {
    process.stdout.write(` (${report.updated_age_seconds}s ago)`);
  }
  process.stdout.write("\n");
  if (report.summary) {
    process.stdout.write(`Summary: ${report.summary}\n`);
  }
  process.stdout.write(`Workers: ${report.workers.length}\n`);
  for (const worker of report.workers) {
    process.stdout.write(
      ` - ${worker.local_key} provider=${worker.provider ?? "unknown"} agent=${worker.agent_id ?? "unresolved"} heartbeat=${worker.last_heartbeat_at ?? "none"}`
    );
    if (worker.heartbeat_age_seconds !== null) {
      process.stdout.write(` (${worker.heartbeat_age_seconds}s ago)`);
    }
    process.stdout.write(` workspace=${worker.workspace_exists ? "ok" : "missing"}`);
    process.stdout.write(` state=${worker.state_exists ? "present" : "missing"}`);
    if (worker.state_age_seconds !== null) {
      process.stdout.write(` state_age=${worker.state_age_seconds}s`);
    }
    if (worker.state_error) {
      process.stdout.write(` state_error=${worker.state_error}`);
    }
    if (worker.heartbeat_parse_error) {
      process.stdout.write(` heartbeat_error=${worker.heartbeat_parse_error}`);
    }
    process.stdout.write("\n");
  }
  if (report.process) {
    process.stdout.write(`Process: pid=${report.process.pid}`);
    if (report.process.ppid !== null) {
      process.stdout.write(` ppid=${report.process.ppid}`);
    }
    if (report.process.state) {
      process.stdout.write(` state=${report.process.state}`);
    }
    if (report.process.elapsed_seconds !== null) {
      process.stdout.write(` elapsed=${report.process.elapsed_seconds}s`);
    }
    if (report.process.cpu_percent !== null) {
      process.stdout.write(` cpu=${report.process.cpu_percent.toFixed(1)}%`);
    }
    if (report.process.memory_percent !== null) {
      process.stdout.write(` mem=${report.process.memory_percent.toFixed(1)}%`);
    }
    if (report.process.rss_kb !== null) {
      process.stdout.write(` rss=${report.process.rss_kb}KB`);
    }
    process.stdout.write("\n");
    if (report.process.command) {
      process.stdout.write(`Command: ${report.process.command}\n`);
    }
  }
  if (report.service) {
    process.stdout.write(
      `Service: ${report.service.name} active=${report.service.active_state ?? "unknown"} sub=${report.service.sub_state ?? "unknown"}`
    );
    if (report.service.main_pid !== null) {
      process.stdout.write(` pid=${report.service.main_pid}`);
    }
    if (report.service.restarts !== null) {
      process.stdout.write(` restarts=${report.service.restarts}`);
    }
    if (report.service.exec_main_status !== null) {
      process.stdout.write(` exit=${report.service.exec_main_status}`);
    }
    process.stdout.write("\n");
  }
  process.stdout.write("Diagnostics:\n");
  if (report.diagnostics.hints.length === 0) {
    process.stdout.write(" - no immediate issues detected\n");
  } else {
    for (const hint of report.diagnostics.hints) {
      process.stdout.write(` - ${hint}\n`);
    }
  }
  process.stdout.write(
    `Recent errors (${report.recent_errors_window_minutes}m, limit=${report.recent_errors_limit}): ${report.recent_errors.length}\n`
  );
  if (report.recent_errors.length === 0) {
    process.stdout.write(" - none\n");
  } else {
    for (const entry of report.recent_errors) {
      process.stdout.write(` - [${entry.timestamp ?? "unknown"}] ${entry.message}\n`);
    }
  }
  for (const warning of report.warnings) {
    process.stdout.write(`Warning: ${warning}\n`);
  }
}

async function runMultiAgentRuntimeFromEnv(env: NodeJS.ProcessEnv): Promise<boolean> {
  const hostApiKey = nonEmpty(env.AGENTMC_API_KEY);
  if (!hostApiKey) {
    return false;
  }

  configureRuntimeDnsResolution();

  const workerRestartDelayMs = DEFAULT_WORKER_RESTART_DELAY_MS;
  const workerRestartMaxDelayMs = DEFAULT_WORKER_RESTART_MAX_DELAY_MS;
  const statusPath = resolveRuntimeStatusPath();
  let statusWorkers: RuntimeWorkerConfig[] = [];
  const statusSnapshot: RuntimeSupervisorSnapshot = {
    schema_version: 1,
    pid: process.pid,
    status: "running",
    mode: "multi-agent",
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    host_fingerprint: null,
    summary: "initializing runtime supervisor",
    workers: []
  };
  let statusRefreshTimer: NodeJS.Timeout | null = null;

  let stopping = false;
  const activeRuntimes = new Map<string, AgentRuntimeProgram>();
  let hostHeartbeatLoopPromise: Promise<void> | null = null;
  let hostRealtimeRoutingLoopPromise: Promise<void> | null = null;
  let autoUpdateLoopPromise: Promise<void> | null = null;
  let restartRequestedByAutoUpdate = false;
  let restartRequestedByProvisioning = false;
  const autoUpdateConfig = resolveRuntimeAutoUpdateConfig(env);

  const persistStatus = async (
    input: Partial<Pick<RuntimeSupervisorSnapshot, "status" | "mode" | "host_fingerprint" | "summary">> = {}
  ): Promise<void> => {
    if (input.status) {
      statusSnapshot.status = input.status;
    }
    if (input.mode) {
      statusSnapshot.mode = input.mode;
    }
    if (Object.prototype.hasOwnProperty.call(input, "host_fingerprint")) {
      statusSnapshot.host_fingerprint = input.host_fingerprint ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(input, "summary")) {
      statusSnapshot.summary = input.summary ?? null;
    }
    statusSnapshot.updated_at = new Date().toISOString();
    statusSnapshot.workers = statusWorkers.map((worker) => toRuntimeSupervisorWorkerStatus(worker));
    await writeRuntimeSupervisorSnapshot(statusPath, statusSnapshot);
  };

  const persistStatusSafe = async (
    input: Partial<Pick<RuntimeSupervisorSnapshot, "status" | "mode" | "host_fingerprint" | "summary">> = {}
  ): Promise<void> => {
    try {
      await persistStatus(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[agentmc-runtime] failed to write runtime status file ${statusPath}: ${message}\n`);
    }
  };

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
    await persistStatusSafe();
    statusRefreshTimer = setInterval(() => {
      void persistStatusSafe();
    }, 30_000);
    statusRefreshTimer.unref?.();

    if (autoUpdateConfig.enabled) {
      process.stderr.write(
        `[agentmc-runtime] auto-update enabled interval=${autoUpdateConfig.intervalSeconds}s install_dir=${autoUpdateConfig.installDir}\n`
      );
      autoUpdateLoopPromise = runAutoUpdateLoop({
        config: autoUpdateConfig,
        shouldStop: () => stopping,
        onUpdateInstalled: async ({ fromVersion, toVersion }) => {
          restartRequestedByAutoUpdate = true;
          await persistStatusSafe({
            summary: `auto-update installed ${fromVersion ?? "unknown"} -> ${toVersion}; restarting runtime supervisor`
          });
          await stopAll();
        }
      });
    }

    const discoveredAgents = await detectRuntimeAgents({
      workspaceDir: process.cwd()
    });
    if (discoveredAgents.length === 0) {
      throw new Error("Runtime bootstrap failed. No runtime agents detected from OpenClaw config/discovery.");
    }

    const resolved = resolveWorkerConfigs({
      hostApiKey,
      discoveredAgents
    });
    const workers = resolved.workers;
    const startupWarnings = [...resolved.warnings];

    if (workers.length === 0) {
      throw new Error("Detected runtime agents but failed to build worker runtime configs.");
    }
    statusWorkers = workers;
    await persistStatusSafe({
      mode: "multi-agent",
      summary: `starting ${workers.length} worker runtime(s)`
    });

    let hostHeartbeatIntervalSeconds = DEFAULT_HOST_HEARTBEAT_INTERVAL_SECONDS;
    const hostRealtimeRouteIntervalMs = DEFAULT_HOST_REALTIME_ROUTE_INTERVAL_MS;
    const hostRealtimeRouteLimit = DEFAULT_HOST_REALTIME_ROUTE_LIMIT;

    const heartbeatClient = new AgentMCApi({
      baseUrl: undefined,
      apiKey: hostApiKey
    });
    const hostFingerprint = resolveHostFingerprint();
    await persistStatusSafe({
      host_fingerprint: hostFingerprint,
      summary: "sending initial host heartbeat"
    });

    const initialHeartbeat = await sendHostHeartbeat(heartbeatClient, workers, hostFingerprint);

    applyHeartbeatAgentMapping(workers, initialHeartbeat.agents);
    let latestHostRealtimeSocket: HostRealtimeSocketPayload | null = initialHeartbeat.hostRealtime;
    hostHeartbeatIntervalSeconds = initialHeartbeat.heartbeatIntervalSeconds ?? hostHeartbeatIntervalSeconds;
    const unresolvedWorkers = workers.filter((worker) => worker.agentId === null);
    if (unresolvedWorkers.length > 0) {
      const unresolved = unresolvedWorkers.map((worker) => worker.localKey).join(", ");
      process.stderr.write(
        `[agentmc-runtime] initial host heartbeat left workers unresolved; keeping them paused until AgentMC resolves ids local=${unresolved} cause=plan-capacity-or-mapping\n`
      );
      await persistStatusSafe({
        summary: `initial host heartbeat complete; paused unresolved workers: ${unresolved}`
      });
    } else {
      await persistStatusSafe({
        summary: "initial host heartbeat complete"
      });
    }

    for (const warning of startupWarnings) {
      process.stderr.write(`[agentmc-runtime] ${warning}\n`);
    }

    process.stderr.write(
      `[agentmc-runtime] host heartbeat active interval=${hostHeartbeatIntervalSeconds}s host=${hostFingerprint}\n`
    );
    process.stderr.write(
      `[agentmc-runtime] host realtime mode=single-websocket-router interval_ms=${hostRealtimeRouteIntervalMs} limit=${hostRealtimeRouteLimit}\n`
    );

    const runtimeEntries: RuntimeEntry[] = workers.map((worker) => ({
      worker,
      runtimeOptions: buildRuntimeOptions(worker, true)
    }));
    const runtimeEntriesByLocalKey = new Map(runtimeEntries.map((entry) => [entry.worker.localKey, entry]));

    hostHeartbeatLoopPromise = runHostHeartbeatLoop({
      client: heartbeatClient,
      workers,
      hostFingerprint,
      intervalSeconds: hostHeartbeatIntervalSeconds,
      onHostRealtimeSocketChanged: async (socket) => {
        latestHostRealtimeSocket = socket;
      },
      onAgentMappingChanged: async (changedWorkerKeys) => {
        if (changedWorkerKeys.length === 0) {
          return;
        }

        for (const workerKey of changedWorkerKeys) {
          const entry = runtimeEntriesByLocalKey.get(workerKey);
          if (!entry) {
            continue;
          }

          entry.runtimeOptions = buildRuntimeOptions(entry.worker, true);
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

        await persistStatusSafe({
          summary: `worker mapping changed for ${changedWorkerKeys.join(", ")}`
        });
      },
      onRestartRequested: async (summary) => {
        restartRequestedByProvisioning = true;
        await persistStatusSafe({
          summary
        });
        await stopAll();
      },
      shouldStop: () => stopping
    });
    hostRealtimeRoutingLoopPromise = runHostRealtimeSessionRoutingLoop({
      client: heartbeatClient,
      workers,
      activeRuntimes,
      intervalMs: hostRealtimeRouteIntervalMs,
      queryLimit: hostRealtimeRouteLimit,
      getHostRealtimeSocket: () => latestHostRealtimeSocket,
      shouldStop: () => stopping
    });

    const lifecyclePromises: Promise<void>[] = [
      ...runtimeEntries.map((entry) =>
        runRuntimeEntryWithRestart({
          entry,
          activeRuntimes,
          workerRestartDelayMs,
          workerRestartMaxDelayMs,
          onWorkerEvent: async ({ worker, event }) => {
            await persistStatusSafe({
              summary: `worker ${worker.localKey} ${event}`
            });
          },
          shouldStop: () => stopping
        })
      ),
      hostHeartbeatLoopPromise,
      hostRealtimeRoutingLoopPromise
    ];
    if (autoUpdateLoopPromise) {
      lifecyclePromises.push(autoUpdateLoopPromise);
    }

    await Promise.all(lifecyclePromises);

    if (restartRequestedByAutoUpdate) {
      process.stderr.write("[agentmc-runtime] auto-update applied; exiting for restart.\n");
    }

    if (restartRequestedByProvisioning) {
      process.stderr.write("[agentmc-runtime] host provisioning applied; exiting for restart.\n");
    }

    return true;
  } finally {
    stopping = true;
    if (statusRefreshTimer) {
      clearInterval(statusRefreshTimer);
      statusRefreshTimer = null;
    }
    if (hostHeartbeatLoopPromise) {
      await Promise.allSettled([hostHeartbeatLoopPromise]);
    }
    if (hostRealtimeRoutingLoopPromise) {
      await Promise.allSettled([hostRealtimeRoutingLoopPromise]);
    }
    if (autoUpdateLoopPromise) {
      await Promise.allSettled([autoUpdateLoopPromise]);
    }
    await stopAll();
    closeSharedRealtimeTransports();
    await persistStatusSafe({
      status: "stopped",
      summary: "runtime supervisor stopped"
    });
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
  }
}

function configureRuntimeDnsResolution(): void {
  const configured = DEFAULT_RUNTIME_DNS_RESULT_ORDER;
  try {
    setDefaultResultOrder(configured);
    process.stderr.write(`[agentmc-runtime] dns result order set to ${configured}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[agentmc-runtime] failed to apply DNS result order ${configured}: ${message}\n`);
  }
}

async function runHostHeartbeatLoop(input: {
  client: AgentMCApi;
  workers: RuntimeWorkerConfig[];
  hostFingerprint: string;
  intervalSeconds: number;
  onHostRealtimeSocketChanged?: (socket: HostRealtimeSocketPayload | null) => Promise<void> | void;
  onAgentMappingChanged?: (changedWorkerKeys: string[]) => Promise<void> | void;
  onRestartRequested?: (summary: string) => Promise<void> | void;
  shouldStop: () => boolean;
}): Promise<void> {
  let heartbeatIntervalSeconds = input.intervalSeconds;
  let pendingHostRuntimeUpdates: HostRuntimeCommandUpdate[] = [];

  while (!input.shouldStop()) {
    await sleepWithStop(Math.max(1_000, heartbeatIntervalSeconds * 1000), input.shouldStop);
    if (input.shouldStop()) {
      break;
    }

    try {
      const heartbeat = await sendHostHeartbeat(
        input.client,
        input.workers,
        input.hostFingerprint,
        pendingHostRuntimeUpdates
      );
      pendingHostRuntimeUpdates = [];
      const changedWorkerKeys = applyHeartbeatAgentMapping(input.workers, heartbeat.agents);
      if (
        heartbeat.heartbeatIntervalSeconds !== null &&
        heartbeat.heartbeatIntervalSeconds !== heartbeatIntervalSeconds
      ) {
        heartbeatIntervalSeconds = heartbeat.heartbeatIntervalSeconds;
        process.stderr.write(
          `[agentmc-runtime] host heartbeat interval updated interval=${heartbeatIntervalSeconds}s source=server_defaults\n`
        );
      }
      if (input.onHostRealtimeSocketChanged) {
        await input.onHostRealtimeSocketChanged(heartbeat.hostRealtime);
      }
      if (input.onAgentMappingChanged && changedWorkerKeys.length > 0) {
        await input.onAgentMappingChanged(changedWorkerKeys);
      }

      if (heartbeat.hostRuntimeCommands.length > 0) {
        const commandResult = await executeHostRuntimeCommands({
          commands: heartbeat.hostRuntimeCommands,
          workers: input.workers
        });

        if (commandResult.updates.length > 0) {
          pendingHostRuntimeUpdates = commandResult.updates;

          const ackHeartbeat = await sendHostHeartbeat(
            input.client,
            input.workers,
            input.hostFingerprint,
            pendingHostRuntimeUpdates
          );
          pendingHostRuntimeUpdates = [];

          const ackChangedWorkerKeys = applyHeartbeatAgentMapping(input.workers, ackHeartbeat.agents);
          if (
            ackHeartbeat.heartbeatIntervalSeconds !== null &&
            ackHeartbeat.heartbeatIntervalSeconds !== heartbeatIntervalSeconds
          ) {
            heartbeatIntervalSeconds = ackHeartbeat.heartbeatIntervalSeconds;
            process.stderr.write(
              `[agentmc-runtime] host heartbeat interval updated interval=${heartbeatIntervalSeconds}s source=server_defaults\n`
            );
          }
          if (input.onHostRealtimeSocketChanged) {
            await input.onHostRealtimeSocketChanged(ackHeartbeat.hostRealtime);
          }
          if (input.onAgentMappingChanged && ackChangedWorkerKeys.length > 0) {
            await input.onAgentMappingChanged(ackChangedWorkerKeys);
          }
        }

        if (commandResult.restartRequested) {
          if (input.onRestartRequested) {
            await input.onRestartRequested("host provisioning command completed; restarting runtime supervisor");
          }

          return;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[agentmc-runtime] host heartbeat failed: ${message}\n`);
    }
  }
}

async function executeHostRuntimeCommands(input: {
  commands: HostRuntimeCommand[];
  workers: RuntimeWorkerConfig[];
}): Promise<{ updates: HostRuntimeCommandUpdate[]; restartRequested: boolean }> {
  const updates: HostRuntimeCommandUpdate[] = [];
  let restartRequested = false;

  for (const command of input.commands) {
    try {
      if (command.type === "agent.provision" && command.provider?.toLowerCase() === "openclaw") {
        const result = provisionOpenClawAgent(command, input.workers);
        updates.push({
          id: command.id,
          status: "completed",
          result
        });
        restartRequested = true;
        continue;
      }

      updates.push({
        id: command.id,
        status: "failed",
        error: `Unsupported host runtime command: ${command.type} (${command.provider ?? "unknown provider"}).`
      });
    } catch (error) {
      updates.push({
        id: command.id,
        status: "failed",
        error: normalizeCommandError(error).message
      });
    }
  }

  return { updates, restartRequested };
}

function provisionOpenClawAgent(
  command: HostRuntimeCommand,
  workers: RuntimeWorkerConfig[]
): Record<string, unknown> {
  const runtimeKey = normalizeProvisionRuntimeKey(
    nonEmpty(command.payload.runtime_key) ??
      nonEmpty(command.payload.agent_key) ??
      nonEmpty(command.payload.agent_name)
  );
  if (!runtimeKey) {
    throw new Error("OpenClaw provisioning requires a valid runtime key.");
  }

  const agentName = nonEmpty(command.payload.agent_name) ?? runtimeKey;
  const agentEmoji = nonEmpty(command.payload.agent_emoji);
  const workspaceDir = resolveProvisionWorkspaceDir(workers, runtimeKey);
  const openclawCommand = "openclaw";

  if (!resolveExistingOpenClawWorker(runtimeKey, workers) && !detectExistingOpenClawAgentSync(runtimeKey)) {
    runOpenClawCommandWithNonInteractiveFallback(
      openclawCommand,
      ["agents", "add", runtimeKey, "--workspace", workspaceDir, "--non-interactive", "--json"],
      ["agents", "add", runtimeKey, "--workspace", workspaceDir, "--json"],
      runtimeKey
    );
  }

  if (agentName !== runtimeKey || agentEmoji) {
    runOpenClawCommandWithNonInteractiveFallback(
      openclawCommand,
      ["agents", "set-identity", "--non-interactive", "--agent", runtimeKey, "--name", agentName, ...(agentEmoji ? ["--emoji", agentEmoji] : [])],
      ["agents", "set-identity", "--agent", runtimeKey, "--name", agentName, ...(agentEmoji ? ["--emoji", agentEmoji] : [])],
      runtimeKey
    );
  }

  const discovered = detectExistingOpenClawAgentSync(runtimeKey);

  process.stderr.write(
    `[agentmc-runtime] provisioned openclaw agent key=${runtimeKey} workspace=${discovered?.workspaceDir ?? workspaceDir}\n`
  );

  return {
    runtime_key: runtimeKey,
    runtime_agent_name: agentName,
    workspace_dir: discovered?.workspaceDir ?? workspaceDir
  };
}

function resolveProvisionWorkspaceDir(workers: RuntimeWorkerConfig[], runtimeKey: string): string {
  const configuredDefault = resolveOpenClawDefaultWorkspace();
  if (configuredDefault) {
    return deriveProvisionWorkspacePath(configuredDefault, runtimeKey);
  }

  const firstOpenClawWorker = workers.find((worker) => nonEmpty(worker.provider)?.toLowerCase() === "openclaw");
  const existingWorkspace = nonEmpty(firstOpenClawWorker?.workspaceDir);
  if (existingWorkspace) {
    return deriveProvisionWorkspacePath(existingWorkspace, runtimeKey);
  }

  throw new Error("Unable to resolve an OpenClaw workspace path for agent provisioning.");
}

function deriveProvisionWorkspacePath(sourceWorkspace: string, runtimeKey: string): string {
  const trimmed = sourceWorkspace.trim().replace(/\/+$/, "");
  const baseName = trimmed.endsWith("/workspace") ? "workspace" : trimmed.split("/").pop() ?? "workspace";

  return resolve(dirname(trimmed), `${baseName}-${runtimeKey}`);
}

function resolveOpenClawDefaultWorkspace(): string | null {
  const config = readOpenClawConfigObject();
  const defaults = valueAsObject(valueAsObject(config?.agents)?.defaults);

  return nonEmpty(defaults?.workspace);
}

function readOpenClawConfigObject(): Record<string, unknown> | null {
  const homeDir = nonEmpty(process.env.HOME);
  const candidates = [
    homeDir ? resolve(homeDir, ".openclaw", "openclaw.json") : null,
    "/root/.openclaw/openclaw.json",
    resolve(process.cwd(), ".openclaw", "openclaw.json")
  ].filter((value): value is string => Boolean(value));

  for (const configPath of candidates) {
    if (!existsSync(configPath)) {
      continue;
    }

    try {
      const parsed = JSON.parse(readFileSync(configPath, "utf8"));
      const object = valueAsObject(parsed);
      if (object) {
        return object;
      }
    } catch {
      // Keep checking other candidate config paths.
    }
  }

  return null;
}

function runOpenClawCommandWithNonInteractiveFallback(
  command: string,
  argsWithNonInteractive: string[],
  argsWithoutNonInteractive: string[],
  runtimeKey: string
): void {
  try {
    execFileSync(command, argsWithNonInteractive, {
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"]
    });

    return;
  } catch (error) {
    if (isOpenClawAgentAlreadyExistsError(error, runtimeKey)) {
      return;
    }

    if (!isUnknownNonInteractiveOptionError(error)) {
      throw error;
    }
  }

  try {
    execFileSync(command, argsWithoutNonInteractive, {
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    if (isOpenClawAgentAlreadyExistsError(error, runtimeKey)) {
      return;
    }

    throw error;
  }
}

function resolveExistingOpenClawWorker(runtimeKey: string, workers: RuntimeWorkerConfig[]): RuntimeWorkerConfig | null {
  const normalizedKey = runtimeKey.toLowerCase();

  for (const worker of workers) {
    const workerKey = nonEmpty(worker.openclawAgent) ?? nonEmpty(worker.localKey);
    if (workerKey?.toLowerCase() === normalizedKey) {
      return worker;
    }
  }

  return null;
}

function detectExistingOpenClawAgentSync(runtimeKey: string): { workspaceDir: string | null } | null {
  const config = readOpenClawConfigObject();
  const agentsRoot = valueAsObject(config?.agents);
  if (!agentsRoot) {
    return null;
  }

  const rawList = Array.isArray(agentsRoot.list)
    ? agentsRoot.list
    : Object.entries(valueAsObject(agentsRoot.list) ?? {}).map(([id, row]) => {
        const objectRow = valueAsObject(row);
        return objectRow ? { id, ...objectRow } : null;
      }).filter((row) => row !== null) as Array<Record<string, unknown>>;

  for (const row of rawList) {
    const objectRow = valueAsObject(row);
    if (!objectRow) {
      continue;
    }

    const key =
      nonEmpty(objectRow.id) ??
      nonEmpty(objectRow.agent_key) ??
      nonEmpty(objectRow.agentKey) ??
      nonEmpty(objectRow.name);
    if (key?.toLowerCase() !== runtimeKey.toLowerCase()) {
      continue;
    }

    return {
      workspaceDir:
        nonEmpty(objectRow.workspace) ??
        nonEmpty(objectRow.workspace_path) ??
        nonEmpty(objectRow.workspacePath) ??
        nonEmpty(valueAsObject(valueAsObject(config?.agents)?.defaults)?.workspace) ??
        null
    };
  }

  return null;
}

function isUnknownNonInteractiveOptionError(error: unknown): boolean {
  const candidates = extractCommandErrorText(error);
  if (!candidates.includes("--non-interactive")) {
    return false;
  }

  return (
    candidates.includes("unknown option") ||
    candidates.includes("unknown argument") ||
    candidates.includes("unrecognized option")
  );
}

function isOpenClawAgentAlreadyExistsError(error: unknown, runtimeKey: string): boolean {
  const candidates = extractCommandErrorText(error);

  return (
    (candidates.includes("already exists") || candidates.includes("duplicate")) &&
    (candidates.includes(runtimeKey.toLowerCase()) || candidates.includes("agent"))
  );
}

function extractCommandErrorText(error: unknown): string {
  const object = valueAsObject(error);

  return [
    nonEmpty(object?.message),
    nonEmpty(object?.stderr),
    nonEmpty(object?.stdout),
    error instanceof Error ? error.message : null
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n")
    .toLowerCase();
}

function normalizeProvisionRuntimeKey(value: unknown): string | null {
  const normalized = nonEmpty(value);
  if (!normalized) {
    return null;
  }

  const slug = normalized
    .replace(/[^A-Za-z0-9_.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return slug !== "" ? slug.slice(0, 160) : null;
}

function normalizeCommandError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

async function runHostRealtimeSessionRoutingLoop(input: {
  client: AgentMCApi;
  workers: RuntimeWorkerConfig[];
  activeRuntimes: Map<string, AgentRuntimeProgram>;
  intervalMs: number;
  queryLimit: number;
  getHostRealtimeSocket: () => HostRealtimeSocketPayload | null;
  shouldStop: () => boolean;
}): Promise<void> {
  const sessionLimit = Math.max(1, Math.min(100, input.queryLimit));
  let hostRealtimeSubscription: Awaited<
    ReturnType<AgentMCApi["subscribeToHostRealtimeSessionRequests"]>
  > | null = null;
  let hostRealtimeSocketKey: string | null = null;
  let subscribeRetryAtMs = 0;
  let nextPollAtMs = 0;
  let immediatePollRequested = true;

  const buildRuntimeByAgentId = (): Map<number, AgentRuntimeProgram> => {
    const runtimeByAgentId = new Map<number, AgentRuntimeProgram>();
    for (const worker of input.workers) {
      const agentId = worker.agentId;
      if (!agentId || agentId < 1) {
        continue;
      }
      const runtime = input.activeRuntimes.get(worker.localKey);
      if (!runtime) {
        continue;
      }
      runtimeByAgentId.set(agentId, runtime);
    }
    return runtimeByAgentId;
  };

  const attachHintedSession = (sessionId: number | null, agentId: number | null): boolean => {
    if (!sessionId || sessionId < 1 || !agentId || agentId < 1) {
      return false;
    }

    const runtimeByAgentId = buildRuntimeByAgentId();
    const runtime = runtimeByAgentId.get(agentId);
    if (!runtime) {
      return false;
    }

    return runtime.attachRealtimeSession(sessionId);
  };

  const routeRequestedSessions = async (runtimeByAgentId: Map<number, AgentRuntimeProgram>): Promise<number> => {
    try {
      // Query once in host context; server returns sessions across host-assigned agents.
      const response = await input.client.operations.listAgentRealtimeRequestedSessions({
        params: {
          query: {
            limit: sessionLimit
          }
        }
      });

      if (response.error) {
        const status = Number(response.status || 0);
        const summary = summarizeApiError(response.error);
        const retryAfterSeconds = resolveRetryAfterSeconds(response.response, response.error);
        const backoffMs = resolveHostRealtimeRoutingBackoffMs({
          intervalMs: input.intervalMs,
          status,
          retryAfterSeconds
        });
        process.stderr.write(
          `[agentmc-runtime] host realtime routing failed: listAgentRealtimeRequestedSessions failed with status ${response.status}${summary ? ` (${summary})` : ""}; backing off ${backoffMs}ms\n`
        );
        return backoffMs;
      }

      const payload = valueAsObject(response.data) ?? (await readJsonResponseObject(response.response));
      const sessions = Array.isArray(payload?.data) ? payload.data : [];
      const orderedSessions = [...sessions].sort((left, right) => {
        const leftId = toPositiveInt(valueAsObject(left)?.id) ?? 0;
        const rightId = toPositiveInt(valueAsObject(right)?.id) ?? 0;
        return rightId - leftId;
      });
      let routedSessions = 0;

      for (const session of orderedSessions) {
        const sessionObject = valueAsObject(session);
        if (!sessionObject) {
          continue;
        }

        const sessionId = toPositiveInt(sessionObject.id);
        const status = nonEmpty(sessionObject.status)?.toLowerCase();
        if (sessionId === null || !isRecoverableHostRealtimeSessionStatus(status)) {
          continue;
        }

        const sessionAgentId = toPositiveInt(sessionObject.agent_id);
        if (!sessionAgentId) {
          continue;
        }

        const runtime = runtimeByAgentId.get(sessionAgentId);
        if (!runtime) {
          continue;
        }

        runtime.attachRealtimeSession(sessionId);
        routedSessions += 1;
      }

      if (hostRealtimeSubscription) {
        // Push events drive immediate routing; keep only a low-frequency API reconciliation poll.
        return Math.max(DEFAULT_HOST_REALTIME_CONNECTED_RECONCILE_POLL_MS, input.intervalMs * 10);
      }

      const idlePollMs = Math.max(input.intervalMs, 5_000);
      return routedSessions > 0 ? input.intervalMs : idlePollMs;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[agentmc-runtime] host realtime routing failed: ${message}\n`);
      return Math.max(input.intervalMs, 3_000);
    }
  };

  const disconnectHostRealtimeSubscription = async (): Promise<void> => {
    if (!hostRealtimeSubscription) {
      return;
    }

    try {
      await hostRealtimeSubscription.disconnect();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[agentmc-runtime] host realtime push disconnect failed: ${message}\n`);
    } finally {
      hostRealtimeSubscription = null;
      hostRealtimeSocketKey = null;
    }
  };

  const maybeStartHostRealtimeSubscription = async (): Promise<void> => {
    const nowMs = Date.now();
    if (nowMs < subscribeRetryAtMs) {
      return;
    }

    const socket = input.getHostRealtimeSocket();
    const socketKey = serializeHostRealtimeSocketKey(socket);
    if (!socket || !socketKey) {
      await disconnectHostRealtimeSubscription();
      return;
    }

    if (hostRealtimeSubscription && socketKey === hostRealtimeSocketKey) {
      return;
    }

    await disconnectHostRealtimeSubscription();

    try {
      const subscription = await input.client.subscribeToHostRealtimeSessionRequests({
        socket,
        onReady: () => {
          immediatePollRequested = true;
          nextPollAtMs = Math.min(nextPollAtMs, Date.now());
          const channel = nonEmpty(valueAsObject(socket)?.channel) ?? "unknown";
          const event = nonEmpty(valueAsObject(socket)?.event) ?? "agent.realtime.host.session.requested";
          process.stderr.write(
            `[agentmc-runtime] host realtime push subscribed channel=${channel} event=${event}\n`
          );
        },
        onSessionRequested: (event) => {
          if (!attachHintedSession(event.sessionId, event.agentId)) {
            immediatePollRequested = true;
            nextPollAtMs = Math.min(nextPollAtMs, Date.now());
          }
        },
        onConnectionStateChange: (state) => {
          if (state === "connected") {
            immediatePollRequested = true;
            nextPollAtMs = Math.min(nextPollAtMs, Date.now());
          }
        },
        onError: (error) => {
          process.stderr.write(`[agentmc-runtime] host realtime push error: ${error.message}\n`);
        }
      });

      await subscription.ready;
      hostRealtimeSubscription = subscription;
      hostRealtimeSocketKey = socketKey;
      subscribeRetryAtMs = 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[agentmc-runtime] host realtime push unavailable: ${message}\n`);
      await disconnectHostRealtimeSubscription();
      subscribeRetryAtMs = nowMs + Math.max(5_000, input.intervalMs * 4);
    }
  };

  try {
    while (!input.shouldStop()) {
      const runtimeByAgentId = buildRuntimeByAgentId();
      if (runtimeByAgentId.size === 0) {
        await disconnectHostRealtimeSubscription();
        await sleepWithStop(input.intervalMs, input.shouldStop);
        continue;
      }

      await maybeStartHostRealtimeSubscription();

      const nowMs = Date.now();
      if (!immediatePollRequested && nowMs < nextPollAtMs) {
        await sleepWithStop(Math.min(500, Math.max(100, nextPollAtMs - nowMs)), input.shouldStop);
        continue;
      }

      immediatePollRequested = false;
      const nextDelayMs = await routeRequestedSessions(runtimeByAgentId);
      nextPollAtMs = Date.now() + nextDelayMs;
    }
  } finally {
    await disconnectHostRealtimeSubscription();
  }
}

async function runAutoUpdateLoop(input: {
  config: RuntimeAutoUpdateConfig;
  shouldStop: () => boolean;
  onUpdateInstalled: (input: { fromVersion: string | null; toVersion: string }) => Promise<void> | void;
}): Promise<void> {
  const currentVersion = nonEmpty(AGENTMC_NODE_PACKAGE_VERSION);

  while (!input.shouldStop()) {
    await sleepWithStop(input.config.intervalSeconds * 1000, input.shouldStop);
    if (input.shouldStop()) {
      break;
    }

    try {
      const latestVersion = await fetchLatestPackageVersion(input.config.registryUrl);
      if (!latestVersion) {
        continue;
      }
      if (currentVersion && latestVersion === currentVersion) {
        continue;
      }

      process.stderr.write(
        `[agentmc-runtime] auto-update found ${input.config.packageName}@${latestVersion} (current=${currentVersion ?? "unknown"}); installing...\n`
      );
      installLatestPackageVersion({
        npmCommand: input.config.npmCommand,
        installDir: input.config.installDir,
        installTimeoutMs: input.config.installTimeoutMs,
        packageName: input.config.packageName,
        targetVersion: latestVersion
      });
      process.stderr.write(
        `[agentmc-runtime] auto-update installed ${input.config.packageName}@${latestVersion}; restarting runtime.\n`
      );
      await input.onUpdateInstalled({
        fromVersion: currentVersion,
        toVersion: latestVersion
      });
      return;
    } catch (error) {
      const message = summarizeRuntimeAutoUpdateError(error);
      process.stderr.write(`[agentmc-runtime] auto-update check failed: ${message}\n`);
    }
  }
}

async function fetchLatestPackageVersion(registryUrl: string): Promise<string | null> {
  const response = await fetch(registryUrl, {
    headers: {
      Accept: "application/json",
      "User-Agent": "agentmc-runtime-auto-update"
    }
  });

  if (!response.ok) {
    throw new Error(`registry request failed with HTTP ${response.status}`);
  }

  const payload = valueAsObject(await response.json());
  return nonEmpty(payload?.version);
}

async function readJsonResponseObject(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return valueAsObject(await response.clone().json());
  } catch {
    return null;
  }
}

function installLatestPackageVersion(input: {
  npmCommand: string;
  installDir: string;
  installTimeoutMs: number;
  packageName: string;
  targetVersion: string;
}): void {
  execFileSync(
    input.npmCommand,
    [
      "install",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      "--no-save",
      `${input.packageName}@${input.targetVersion}`
    ],
    {
      cwd: input.installDir,
      env: process.env,
      stdio: "pipe",
      encoding: "utf8",
      timeout: input.installTimeoutMs
    }
  );
}

function summarizeRuntimeAutoUpdateError(error: unknown): string {
  const object = valueAsObject(error);
  const stderrValue = object ? valueAsCommandOutput(object.stderr) : null;
  if (stderrValue) {
    return stderrValue;
  }

  const stdoutValue = object ? valueAsCommandOutput(object.stdout) : null;
  if (stdoutValue) {
    return stdoutValue;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function valueAsCommandOutput(value: unknown): string | null {
  if (typeof value === "string") {
    return nonEmpty(value);
  }
  if (value instanceof Buffer) {
    return nonEmpty(value.toString("utf8"));
  }
  return null;
}

async function sleepWithStop(totalMs: number, shouldStop: () => boolean): Promise<void> {
  let remaining = Math.max(0, totalMs);
  while (remaining > 0 && !shouldStop()) {
    const stepMs = Math.min(1_000, remaining);
    await sleep(stepMs);
    remaining -= stepMs;
  }
}

function buildHostHeartbeatPayload(
  workers: RuntimeWorkerConfig[],
  hostFingerprint: string,
  hostRuntimeUpdates: HostRuntimeCommandUpdate[] = []
): Record<string, unknown> {
  const privateIp = resolvePrivateIp();
  const publicIp = privateIp ?? "127.0.0.1";
  const configuredRuntimeProvider = normalizeRuntimeProvider(null);
  const resolvedRuntimeProvider = resolveHostHeartbeatRuntimeProvider(configuredRuntimeProvider, workers);
  const runtimeIdentity = resolveHostHeartbeatRuntimeIdentity(configuredRuntimeProvider, resolvedRuntimeProvider);
  const models = resolveHostHeartbeatModels(workers, resolvedRuntimeProvider);
  const heartbeatModels =
    models.length > 0 ? models : resolveHostHeartbeatFallbackModels(runtimeIdentity, resolvedRuntimeProvider);
  const hasOpenClawWorkers = workers.some((worker) => nonEmpty(worker.provider)?.toLowerCase() === "openclaw");
  const latestOpenClawProfiles =
    hasOpenClawWorkers
      ? resolveLatestHostHeartbeatOpenClawProfiles()
      : new Map<string, { name: string | null; emoji: string | null }>();
  const openClawStatus =
    hasOpenClawWorkers
      ? readOpenClawHeartbeatStatus("openclaw")
      : null;
  const openClawAgentMeta = buildOpenClawHeartbeatAgentMetaMap(openClawStatus);

  const agentPayloads = workers.map((worker) => {
    updateWorkerProfileFromHeartbeat(worker, latestOpenClawProfiles);
    const resolvedName = worker.localName ?? worker.localKey;
    const resolvedEmoji = nonEmpty(worker.localEmoji) ?? null;
    const agentMeta = resolveHostHeartbeatAgentMeta(worker, openClawAgentMeta);

    return {
      ...(worker.agentId !== null ? { id: worker.agentId } : {}),
      name: resolvedName,
      ...(resolvedEmoji ? { emoji: resolvedEmoji } : {}),
      type: worker.provider ?? "runtime",
      ...(agentMeta ? { meta: agentMeta } : {}),
      identity: {
        name: resolvedName,
        ...(resolvedEmoji ? { emoji: resolvedEmoji } : {}),
        agent_key: worker.localKey,
        openclaw_agent: worker.openclawAgent ?? worker.localKey
      }
    };
  });

  return {
    meta: {
      runtime: {
        name: runtimeIdentity.name,
        version: runtimeIdentity.version,
        ...(runtimeIdentity.build ? { build: runtimeIdentity.build } : {}),
        mode: runtimeIdentity.mode
      },
      type: runtimeIdentity.type,
      runtime_mode: runtimeIdentity.mode,
      models: heartbeatModels,
      ...(AGENTMC_NODE_PACKAGE_VERSION ? { agentmc_node_package_version: AGENTMC_NODE_PACKAGE_VERSION } : {}),
      ...(runtimeIdentity.openclawVersion ? { openclaw_version: runtimeIdentity.openclawVersion } : {}),
      ...(runtimeIdentity.openclawBuild ? { openclaw_build: runtimeIdentity.openclawBuild } : {})
    },
    host: {
      fingerprint: hostFingerprint,
      name: hostname(),
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
    agents: agentPayloads,
    ...(hostRuntimeUpdates.length > 0 ? { host_runtime_updates: hostRuntimeUpdates } : {})
  };
}

async function sendHostHeartbeat(
  client: AgentMCApi,
  workers: RuntimeWorkerConfig[],
  hostFingerprint: string,
  hostRuntimeUpdates: HostRuntimeCommandUpdate[] = []
): Promise<HostHeartbeatResult> {
  const payload = buildHostHeartbeatPayload(workers, hostFingerprint, hostRuntimeUpdates);

  const response = await client.request("agentHeartbeat", {
    body: payload as never
  });

  if (response.error) {
    const summary = summarizeApiError(response.error);
    const error = new Error(`agentHeartbeat failed with status ${response.status}${summary ? ` (${summary})` : ""}`) as ApiErrorCarrier;
    error.status = response.status;
    error.apiError = response.error;
    throw error;
  }

  const responseData = valueAsObject(response.data);
  const responseDefaults = valueAsObject(responseData?.defaults);
  const hostRealtime = valueAsObject(responseData?.host_realtime) as HostRealtimeSocketPayload | null;
  const heartbeatIntervalSeconds = toPositiveInt(
    responseDefaults?.heartbeat_interval_seconds ?? responseDefaults?.heartbeatIntervalSeconds
  );
  const hostRuntimeCommands = Array.isArray(responseData?.host_runtime_commands)
    ? responseData.host_runtime_commands
        .map((row) => {
          const objectRow = valueAsObject(row);
          const id = toPositiveInt(objectRow?.id);
          const type = nonEmpty(objectRow?.type);
          if (id === null || !type) {
            return null;
          }

          return {
            id,
            type,
            provider: nonEmpty(objectRow?.provider),
            payload: valueAsObject(objectRow?.payload) ?? {}
          } satisfies HostRuntimeCommand;
        })
        .filter((row): row is HostRuntimeCommand => row !== null)
    : [];
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

  return {
    agents: rows,
    hostRealtime,
    heartbeatIntervalSeconds,
    hostRuntimeCommands
  };
}


function resolveHostHeartbeatAgentMeta(
  worker: RuntimeWorkerConfig,
  metaByAgent: Map<string, Record<string, unknown>>
): Record<string, unknown> | null {
  const agentKeys = [
    nonEmpty(worker.openclawAgent),
    nonEmpty(worker.localKey)
  ].filter((value): value is string => Boolean(value));

  for (const agentKey of agentKeys) {
    const resolved = metaByAgent.get(agentKey.toLowerCase());
    if (resolved && Object.keys(resolved).length > 0) {
      return resolved;
    }
  }

  return null;
}

function updateWorkerProfileFromHeartbeat(
  worker: RuntimeWorkerConfig,
  profiles: Map<string, { name: string | null; emoji: string | null }>
): void {
  const lookupKey = nonEmpty(worker.openclawAgent) ?? nonEmpty(worker.localKey);
  if (!lookupKey) {
    return;
  }

  const profile = profiles.get(lookupKey.toLowerCase());
  if (!profile) {
    return;
  }

  if (profile.name) {
    worker.localName = profile.name;
  }

  if (profile.emoji) {
    worker.localEmoji = profile.emoji;
  }
}

function resolveLatestHostHeartbeatOpenClawProfiles(
): Map<string, { name: string | null; emoji: string | null }> {
  const command = "openclaw";
  const rows = resolveOpenClawHeartbeatAgentRows(command);
  const profiles = new Map<string, { name: string | null; emoji: string | null }>();

  for (const row of rows) {
    const identity = valueAsObject(row.identity);
    const runtimeAgent = valueAsObject(row.runtime_agent);
    const rowAgent = valueAsObject(row.agent);
    const key =
      nonEmpty(row.key) ??
      nonEmpty(row.id) ??
      nonEmpty(row.agent) ??
      nonEmpty(row.agent_key) ??
      nonEmpty(row.agentKey) ??
      nonEmpty(row.slug) ??
      nonEmpty(row.openclaw_agent) ??
      nonEmpty(row.openclawAgent) ??
      nonEmpty(identity?.agent_key) ??
      nonEmpty(identity?.agentKey) ??
      nonEmpty(identity?.openclaw_agent) ??
      nonEmpty(identity?.openclawAgent) ??
      nonEmpty(runtimeAgent?.key) ??
      nonEmpty(runtimeAgent?.agent_key) ??
      nonEmpty(runtimeAgent?.agentKey) ??
      nonEmpty(rowAgent?.key) ??
      nonEmpty(rowAgent?.agent_key) ??
      nonEmpty(rowAgent?.agentKey);
    if (!key) {
      continue;
    }

    profiles.set(key.toLowerCase(), {
      name: resolveOpenClawAgentRowName(row, identity),
      emoji: extractIdentityEmojiFromObject(row) ?? extractIdentityEmojiFromObject(identity)
    });
  }

  return profiles;
}

function readOpenClawHeartbeatStatus(command: string): Record<string, unknown> | null {
  const candidates: string[][] = [
    ["status", "--usage", "--json"],
    ["status", "--json", "--usage"],
    ["status", "--json"]
  ];

  for (const args of candidates) {
    const parsed = readCommandJsonObjectOutput(command, args);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function buildOpenClawHeartbeatAgentMetaMap(
  status: Record<string, unknown> | null
): Map<string, Record<string, unknown>> {
  const metaByAgent = new Map<string, Record<string, unknown>>();
  if (!status) {
    return metaByAgent;
  }

  const sharedUsageMeta = extractOpenClawUsageMeta(status);
  const sessions = valueAsObject(status.sessions);
  const byAgent = Array.isArray(sessions?.byAgent) ? sessions.byAgent : [];

  for (const entry of byAgent) {
    const byAgentEntry = valueAsObject(entry);
    if (!byAgentEntry) {
      continue;
    }

    const agentId = nonEmpty(byAgentEntry.agentId);
    if (!agentId) {
      continue;
    }

    const recent = Array.isArray(byAgentEntry.recent) ? byAgentEntry.recent : [];
    const session = selectRecentOpenClawSession(recent);
    if (!session) {
      continue;
    }

    const telemetry = {
      ...sharedUsageMeta,
      ...extractOpenClawSessionMeta(session)
    };

    if (Object.keys(telemetry).length > 0) {
      metaByAgent.set(agentId.toLowerCase(), telemetry);
    }
  }

  if (metaByAgent.size > 0) {
    return metaByAgent;
  }

  const recent = Array.isArray(sessions?.recent) ? sessions.recent : [];
  for (const row of recent) {
    const session = valueAsObject(row);
    const agentId = nonEmpty(session?.agentId);
    if (!session || !agentId) {
      continue;
    }

    const telemetry = {
      ...sharedUsageMeta,
      ...extractOpenClawSessionMeta(session)
    };

    if (Object.keys(telemetry).length > 0) {
      metaByAgent.set(agentId.toLowerCase(), telemetry);
    }
  }

  return metaByAgent;
}

function selectRecentOpenClawSession(values: unknown[]): Record<string, unknown> | null {
  const sessions = values
    .map((entry) => valueAsObject(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));

  if (sessions.length === 0) {
    return null;
  }

  sessions.sort((left, right) => {
    const rightUpdatedAt = toPositiveInt(right.updatedAt) ?? 0;
    const leftUpdatedAt = toPositiveInt(left.updatedAt) ?? 0;
    return rightUpdatedAt - leftUpdatedAt;
  });

  return sessions[0] ?? null;
}

function extractOpenClawSessionMeta(session: Record<string, unknown>): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  const totalTokens = toPositiveInt(session.totalTokens);
  const outputTokens = toNonNegativeInt(session.outputTokens);
  const cacheRead = toNonNegativeInt(session.cacheRead);
  const cacheWrite = toNonNegativeInt(session.cacheWrite);
  const contextTokens = toPositiveInt(session.contextTokens);
  const percentUsed =
    toFiniteNumber(session.percentUsed) ??
    (totalTokens !== null && contextTokens !== null && contextTokens > 0
      ? Number(((totalTokens / contextTokens) * 100).toFixed(2))
      : null);
  const runtimeMode = nonEmpty(session.kind);
  const sessionKey = nonEmpty(session.key) ?? nonEmpty(session.sessionId);

  if (totalTokens !== null) {
    meta.tokens_in = totalTokens;
    meta.context_tokens_used = totalTokens;
  }
  if (outputTokens !== null) {
    meta.tokens_out = outputTokens;
  }
  if (cacheRead !== null) {
    meta.cache_tokens_cached = cacheRead;
  }
  if (cacheWrite !== null) {
    meta.cache_tokens_new = cacheWrite;
  }
  if (contextTokens !== null) {
    meta.context_tokens_max = contextTokens;
  }
  if (percentUsed !== null) {
    meta.context_percent_used = percentUsed;
  }
  if (cacheRead !== null && totalTokens !== null && totalTokens > 0) {
    meta.cache_hit_rate_percent = Math.max(0, Math.min(100, Math.round((cacheRead / totalTokens) * 100)));
  }
  if (runtimeMode) {
    meta.runtime_mode = runtimeMode;
  }
  if (sessionKey) {
    meta.session = sessionKey;
  }

  return meta;
}

function extractOpenClawUsageMeta(status: Record<string, unknown>): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  const usage = valueAsObject(status.usage);
  const providers = Array.isArray(usage?.providers) ? usage.providers : [];
  const provider = providers
    .map((entry) => valueAsObject(entry))
    .find((entry) => Array.isArray(entry?.windows) && entry.windows.length > 0)
    ?? null;
  if (!provider) {
    return meta;
  }

  const windows = Array.isArray(provider.windows) ? provider.windows : [];
  const primary = normalizeOpenClawUsageWindow(windows[0]);
  const secondary = normalizeOpenClawUsageWindow(windows[1]);

  if (primary) {
    if (primary.label) {
      meta.usage_window_label = primary.label;
    }
    if (primary.percentLeft !== null) {
      meta.usage_window_percent_left = primary.percentLeft;
    }
    if (primary.timeLeft) {
      meta.usage_window_time_left = primary.timeLeft;
    }
  }

  if (secondary) {
    if (secondary.label) {
      meta.usage_day_label = secondary.label;
    }
    if (secondary.percentLeft !== null) {
      meta.usage_day_percent_left = secondary.percentLeft;
    }
    if (secondary.timeLeft) {
      meta.usage_day_time_left = secondary.timeLeft;
    }
  }

  return meta;
}

function normalizeOpenClawUsageWindow(
  value: unknown
): { label: string | null; percentLeft: number | null; timeLeft: string | null } | null {
  const window = valueAsObject(value);
  if (!window) {
    return null;
  }

  const usedPercent = toFiniteNumber(window.usedPercent);
  const percentLeft =
    toFiniteNumber(window.percent_left) ??
    toFiniteNumber(window.percentLeft) ??
    (usedPercent !== null ? Math.max(0, Math.min(100, 100 - usedPercent)) : null);
  const label = nonEmpty(window.label) ?? nonEmpty(window.name);
  const timeLeft =
    nonEmpty(window.time_left) ??
    nonEmpty(window.timeLeft) ??
    formatOpenClawResetTime(window.resetAt);

  if (label === null && percentLeft === null && timeLeft === null) {
    return null;
  }

  return { label, percentLeft, timeLeft };
}

function formatOpenClawResetTime(value: unknown): string | null {
  const resetAt = toPositiveInt(value);
  if (resetAt === null) {
    return null;
  }

  const deltaMs = Math.max(0, resetAt - Date.now());
  const totalMinutes = Math.floor(deltaMs / 60000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
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

function resolveOpenClawHeartbeatAgentRows(command: string): Record<string, unknown>[] {
  const commands: string[][] = [
    ["agents", "list", "--json"],
    ["gateway", "call", "agents.list", "--json"],
    ["gateway", "call", "agents.list", "--json", "--params", "{}"],
    ["gateway", "call", "config.get", "--json"]
  ];

  for (const args of commands) {
    const payload = readCommandJsonUnknownOutput(command, args);
    if (payload === null) {
      continue;
    }

    const rows = extractOpenClawAgentRows(payload);
    if (rows.length > 0) {
      return rows;
    }
  }

  return [];
}

function readCommandJsonUnknownOutput(command: string, args: readonly string[]): unknown | null {
  try {
    const stdout = execFileSync(command, [...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return parseJsonUnknownOutput(stdout);
  } catch (error) {
    const normalizedError = error as { stdout?: string | Buffer; stderr?: string | Buffer };
    const stdout = parseJsonUnknownOutput(execOutputToString(normalizedError.stdout));
    if (stdout !== null) {
      return stdout;
    }

    return parseJsonUnknownOutput(execOutputToString(normalizedError.stderr));
  }
}

function parseJsonUnknownOutput(value: string): unknown | null {
  const trimmed = String(value ?? "").trim();
  if (trimmed === "") {
    return null;
  }

  const direct = parseJsonUnknownCandidate(trimmed);
  if (direct !== null) {
    return direct;
  }

  const firstLine = firstNonEmptyLine(trimmed);
  if (firstLine) {
    const lineParsed = parseJsonUnknownCandidate(firstLine);
    if (lineParsed !== null) {
      return lineParsed;
    }
  }

  const candidate = extractFirstJsonCandidate(trimmed);
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

function extractOpenClawAgentRows(payload: unknown): Record<string, unknown>[] {
  const queue: unknown[] = [payload];
  const visited = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || current === null || visited.has(current)) {
      continue;
    }
    visited.add(current);

    const rows = coerceOpenClawAgentRows(current);
    if (rows.length > 0) {
      return rows;
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        queue.push(item);
      }
      continue;
    }

    const object = valueAsObject(current);
    if (!object) {
      continue;
    }

    queue.push(
      object.payload,
      object.result,
      object.response,
      object.data,
      object.config,
      object.parsed,
      object.agents,
      object.list,
      object.items
    );
  }

  return [];
}

function coerceOpenClawAgentRows(candidate: unknown): Record<string, unknown>[] {
  if (Array.isArray(candidate)) {
    return candidate
      .map((entry) => valueAsObject(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== null)
      .filter((entry) => isLikelyOpenClawAgentRow(entry));
  }

  const object = valueAsObject(candidate);
  if (!object) {
    return [];
  }

  const nestedCandidates = [
    object.list,
    object.agents,
    object.data,
    object.items,
    valueAsObject(object.list)?.agents,
    valueAsObject(object.agents)?.agents,
    valueAsObject(object.agents)?.list,
    valueAsObject(object.config)?.agents,
    valueAsObject(valueAsObject(object.config)?.agents)?.list,
    valueAsObject(object.parsed)?.agents,
    valueAsObject(valueAsObject(object.parsed)?.agents)?.list
  ];
  for (const nested of nestedCandidates) {
    const rows = coerceOpenClawAgentRows(nested);
    if (rows.length > 0) {
      return rows;
    }
  }

  return Object.entries(object)
    .map(([mapKey, entry]) => {
      const objectEntry = valueAsObject(entry);
      if (!objectEntry || !isLikelyOpenClawAgentRow(objectEntry)) {
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

      return { key: mapKey, ...objectEntry };
    })
    .filter((entry): entry is Record<string, unknown> => entry !== null);
}

function isLikelyOpenClawAgentRow(row: Record<string, unknown>): boolean {
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

function resolveOpenClawAgentRowName(
  row: Record<string, unknown>,
  identityFromRow: Record<string, unknown> | null
): string | null {
  const rowAgent = valueAsObject(row.agent);
  const rowProfile = valueAsObject(row.profile);
  const rowMeta = valueAsObject(row.meta);
  const identity = identityFromRow ?? valueAsObject(row.identity);

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
    null
  );
}

function extractIdentityEmojiFromObject(value: Record<string, unknown> | null): string | null {
  if (!value) {
    return null;
  }

  const direct =
    nonEmpty(value.emoji) ??
    nonEmpty(value.avatar_emoji) ??
    nonEmpty(value.avatarEmoji) ??
    nonEmpty(value.profile_emoji) ??
    nonEmpty(value.profileEmoji) ??
    nonEmpty(value.icon_emoji) ??
    nonEmpty(value.iconEmoji) ??
    nonEmpty(value.icon) ??
    nonEmpty(value.avatar) ??
    nonEmpty(value.symbol) ??
    nonEmpty(value.glyph);
  if (direct) {
    return direct;
  }

  const nestedIdentity = valueAsObject(value.identity);
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
  const configuredRuntimeVersion: string | null = null;
  const configuredRuntimeBuild: string | null = null;

  if (resolvedProvider === "openclaw") {
    const openclawIdentity = resolveOpenClawVersionIdentity();
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
    name: "agentmc-node-host",
    version: configuredRuntimeVersion ?? process.version,
    build: configuredRuntimeBuild ?? null,
    modelPrefix: resolvedProvider === "external" ? "external" : mode,
    openclawVersion: null,
    openclawBuild: null
  };
}

function resolveOpenClawVersionIdentity(): {
  version: string;
  build: string | null;
} | null {
  const command = "openclaw";
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
  workers: RuntimeWorkerConfig[],
  resolvedProvider: HostHeartbeatRuntimeProvider
): string[] {
  if (resolvedProvider !== "openclaw") {
    return [];
  }

  const command = "openclaw";
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

  return [];
}

function resolveHostHeartbeatFallbackModels(
  runtimeIdentity: ReturnType<typeof resolveHostHeartbeatRuntimeIdentity>,
  resolvedRuntimeProvider: HostHeartbeatRuntimeProvider
): string[] {
  if (resolvedRuntimeProvider === "openclaw") {
    return [];
  }

  return [`${runtimeIdentity.name}@${runtimeIdentity.version}`];
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

function resolveHostFingerprint(): string {
  const seed = [
    hostname(),
    platform(),
    arch(),
    String(cpus().length),
    "https://agentmc.ai/api/v1",
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

function resolveRetryAfterSeconds(response: Response | undefined, error: unknown): number | null {
  const headerValue = response?.headers.get("retry-after");
  const headerSeconds = toPositiveInt(headerValue);
  if (headerSeconds !== null) {
    return headerSeconds;
  }

  const payload = valueAsObject(error);
  const root = valueAsObject(payload?.error) ?? payload;
  const details = valueAsObject(root?.details);
  return toPositiveInt(details?.retry_after);
}

function serializeHostRealtimeSocketKey(socket: HostRealtimeSocketPayload | null): string | null {
  const socketObject = valueAsObject(socket);
  const connection = valueAsObject(socketObject?.connection);
  const key = nonEmpty(connection?.key);
  const host = nonEmpty(connection?.host);
  const channel = nonEmpty(socketObject?.channel);
  if (!key || !host || !channel) {
    return null;
  }

  const scheme = nonEmpty(connection?.scheme) ?? "https";
  const port = toPositiveInt(connection?.port) ?? (scheme.toLowerCase() === "http" ? 80 : 443);
  const cluster = nonEmpty(connection?.cluster) ?? "mt1";
  const path = nonEmpty(connection?.path) ?? "";
  const event = nonEmpty(socketObject?.event) ?? "agent.realtime.host.session.requested";
  return [key, host, String(port), scheme.toLowerCase(), cluster, path, channel, event].join("|");
}

function resolveHostRealtimeRoutingBackoffMs(input: {
  intervalMs: number;
  status: number;
  retryAfterSeconds: number | null;
}): number {
  const baseIntervalMs = Math.max(1_000, input.intervalMs);
  const retryAfterMs = (input.retryAfterSeconds ?? 0) * 1_000;

  if (input.status === 429) {
    return Math.min(60_000, Math.max(retryAfterMs, baseIntervalMs * 4, 5_000));
  }

  if (input.status >= 500 || input.status === 0) {
    return Math.min(20_000, Math.max(baseIntervalMs * 2, 3_000));
  }

  return Math.min(10_000, Math.max(baseIntervalMs, 2_000));
}

function isRecoverableHostRealtimeSessionStatus(status: string | null | undefined): boolean {
  if (status === null || status === undefined) {
    return true;
  }

  return status === "requested" || status === "claimed" || status === "active";
}

function buildRuntimeOptions(worker: RuntimeWorkerConfig, disableHeartbeat = false): AgentRuntimeProgramOptions {
  const provider = normalizeRuntimeProvider(worker.provider);
  return {
    apiKey: worker.apiKey,
    workspaceDir: worker.workspaceDir,
    statePath: worker.statePath,
    agentId: worker.agentId ?? undefined,
    heartbeatEnabled: !disableHeartbeat,
    realtimeSessionPollingEnabled: disableHeartbeat ? false : true,
    runtimeProvider: provider,
    openclawAgent: worker.openclawAgent,
    onInfo: (message, meta) => {
      writeRuntimeLog("info", `worker ${worker.localKey} ${message}`, workerRuntimeLogMeta(worker, meta));
    },
    onError: (error, meta) => {
      writeRuntimeLog("error", `worker ${worker.localKey} ${error.message}`, workerRuntimeLogMeta(worker, meta));
    }
  };
}

async function runRuntimeEntryWithRestart(input: {
  entry: RuntimeEntry;
  activeRuntimes: Map<string, AgentRuntimeProgram>;
  workerRestartDelayMs: number;
  workerRestartMaxDelayMs: number;
  onWorkerEvent?: (input: { worker: RuntimeWorkerConfig; event: string }) => Promise<void> | void;
  shouldStop: () => boolean;
}): Promise<void> {
  const { entry, activeRuntimes, shouldStop } = input;
  const emitWorkerEvent = async (event: string): Promise<void> => {
    if (!input.onWorkerEvent) {
      return;
    }
    try {
      await input.onWorkerEvent({
        worker: entry.worker,
        event
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[agentmc-runtime] worker event callback failed (${event}): ${message}\n`);
    }
  };
  let consecutiveFailures = 0;
  let waitingForAgentId = false;

  while (!shouldStop()) {
    if (entry.worker.agentId === null) {
      if (!waitingForAgentId) {
        waitingForAgentId = true;
        process.stderr.write(
          `[agentmc-runtime] worker paused awaiting AgentMC agent id local=${entry.worker.localKey} provider=${entry.worker.provider ?? "unknown"} workspace=${entry.worker.workspaceDir}\n`
        );
        await emitWorkerEvent("paused-awaiting-agent-id");
      }

      await sleep(DEFAULT_UNRESOLVED_WORKER_WAIT_MS);
      continue;
    }

    if (waitingForAgentId) {
      waitingForAgentId = false;
      process.stderr.write(
        `[agentmc-runtime] worker agent id resolved; resuming local=${entry.worker.localKey} agent=${entry.worker.agentId}\n`
      );
      await emitWorkerEvent("agent-id-resolved");
    }

    const workerLabel =
      `agent=${entry.worker.agentId ?? `auto:${entry.worker.localKey}`} provider=${entry.worker.provider ?? "unknown"} ` +
      `local=${entry.worker.localName ?? "unknown"} workspace=${entry.worker.workspaceDir}`;
    const runtime = new AgentRuntimeProgram(entry.runtimeOptions);
    activeRuntimes.set(entry.worker.localKey, runtime);
    const startedAtMs = Date.now();
    process.stderr.write(`[agentmc-runtime] worker start ${workerLabel}\n`);
    await emitWorkerEvent("starting");

    try {
      await runtime.run();

      if (shouldStop()) {
        break;
      }

      process.stderr.write(`[agentmc-runtime] worker exited unexpectedly; restarting ${workerLabel}\n`);
      await emitWorkerEvent("exited");
    } catch (error) {
      if (shouldStop()) {
        break;
      }

      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[agentmc-runtime] worker crashed ${workerLabel}: ${message}\n`);
      await emitWorkerEvent("crashed");
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
    await emitWorkerEvent("restart-scheduled");
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
    localEmoji: resolveDiscoveredAgentEmoji(local),
    provider: local.provider
  };
}

function resolveDiscoveredAgentEmoji(agent: DiscoveredRuntimeAgent): string | undefined {
  const discoveredEmoji = nonEmpty(agent.emoji);
  if (discoveredEmoji) {
    return discoveredEmoji;
  }

  const meta = valueAsObject(agent.meta);
  if (!meta) {
    return undefined;
  }

  return (
    nonEmpty(meta.emoji) ??
    nonEmpty(meta.avatar_emoji) ??
    nonEmpty(meta.avatarEmoji) ??
    nonEmpty(meta.profile_emoji) ??
    nonEmpty(meta.profileEmoji) ??
    nonEmpty(meta.icon_emoji) ??
    nonEmpty(meta.iconEmoji) ??
    nonEmpty(meta.icon) ??
    nonEmpty(valueAsObject(meta.identity)?.emoji) ??
    undefined
  );
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
    .command("runtime:status")
    .description("Print local AgentMC runtime supervisor status from the server")
    .option("--status-path <path>", "override runtime status file path")
    .option("--service-name <name>", "override systemd service unit name used for diagnostics")
    .option(
      "--errors-since-minutes <minutes>",
      "lookback window for recent runtime errors (journalctl)",
      String(DEFAULT_RUNTIME_ERROR_LOOKBACK_MINUTES)
    )
    .option("--errors-limit <count>", "max recent runtime errors to include", String(DEFAULT_RUNTIME_ERROR_LIMIT))
    .option("--no-recent-errors", "skip journalctl recent runtime error scan")
    .option("--json", "print full status JSON payload", false)
    .action(
      (options: {
        statusPath?: string;
        serviceName?: string;
        errorsSinceMinutes?: string;
        errorsLimit?: string;
        recentErrors?: boolean;
        json?: boolean;
      }) => {
      const statusPath = resolveRuntimeStatusPath(options.statusPath);
      const baseReport = readRuntimeStatusReport(statusPath);
      const serviceName = resolveRuntimeServiceName(options.serviceName);
      const recentErrorWindowMinutes = parseBoundedPositiveInt(
        options.errorsSinceMinutes,
        DEFAULT_RUNTIME_ERROR_LOOKBACK_MINUTES,
        1,
        24 * 60
      );
      const recentErrorLimit = parseBoundedPositiveInt(
        options.errorsLimit,
        DEFAULT_RUNTIME_ERROR_LIMIT,
        1,
        200
      );
      const report = enrichRuntimeStatusReport(baseReport, {
        serviceName,
        includeRecentErrors: options.recentErrors !== false,
        recentErrorWindowMinutes,
        recentErrorLimit
      });
      if (options.json) {
        print(report);
        return;
      }
      printRuntimeStatusReport(report);
    });

  program
    .command("runtime:logs")
    .description("Stream live AgentMC runtime logs from the server journal")
    .option("--service-name <name>", "override systemd service unit name used for log streaming")
    .option("--lines <count>", "number of recent lines to print before following", String(DEFAULT_RUNTIME_LOG_LINES))
    .option(
      "--since-minutes <minutes>",
      "lookback window for the initial log snapshot before follow mode starts",
      String(DEFAULT_RUNTIME_ERROR_LOOKBACK_MINUTES)
    )
    .option("--grep <pattern>", "optional journalctl grep filter")
    .option("--raw", "print raw journalctl output without AgentMC pretty formatting", false)
    .option("--no-follow", "print recent logs without following")
    .action(
      async (options: {
        serviceName?: string;
        lines?: string;
        sinceMinutes?: string;
        grep?: string;
        raw?: boolean;
        follow?: boolean;
      }) => {
        await streamRuntimeLogs({
          serviceName: resolveRuntimeServiceName(options.serviceName),
          lines: parseBoundedPositiveInt(options.lines, DEFAULT_RUNTIME_LOG_LINES, 1, 10_000),
          sinceMinutes: parseBoundedPositiveInt(
            options.sinceMinutes,
            DEFAULT_RUNTIME_ERROR_LOOKBACK_MINUTES,
            1,
            7 * 24 * 60
          ),
          follow: options.follow !== false,
          grep: options.grep,
          raw: options.raw === true
        });
      }
    );

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
