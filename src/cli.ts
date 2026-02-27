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
      const runtime = AgentRuntimeProgram.fromEnv(process.env);
      await runtime.run();
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
