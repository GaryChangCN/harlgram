#!/usr/bin/env bash
# Source from the other scripts; all paths remain quoted for installations with spaces.
set -euo pipefail

HARLGRAM_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEVECO_HOME="${DEVECO_HOME:-/Applications/DevEco-Studio.app/Contents}"
if [[ -d "$DEVECO_HOME/Contents" ]]; then
  DEVECO_HOME="$DEVECO_HOME/Contents"
fi
export DEVECO_SDK_HOME="${DEVECO_SDK_HOME:-$DEVECO_HOME/sdk}"
export NODE_HOME="${HARLGRAM_NODE_HOME:-$DEVECO_HOME/tools/node}"
export JAVA_HOME="${HARLGRAM_JAVA_HOME:-$DEVECO_HOME/jbr/Contents/Home}"
export PATH="$NODE_HOME/bin:$DEVECO_HOME/tools/ohpm/bin:$JAVA_HOME/bin:$PATH"
HVIGOR_BIN="${HVIGOR_BIN:-$DEVECO_HOME/tools/hvigor/bin/hvigorw}"
HDC_BIN="${HDC_BIN:-$DEVECO_SDK_HOME/default/openharmony/toolchains/hdc}"
EMULATOR_BIN="${EMULATOR_BIN:-$DEVECO_HOME/tools/emulator/Emulator}"
HARLGRAM_BUNDLE="${HARLGRAM_BUNDLE:-xyz.3333189.harlgram}"
HARLGRAM_ABILITY="${HARLGRAM_ABILITY:-EntryAbility}"

fail() { printf '%s\n' "$*" >&2; exit 1; }
require_tool() { [[ -x "$1" ]] || fail "找不到可执行文件：$1；请设置 DEVECO_HOME 或对应工具路径。"; }

select_device() {
  require_tool "$HDC_BIN"
  local target listing
  local targets=()
  listing="$("$HDC_BIN" list targets)" || fail '无法读取设备列表。'
  while IFS= read -r target; do
    target="${target//$'\r'/}"
    [[ -z "$target" || "$target" == '[Empty]' ]] && continue
    targets+=("$target")
  done <<< "$listing"
  [[ ${#targets[@]} -gt 0 ]] || fail '没有可用设备；请启动已有模拟器或连接已开启调试的真机。'
  if [[ -n "${HDC_TARGET:-}" ]]; then
    for target in "${targets[@]}"; do
      [[ "$target" == "$HDC_TARGET" ]] && return 0
    done
    fail "HDC_TARGET 不在设备列表中：$HDC_TARGET"
  fi
  [[ ${#targets[@]} -eq 1 ]] || fail "检测到多个设备，请用 HDC_TARGET 指定目标：${targets[*]}"
  HDC_TARGET="${targets[0]}"
}

hdc_device() { "$HDC_BIN" -t "$HDC_TARGET" "$@"; }
