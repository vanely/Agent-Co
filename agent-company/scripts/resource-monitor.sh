#!/bin/bash
# ================================================================
# Agent Company — Resource Monitor
# Runs on a cron/timer schedule. Analyzes running processes,
# kills zombie/stopped processes, warns on high resource usage,
# and logs actions taken.
#
# Usage:
#   ./scripts/resource-monitor.sh           # Run analysis + cleanup
#   ./scripts/resource-monitor.sh --dry-run  # Report only, don't kill
#   ./scripts/resource-monitor.sh --report   # Print current status
# ================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG="${SCRIPT_DIR}/resource-monitor.log"
DRY_RUN=false
REPORT_ONLY=false

case "${1:-}" in
  --dry-run)  DRY_RUN=true ;;
  --report)   REPORT_ONLY=true ;;
esac

TS=$(date '+%Y-%m-%d %H:%M:%S')

log() {
  echo "[$TS] $1" >> "$LOG"
  echo "$1"
}

# ----------------------------------------------------------------
# Thresholds
# ----------------------------------------------------------------
SWAP_WARN_MB=300            # Warn if swap exceeds this
STOPPED_PROCESS_MAX_AGE=3600 # Kill stopped processes older than 1 hour (seconds)
PROCESS_MEM_WARN_MB=500     # Warn if any single process exceeds this
ZOMBIE_KILL=true            # Kill zombie/stopped claude processes
MAX_LOG_LINES=500           # Trim log to this length

# ----------------------------------------------------------------
# System Overview
# ----------------------------------------------------------------
report_system() {
  local cpu_idle mem_total mem_used mem_free swap_used swap_total
  cpu_idle=$(top -bn1 | grep "Cpu(s)" | awk '{print $8}' | cut -d. -f1)
  mem_total=$(free -m | awk '/Mem:/{print $2}')
  mem_used=$(free -m | awk '/Mem:/{print $3}')
  mem_free=$(free -m | awk '/Mem:/{print $4}')
  swap_used=$(free -m | awk '/Swap:/{print $3}')
  swap_total=$(free -m | awk '/Swap:/{print $2}')
  local load
  load=$(cat /proc/loadavg | awk '{print $1, $2, $3}')

  echo ""
  echo "=== System Resource Report ==="
  echo "  Time:      $TS"
  echo "  Load:      $load"
  echo "  CPU idle:  ${cpu_idle}%"
  echo "  Memory:    ${mem_used}MB / ${mem_total}MB (${mem_free}MB free)"
  echo "  Swap:      ${swap_used}MB / ${swap_total}MB"
  echo ""

  # Swap warning
  if [ "$swap_used" -gt "$SWAP_WARN_MB" ]; then
    echo "  [!!] Swap usage high: ${swap_used}MB (threshold: ${SWAP_WARN_MB}MB)"
    log "WARN: Swap at ${swap_used}MB"
  fi
}

# ----------------------------------------------------------------
# Find and report stopped/zombie processes
# ----------------------------------------------------------------
find_stopped_processes() {
  echo "=== Stopped/Zombie Processes ==="

  local found=false

  # Stopped processes (T/Tl state)
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    found=true
    local pid user cpu mem stat cmd
    pid=$(echo "$line" | awk '{print $2}')
    user=$(echo "$line" | awk '{print $1}')
    cpu=$(echo "$line" | awk '{print $3}')
    mem=$(echo "$line" | awk '{print $4}')
    stat=$(echo "$line" | awk '{print $8}')
    cmd=$(echo "$line" | awk '{for(i=11;i<=NF;i++) printf "%s ", $i; print ""}' | head -c 80)
    local rss_mb
    rss_mb=$(echo "$line" | awk '{print int($6/1024)}')

    echo "  PID $pid [$stat] ${rss_mb}MB — $cmd"

    if $ZOMBIE_KILL && ! $DRY_RUN && ! $REPORT_ONLY; then
      kill -9 "$pid" 2>/dev/null
      if ! kill -0 "$pid" 2>/dev/null; then
        log "KILLED: PID $pid (${rss_mb}MB) — $cmd"
        echo "    -> killed (freed ~${rss_mb}MB)"
      else
        log "FAILED to kill PID $pid"
        echo "    -> kill failed"
      fi
    elif $DRY_RUN; then
      echo "    -> would kill (dry-run)"
    fi
  done < <(ps aux | awk '$8 ~ /^T/ && $1 != "root"' | grep -v "grep")

  # Zombie processes (Z state)
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    found=true
    local pid cmd
    pid=$(echo "$line" | awk '{print $2}')
    cmd=$(echo "$line" | awk '{for(i=11;i<=NF;i++) printf "%s ", $i; print ""}' | head -c 80)
    echo "  PID $pid [zombie] — $cmd"
  done < <(ps aux | awk '$8 == "Z"')

  if ! $found; then
    echo "  (none)"
  fi
  echo ""
}

