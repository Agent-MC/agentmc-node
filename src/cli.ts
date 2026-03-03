import { Command } from "commander";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, hostname, networkInterfaces, platform, release, totalmem, uptime } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

import { detectRuntimeAgents, type DiscoveredRuntimeAgent } from "./agent-discovery";
import { AgentMCApi } from "./client";
import { operationsById, type OperationId } from "./generated/operations";
import { AGENTMC_NODE_PACKAGE_VERSION } from "./package-version";
import { closeSharedRealtimeTransports } from "./realtime";
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
  localEmoji?: string;
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
type RuntimeSupervisorMode = "multi-agent";
type RuntimeSupervisorStatus = "running" | "stopped";

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
  state_exists: boolean;
  state_error: string | null;
  last_heartbeat_at: string | null;
  heartbeat_age_seconds: number | null;
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
  unresolved_workers: string[];
  workers_missing_heartbeat: string[];
  workers_stale_heartbeat: string[];
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

function parseBoundedPositiveInt(
  value: unknown,
  fallback: number,
  minValue: number,
  maxValue: number
): number {
  const parsed = toPositiveInt(value) ?? fallback;
  return Math.max(minValue, Math.min(maxValue, parsed));
}

function resolveRuntimeStatusPath(env: NodeJS.ProcessEnv, override?: string): string {
  const configured = nonEmpty(override) ?? nonEmpty(env.AGENTMC_RUNTIME_STATUS_PATH);
  return resolve(configured ?? resolve(process.cwd(), DEFAULT_RUNTIME_STATUS_PATH));
}

