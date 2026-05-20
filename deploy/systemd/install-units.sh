#!/usr/bin/env bash
# Install mmx-report-automation systemd units on Raspberry Pi.
# Usage: ./deploy/systemd/install-units.sh orbro
set -euo pipefail

MMX_USER="${1:-}"
if [ -z "$MMX_USER" ]; then
    echo "Usage: $0 <linux-user>" >&2
    echo "Example: $0 orbro" >&2
    exit 1
fi

MMX_HOME="$(getent passwd "$MMX_USER" | cut -d: -f6)"
REPO="$MMX_HOME/mmx-report-automation"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -d "$REPO" ]; then
    echo "Repo not found at $REPO — clone first." >&2
    exit 1
fi

chmod +x "$REPO/scripts/pi-git-pull.sh"

if [ ! -f "$REPO/.env.production" ] && [ ! -f "$REPO/.env" ]; then
    echo "ERROR: Create $REPO/.env.production before starting services (see docs/raspberry-pi-setup.md §3)." >&2
    echo "  cp .env.example .env.production && nano .env.production" >&2
    exit 1
fi

for f in mmx-gate-watch.service mmx-pipeline.service mmx-pipeline.timer mmx-git-pull.service mmx-git-pull.timer; do
    sed -e "s|MMX_USER|$MMX_USER|g" -e "s|MMX_HOME|$MMX_HOME|g" "$SCRIPT_DIR/$f" | sudo tee "/etc/systemd/system/$f" >/dev/null
done

sudo systemctl daemon-reload
sudo systemctl enable mmx-gate-watch mmx-pipeline.timer mmx-git-pull.timer
sudo systemctl restart mmx-gate-watch
sudo systemctl start mmx-pipeline.timer mmx-git-pull.timer

echo "Installed. Status:"
systemctl is-enabled mmx-gate-watch mmx-pipeline.timer mmx-git-pull.timer
systemctl --no-pager status mmx-gate-watch --lines=5
systemctl list-timers --no-pager 'mmx-*'