# ----------------------------------------------------------------
# Find high-memory processes
# ----------------------------------------------------------------
find_memory_hogs() {
  echo "=== High Memory Processes (>${PROCESS_MEM_WARN_MB}MB) ==="

  local found=false
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    local pid user rss_mb cmd
    pid=$(echo "$line" | awk '{print $2}')
    user=$(echo "$line" | awk '{print $1}')
    rss_mb=$(echo "$line" | awk '{print int($6/1024)}')
    cmd=$(echo "$line" | awk '{for(i=11;i<=NF;i++) printf "%s ", $i; print ""}' | head -c 80)

    if [ "$rss_mb" -gt "$PROCESS_MEM_WARN_MB" ]; then
      found=true
      echo "  PID $pid — ${rss_mb}MB — $cmd"
    fi
  done < <(ps aux --sort=-rss | head -20)

  if ! $found; then
    echo "  (none above ${PROCESS_MEM_WARN_MB}MB)"
  fi
  echo ""
}

# ----------------------------------------------------------------
# Find high-CPU processes (sustained)
# ----------------------------------------------------------------
find_cpu_hogs() {
  echo "=== High CPU Processes (>10%) ==="

  local found=false
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    local pid user cpu cmd stat
    pid=$(echo "$line" | awk '{print $2}')
    user=$(echo "$line" | awk '{print $1}')
    cpu=$(echo "$line" | awk '{print $3}')
    stat=$(echo "$line" | awk '{print $8}')
    cmd=$(echo "$line" | awk '{for(i=11;i<=NF;i++) printf "%s ", $i; print ""}' | head -c 80)

    # Skip the monitoring command itself
    echo "$cmd" | grep -q "ps aux\|resource-monitor\|top -bn" && continue

    local cpu_int
    cpu_int=$(echo "$cpu" | cut -d. -f1)
    if [ "$cpu_int" -gt 10 ]; then
      found=true
      echo "  PID $pid — ${cpu}% CPU [$stat] — $cmd"
    fi
  done < <(ps aux --sort=-%cpu | tail -n +2 | head -15)

  if ! $found; then
    echo "  (none above 10%)"
  fi
  echo ""
}

# ----------------------------------------------------------------
# Check agent-co services
# ----------------------------------------------------------------
check_services() {
  echo "=== Agent Company Services ==="

  # Relay
  local relay_status="DOWN"
  if curl -s -o /dev/null --connect-timeout 2 http://localhost:3456/health 2>/dev/null; then
    relay_status="UP"
  fi
  echo "  Relay:      $relay_status"

  # Bot
  local bot_status="DOWN"
  if systemctl --user is-active --quiet agentco-bot.service 2>/dev/null; then
    bot_status="UP"
  fi
  echo "  Bot:        $bot_status"

  # Docker containers
  for container in agentco_postgres agentco_n8n agentco_dashboard; do
    local status="DOWN"
    docker ps --format '{{.Names}}' 2>/dev/null | grep -q "$container" && status="UP"
    echo "  $container: $status"
  done

  # Tunnel
  if [ -f "$PROJECT_DIR/scripts/tunnel.pid" ] && kill -0 "$(cat "$PROJECT_DIR/scripts/tunnel.pid" 2>/dev/null)" 2>/dev/null; then
    echo "  Tunnel:     UP"
  else
    echo "  Tunnel:     DOWN"
  fi

  echo ""
}

