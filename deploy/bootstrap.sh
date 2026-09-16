#!/usr/bin/env bash
# Bring up the full dsh + image-studio stack on a fresh Linux box.
# Usage (as root, keys in env):
#   DASHSCOPE_API_KEY=... DOUBAO_SEARCH_API_KEY=... TOKEN_PLAN_DASHSCOPE_API_KEY=... \
#   DSH_TRUSTED_HOSTS="1.2.3.4:8099 1.2.3.4" bash deploy/bootstrap.sh
set -euo pipefail

: "${DASHSCOPE_API_KEY:?required}"
: "${DOUBAO_SEARCH_API_KEY:?required}"
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

# MCP server layers carry secrets in config.env, so they are appended here at
# bootstrap time from the environment instead of living in the repo template.
cat >> ~/.dsh/profiles/web/cordis.patch.yml <<LAYER
- insert:
    - id: mcp-claude-mem
      name: "@deepseek-ai/dsh-mcp-client"
    - id: mcp-doubao
      name: "@deepseek-ai/dsh-mcp-client"
    - id: mcp-tavily
      name: "@deepseek-ai/dsh-mcp-client"
- id: mcp-claude-mem
  name: "@deepseek-ai/dsh-mcp-client"
  config:
    serverName: claude-mem
    transport: stdio
    command: $(command -v node)
    args: ["/root/work/claude-mem/plugin/scripts/mcp-server.cjs"]
    env:
      CLAUDE_PLUGIN_ROOT: /root/work/claude-mem/plugin
- id: mcp-doubao
  name: "@deepseek-ai/dsh-mcp-client"
  config:
    serverName: doubao-search
    transport: stdio
    command: $(command -v npx)
    args: ["-y", "github:alchaincyf/huashu-doubao-search"]
    env:
      DOUBAO_SEARCH_API_KEY: $DOUBAO_SEARCH_API_KEY
- id: mcp-tavily
  name: "@deepseek-ai/dsh-mcp-client"
  config:
    serverName: tavily
    transport: stdio
    command: $(command -v npx)
    args: ["-y", "tavily-mcp@latest"]
    env:
      TAVILY_API_KEY: $TAVILY_API_KEY
LAYER

mkdir -p /root/workspace /root/.dsh/hooks
cp "$HERE/imgsrv.js" /opt/dsh-imgsrv.js
cp "$HERE/entry-service.js" /opt/dsh-entry-service.js

NODE_BIN="$(command -v node)"
DSH_BIN="$(command -v dsh)"
# DSH_TRUSTED_HOSTS: space-separated public authorities dsh's browser-trust
# fence should accept, e.g. "203.0.113.7:8099 203.0.113.7". Empty = loopback only.
TRUSTED_ARGS=""
for h in ${DSH_TRUSTED_HOSTS:-}; do TRUSTED_ARGS="$TRUSTED_ARGS --trusted-host $h"; done
sed -e "s|@NODE@|$NODE_BIN|" -e "s|@DSH@|$DSH_BIN|" -e "s|@TRUSTED_HOSTS@|$TRUSTED_ARGS|" "$HERE/dsh-web.service" > /etc/systemd/system/dsh-web.service
sed -e "s|@NODE@|$NODE_BIN|" "$HERE/dsh-images.service" > /etc/systemd/system/dsh-images.service
sed -e "s|@NODE@|$NODE_BIN|" "$HERE/dsh-entry.service" > /etc/systemd/system/dsh-entry.service

# Self-hosted KaTeX: the client plugin loads /katex/ from the nginx gateway for
# math rendering (the dsh Web UI ships no TeX renderer).
if [ ! -f /opt/dsh-katex/katex.min.js ]; then
  cd /tmp
  npm pack katex@0.16.21 --silent
  tar xzf katex-0.16.21.tgz
  rm -rf /opt/dsh-katex
  mv package/dist /opt/dsh-katex
  cd "$HERE"
fi

# nginx gateway: silent boot-ticket exchange, /dsh-images image store, /katex.
cp "$HERE/nginx-dsh.conf" /etc/nginx/conf.d/dsh.conf
nginx -t
systemctl enable --now nginx
systemctl reload nginx

systemctl daemon-reload
systemctl enable --now dsh-images dsh-entry dsh-web

cat <<'EOF'

Done. Open http://<this-host>:8099/ (or ssh -L 8099:127.0.0.1:8099 first).
First visit silently exchanges the boot ticket: no password, no token handling.
EOF
