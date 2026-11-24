#!/bin/bash
# Starts run.sh every 6 hours (12:17, 6:17 am/pm local) with launchd. If the Mac was asleep,
# launchd runs it once when it wakes. Remove with: launchctl bootout gui/$(id -u)/com.jobhunt.collector
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.jobhunt.collector.plist"
LOG="$HOME/Library/Logs/job-hunt-collector.log"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
chmod +x "$HERE/run.sh"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.jobhunt.collector</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$HERE/run.sh</string></array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>0</integer><key>Minute</key><integer>17</integer></dict>
    <dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>17</integer></dict>
    <dict><key>Hour</key><integer>12</integer><key>Minute</key><integer>17</integer></dict>
    <dict><key>Hour</key><integer>18</integer><key>Minute</key><integer>17</integer></dict>
  </array>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PL
launchctl bootout "gui/$(id -u)/com.jobhunt.collector" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed. Log: $LOG"
