#!/bin/bash
# ================================================================
# Agent Company — Desktop Bloat Stripper
#
# Strips KDE Plasma down to bare essentials for a headless-first
# workstation that only needs: terminal, Cursor, Chrome.
#
# What it does:
#   1. Kills bloat processes (KDE services, openclaw, etc.)
#   2. Disables system services (cups, bluetooth, modem, etc.)
#   3. Disables KDE user services & autostart entries
#   4. Disables Baloo file indexer
#   5. Installs openbox (if missing) + creates minimal config
#   6. Prints summary of freed resources
#
# Usage:
#   ./scripts/strip-desktop.sh           # full strip (needs sudo)
#   ./scripts/strip-desktop.sh --dry-run  # show what would be done
#   ./scripts/strip-desktop.sh --kill-only # just kill processes, no permanent changes
#
# After running, log out and select "Openbox" at the SDDM login
# screen to permanently ditch plasmashell + kwin_wayland.
#
# To revert system services:
#   sudo systemctl unmask packagekit fwupd
#   sudo systemctl enable cups bluetooth ModemManager
# ================================================================

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DRY_RUN=false
KILL_ONLY=false

case "${1:-}" in
    --dry-run)  DRY_RUN=true ;;
    --kill-only) KILL_ONLY=true ;;
esac

# ── Colors ──────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $1"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()  { echo -e "${YELLOW}[SKIP]${NC}  $1"; }
action(){ echo -e "${RED}[KILL]${NC}  $1"; }

# ── Memory snapshot (before) ────────────────────────────────────
MEM_BEFORE=$(free -m | awk '/^Mem:/ {print $3}')
SWAP_BEFORE=$(free -m | awk '/^Swap:/ {print $3}')

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║       Desktop Bloat Stripper                     ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
info "Memory before: ${MEM_BEFORE} MB used, ${SWAP_BEFORE} MB swap"
echo ""

# ================================================================
# Phase 1: Kill bloat processes
# ================================================================
info "Phase 1: Killing bloat processes..."

KDE_PROCS=(
    krunner
    kded6
    kdeconnectd
    baloo_file
    baloorunner
    DiscoverNotifier
    kaccess
    org_kde_powerdevil
    kactivitymanagerd
    polkit-kde-authentication-agent
    ksmserver
    kwalletd6
    ksecretd
    xdg-desktop-portal-kde
    gmenudbusmenuproxy
    xembedsniproxy
    kioworker
    geoclue
    drkonqi
)

OTHER_PROCS=(
    openclaw-gateway
)

kill_proc() {
    local name="$1"
    local pids
    pids=$(pgrep -f "$name" 2>/dev/null || true)
    if [ -n "$pids" ]; then
        if $DRY_RUN; then
            action "[dry-run] would kill $name (PIDs: $pids)"
        else
            echo "$pids" | xargs kill -9 2>/dev/null || true
            action "killed $name"
        fi
    fi
}

for proc in "${KDE_PROCS[@]}" "${OTHER_PROCS[@]}"; do
    kill_proc "$proc"
done

if $KILL_ONLY; then
    MEM_AFTER=$(free -m | awk '/^Mem:/ {print $3}')
    SWAP_AFTER=$(free -m | awk '/^Swap:/ {print $3}')
    echo ""
    ok "Freed ~$((MEM_BEFORE - MEM_AFTER)) MB RAM, swap: ${SWAP_BEFORE} → ${SWAP_AFTER} MB"
    exit 0
fi

# ================================================================
# Phase 2: Disable system services (requires sudo)
# ================================================================
echo ""
info "Phase 2: Disabling system services..."

SYSTEM_SERVICES_DISABLE=(
    cups.service
    cups-browsed.service
    cups.socket
    cups.path
    bluetooth.service
    ModemManager.service
)

SYSTEM_SERVICES_MASK=(
    packagekit.service
    fwupd.service
)

SYSTEM_SERVICES_DISABLE_EXTRA=(
    neon-packagekit-offline-update-policy.service
    neon-packagekit-online-update-policy.service
)

if $DRY_RUN; then
    for svc in "${SYSTEM_SERVICES_DISABLE[@]}"; do
        action "[dry-run] would disable $svc"
    done
    for svc in "${SYSTEM_SERVICES_MASK[@]}"; do
        action "[dry-run] would mask $svc"
    done
else
    for svc in "${SYSTEM_SERVICES_DISABLE[@]}"; do
        sudo systemctl stop "$svc" 2>/dev/null || true
        sudo systemctl disable "$svc" 2>/dev/null || true
        ok "disabled $svc"
    done
    for svc in "${SYSTEM_SERVICES_MASK[@]}"; do
        sudo systemctl stop "$svc" 2>/dev/null || true
        sudo systemctl mask "$svc" 2>/dev/null || true
        ok "masked $svc"
    done
    for svc in "${SYSTEM_SERVICES_DISABLE_EXTRA[@]}"; do
        sudo systemctl disable "$svc" 2>/dev/null || true
        ok "disabled $svc"
    done
