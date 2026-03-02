import { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

interface MultiAgentRuntimeConfig {
  agentId: number;
  apiKey: string;
  workspaceDir: string;
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

function resolveMultiAgentConfigs(env: NodeJS.ProcessEnv): MultiAgentRuntimeConfig[] {
  const keyedEntries = Object.entries(env)
    .map(([name, value]) => {
      const match = name.match(/^AGENTMC_API_KEY_(\d+)$/);
      if (!match) {
        return null;
      }

      const agentId = toPositiveInt(match[1]);
      const apiKey = nonEmpty(value);

      if (agentId === null || !apiKey) {
        return null;
      }

      return { agentId, apiKey, envName: name };
    })
    .filter((entry): entry is { agentId: number; apiKey: string; envName: string } => entry !== null)
    .sort((a, b) => a.agentId - b.agentId);

  if (keyedEntries.length === 0) {
    return [];
  }

  const workspaceRootOverride = nonEmpty(env.AGENTMC_MULTI_WORKSPACE_ROOT);
  const useDefaultWorkspace = keyedEntries.length === 1 && workspaceRootOverride === null;
  const runtimeRoot = workspaceRootOverride ?? resolve(process.cwd(), ".agentmc", "runtimes");

  return keyedEntries.map(({ agentId, apiKey, envName }) => {
    if (apiKey.startsWith("cc_")) {
      throw new Error(`${envName} contains a team API key (cc_*). Agent runtimes require agent keys (mca_*).`);
    }

    const workspaceOverride = nonEmpty(env[`AGENTMC_WORKSPACE_DIR_${agentId}`]);
    const workspaceDir =
      workspaceOverride ?? (useDefaultWorkspace ? process.cwd() : resolve(runtimeRoot, `agent-${agentId}`));

    return {
      agentId,
      apiKey,
      workspaceDir
    };
  });
}

async function runMultiAgentRuntimeFromEnv(env: NodeJS.ProcessEnv): Promise<boolean> {
  const configs = resolveMultiAgentConfigs(env);
  if (configs.length === 0) {
    return false;
  }

  const baseUrl = nonEmpty(env.AGENTMC_BASE_URL) ?? undefined;
  const runtimeEntries = configs.map((config) => ({
    ...config,
    runtime: new AgentRuntimeProgram({
      apiKey: config.apiKey,
      baseUrl,
      agentId: config.agentId,
      workspaceDir: config.workspaceDir
    })
  }));

  let stopping = false;
  const stopAll = async (): Promise<void> => {
    if (stopping) {
      return;
    }

    stopping = true;
    await Promise.allSettled(runtimeEntries.map((entry) => entry.runtime.stop()));
  };

  const handleSignal = (signal: NodeJS.Signals): void => {
    process.stderr.write(`[agentmc-runtime] received ${signal}, stopping worker runtimes...\n`);
    void stopAll();
  };

  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);

  try {
    await Promise.all(
      runtimeEntries.map(async (entry) => {
        process.stderr.write(
          `[agentmc-runtime] worker start agent=${entry.agentId} workspace=${entry.workspaceDir}\n`
        );
        await entry.runtime.run();
      })
    );
  } catch (error) {
    await stopAll();
    throw error;
  } finally {
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
  }

  return true;
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
    .description("Start the unified AgentMC runtime program (realtime + instructions sync + heartbeat)")
    .action(async () => {
      const multiRuntimeRan = await runMultiAgentRuntimeFromEnv(process.env);
      if (!multiRuntimeRan) {
        throw new Error(
          "No agent runtime keys found. Set one or more AGENTMC_API_KEY_<AGENT_ID>=mca_... environment variables."
        );
      }
    });

  program
    .command("call")
    .description("Call an operation by operationId")
    .argument("<operationId>")
    .option("--base-url <url>", "override API base URL")
    .option("--api-key <key>", "Agent or workspace API key credential")
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
