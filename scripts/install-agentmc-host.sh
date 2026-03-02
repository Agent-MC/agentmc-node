#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${AGENTMC_SERVICE_NAME:-agentmc-host}"
INSTALL_DIR="${AGENTMC_INSTALL_DIR:-/opt/agentmc-host}"
ENV_DIR="${AGENTMC_ENV_DIR:-/etc/agentmc}"
ENV_FILE="${ENV_DIR}/agentmc-host.env"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
BASE_URL="${AGENTMC_BASE_URL:-https://agentmc.ai/api/v1}"
RUNTIME_PROVIDER="${AGENTMC_RUNTIME_PROVIDER:-auto}"
SERVICE_USER="${AGENTMC_SERVICE_USER:-$(id -un)}"
SERVICE_GROUP="${AGENTMC_SERVICE_GROUP:-$(id -gn)}"

if [[ -z "${AGENTMC_API_KEY:-}" ]]; then
  echo "AGENTMC_API_KEY is required (host-level key)." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required but was not found on PATH." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but was not found on PATH." >&2
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl is required (Linux systemd host)." >&2
  exit 1
fi

SUDO=""
if [[ "${EUID}" -ne 0 ]]; then
  if ! command -v sudo >/dev/null 2>&1; then
    echo "This script needs root privileges or sudo." >&2
    exit 1
  fi
  SUDO="sudo"
fi

echo "[agentmc-install] Installing runtime package into ${INSTALL_DIR}"
${SUDO} mkdir -p "${INSTALL_DIR}"
${SUDO} chown -R "${SERVICE_USER}:${SERVICE_GROUP}" "${INSTALL_DIR}"

run_as_service_user() {
  if [[ "${SERVICE_USER}" == "$(id -un)" ]]; then
    bash -lc "$1"
  else
    ${SUDO} -u "${SERVICE_USER}" bash -lc "$1"
  fi
}

run_as_service_user "cd '${INSTALL_DIR}' && npm install --omit=dev --no-audit --no-fund @agentmc/api@latest"

echo "[agentmc-install] Writing env file ${ENV_FILE}"
${SUDO} mkdir -p "${ENV_DIR}"
${SUDO} bash -lc "cat > '${ENV_FILE}' <<EOF
AGENTMC_API_KEY=${AGENTMC_API_KEY}
AGENTMC_BASE_URL=${BASE_URL}
AGENTMC_RUNTIME_PROVIDER=${RUNTIME_PROVIDER}
EOF"

${SUDO} chmod 600 "${ENV_FILE}"

echo "[agentmc-install] Installing systemd service ${SERVICE_NAME}"
${SUDO} bash -lc "cat > '${SERVICE_FILE}' <<EOF
[Unit]
Description=AgentMC Host Runtime
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=${ENV_FILE}
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/env node ${INSTALL_DIR}/node_modules/@agentmc/api/bin/agentmc-api.mjs runtime:start
Restart=always
RestartSec=5
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
EOF"

echo "[agentmc-install] Loading systemd service"
${SUDO} systemctl daemon-reload
${SUDO} systemctl enable --now "${SERVICE_NAME}"
${SUDO} systemctl restart "${SERVICE_NAME}"

echo "[agentmc-install] Service is active:"
${SUDO} systemctl --no-pager --full status "${SERVICE_NAME}" || true
