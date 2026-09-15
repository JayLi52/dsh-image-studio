#!/bin/bash
# claude-mem hook wrapper for DeepSeek Harness (dsh-hooks-codex bridge).
# Mirrors the ZCode reference wrapper: bridges dsh hook events to claude-mem's
# codex adapter on this host's worker (bun + worker-service.cjs).
#
# Usage: bash claude-mem-hook.sh <event>
# Events: context | session-init | observation | file-context | summarize
set -euo pipefail

EVENT="${1:-}"
PLUGIN_ROOT="/root/work/claude-mem/plugin"
export PATH="/root/.bun/bin:/root/.nvm/versions/node/v22.23.2/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"
export CLAUDE_MEM_CODEX_HOOK=1

case "$EVENT" in
  context)       HOOK_EVENT="SessionStart" ;;
  session-init)  HOOK_EVENT="UserPromptSubmit" ;;
  observation)   HOOK_EVENT="PostToolUse" ;;
  file-context)  HOOK_EVENT="PreToolUse" ;;
  summarize)     HOOK_EVENT="Stop" ;;
  *) echo "{}"; exit 0 ;;
esac
export HE="$HOOK_EVENT"

INPUT="$(cat)"

TRANSFORMED=$(printf '%s' "$INPUT" | node -e '
let d = "";
process.stdin.on("data", (c) => (d += c)).on("end", () => {
  let o;
  try { o = JSON.parse(d || "{}"); } catch { o = {}; }
  o.hook_event_name = process.env.HE;
  if (o.stop_response && !o.last_assistant_message) o.last_assistant_message = o.stop_response;
  if (!o.session_id) o.session_id = o.id || "dsh-session";
  if (!o.cwd) o.cwd = process.env.HOME;
  process.stdout.write(JSON.stringify(o));
});' 2>/dev/null || echo "{\"session_id\":\"dsh-session\",\"cwd\":\"$HOME\",\"hook_event_name\":\"$HOOK_EVENT\"}")

OUTPUT=$(printf '%s' "$TRANSFORMED" | bun "$PLUGIN_ROOT/scripts/worker-service.cjs" hook codex "$EVENT" 2>/dev/null || true)

printf '%s' "$OUTPUT" | node -e '
let d = "";
process.stdin.on("data", (c) => (d += c)).on("end", () => {
  let o;
  try { o = JSON.parse(d || "{}"); } catch { o = {}; }
  const out = {};
  const ac = (o.hookSpecificOutput && o.hookSpecificOutput.additionalContext) || o.additionalContext;
  if (ac) out.additionalContext = ac;
  if (o.systemMessage) out.systemMessage = o.systemMessage;
  if (o.decision) out.decision = o.decision;
  if (o.reason) out.reason = o.reason;
  process.stdout.write(JSON.stringify(out));
});' 2>/dev/null || echo '{}'

exit 0