function resolveRuntimeServiceName(env: NodeJS.ProcessEnv, override?: string): string {
  return nonEmpty(override) ?? nonEmpty(env.AGENTMC_SERVICE_NAME) ?? DEFAULT_RUNTIME_SERVICE_NAME;
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

function resolveRuntimeAutoUpdateInstallDir(env: NodeJS.ProcessEnv): string {
  const configured = nonEmpty(env.AGENTMC_AUTO_UPDATE_INSTALL_DIR);
  if (configured) {
    return resolve(configured);
  }

  const normalizedCliFilePath = fileURLToPath(import.meta.url).replace(/\\/g, "/");
  const markerIndex = normalizedCliFilePath.lastIndexOf(INSTALLED_PACKAGE_PATH_MARKER);
  if (markerIndex >= 0) {
    return resolve(normalizedCliFilePath.slice(0, markerIndex));
  }

  return process.cwd();
}

function resolveRuntimeAutoUpdateConfig(env: NodeJS.ProcessEnv): RuntimeAutoUpdateConfig {
  const normalizedCliFilePath = fileURLToPath(import.meta.url).replace(/\\/g, "/");
  const defaultEnabled = normalizedCliFilePath.includes(INSTALLED_PACKAGE_PATH_MARKER);
  const enabled = toBoolean(env.AGENTMC_AUTO_UPDATE) ?? defaultEnabled;

  return {
    enabled,
    intervalSeconds: Math.max(
      30,
      toPositiveInt(env.AGENTMC_AUTO_UPDATE_INTERVAL_SECONDS) ?? DEFAULT_AUTO_UPDATE_INTERVAL_SECONDS
    ),
    installTimeoutMs: Math.max(
      10_000,
      toPositiveInt(env.AGENTMC_AUTO_UPDATE_INSTALL_TIMEOUT_MS) ?? DEFAULT_AUTO_UPDATE_INSTALL_TIMEOUT_MS
    ),
    npmCommand: nonEmpty(env.AGENTMC_AUTO_UPDATE_NPM_COMMAND) ?? "npm",
    installDir: resolveRuntimeAutoUpdateInstallDir(env),
    registryUrl: nonEmpty(env.AGENTMC_AUTO_UPDATE_REGISTRY_URL) ?? DEFAULT_AUTO_UPDATE_REGISTRY_URL,
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
      error: null
    };
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
        error: "invalid_state_json"
      };
    }

    return {
      exists: true,
      agentId: toPositiveInt(object.agent_id),
      lastHeartbeatAt: nonEmpty(object.last_heartbeat_at),
      error: null
    };
  } catch (error) {
    return {
      exists: true,
      agentId: null,
      lastHeartbeatAt: null,
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

function readRuntimeStatusReport(statusPath: string, env: NodeJS.ProcessEnv): RuntimeStatusReport {
  const warnings: string[] = [];
  const now = new Date();

  if (!existsSync(statusPath)) {
    const fallbackStatePath = resolve(nonEmpty(env.AGENTMC_STATE_PATH) ?? resolve(process.cwd(), DEFAULT_RUNTIME_STATE_PATH));
    const fallbackState = readRuntimeWorkerStateSnapshot(fallbackStatePath);
    const fallbackHeartbeatDate = parseIsoDate(fallbackState.lastHeartbeatAt);
    const fallbackWorker: RuntimeWorkerStatusReport[] = fallbackState.exists
      ? [{
          local_key: "default",
          local_name: null,
          provider: null,
          agent_id: fallbackState.agentId,
          workspace_dir: dirname(dirname(fallbackStatePath)),
          state_path: fallbackStatePath,
          openclaw_agent: null,
          state_exists: fallbackState.exists,
          state_error: fallbackState.error,
          last_heartbeat_at: fallbackState.lastHeartbeatAt,
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
      warnings,
      service: null,
      recent_errors: [],
      recent_errors_service_name: null,
      recent_errors_window_minutes: DEFAULT_RUNTIME_ERROR_LOOKBACK_MINUTES,
      recent_errors_limit: DEFAULT_RUNTIME_ERROR_LIMIT,
      diagnostics: {
        status_stale: false,
        status_stale_threshold_seconds: DEFAULT_RUNTIME_STATUS_STALE_THRESHOLD_SECONDS,
        heartbeat_stale_threshold_seconds: DEFAULT_HOST_HEARTBEAT_INTERVAL_SECONDS * 2 + 60,
        unresolved_workers: [],
        workers_missing_heartbeat: [],
        workers_stale_heartbeat: [],
        workers_with_state_errors: [],
        hints: []
      }
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
      warnings,
      service: null,
      recent_errors: [],
      recent_errors_service_name: null,
      recent_errors_window_minutes: DEFAULT_RUNTIME_ERROR_LOOKBACK_MINUTES,
      recent_errors_limit: DEFAULT_RUNTIME_ERROR_LIMIT,
      diagnostics: {
        status_stale: false,
        status_stale_threshold_seconds: DEFAULT_RUNTIME_STATUS_STALE_THRESHOLD_SECONDS,
        heartbeat_stale_threshold_seconds: DEFAULT_HOST_HEARTBEAT_INTERVAL_SECONDS * 2 + 60,
        unresolved_workers: [],
        workers_missing_heartbeat: [],
        workers_stale_heartbeat: [],
        workers_with_state_errors: [],
        hints: []
      }
    };
  }

  const updatedAtDate = parseIsoDate(parsedSnapshot.updated_at);
  const processAlive = isPidAlive(parsedSnapshot.pid);
  const workerReports: RuntimeWorkerStatusReport[] = parsedSnapshot.workers.map((worker) => {
    const state = readRuntimeWorkerStateSnapshot(worker.state_path);
    const lastHeartbeatDate = parseIsoDate(state.lastHeartbeatAt);
    return {
      ...worker,
      state_exists: state.exists,
      state_error: state.error,
      last_heartbeat_at: state.lastHeartbeatAt,
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
    warnings,
    service: null,
    recent_errors: [],
    recent_errors_service_name: null,
    recent_errors_window_minutes: DEFAULT_RUNTIME_ERROR_LOOKBACK_MINUTES,
    recent_errors_limit: DEFAULT_RUNTIME_ERROR_LIMIT,
    diagnostics: {
      status_stale: false,
      status_stale_threshold_seconds: DEFAULT_RUNTIME_STATUS_STALE_THRESHOLD_SECONDS,
      heartbeat_stale_threshold_seconds: DEFAULT_HOST_HEARTBEAT_INTERVAL_SECONDS * 2 + 60,
      unresolved_workers: [],
      workers_missing_heartbeat: [],
      workers_stale_heartbeat: [],
      workers_with_state_errors: [],
      hints: []
    }
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

function buildRuntimeStatusDiagnostics(
  report: RuntimeStatusReport,
  env: NodeJS.ProcessEnv,
  service: RuntimeServiceStatusReport | null,
  recentErrors: RuntimeStatusLogEntry[]
): RuntimeStatusDiagnostics {
  const statusStaleThresholdSeconds = DEFAULT_RUNTIME_STATUS_STALE_THRESHOLD_SECONDS;
  const heartbeatIntervalSeconds =
    toPositiveInt(env.AGENTMC_HOST_HEARTBEAT_INTERVAL_SECONDS) ??
    toPositiveInt(env.AGENTMC_HEARTBEAT_INTERVAL_SECONDS) ??
    DEFAULT_HOST_HEARTBEAT_INTERVAL_SECONDS;
  const heartbeatStaleThresholdSeconds = Math.max(180, heartbeatIntervalSeconds * 2 + 60);

  const unresolvedWorkers: string[] = [];
  const workersMissingHeartbeat: string[] = [];
  const workersStaleHeartbeat: string[] = [];
  const workersWithStateErrors: string[] = [];
  for (const worker of report.workers) {
    if (worker.agent_id === null) {
      unresolvedWorkers.push(worker.local_key);
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
  if (statusStale) {
    hints.push("Supervisor status file appears stale. Check service health and restart if needed.");
  }
  if (unresolvedWorkers.length > 0) {
    hints.push("Some workers are unresolved in AgentMC. Check host heartbeat/API key and mapping logs.");
  }
  if (workersMissingHeartbeat.length > 0) {
    hints.push("Some workers have not persisted heartbeats yet. Check recent heartbeat errors.");
  }
  if (workersStaleHeartbeat.length > 0) {
    hints.push("Some workers have stale heartbeats. Verify API reachability and runtime loops.");
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
    unresolved_workers: unresolvedWorkers,
    workers_missing_heartbeat: workersMissingHeartbeat,
    workers_stale_heartbeat: workersStaleHeartbeat,
    workers_with_state_errors: workersWithStateErrors,
    hints
  };
}

function enrichRuntimeStatusReport(
  report: RuntimeStatusReport,
  env: NodeJS.ProcessEnv,
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

  return {
    ...report,
    warnings,
    service: serviceResult.status,
    recent_errors: recentErrorResult.entries,
    recent_errors_service_name: input.includeRecentErrors ? input.serviceName : null,
    recent_errors_window_minutes: input.recentErrorWindowMinutes,
    recent_errors_limit: input.recentErrorLimit,
    diagnostics: buildRuntimeStatusDiagnostics(report, env, serviceResult.status, recentErrorResult.entries)
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
    process.stdout.write("\n");
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

  const workerRestartDelayMs = toPositiveInt(env.AGENTMC_WORKER_RESTART_DELAY_MS) ?? DEFAULT_WORKER_RESTART_DELAY_MS;
  const workerRestartMaxDelayMs = Math.max(
    workerRestartDelayMs,
    toPositiveInt(env.AGENTMC_WORKER_RESTART_MAX_DELAY_MS) ?? DEFAULT_WORKER_RESTART_MAX_DELAY_MS
  );
  const statusPath = resolveRuntimeStatusPath(env);
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
  let autoUpdateLoopPromise: Promise<void> | null = null;
  let restartRequestedByAutoUpdate = false;
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

    const baseUrl = nonEmpty(env.AGENTMC_BASE_URL) ?? undefined;
    if (toPositiveInt(env.AGENTMC_AGENT_ID) !== null) {
      process.stderr.write(
        "[agentmc-runtime] AGENTMC_AGENT_ID is ignored in host supervisor mode; using discovered multi-agent workers.\n"
      );
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
    statusWorkers = resolved.workers;
    await persistStatusSafe({
      mode: "multi-agent",
      summary: `starting ${resolved.workers.length} worker runtime(s)`
    });

    const hostHeartbeatIntervalSeconds =
      toPositiveInt(env.AGENTMC_HOST_HEARTBEAT_INTERVAL_SECONDS) ??
      toPositiveInt(env.AGENTMC_HEARTBEAT_INTERVAL_SECONDS) ??
      DEFAULT_HOST_HEARTBEAT_INTERVAL_SECONDS;

    const heartbeatClient = new AgentMCApi({
      baseUrl,
      apiKey: hostApiKey
    });
    const hostFingerprint = resolveHostFingerprint(env);
    await persistStatusSafe({
      host_fingerprint: hostFingerprint,
      summary: "sending initial host heartbeat"
    });

    const initialHeartbeat = await sendHostHeartbeat(heartbeatClient, env, resolved.workers, hostFingerprint);
    applyHeartbeatAgentMapping(resolved.workers, initialHeartbeat);
    await persistStatusSafe({
      summary: "initial host heartbeat complete"
    });

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
      "[agentmc-runtime] host realtime mode=persistent-websocket (one session per agent, shared transport)\n"
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

        await persistStatusSafe({
          summary: `worker mapping changed for ${changedWorkerKeys.join(", ")}`
        });
      },
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
      hostHeartbeatLoopPromise
    ];
    if (autoUpdateLoopPromise) {
      lifecyclePromises.push(autoUpdateLoopPromise);
    }

    await Promise.all(lifecyclePromises);

    if (restartRequestedByAutoUpdate) {
      process.stderr.write("[agentmc-runtime] auto-update applied; exiting for restart.\n");
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
  const models = resolveHostHeartbeatModels(env, workers, resolvedRuntimeProvider);
  const heartbeatModels =
    models.length > 0 ? models : resolveHostHeartbeatFallbackModels(runtimeIdentity, resolvedRuntimeProvider);
  const hasOpenClawWorkers = workers.some((worker) => nonEmpty(worker.provider)?.toLowerCase() === "openclaw");
  const latestOpenClawProfiles =
    hasOpenClawWorkers
      ? resolveLatestHostHeartbeatOpenClawProfiles(env)
      : new Map<string, { name: string | null; emoji: string | null }>();

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
      models: heartbeatModels,
      ...(AGENTMC_NODE_PACKAGE_VERSION ? { agentmc_node_package_version: AGENTMC_NODE_PACKAGE_VERSION } : {}),
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
    agents: workers.map((worker) => {
      updateWorkerProfileFromHeartbeat(worker, latestOpenClawProfiles);
      const resolvedName = worker.localName ?? worker.localKey;
      const resolvedEmoji = nonEmpty(worker.localEmoji) ?? null;

      return {
        ...(worker.agentId !== null ? { id: worker.agentId } : {}),
        name: resolvedName,
        ...(resolvedEmoji ? { emoji: resolvedEmoji } : {}),
        type: worker.provider ?? "runtime",
        identity: {
          name: resolvedName,
          ...(resolvedEmoji ? { emoji: resolvedEmoji } : {}),
          agent_key: worker.localKey,
          openclaw_agent: worker.openclawAgent ?? worker.localKey
        }
      };
    })
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
  env: NodeJS.ProcessEnv
): Map<string, { name: string | null; emoji: string | null }> {
  const command = nonEmpty(env.OPENCLAW_CMD) ?? "openclaw";
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
  resolvedProvider: HostHeartbeatRuntimeProvider
): string[] {
  const configured = parseCommaSeparatedList(env.AGENTMC_MODELS);
  if (configured.length > 0) {
    return dedupeModelIdentifiers(configured);
  }

  if (resolvedProvider !== "openclaw") {
    return [];
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

  return [];
}

function resolveHostHeartbeatFallbackModels(
  runtimeIdentity: ReturnType<typeof resolveHostHeartbeatRuntimeIdentity>,
  resolvedRuntimeProvider: HostHeartbeatRuntimeProvider
): string[] {
  if (resolvedRuntimeProvider === "openclaw") {
    const version = nonEmpty(runtimeIdentity.openclawVersion) ?? runtimeIdentity.version;
    const build = nonEmpty(runtimeIdentity.openclawBuild) ?? nonEmpty(runtimeIdentity.build) ?? version;
    return [`🦞 OpenClaw ${version} (${build})`];
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
  } else {
    delete runtimeEnv.AGENTMC_DISABLE_HEARTBEAT;
  }

  return runtimeEnv;
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

  while (!shouldStop()) {
    const workerLabel =
      `agent=${entry.worker.agentId ?? `auto:${entry.worker.localKey}`} provider=${entry.worker.provider ?? "unknown"} ` +
      `local=${entry.worker.localName ?? "unknown"} workspace=${entry.worker.workspaceDir}`;
    const runtime = AgentRuntimeProgram.fromEnv(entry.runtimeEnv);
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
      const statusPath = resolveRuntimeStatusPath(process.env, options.statusPath);
      const baseReport = readRuntimeStatusReport(statusPath, process.env);
      const serviceName = resolveRuntimeServiceName(process.env, options.serviceName);
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
      const report = enrichRuntimeStatusReport(baseReport, process.env, {
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