# ----------------------------------------------------------------
# Duplicate process detection
# ----------------------------------------------------------------
find_duplicates() {
  echo "=== Duplicate Processes ==="

  local found=false

  # Multiple claude processes
  local claude_count
  claude_count=$(ps aux | grep "claude.*dangerously" | grep -v grep | wc -l)
  if [ "$claude_count" -gt 1 ]; then
    found=true
    echo "  [!!] $claude_count claude processes running (expected: 1 active)"
    ps aux | grep "claude.*dangerously" | grep -v grep | awk '{printf "    PID %s [%s] %sMB — started %s\n", $2, $8, int($6/1024), $9}'
  fi

  # Multiple node relay processes
  local relay_count
  relay_count=$(ps aux | grep "node dist/server.js" | grep -v grep | wc -l)
  if [ "$relay_count" -gt 1 ]; then
    found=true
    echo "  [!!] $relay_count relay processes (expected: 1)"
    ps aux | grep "node dist/server.js" | grep -v grep | awk '{printf "    PID %s — %sMB\n", $2, int($6/1024)}'
  fi

  # Multiple bot processes
  local bot_count
  bot_count=$(ps aux | grep "node dist/bot.js" | grep -v grep | wc -l)
  if [ "$bot_count" -gt 1 ]; then
    found=true
    echo "  [!!] $bot_count bot processes (expected: 1)"
  fi

  if ! $found; then
    echo "  (no duplicates)"
  fi
  echo ""
}

# ----------------------------------------------------------------
# Recommendations
# ----------------------------------------------------------------
generate_recommendations() {
  echo "=== Recommendations ==="

  local has_recs=false

  # Swap
  local swap_used
  swap_used=$(free -m | awk '/Swap:/{print $3}')
  if [ "$swap_used" -gt "$SWAP_WARN_MB" ]; then
    has_recs=true
    echo "  - High swap usage (${swap_used}MB). Check for memory leaks or stopped processes."
  fi

  # KDE compositing (known issue)
  local kwin_cpu
  kwin_cpu=$(ps aux | grep "kwin_wayland" | grep -v grep | awk '{print $3}' | cut -d. -f1 | head -1)
  if [ -n "$kwin_cpu" ] && [ "$kwin_cpu" -gt 15 ]; then
    has_recs=true
    echo "  - kwin_wayland at ${kwin_cpu}% CPU. KDE Wayland compositor issue."
    echo "    Consider: disable blur/transparency, or switch to X11 session."
  fi

  local plasmashell_cpu
  plasmashell_cpu=$(ps aux | grep "plasmashell" | grep -v grep | awk '{print $3}' | cut -d. -f1 | head -1)
  if [ -n "$plasmashell_cpu" ] && [ "$plasmashell_cpu" -gt 15 ]; then
    has_recs=true
    echo "  - plasmashell at ${plasmashell_cpu}% CPU. Desktop shell running hot."
  fi

  if ! $has_recs; then
    echo "  (system looks healthy)"
  fi
  echo ""
}

