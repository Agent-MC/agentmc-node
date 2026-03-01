# @agentmc/api

TypeScript SDK + endpoint docs + CLI for the AgentMC API.

-   API domain: [https://agentmc.ai](https://agentmc.ai)
-   OpenAPI source: `https://agentmc.ai/api/openapi.json`
-   Default SDK base URL: `https://agentmc.ai/api/v1`

## Install

```bash
npm install @agentmc/api
```

## What This Package Includes

-   Fully generated, typed SDK surface from OpenAPI.
-   Generated operation docs: `docs/operations/*.md`, `docs/operations/index.json`
-   Per-endpoint TypeScript examples: `examples/http/*.ts`
-   Realtime websocket notification example: `examples/realtime/subscribeToRealtimeNotifications.ts`
-   Unified runtime program example: `examples/runtime/agentRuntimeProgram.ts`
-   Realtime runtime example: `examples/realtime/openclawAgentRuntime.ts`
-   CLI for operation discovery and direct API calls.

## Quick Start (SDK)

```ts
import { AgentMCApi } from '@agentmc/api';

const client = new AgentMCApi({
	apiKey: process.env.AGENTMC_API_KEY,
});

const result = await client.operations.listTasks({
	params: {
		query: {
			per_page: 20,
		},
	},
});

if (result.error) {
	console.error(result.status, result.error);
} else {
	console.log(result.data);
}
```

## Auth Configuration

Supported auth schemes:

-   `ApiKeyAuth` via `X-Api-Key`
-   `SessionCookieAuth` via browser session cookie

`apiKey` can be either:

-   an agent key (for example `mca_...`)
-   a workspace key (for example `cc_...`)

Configure once at client creation:

```ts
const client = new AgentMCApi({
	apiKey: process.env.AGENTMC_API_KEY,
});
```

Override auth per request:

```ts
await client.request('listTasks', {
	auth: {
		apiKey: process.env.AGENTMC_API_KEY,
	},
	params: {
		query: {
			per_page: 20,
		},
	},
});
```

## API Discovery Helpers

```ts
import { operations, operationsById } from '@agentmc/api';

console.log(operations.length); // total available operations
console.log(operationsById.listTasks.path); // /tasks
```

Runtime helpers on client:

```ts
const allOperations = client.listOperations();
const oneOperation = client.getOperation('listTasks');
```

## Realtime Notification Subscription (Agent Sessions)

Use the low-level realtime helper when you need raw session signal subscription primitives.
For full chat + runtime files + notification handling, use `OpenClawAgentRuntime` in the next section.

```ts
import { AgentMCApi } from '@agentmc/api';

const client = new AgentMCApi({
	apiKey: process.env.AGENTMC_API_KEY,
});

const subscription = await client.subscribeToRealtimeNotifications({
	agent: 42,
	onReady: (session) => {
		console.log(`Realtime connected for session ${session.id}`);
	},
	onSignal: (signal) => {
		console.log('signal', signal.type, signal.id, signal.sender);
	},
	onNotification: ({ notification, notificationType }) => {
		console.log('Notification event:', notificationType, notification);
	},
	onError: (error) => {
		console.error('Realtime error:', error.message);
	},
});

await subscription.ready;

// Keep your process alive while subscribed...
// Later, disconnect cleanly:
await subscription.disconnect();
```

Notes:

-   This helper claims a requested realtime session for the agent before opening the websocket subscription.
-   If you do not pass `session`, the helper picks the newest requested session returned by `listAgentRealtimeRequestedSessions`.
-   Realtime transport uses the session socket metadata and signs channel subscriptions via `authenticateAgentRealtimeSocket`.
-   Use `publishRealtimeMessage(...)` if you need to emit your own channel events.
-   `publishRealtimeMessage(...)` automatically chunks oversized channel payloads into multiple realtime signals so each signal stays within websocket broadcast limits.
    -   Chunk envelopes include `chunk_id`, `chunk_index`, `chunk_total`, `chunk_encoding`, and `chunk_data` under the channel payload.
    -   Defaults: `maxPayloadBytes=9000`, `maxEnvelopeBytes=10000` (override per call if your runtime limits differ).
-   For long-running runtimes, call `disconnect()` during shutdown. Set `autoCloseSession: true` to also close the remote session.

## Unified Runtime Program (Recommended)

Use `AgentRuntimeProgram` to run:

-   realtime websocket handling (chat/files/notifications)
-   instruction bundle sync (`getAgentInstructions`)
-   immediate startup heartbeat plus recurring heartbeat updates (`agentHeartbeat`)
-   recurring task polling + completion (`listDueRecurringTaskRuns`, `completeRecurringTaskRun`)
-   runtime health/self-heal loop

```ts
import { AgentRuntimeProgram } from '@agentmc/api';

const runtime = AgentRuntimeProgram.fromEnv(process.env);
await runtime.run();
```

Example:

-   `examples/runtime/agentRuntimeProgram.ts`

## Realtime Runtime (Advanced)

Use `AgentRuntime` when you only want realtime socket handling without the heartbeat/instruction supervisor.

-   `chat.user` -> `chat.agent.delta` / `chat.agent.done`
-   `snapshot.request` / `file.save` / `file.delete`
-   notification event bridge

-   `examples/realtime/openclawAgentRuntime.ts`

## CLI Runtime Command

Run the unified runtime program directly:

```bash
npx agentmc-api runtime:start
```

Required env:
-   `AGENTMC_API_KEY`
-   Optional API base URL override: `AGENTMC_BASE_URL` (defaults to `https://agentmc.ai/api/v1`)
-   Runtime provider inputs:
    -   OpenClaw auto-detect (must resolve at least one runtime model), or
    -   `AGENTMC_RUNTIME_COMMAND` + `AGENTMC_MODELS`
-   Optional OpenClaw command override: `OPENCLAW_CMD`
    -   If unset (or invalid), runtime checks `openclaw` on `PATH`, then common absolute paths (`/usr/bin/openclaw`, `/usr/local/bin/openclaw`, `/opt/homebrew/bin/openclaw`, `/bin/openclaw`).
-   `AGENTMC_MODELS` (comma-separated, for example `openai/gpt-5-codex`) is required whenever model auto-detection is unavailable. Heartbeats require at least one runtime model in `meta.models`.
-   Optional agent profile overrides: `AGENTMC_AGENT_NAME`, `AGENTMC_AGENT_TYPE`, `AGENTMC_AGENT_EMOJI`
    -   If these values are unset, OpenClaw runtimes attempt agent discovery in this order:
        1. `openclaw agents list --json`
        2. `openclaw gateway call agents.list --json` (and `--params {}` variant)
        3. `openclaw gateway call config.get --json` (`parsed.agents.list`)
        4. local `openclaw.json` (`OPENCLAW_CONFIG_PATH`, `~/.openclaw/openclaw.json`, related fallbacks)
    -   If no source returns a profile, runtime falls back to `name=agent-<AGENTMC_AGENT_ID>` and `type=runtime`.
-   Optional recurring execution tuning:
    -   `AGENTMC_RECURRING_WAIT_TIMEOUT_MS` (default `600000` / 10 minutes)
    -   `AGENTMC_RECURRING_GATEWAY_TIMEOUT_MS` (default `720000` / 12 minutes; always coerced to at least wait timeout + 30 seconds)

Keep these env values up to date for the running agent. Update and restart the runtime whenever provider/model/network settings change.
-   Keep `AGENTMC_MODELS` aligned with the runtime's active/default model inventory.
-   Keep `AGENTMC_API_KEY` rotated/current for the target workspace.

Keep heartbeat telemetry up to date on every send (do not hardcode stale values):
-   Runtime identity and mode: `meta.runtime.name`, `meta.runtime.version`, `meta.runtime.build`, `meta.runtime.mode`, `meta.runtime_mode`.
-   Runtime model inventory: `meta.models`.
-   Runtime behavior flags/modes when available: `meta.thinking_mode`, tool availability fields.
-   Usage and token/context telemetry when available: token counters, cache metrics, context usage, and usage-window/day remaining fields.
-   OpenClaw-specific metadata when available: `meta.openclaw_version`, `meta.openclaw_build`.
-   The runtime supervisor pulls these values from OpenClaw status commands (`openclaw status --json --usage`, fallback `openclaw status --json`, plus `openclaw models status --json`) before each heartbeat.

## CLI

After install, use:

```bash
npx agentmc-api list-operations
```

List as JSON:

```bash
npx agentmc-api list-operations --json
```

Show operation metadata:

```bash
npx agentmc-api show-operation listTasks
```

Show generated markdown docs:

```bash
npx agentmc-api show-doc listTasks
```

Call endpoint directly:

```bash
npx agentmc-api call listTasks \
  --api-key "$AGENTMC_API_KEY" \
  --params '{"query":{"limit":20}}'
```

## Development

### 1) Install

```bash
npm install
```

### 2) Sync source OpenAPI

```bash
npm run sync:spec
```

Optional environment variables:

-   `AGENTMC_OPENAPI_PATH` (local file path override)
-   `AGENTMC_OPENAPI_URL` (remote URL override)

### 3) Generate typed client artifacts/docs/examples

```bash
npm run generate
```

Outputs:

-   `spec/openapi.filtered.json`
-   `src/generated/schema.ts`
-   `src/generated/operations.ts`
-   `docs/operations/*.md`
-   `docs/operations/index.json`
-   `examples/http/*.ts`

### 4) Build package

```bash
npm run build
```

## Notes For Agent Authors

-   Use `client.operations.<operationId>` for named operation calls.
-   Use `client.request(operationId, options)` for dynamic routing.
-   Read per-endpoint docs from `docs/operations/<operationId>.md` when selecting params/body fields.
-   Treat the generated docs/index as the operation registry:
    -   `docs/operations/index.json`
