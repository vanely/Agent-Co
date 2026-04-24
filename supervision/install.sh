#!/usr/bin/env bash
# supervision/install.sh — cross-platform supervision installer.
#
# Detects the host OS, renders the appropriate templates, and installs them
# to the right location:
#   Linux  → ~/.config/systemd/user/  (systemctl --user)
#   macOS  → ~/Library/LaunchAgents/  (launchctl)
#
# Subcommands:
#   install   — render + install all service/timer units
#   uninstall — stop + disable + remove installed units
#   status    — show which units are installed and their state
#   render    — preview rendered templates without installing (dry run)
#
# Environment:
#   AGENT_CO_ROOT  absolute path to installed agent-co (required)
#   HOME           user's home (auto-detected)

set -euo pipefail

AGENT_CO_ROOT="${AGENT_CO_ROOT:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." &> /dev/null && pwd)}"
TEMPLATE_ROOT="$AGENT_CO_ROOT/supervision"

FORCE=false
cmd="install"
for arg in "$@"; do
  case "$arg" in
    --force|-f) FORCE=true ;;
    install|uninstall|status|render) cmd="$arg" ;;
    *) ;;
  esac
done

detect_platform() {
  case "$(uname -s)" in
    Linux*)  echo "linux"  ;;
    Darwin*) echo "darwin" ;;
    *)       echo "unsupported" ;;
  esac
}

render_template() {
  local src="$1" dst="$2"
  sed -e "s|{{AGENT_CO_ROOT}}|$AGENT_CO_ROOT|g" \
      -e "s|{{HOME}}|$HOME|g" \
      "$src" > "$dst"
}