# ----------------------------------------------------------------
# Kill true orphans (PPID=1 = reparented to init)
#
# Catches cases the "duplicate claude" logic misses — a single abandoned
# process is still abandoned. Two specific orphan shapes we've seen burn
# hours of uptime:
#
#   1. `claude --dangerously-skip-permissions ...` reparented to init after
#      its spawning shell/service died. No tty, nothing to talk to.
#   2. `cloudflared tunnel --url http://localhost:PORT` whose upstream
#      service (Vite, dashboard, etc.) exited — tunnel tunnels to a dead
#      port forever.
#
# Both signals combine: PPID=1 + (no tty || upstream port is cold).
# ----------------------------------------------------------------
cleanup_orphans() {
  local killed=0

  # Orphaned claude: PPID=1, no controlling tty (pts/? would mean a live shell).
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    local pid etime cmd
    pid=$(echo "$line"   | awk '{print $1}')
    etime=$(echo "$line" | awk '{print $3}')
    cmd=$(echo "$line"   | awk '{for(i=5;i<=NF;i++) printf "%s ", $i; print ""}' | head -c 100)
    kill -9 "$pid" 2>/dev/null
    if ! kill -0 "$pid" 2>/dev/null; then
      log "KILLED orphan claude: PID $pid (uptime $etime) — $cmd"
      killed=$((killed + 1))
    fi
  done < <(ps -eo pid,ppid,etime,tty,cmd --sort=-etime 2>/dev/null \
           | awk '$2 == 1 && $4 == "?" && $5 ~ /claude/')

  # Orphaned cloudflared: PPID=1 AND tunneling to a localhost port nothing
  # is listening on. Ignores named/permanent tunnels (no localhost:PORT arg).
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    local pid etime cmd port
    pid=$(echo "$line"   | awk '{print $1}')
    etime=$(echo "$line" | awk '{print $3}')
    cmd=$(echo "$line"   | awk '{for(i=5;i<=NF;i++) printf "%s ", $i; print ""}' | head -c 200)
    port=$(echo "$cmd" | grep -oE 'localhost:[0-9]+' | head -1 | cut -d: -f2)
    [ -z "$port" ] && continue  # not a localhost quick-tunnel — leave it alone
    if ! ss -tln 2>/dev/null | grep -qE ":${port}[[:space:]]"; then
      kill -9 "$pid" 2>/dev/null
      if ! kill -0 "$pid" 2>/dev/null; then
        log "KILLED orphan cloudflared: PID $pid (uptime $etime, dead upstream :$port) — $cmd"
        killed=$((killed + 1))
      fi
    fi
  done < <(ps -eo pid,ppid,etime,tty,cmd --sort=-etime 2>/dev/null \
           | awk '$2 == 1 && $5 ~ /cloudflared/')

  if [ "$killed" -gt 0 ]; then
    log "Cleaned $killed orphan process(es) (PPID=1)"
  fi
}

# ----------------------------------------------------------------
# Log trimming
# ----------------------------------------------------------------
trim_log() {
  if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt "$MAX_LOG_LINES" ]; then
    tail -"$MAX_LOG_LINES" "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
  fi
}

# ----------------------------------------------------------------
# Main
# ----------------------------------------------------------------
main() {
  if $REPORT_ONLY || $DRY_RUN; then
    report_system
    find_stopped_processes
    find_memory_hogs
    find_cpu_hogs
    find_duplicates
    check_services
    generate_recommendations
  else
    # Automated cleanup mode (cron)
    log "--- Resource monitor run ---"

    # Kill stopped processes
    local killed=0
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      local pid rss_mb cmd
      pid=$(echo "$line" | awk '{print $2}')
      rss_mb=$(echo "$line" | awk '{print int($6/1024)}')
      cmd=$(echo "$line" | awk '{for(i=11;i<=NF;i++) printf "%s ", $i; print ""}' | head -c 80)

      kill -9 "$pid" 2>/dev/null
      if ! kill -0 "$pid" 2>/dev/null; then
        log "KILLED: PID $pid (${rss_mb}MB) — $cmd"
        killed=$((killed + 1))
      fi
    done < <(ps aux | awk '$8 ~ /^T/ && $1 != "root"')

    # Report
    local swap_used mem_free
    swap_used=$(free -m | awk '/Swap:/{print $3}')
    mem_free=$(free -m | awk '/Mem:/{print $4}')

    if [ "$killed" -gt 0 ]; then
      log "Cleaned $killed stopped process(es). Memory free: ${mem_free}MB, Swap: ${swap_used}MB"
    fi

    if [ "$swap_used" -gt "$SWAP_WARN_MB" ]; then
      log "WARN: Swap still high at ${swap_used}MB after cleanup"
    fi

    # Reap true orphans (PPID=1) — dead-parent claude + cloudflared with cold upstream.
    cleanup_orphans

    # Check for duplicate claude processes and kill extras
    local claude_pids
    claude_pids=$(ps aux | grep "claude.*dangerously" | grep -v grep | awk '$8 ~ /^S/' | awk '{print $2}')
    local active_count
    active_count=$(echo "$claude_pids" | grep -c "." 2>/dev/null || echo 0)
    if [ "$active_count" -gt 1 ]; then
      # Keep the most recent, kill the rest
      local newest
      newest=$(echo "$claude_pids" | tail -1)
      for pid in $claude_pids; do
        if [ "$pid" != "$newest" ]; then
          kill -9 "$pid" 2>/dev/null
          log "KILLED duplicate claude: PID $pid (kept $newest)"
        fi
      done
    fi

    log "OK: mem_free=${mem_free}MB swap=${swap_used}MB"
  fi

  trim_log
}

main
