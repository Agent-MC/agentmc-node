# AGENTS

## Project Notes

- This repository is `@agentmc/api` (TypeScript SDK + runtime supervisor + CLI for AgentMC).
- Default runtime behavior is intentionally opinionated and auto-discovered.

## Environment Variable Policy

- Runtime/app configuration must use a single required env var: `AGENTMC_API_KEY`.
- Do not add optional AgentMC/OpenClaw env toggles for runtime behavior.
- Prefer smart defaults in code over env-driven branching.
- If new behavior truly needs configuration, use explicit CLI flags or code-level constants first, not new env vars.

## Documentation Rule

- Keep README/runtime docs aligned with the one-env policy.
- Do not document optional AgentMC runtime env vars.
