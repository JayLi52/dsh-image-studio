#!/usr/bin/env bash
# Bring up the full dsh + image-studio stack on a fresh Linux box.
# Usage (as root, keys in env):
#   DASHSCOPE_API_KEY=... DOUBAO_SEARCH_API_KEY=... TOKEN_PLAN_DASHSCOPE_API_KEY=... bash deploy/bootstrap.sh
set -euo pipefail

: "${DASHSCOPE_API_KEY:?required}"
: "${DOUBAO_SEARCH_API_KEY:?required (optional feature: set dummy to skip doubao plugin)}"
: "${TOKEN_PLAN_DASHSCOPE_API_KEY:?required}"

HERE="$(cd "$(dirname "$0")" && pwd)"

# China-mainland boxes need the mirror; remove this line elsewhere.
npm config set registry https://registry.npmmirror.com
npm install -g @deepseek-ai/dsh pnpm

mkdir -p ~/.dsh
umask 077
printf 'DASHSCOPE_API_KEY=%s\nDOUBAO_SEARCH_API_KEY=%s\nTOKEN_PLAN_DASHSCOPE_API_KEY=%s\n' \
  "$DASHSCOPE_API_KEY" "$DOUBAO_SEARCH_API_KEY" "$TOKEN_PLAN_DASHSCOPE_API_KEY" > ~/.dsh/.env
cp "$HERE/settings.example.yaml" ~/.dsh/settings.yaml

dsh plugin --profile web add github:JayLi52/dsh-web-search-doubao
dsh plugin --profile web add github:JayLi52/dsh-image-studio

mkdir -p /root/workspace
cp "$HERE/imgsrv.js" /opt/dsh-imgsrv.js

NODE_BIN="$(command -v node)"
DSH_BIN="$(command -v dsh)"
# DSH_TRUSTED_HOSTS: space-separated public authorities dsh's browser-trust
# fence should accept, e.g. "203.0.113.7:8099 203.0.113.7". Empty = loopback only.
TRUSTED_ARGS=""
for h in ${DSH_TRUSTED_HOSTS:-}; do TRUSTED_ARGS="$TRUSTED_ARGS --trusted-host $h"; done
sed -e "s|@NODE@|$NODE_BIN|" -e "s|@DSH@|$DSH_BIN|" -e "s|@TRUSTED_HOSTS@|$TRUSTED_ARGS|" "$HERE/dsh-web.service" > /etc/systemd/system/dsh-web.service
sed -e "s|@NODE@|$NODE_BIN|" "$HERE/dsh-images.service" > /etc/systemd/system/dsh-images.service
systemctl daemon-reload
systemctl enable --now dsh-images dsh-web

cat <<'EOF'

Done. From your laptop, open the tunnel:
  ssh -f -N -L 3080:127.0.0.1:3080 -L 3081:127.0.0.1:3081 root@<this-host>
Then browse http://127.0.0.1:3080 — the first-visit trust URL (with ?token=...) is in:
  ssh root@<this-host> "journalctl -u dsh-web --no-pager | grep -oE 'http://127.0.0.1:3080/\?[^ ]+' | tail -1"
EOF