# Read the AGENT_CO_ROOT value embedded in an already-installed unit file.
# Works on both systemd units (Environment=AGENT_CO_ROOT=…) and launchd plists
# (XML <key>AGENT_CO_ROOT</key><string>…</string>). Empty if none found.
existing_agent_co_root() {
  local file="$1"
  [ -f "$file" ] || return 0

  # systemd style
  local v
  v=$(grep -oE 'AGENT_CO_ROOT=[^[:space:]"]+' "$file" 2>/dev/null | head -1 | cut -d= -f2- || true)
  if [ -n "$v" ]; then
    echo "$v"
    return 0
  fi

  # launchd plist style: next <string> after <key>AGENT_CO_ROOT</key>
  v=$(awk '
    /<key>AGENT_CO_ROOT<\/key>/ { hit=1; next }
    hit && /<string>/ {
      match($0, /<string>([^<]*)<\/string>/, m)
      print m[1]
      exit
    }
  ' "$file" 2>/dev/null || true)
  [ -n "$v" ] && echo "$v"
}

# Check that an existing unit is safe to overwrite. Returns 0 (safe) or 1
# (conflict). Conflict means: a unit with the same name already exists and
# its AGENT_CO_ROOT points somewhere other than the one we're about to install.
# This is the class of bug where a smoke-test install overwrote a prod unit
# with a throwaway path. Refusing here unless --force means the only way to
# hit it is deliberate.
check_safe_overwrite() {
  local dst="$1"
  [ -f "$dst" ] || return 0  # new file — safe

  local existing
  existing=$(existing_agent_co_root "$dst")
  [ -z "$existing" ] && return 0             # no AGENT_CO_ROOT in existing file
  [ "$existing" = "$AGENT_CO_ROOT" ] && return 0  # same path — safe to refresh

  echo "  ⚠ CONFLICT: $(basename "$dst")" >&2
  echo "      existing AGENT_CO_ROOT: $existing" >&2
  echo "      installing with:        $AGENT_CO_ROOT" >&2
  return 1
}

install_linux() {
  local dest="$HOME/.config/systemd/user"
  mkdir -p "$dest" "$AGENT_CO_ROOT/logs"

  local units=(
    "agentco-relay.service"
    "agentco-bot.service"
    "agentco-telegram-bot.service"
    "agentco-cc-health-check.service"
    "agentco-cc-health-check.timer"
    "agentco-learning-consolidation.service"
    "agentco-learning-consolidation.timer"
  )

  # Safety check: refuse to overwrite any existing unit whose AGENT_CO_ROOT
  # points elsewhere. Prevents a dev/smoke-test run from silently stomping
  # a production install's supervision.
  if ! $FORCE; then
    local conflicts=0
    for unit in "${units[@]}"; do
      [ -f "$TEMPLATE_ROOT/systemd/$unit.template" ] || continue
      if ! check_safe_overwrite "$dest/$unit"; then
        conflicts=$((conflicts + 1))
      fi
    done
    if [ "$conflicts" -gt 0 ]; then
      echo "" >&2
      echo "Refusing to overwrite $conflicts unit(s) that point at a different AGENT_CO_ROOT." >&2
      echo "If this is intentional (e.g. relocating an install), re-run with --force." >&2
      echo "Otherwise, unset AGENT_CO_ROOT and let the script auto-detect, or run this from" >&2
      echo "the correct install directory:" >&2
      echo "    cd /path/to/real/agent-co && supervision/install.sh install" >&2
      exit 3
    fi
  fi

  echo "→ Rendering + installing systemd user units to $dest"
  for unit in "${units[@]}"; do
    local tmpl="$TEMPLATE_ROOT/systemd/$unit.template"
    if [ ! -f "$tmpl" ]; then
      echo "  skip $unit (no template)"
      continue
    fi
    render_template "$tmpl" "$dest/$unit"
    echo "  installed $unit"
  done

  systemctl --user daemon-reload
  echo ""
  echo "→ Units installed. Enable + start:"
  echo "  systemctl --user enable --now agentco-relay.service"
  echo "  systemctl --user enable --now agentco-bot.service       # optional"
  echo "  systemctl --user enable --now agentco-telegram-bot.service   # optional"
  echo "  systemctl --user enable --now agentco-cc-health-check.timer"
  echo "  systemctl --user enable --now agentco-learning-consolidation.timer"
}

install_darwin() {
  local dest="$HOME/Library/LaunchAgents"
  mkdir -p "$dest" "$AGENT_CO_ROOT/logs"

  local plists=(
    "com.agentco.relay.plist"
    "com.agentco.bot.plist"
    "com.agentco.telegram-bot.plist"
    "com.agentco.cc-health-check.plist"
    "com.agentco.learning-consolidation.plist"
  )

  # Safety check (see install_linux for rationale).
  if ! $FORCE; then
    local conflicts=0
    for plist in "${plists[@]}"; do
      [ -f "$TEMPLATE_ROOT/launchd/$plist.template" ] || continue
      if ! check_safe_overwrite "$dest/$plist"; then
        conflicts=$((conflicts + 1))
      fi
    done
    if [ "$conflicts" -gt 0 ]; then
      echo "" >&2
      echo "Refusing to overwrite $conflicts plist(s) pointing at a different AGENT_CO_ROOT." >&2
      echo "Re-run with --force if intentional, or run from the correct install directory." >&2
      exit 3
    fi
  fi

  echo "→ Rendering + installing launchd agents to $dest"
  for plist in "${plists[@]}"; do
    local tmpl="$TEMPLATE_ROOT/launchd/$plist.template"
    if [ ! -f "$tmpl" ]; then
      echo "  skip $plist (no template)"
      continue
    fi
    render_template "$tmpl" "$dest/$plist"
    echo "  installed $plist"
  done

  echo ""
  echo "→ Plists installed. Load them:"
  echo "  launchctl load -w $dest/com.agentco.relay.plist"
  echo "  launchctl load -w $dest/com.agentco.bot.plist                 # optional"
  echo "  launchctl load -w $dest/com.agentco.telegram-bot.plist        # optional"
  echo "  launchctl load -w $dest/com.agentco.cc-health-check.plist"
  echo "  launchctl load -w $dest/com.agentco.learning-consolidation.plist"
}

uninstall_linux() {
  local dest="$HOME/.config/systemd/user"
  for unit in agentco-relay agentco-bot agentco-telegram-bot \
              agentco-cc-health-check agentco-learning-consolidation; do
    systemctl --user disable --now "$unit.service" 2>/dev/null || true
    systemctl --user disable --now "$unit.timer"   2>/dev/null || true
    rm -f "$dest/$unit.service" "$dest/$unit.timer"
    echo "  removed $unit"
  done
  systemctl --user daemon-reload
}

uninstall_darwin() {
  local dest="$HOME/Library/LaunchAgents"
  for plist in com.agentco.relay com.agentco.bot com.agentco.telegram-bot \
               com.agentco.cc-health-check com.agentco.learning-consolidation; do
    launchctl unload -w "$dest/$plist.plist" 2>/dev/null || true
    rm -f "$dest/$plist.plist"
    echo "  removed $plist"
  done
}

status_linux() {
  systemctl --user list-units --all 'agentco-*' --no-legend --no-pager 2>/dev/null || true
  echo ""
  systemctl --user list-timers 'agentco-*.timer' --no-legend --no-pager 2>/dev/null || true
}

status_darwin() {
  launchctl list | grep -E 'com\.agentco' || echo "  (no agentco agents loaded)"
}

render_all() {
  local platform="$1"
  local subdir
  case "$platform" in
    linux)  subdir="systemd"  ;;
    darwin) subdir="launchd"  ;;
    *) echo "unsupported platform: $platform" >&2; exit 2 ;;
  esac

  echo "→ Rendered templates (platform=$platform):"
  echo ""
  for tmpl in "$TEMPLATE_ROOT/$subdir"/*.template; do
    [ -f "$tmpl" ] || continue
    echo "════════════════════════════════════════════════════════════════"
    echo "  $(basename "$tmpl" .template)"
    echo "════════════════════════════════════════════════════════════════"
    sed -e "s|{{AGENT_CO_ROOT}}|$AGENT_CO_ROOT|g" -e "s|{{HOME}}|$HOME|g" "$tmpl"
    echo ""
  done
}

platform="$(detect_platform)"
if [ "$platform" = "unsupported" ]; then
  echo "error: unsupported platform. Linux and macOS only for now." >&2
  echo "For Windows/other: consider running in Docker or WSL." >&2
  exit 2
fi

case "$cmd" in
  install)
    case "$platform" in
      linux)  install_linux  ;;
      darwin) install_darwin ;;
    esac
    ;;
  uninstall)
    case "$platform" in
      linux)  uninstall_linux  ;;
      darwin) uninstall_darwin ;;
    esac
    ;;
  status)
    case "$platform" in
      linux)  status_linux  ;;
      darwin) status_darwin ;;
    esac
    ;;
  render)
    render_all "$platform"
    ;;
  *)
    cat <<EOF
usage: $0 <command> [--force]

commands:
  install    render + install supervision units for this platform ($platform)
  uninstall  stop + disable + remove installed units
  status     show installed units and their state
  render     preview rendered templates (dry run)

flags:
  --force    overwrite existing units even when their AGENT_CO_ROOT differs
             from the one being installed. Without this, install refuses to
             clobber a unit that points at a different install path.

detected platform: $platform
template root:     $TEMPLATE_ROOT
agent-co root:     $AGENT_CO_ROOT
EOF
    exit 1
    ;;
esac
