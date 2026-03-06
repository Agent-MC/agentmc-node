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

## Quick Start(SDK)

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

`apiKey` should be a host/team API key (for example `cc_...`).

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
-   `OpenClawAgentRuntime` keeps long-lived websocket subscriptions and relies on realtime fanout for chat/files/notifications routing.
-   In multi-agent supervisor mode, one host-level websocket transport is multiplexed across workers; requested sessions are routed to the correct worker by `agent_id`.
-   Realtime transport uses the session socket metadata and signs channel subscriptions via `authenticateAgentRealtimeSocket`.
-   Websocket reconnect automatically replays missed persisted signals (`after_id` catch-up) before resuming live delivery, and the runtime opportunistically polls persisted signals while the socket is reconnecting.
-   Unified runtime heartbeat loops also poll unread notifications via `listNotifications` and ingest them through the runtime notification bridge, covering websocket miss windows.
-   Use `publishRealtimeMessage(...)` if you need to emit your own channel events.
-   `publishRealtimeMessage(...)` automatically chunks oversized channel payloads into multiple realtime signals so each signal stays within websocket broadcast limits.
    -   Chunk envelopes include `chunk_id`, `chunk_index`, `chunk_total`, `chunk_encoding`, and `chunk_data` under the channel payload.
    -   Defaults: `maxPayloadBytes=9000`, `maxEnvelopeBytes=10000` (override per call if your runtime limits differ).
-   For long-running runtimes, call `disconnect()` during shutdown. Set `autoCloseSession: true` to also close the remote session.

## Unified Runtime Program (Recommended)

Use `AgentRuntimeProgram` to run:

-   realtime websocket handling (chat/files/notifications)
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

Check runtime status quickly on the server:

```bash
npx agentmc-api runtime:status
```

JSON output (for scripts/monitoring):

```bash
npx agentmc-api runtime:status --json
```

`runtime:status` now also includes:

-   computed diagnostics (missing/stale status, unresolved workers, workspace/state-file issues, missing/stale/invalid heartbeats, service PID mismatch checks)
-   runtime process snapshot (`ps` command line, cpu/memory %, elapsed seconds, rss/vsz)
-   systemd service snapshot (`systemctl show`, default service `agentmc-host`)
-   recent runtime errors from `journalctl` (default: last `30` minutes, max `20` entries)

Useful options:

-   `--service-name <name>` to inspect a different systemd unit
-   `--errors-since-minutes <minutes>` to change journal lookback window
-   `--errors-limit <count>` to control max error entries
-   `--no-recent-errors` to skip journal scan

Required env:

-   `AGENTMC_API_KEY=<host-key>`

Runtime defaults (no optional env overrides):

-   API base URL: `https://agentmc.ai/api/v1`
-   DNS result order: `ipv4first`
-   Runtime status path: `.agentmc/runtime-status.json` in the current working directory
-   Host heartbeat interval: `60s`
-   Host realtime route interval: `1000ms`
-   Host realtime route limit: `100`
-   Host realtime connected reconcile poll: `60s` (push events still trigger immediate routing)
-   Agent routing: auto-detect OpenClaw agents from `~/.openclaw/openclaw.json`; heartbeat auto-provisions AgentMC agents per host.
-   Realtime worker behavior: heartbeat disabled in worker mode, websocket routing enabled, polling fallback disabled.

-   Keep the host API key rotated/current for the target host.
-   OpenClaw prompt execution uses `openclaw agent --agent <openclaw-agent> --message "<prompt>"`.

Keep heartbeat telemetry up to date on every send (do not hardcode stale values):

-   Runtime identity and mode: `meta.runtime.name`, `meta.runtime.version`, `meta.runtime.build`, `meta.runtime.mode`, `meta.runtime_mode`.
-   Runtime model inventory: `meta.models`.
-   AgentMC SDK package version: `meta.agentmc_node_package_version` (`@agentmc/api` package version).
-   Runtime behavior flags/modes when available: `meta.thinking_mode`, tool availability fields.
-   Usage and token/context telemetry when available: token counters, cache metrics, context usage, and usage-window/day remaining fields.
-   OpenClaw-specific metadata when available: `meta.openclaw_version`, `meta.openclaw_build`.
-   OpenClaw current-model pointer when available: `meta.openclaw_models_status.default_model`, `meta.openclaw_models_status.resolved_default`.
-   The runtime supervisor pulls these values from OpenClaw status commands (`openclaw status --json --usage`, fallback `openclaw status --json`, plus `openclaw models status --json`) before each heartbeat.

## Host Install Script (Systemd)

Install the always-on host service:

```bash
AGENTMC_API_KEY="cc_host_key_here" \
bash scripts/install-agentmc-host.sh
```

Install/runtime configuration uses built-in defaults; only `AGENTMC_API_KEY` is required.

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

`sync:spec` uses a local spec fallback at `../agentmc.ai/public/openapi.json` when present, otherwise it fetches `https://agentmc.ai/api/openapi.json`.

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