fi

# ================================================================
# Phase 3: Disable KDE user services
# ================================================================
echo ""
info "Phase 3: Disabling KDE user services..."

USER_SERVICES_DISABLE=(
    kde-baloo.service
    obex.service
    plasma-ksmserver.service
    drkonqi-coredump-cleanup.service
    drkonqi-coredump-pickup.service
    drkonqi-sentry-postman.path
)

USER_SERVICES_STOP=(
    kde-baloo.service
    plasma-baloorunner.service
    plasma-krunner.service
    plasma-kaccess.service
    plasma-powerdevil.service
    plasma-kactivitymanagerd.service
    plasma-gmenudbusmenuproxy.service
    plasma-xembedsniproxy.service
    plasma-polkit-agent.service
    plasma-kded6.service
    obex.service
)

if $DRY_RUN; then
    for svc in "${USER_SERVICES_DISABLE[@]}"; do
        action "[dry-run] would disable user service $svc"
    done
else
    for svc in "${USER_SERVICES_DISABLE[@]}"; do
        systemctl --user disable "$svc" 2>/dev/null || true
        ok "disabled $svc"
    done
    for svc in "${USER_SERVICES_STOP[@]}"; do
        systemctl --user stop "$svc" 2>/dev/null || true
    done
    ok "stopped all KDE user services"
fi

# ── Disable openclaw-gateway if it has a user service ───────────
if systemctl --user is-enabled openclaw-gateway.service 2>/dev/null | grep -q enabled; then
    if $DRY_RUN; then
        action "[dry-run] would disable openclaw-gateway.service"
    else
        systemctl --user stop openclaw-gateway.service 2>/dev/null || true
        systemctl --user disable openclaw-gateway.service 2>/dev/null || true
        ok "disabled openclaw-gateway.service"
    fi
fi

# ================================================================
# Phase 4: Disable KDE autostart entries
# ================================================================
echo ""
info "Phase 4: Suppressing KDE autostart entries..."

AUTOSTART_SUPPRESS=(
    org.kde.discover.notifier
    org.kde.kdeconnect.daemon
    geoclue-demo-agent
)

mkdir -p ~/.config/autostart

for entry in "${AUTOSTART_SUPPRESS[@]}"; do
    desktop_file="$HOME/.config/autostart/${entry}.desktop"
    if $DRY_RUN; then
        action "[dry-run] would create $desktop_file with Hidden=true"
    else
        cat > "$desktop_file" << 'HIDDEN'
[Desktop Entry]
Hidden=true
HIDDEN
        ok "suppressed autostart: $entry"
    fi
done

# ================================================================
# Phase 5: Disable Baloo file indexer
# ================================================================
echo ""
info "Phase 5: Disabling Baloo file indexer..."

if $DRY_RUN; then
    action "[dry-run] would disable Baloo in ~/.config/baloofilerc"
else
    mkdir -p ~/.config
    cat > ~/.config/baloofilerc << 'EOF'
[Basic Settings]
Indexing-Enabled=false
EOF
    balooctl6 disable 2>/dev/null || balooctl disable 2>/dev/null || true
    ok "Baloo file indexing disabled"
fi

# ================================================================
# Phase 6: Install openbox + create minimal config
# ================================================================
echo ""
info "Phase 6: Setting up openbox minimal session..."

if ! command -v openbox &>/dev/null; then
    if $DRY_RUN; then
        action "[dry-run] would install openbox"
    else
        info "Installing openbox..."
        sudo apt-get install -y openbox > /dev/null 2>&1
        ok "openbox installed"
    fi
else
    ok "openbox already installed"
fi

OPENBOX_DIR="$HOME/.config/openbox"
mkdir -p "$OPENBOX_DIR"

if $DRY_RUN; then
    action "[dry-run] would create openbox config in $OPENBOX_DIR"
else
    # ── autostart ───────────────────────────────────────────────
    cat > "$OPENBOX_DIR/autostart" << 'AUTOSTART'
#!/bin/bash
# ================================================================
# Openbox Autostart — Minimal Session
# Only starts what you actually use: terminal
# Launch Cursor and Chrome manually when needed.
# ================================================================

# Disable screen blanking / power saving (headless-friendly)
xset s off &
xset -dpms &
xset s noblank &

# Start a terminal
konsole &
AUTOSTART
    chmod +x "$OPENBOX_DIR/autostart"

    # ── rc.xml (window manager config) ──────────────────────────
    cat > "$OPENBOX_DIR/rc.xml" << 'RCXML'
