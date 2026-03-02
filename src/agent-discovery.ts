import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type RuntimeProvider = "openclaw" | "external";

export interface DiscoveredRuntimeAgent {
  provider: RuntimeProvider;
  key: string;
  name: string;
  workspaceDir: string | null;
  meta: Record<string, unknown>;
}

export interface DetectRuntimeAgentsOptions {
  runtimeProvider?: "auto" | RuntimeProvider | null;
  openclawConfigPath?: string | null;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
}

interface AgentProviderDetector {
  provider: RuntimeProvider;
  detect: (options: DetectRuntimeAgentsOptions) => Promise<DiscoveredRuntimeAgent[]>;
}

const PROVIDER_DETECTORS: readonly AgentProviderDetector[] = [
  {
    provider: "openclaw",
    detect: detectOpenClawAgents
  }
];

export async function detectRuntimeAgents(
  options: DetectRuntimeAgentsOptions = {}
): Promise<DiscoveredRuntimeAgent[]> {
  const runtimeProvider = normalizeRuntimeProvider(options.runtimeProvider ?? "auto");
  const detectors =
    runtimeProvider === "auto"
      ? PROVIDER_DETECTORS
      : PROVIDER_DETECTORS.filter((entry) => entry.provider === runtimeProvider);

  const allAgents: DiscoveredRuntimeAgent[] = [];
  for (const detector of detectors) {
    const rows = await detector.detect(options);
    allAgents.push(...rows);
  }

  const deduped = new Map<string, DiscoveredRuntimeAgent>();
  for (const agent of allAgents) {
    const key = `${agent.provider}:${normalizeToken(agent.key)}`;
    if (!deduped.has(key)) {
      deduped.set(key, agent);
    }
  }

  return Array.from(deduped.values()).sort((left, right) => left.key.localeCompare(right.key));
}

async function detectOpenClawAgents(options: DetectRuntimeAgentsOptions): Promise<DiscoveredRuntimeAgent[]> {
  const config = await loadFirstOpenClawConfig(options);
  if (!config) {
    return [];
  }

  const agentsRoot = asObject(config.agents);
  if (!agentsRoot) {
    return [];
  }

  const defaults = asObject(agentsRoot.defaults);
  const defaultWorkspace = asString(defaults?.workspace);
  const list = toAgentRows(agentsRoot.list);
  if (list.length === 0 && defaultWorkspace) {
    return [
      {
        provider: "openclaw",
        key: "main",
        name: "main",
        workspaceDir: defaultWorkspace,
        meta: { source: "defaults.workspace" }
      }
    ];
  }

  const discovered: DiscoveredRuntimeAgent[] = [];
  for (const row of list) {
    const identity = asObject(row.identity);
    const key =
      asString(row.id) ??
      asString(row.agent_key) ??
      asString(row.agentKey) ??
      asString(row.name) ??
      null;
    if (!key) {
      continue;
    }

    const workspaceDir =
      asString(row.workspace) ??
      asString(row.workspace_path) ??
      asString(row.workspacePath) ??
      defaultWorkspace ??
      null;
    const name =
      asString(row.identityName) ??
      asString(row.identity_name) ??
      asString(identity?.name) ??
      asString(row.name) ??
      key;

    discovered.push({
      provider: "openclaw",
      key,
      name,
      workspaceDir,
      meta: {
        id: asString(row.id),
        workspaceDir,
        agentDir: asString(row.agentDir) ?? asString(row.agent_dir) ?? asString(row.agentPath) ?? null
      }
    });
  }

  return discovered;
}

async function loadFirstOpenClawConfig(options: DetectRuntimeAgentsOptions): Promise<Record<string, unknown> | null> {
  const cwd = resolve(options.workspaceDir ?? process.cwd());
  const candidates = new Set<string>();

  addConfigPathCandidate(candidates, options.openclawConfigPath);
  addConfigPathCandidate(candidates, join(homedir(), ".openclaw", "openclaw.json"));
  addConfigPathCandidate(candidates, "/root/.openclaw/openclaw.json");
  addConfigPathCandidate(candidates, join(cwd, ".openclaw", "openclaw.json"));

  for (const configPath of candidates) {
    try {
      const raw = await readFile(configPath, "utf8");
      const parsed = JSON.parse(raw);
      const object = asObject(parsed);
      if (object) {
        return object;
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code === "ENOENT") {
        continue;
      }
    }
  }

  return null;
}

function addConfigPathCandidate(target: Set<string>, candidate: string | null | undefined): void {
  const path = asString(candidate);
  if (!path) {
    return;
  }
  target.add(path);
}

function normalizeRuntimeProvider(value: string | RuntimeProvider): "auto" | RuntimeProvider {
  const normalized = normalizeToken(value);
  if (normalized === "openclaw" || normalized === "external" || normalized === "auto") {
    return normalized;
  }
  return "auto";
}

function toAgentRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.map((entry) => asObject(entry)).filter((entry): entry is Record<string, unknown> => entry !== null);
  }

  const object = asObject(value);
  if (!object) {
    return [];
  }

  return Object.entries(object)
    .map(([id, row]) => {
      const item = asObject(row);
      if (!item) {
        return null;
      }
      if (!asString(item.id)) {
        item.id = id;
      }
      return item;
    })
    .filter((entry): entry is Record<string, unknown> => entry !== null);
}

function normalizeToken(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") {
    return "";
  }
  return String(value).trim().toLowerCase();
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}
