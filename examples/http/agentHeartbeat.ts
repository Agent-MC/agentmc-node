import { AgentMCApi } from "@agentmc/api";

const client = new AgentMCApi({
  apiKey: process.env.AGENTMC_API_KEY
});

const result = await client.operations.agentHeartbeat({
  "params": {
    "header": {
      "X-Host-Fingerprint": "a3f56f330f311a2159f8c101eaf1439a29f1d57f007375d56aa79f304bc4f112"
    }
  },
  "body": {
    "status": "online",
    "meta": {
      "type": "codex",
      "runtime": {
        "name": "openclaw",
        "version": "2026.2.26",
        "build": "bc50708",
        "mode": "openclaw"
      },
      "openclaw_version": "2026.2.26",
      "openclaw_build": "bc50708",
      "models": [
        "🦞 OpenClaw 2026.2.26 (bc50708)",
        "openai/gpt-5-codex"
      ],
      "node_version": "v22.14.0",
      "runtime_mode": "openclaw",
      "tool_availability": {
        "chat_realtime": true,
        "files_realtime": true,
        "notifications_realtime": true
      }
    },
    "host": {
      "fingerprint": "a3f56f330f311a2159f8c101eaf1439a29f1d57f007375d56aa79f304bc4f112",
      "name": "worker-01",
      "meta": {
        "hostname": "worker-01",
        "ip": "10.0.2.15",
        "network": {
          "private_ip": "10.0.2.15",
          "public_ip": "34.222.10.10"
        },
        "os": "Ubuntu",
        "os_version": "24.04",
        "arch": "x86_64",
        "cpu": "Intel Xeon",
        "cpu_cores": 8,
        "ram_gb": 32,
        "disk": {
          "total_bytes": 536870912000,
          "free_bytes": 322122547200
        },
        "uptime_seconds": 86400,
        "runtime": {
          "name": "codex",
          "version": "2026.02.1"
        }
      }
    },
    "agent": {
      "id": 42,
      "name": "Jarvis",
      "identity": {
        "name": "Jarvis",
        "creature": "robot",
        "vibe": "calm"
      }
    }
  }
});

if (result.error) {
  console.error(result.status, result.error);
} else {
  console.log(result.data);
}