<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc"
                xmlns:xi="http://www.w3.org/2001/XInclude">

  <resistance>
    <strength>10</strength>
    <screen_edge_strength>20</screen_edge_strength>
  </resistance>

  <focus>
    <focusNew>yes</focusNew>
    <followMouse>no</followMouse>
    <focusLast>yes</focusLast>
    <underMouse>no</underMouse>
    <focusDelay>200</focusDelay>
    <raiseOnFocus>no</raiseOnFocus>
  </focus>

  <placement>
    <policy>Smart</policy>
    <center>yes</center>
    <monitor>Primary</monitor>
    <primaryMonitor>1</primaryMonitor>
  </placement>

  <theme>
    <name>Clearlooks</name>
    <titleLayout>NLIMC</titleLayout>
    <keepBorder>yes</keepBorder>
    <animateIconify>no</animateIconify>
    <font place="ActiveWindow"><name>sans</name><size>10</size></font>
    <font place="InactiveWindow"><name>sans</name><size>10</size></font>
    <font place="MenuHeader"><name>sans</name><size>10</size></font>
    <font place="MenuItem"><name>sans</name><size>10</size></font>
    <font place="ActiveOnScreenDisplay"><name>sans</name><size>10</size></font>
    <font place="InactiveOnScreenDisplay"><name>sans</name><size>10</size></font>
  </theme>

  <desktops>
    <number>2</number>
    <firstdesk>1</firstdesk>
    <names><name>Work</name><name>Aux</name></names>
  </desktops>

  <keyboard>
    <!-- Terminal -->
    <keybind key="C-A-t">
      <action name="Execute"><command>konsole</command></action>
    </keybind>
    <!-- Chrome -->
    <keybind key="C-A-c">
      <action name="Execute"><command>google-chrome-stable</command></action>
    </keybind>
    <!-- Cursor -->
    <keybind key="C-A-e">
      <action name="Execute"><command>cursor</command></action>
    </keybind>
    <!-- Close window -->
    <keybind key="A-F4">
      <action name="Close"/>
    </keybind>
    <!-- Alt-Tab -->
    <keybind key="A-Tab">
      <action name="NextWindow"><finalactions><action name="Focus"/><action name="Raise"/><action name="Unshade"/></finalactions></action>
    </keybind>
    <keybind key="A-S-Tab">
      <action name="PreviousWindow"><finalactions><action name="Focus"/><action name="Raise"/><action name="Unshade"/></finalactions></action>
    </keybind>
    <!-- Switch desktops -->
    <keybind key="C-A-Left"><action name="GoToDesktop"><to>left</to><wrap>no</wrap></action></keybind>
    <keybind key="C-A-Right"><action name="GoToDesktop"><to>right</to><wrap>no</wrap></action></keybind>
    <!-- Fullscreen toggle -->
    <keybind key="F11">
      <action name="ToggleFullscreen"/>
    </keybind>
    <!-- Snap left/right -->
    <keybind key="W-Left">
      <action name="UnmaximizeFull"/>
      <action name="MoveResizeTo"><x>0</x><y>0</y><width>50%</width><height>100%</height></action>
    </keybind>
    <keybind key="W-Right">
      <action name="UnmaximizeFull"/>
      <action name="MoveResizeTo"><x>50%</x><y>0</y><width>50%</width><height>100%</height></action>
    </keybind>
    <!-- Maximize -->
    <keybind key="W-Up">
      <action name="ToggleMaximize"/>
    </keybind>
  </keyboard>

  <mouse>
    <dragThreshold>1</dragThreshold>
    <doubleClickTime>500</doubleClickTime>
    <screenEdgeWarpTime>400</screenEdgeWarpTime>
    <screenEdgeWarpMouse>false</screenEdgeWarpMouse>
    <context name="Frame">
      <mousebind button="A-Left" action="Press"><action name="Focus"/><action name="Raise"/></mousebind>
      <mousebind button="A-Left" action="Click"><action name="Unshade"/></mousebind>
      <mousebind button="A-Left" action="Drag"><action name="Move"/></mousebind>
      <mousebind button="A-Right" action="Press"><action name="Focus"/><action name="Raise"/></mousebind>
      <mousebind button="A-Right" action="Drag"><action name="Resize"/></mousebind>
    </context>
    <context name="Titlebar">
      <mousebind button="Left" action="Drag"><action name="Move"/></mousebind>
      <mousebind button="Left" action="DoubleClick"><action name="ToggleMaximize"/></mousebind>
    </context>
    <context name="Close"><mousebind button="Left" action="Click"><action name="Close"/></mousebind></context>
    <context name="Maximize"><mousebind button="Left" action="Click"><action name="ToggleMaximize"/></mousebind></context>
    <context name="Iconify"><mousebind button="Left" action="Click"><action name="Iconify"/></mousebind></context>
    <context name="Root">
      <mousebind button="Right" action="Press"><action name="ShowMenu"><menu>root-menu</menu></action></mousebind>
    </context>
  </mouse>

  <menu>
    <file>menu.xml</file>
    <hideDelay>200</hideDelay>
    <middle>no</middle>
    <submenuShowDelay>100</submenuShowDelay>
    <submenuHideDelay>400</submenuHideDelay>
    <applicationIcons>yes</applicationIcons>
    <manageDesktops>yes</manageDesktops>
  </menu>

</openbox_config>
RCXML

    # ── menu.xml (right-click menu) ─────────────────────────────
    cat > "$OPENBOX_DIR/menu.xml" << 'MENUXML'
<?xml version="1.0" encoding="UTF-8"?>
<openbox_menu xmlns="http://openbox.org/3.4/rc"
              xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
              xsi:schemaLocation="http://openbox.org/3.4/rc">

  <menu id="root-menu" label="Menu">
    <item label="Terminal"><action name="Execute"><command>konsole</command></action></item>
    <item label="Chrome"><action name="Execute"><command>google-chrome-stable</command></action></item>
    <item label="Cursor"><action name="Execute"><command>cursor</command></action></item>
    <separator/>
    <item label="Log Out"><action name="Exit"/></item>
  </menu>

</openbox_menu>
MENUXML

    ok "openbox config created"
fi

# ── Set SDDM to autologin to Openbox ───────────────────────────
echo ""
info "Phase 7: Configuring SDDM autologin to Openbox..."

SDDM_CONF="/etc/sddm.conf"
CURRENT_USER=$(whoami)

if $DRY_RUN; then
    action "[dry-run] would set SDDM autologin to Openbox for $CURRENT_USER"
else
    sudo tee "$SDDM_CONF" > /dev/null << SDDMEOF
[Autologin]
User=${CURRENT_USER}
Session=/usr/share/xsessions/openbox.desktop
SDDMEOF
    ok "SDDM autologin set to Openbox"
fi

# ================================================================
# Summary
# ================================================================
echo ""
MEM_AFTER=$(free -m | awk '/^Mem:/ {print $3}')
SWAP_AFTER=$(free -m | awk '/^Swap:/ {print $3}')
FREED=$((MEM_BEFORE - MEM_AFTER))

echo "╔══════════════════════════════════════════════════╗"
echo "║       Summary                                    ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
info "Memory after:  ${MEM_AFTER} MB used (freed ~${FREED} MB)"
info "Swap after:    ${SWAP_AFTER} MB (was ${SWAP_BEFORE} MB)"
echo ""
echo "Disabled system services:"
echo "  - cups (printing)"
echo "  - bluetooth"
echo "  - ModemManager (cellular modems)"
echo "  - packagekit (app store backend)"
echo "  - fwupd (firmware updates)"
echo ""
echo "Disabled KDE services:"
echo "  - baloo (file indexer)"
echo "  - krunner, kded6, kdeconnect, kaccess"
echo "  - powerdevil, kactivitymanagerd, polkit-kde"
echo "  - discover notifier, drkonqi, obex"
echo "  - openclaw-gateway"
echo ""
echo "Openbox config written to: ~/.config/openbox/"
echo ""
echo "Keybindings:"
echo "  Ctrl+Alt+T  → Terminal (konsole)"
echo "  Ctrl+Alt+C  → Chrome"
echo "  Ctrl+Alt+E  → Cursor"
echo "  Alt+Tab     → Switch windows"
echo "  Alt+F4      → Close window"
echo "  Super+Left  → Snap left"
echo "  Super+Right → Snap right"
echo "  Super+Up    → Maximize"
echo "  F11         → Fullscreen"
echo "  Right-click → App menu"
echo ""
if ! $DRY_RUN; then
    echo -e "${YELLOW}Next step:${NC} Reboot to land in the Openbox session."
    echo "SDDM will autologin to Openbox — no plasmashell, no"
    echo "kwin_wayland (~700 MB RAM and ~42% CPU saved)."
    echo ""
    echo "To revert:"
    echo "  # Restore Plasma session:"
    echo "  sudo tee /etc/sddm.conf << 'R'"
    echo "  [Autologin]"
    echo "  Session=/usr/share/wayland-sessions/plasma.desktop"
    echo "  R"
    echo "  # Re-enable system services:"
    echo "  sudo systemctl unmask packagekit fwupd"
    echo "  sudo systemctl enable cups bluetooth ModemManager"
fi
