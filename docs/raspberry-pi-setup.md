# Raspberry Pi setup — mmx-report-automation

Deploy the Macromatix pipeline on a fresh Pi alongside [live-dashboard-app](https://github.com/TiripsOrbro/live-dashboard-app). The dashboard and this app use **separate** browser profiles and **separate** systemd units.

## What runs on the Pi

| Job | Command | Purpose |
|-----|---------|---------|
| **Gate watch** (always on) | `npm run gate-watch` | Hourly key-item gate check, 9 AM–11 PM; **restarts on crash**; pauses after daily pipeline |
| **Git pull** (every 15 min) | `scripts/pi-git-pull.sh` | `git pull --ff-only`; restarts gate-watch when code changes |
| **Full pipeline** (scheduled) | `npm start` | Gate → 3 reports → Excel → all scheduled orders (once per day) |

`gate-watch` only logs whether the gate is READY. It does **not** start downloads or orders. After **`npm start`** finishes for the day, gate-watch **stops checking** until the next calendar day. Schedule `npm start` with `mmx-pipeline.timer` (or run manually when logs show READY).

**Production on Pi:** use the three systemd units in `deploy/systemd/` (install script below) — not manual `npm run` in a terminal.

---

## 1. Prerequisites

- Raspberry Pi 4 (or better), **4 GB RAM** recommended
- Raspberry Pi OS (64-bit) with network
- Node.js **18+** and npm:

```bash
sudo apt update
sudo apt install -y git chromium nodejs npm
which chromium || which chromium-browser
```

Note the Chromium path (Bookworm is often `/usr/bin/chromium`; older images use `/usr/bin/chromium-browser`).

---

## 2. Clone and install

```bash
cd ~
git clone https://github.com/TiripsOrbro/mmx-report-automation.git
cd mmx-report-automation
npm install
npm run setup
```

`npm run setup` creates `config/pipeline.json` and `config/excel-mapping.json` from examples if missing.

Copy your workbook (not in git):

```bash
mkdir -p data/workbooks
# Copy Build To JS.xlsx from your PC or server, e.g. scp:
# scp user@pc:"path/Build To JS.xlsx" ~/mmx-report-automation/data/workbooks/
```

---

## 3. Environment file

Keep secrets out of systemd unit files. Use a file readable only by the Pi user:

```bash
sudo install -o pi -g pi -m 600 /dev/null /home/pi/mmx-report-automation/.env.production
nano /home/pi/mmx-report-automation/.env.production
```

Example `/home/pi/mmx-report-automation/.env.production`:

```ini
# Macromatix (same account as live-dashboard-app)
SCRAPER_USERNAME=your-macromatix-username
SCRAPER_PASSWORD=your-macromatix-password

# Pi: use system Chromium (required — bundled Puppeteer Chrome is x86 only)
SCRAPER_HEADLESS=true
SCRAPER_EXECUTABLE_PATH=/usr/bin/chromium

MMX_USER_DATA_DIR=/home/pi/mmx-report-automation/data/browser-profile
MMX_STORE_NAME=3811 Chirnside Park
MMX_TIME_ZONE=Australia/Melbourne

MMX_WORK_DIR=/home/pi/mmx-report-automation/data
MMX_TEMPLATE_LOCAL=/home/pi/mmx-report-automation/data/workbooks/Build To JS.xlsx

# Hourly gate window (local store time)
MMX_GATE_SCHEDULE_START=9
MMX_GATE_SCHEDULE_END=23

MMX_NAV_TIMEOUT_MS=45000
MMX_DOWNLOAD_WAIT_MS=120000
MMX_LOGIN_WAIT_MS=300000
```

Optional: point at the dashboard env so credentials stay in one place:

```bash
# In .env.production, or symlink after copying values:
# source ../live-dashboard-app/.env.production patterns
```

`config.js` also loads `../live-dashboard-app/.env` when present (fills empty vars only).

---

## 4. First-run bootstrap (interactive)

Run once before enabling systemd. Use SSH with X11, VNC, or temporarily disable headless if Duo/MFA appears.

```bash
cd ~/mmx-report-automation
export $(grep -v '^#' .env.production | xargs)  # or use dotenv via copying to .env

# 1) Save login session in data/browser-profile
SCRAPER_HEADLESS=false npm run login

# 2) Confirm gate: Key Item Count + Applied
npm run gate-check

# 3) Dry run: downloads + Excel only (no orders)
npm run dry-run

# 4) Full pipeline test (closes browser; sets daily lock)
npm start
```

To run the full pipeline again the same day during testing:

```bash
npm start -- --force
```

---

## 5. Git credentials (private repo)

The Pi must pull without prompts. One-time on the Pi as your user (`orbro`):

```bash
git config --global credential.helper store
cd ~/mmx-report-automation
git pull origin main   # enter GitHub username + Personal Access Token (repo scope)
```

Credentials are saved in `~/.git-credentials`. Use a **fine-grained PAT** or classic token with **Contents: Read** on this repo only.

---

## 6. systemd — install everything (recommended)

Templates live in `deploy/systemd/`. They set:

- **`Restart=always`** on gate-watch — runs indefinitely; systemd restarts after crash or reboot
- **`mmx-git-pull.timer`** — `git pull --ff-only` every **15 minutes**; restarts gate-watch when `main` changes
- **`ExecStartPre`** on gate-watch and pipeline — pull before each start
- **`mmx-pipeline.timer`** — daily full pipeline (default **11:00** local Pi time)

### 6a. One-command install

After clone, bootstrap, and `.env.production` exist:

```bash
cd ~/mmx-report-automation
git pull origin main
chmod +x scripts/pi-git-pull.sh deploy/systemd/install-units.sh
./deploy/systemd/install-units.sh orbro
```

Replace `orbro` with your Linux username.

### 6b. Allow gate-watch restart after git pull (no password)

```bash
cd ~/mmx-report-automation
sed "s/MMX_USER/orbro/" deploy/systemd/mmx-sudoers | sudo tee /etc/sudoers.d/mmx-report-automation
sudo chmod 440 /etc/sudoers.d/mmx-report-automation
sudo visudo -cf /etc/sudoers.d/mmx-report-automation
```

Without this, pulls still work but you may need `sudo systemctl restart mmx-gate-watch` manually to load new code.

### 6c. What gets enabled

| Unit | Role |
|------|------|
| `mmx-gate-watch.service` | Always on; `Restart=always` |
| `mmx-git-pull.timer` | Git fetch/pull every 15 min |
| `mmx-pipeline.timer` | Daily `npm start` |

Check status:

```bash
systemctl status mmx-gate-watch
systemctl list-timers --all | grep mmx
journalctl -u mmx-gate-watch -f
journalctl -u mmx-git-pull.service -n 20 --no-pager
```

Change pipeline time: edit `/etc/systemd/system/mmx-pipeline.timer` (`OnCalendar`), then `sudo systemctl daemon-reload && sudo systemctl restart mmx-pipeline.timer`.

Change git poll interval: edit `mmx-git-pull.timer` (`OnUnitActiveSec=15min`).

### 6d. Manual unit install (optional)

If you prefer not to use the install script, copy units from `deploy/systemd/` and replace `MMX_USER` / `MMX_HOME` with e.g. `orbro` and `/home/orbro`.

---

## 7. systemd — gate watch only (manual)

<details>
<summary>Legacy manual <code>mmx-gate-watch.service</code> snippet</summary>

```ini
[Service]
Type=simple
User=orbro
WorkingDirectory=/home/orbro/mmx-report-automation
EnvironmentFile=/home/orbro/mmx-report-automation/.env.production
ExecStartPre=/home/orbro/mmx-report-automation/scripts/pi-git-pull.sh
ExecStart=/usr/bin/npm run gate-watch
Restart=always
RestartSec=30
```

</details>

---

## 8. systemd — full pipeline (daily timer)

The full pipeline exits immediately if it already completed today (`data/out/pipeline-complete-today.json`). Schedule one run after the store typically finishes the key item count (adjust time to your store).

**Service** — `/etc/systemd/system/mmx-pipeline.service` (or use `deploy/systemd/mmx-pipeline.service`):

```ini
[Service]
Type=oneshot
User=orbro
WorkingDirectory=/home/orbro/mmx-report-automation
EnvironmentFile=/home/orbro/mmx-report-automation/.env.production
ExecStartPre=/home/orbro/mmx-report-automation/scripts/pi-git-pull.sh
ExecStart=/usr/bin/npm start
TimeoutStartSec=2400
```

**Timer** — `/etc/systemd/system/mmx-pipeline.timer` (example: 11:00 daily, Melbourne):

```ini
[Unit]
Description=Run Macromatix pipeline daily

[Timer]
OnCalendar=*-*-* 11:00:00
Persistent=true
Unit=mmx-pipeline.service

[Install]
WantedBy=timers.target
```

If the Pi timezone is not Melbourne, either set the Pi OS timezone to `Australia/Melbourne` or adjust `OnCalendar` to match local wall clock.

Enable:

```bash
sudo systemctl daemon-reload
sudo systemctl enable mmx-pipeline.timer
sudo systemctl start mmx-pipeline.timer
systemctl list-timers mmx-pipeline.timer
```

Manual run:

```bash
sudo systemctl start mmx-pipeline.service
journalctl -u mmx-pipeline.service -n 200 --no-pager
```

Force another run the same day:

```bash
cd ~/mmx-report-automation
npm start -- --force
```

---

## 8b. PM2 (optional alternative to systemd)

If you use PM2 instead of systemd, **do not** point it at `index.js` (that file does not exist). Use the included ecosystem file:

```bash
cd ~/mmx-report-automation
git pull
npm ci

# Stop any broken process
pm2 delete mmx-report 2>/dev/null || true

# Gate watch only (recommended for always-on PM2)
pm2 start ecosystem.config.cjs
pm2 save
pm2 logs mmx-gate-watch --lines 50
```

The PM2 app runs **`gate-watch`** (hourly gate checks), not the full pipeline. Schedule the full pipeline separately (`npm start` via cron, systemd timer, or manual).

**First-time login on the Pi:** headless SSH has no display, so `SCRAPER_HEADLESS=false` fails with “Missing X server”. You do **not** need `source .env.production` — Node loads it automatically. **Quote values with spaces** in `.env.production`:

```ini
MMX_STORE_NAME="3811 Chirnside Park"
```

Unquoted `3811 Chirnside Park` breaks bash if you run `source .env.production` (`Chirnside: command not found`).

```bash
cd ~/mmx-report-automation
sudo apt install -y xvfb   # one-time, for virtual display
npm run login-pi
```

Or copy a working session from your PC:

```bash
# On PC (PowerShell) — stop mmx automation first if running
scp -r "path/to/mmx-report-automation/data/browser-profile" orbro@AshDash:~/mmx-report-automation/data/
```

On the Pi after copying, remove Chromium lock files from the copy:

```bash
rm -f ~/mmx-report-automation/data/browser-profile/SingletonLock \
      ~/mmx-report-automation/data/browser-profile/SingletonSocket \
      ~/mmx-report-automation/data/browser-profile/SingletonCookie
```

**Before manual `npm run gate-check`**, stop PM2 so two processes do not share the profile:

```bash
pm2 stop mmx-gate-watch
npm run gate-check
pm2 start mmx-gate-watch
```

Then PM2 headless runs should log `Session already active (userDataDir)`.

**If `git pull` fails** (`local changes to package.json`) or `npm ci` installs Puppeteer 25 (needs Node 22):

```bash
cd ~/mmx-report-automation
git checkout -- package.json package-lock.json
git pull
rm -rf node_modules
npm ci
node -e "console.log('puppeteer', require('puppeteer/package.json').version)"
# Must print puppeteer 10.4.0 — not 25.x
```

Never run bare `npm install` on the Pi (it can upgrade Puppeteer). Always `npm ci` after `git pull`.

---

## 9. Running with live-dashboard-app on the same Pi

| | live-dashboard-app | mmx-report-automation |
|---|-------------------|------------------------|
| Port / UI | `npm start` → Express | No UI |
| Browser profile | Dashboard `userDataDir` | `data/browser-profile` |
| Schedule | `live-dashboard.service` | `mmx-gate-watch` + `mmx-pipeline.timer` |
| Credentials | Can share via `.env` | Same `SCRAPER_*` vars |

Do **not** point both apps at the same `userDataDir`.

---

## 10. Useful commands

```bash
# Gate watch logs
journalctl -u mmx-gate-watch -n 50 --no-pager

# Git pull timer
journalctl -u mmx-git-pull.service -n 30 --no-pager
systemctl list-timers mmx-git-pull.timer

# Last pipeline run
journalctl -u mmx-pipeline.service -n 200 --no-pager

# Orders only (testing)
npm run orders-test

# Single vendor
MMX_ORDER_VENDOR_ID=americold-dry npm run orders-test

# Clear daily lock
rm -f data/out/pipeline-complete-today.json
```

---

## 11. Troubleshooting

| Log message | Fix |
|-------------|-----|
| `Failed to load environment files: No such file or directory` | Create `.env.production` (or `.env`) in the repo — see §3 |
| `Failed to spawn 'start-pre' task` / git pull merge error | `git status` — discard or stash local edits, then `git pull`; see below |
| `would be overwritten by merge` on `install-units.sh` | `git checkout -- deploy/systemd/install-units.sh && git pull` |
| Gate-watch restart loop | Fix env + script, then `sudo systemctl restart mmx-gate-watch` |


| Symptom | What to try |
|---------|-------------|
| `Failed to launch the browser` | Install Chromium; set `SCRAPER_EXECUTABLE_PATH` to `which chromium` output |
| Login / Duo loop | `SCRAPER_HEADLESS=false npm run login` with display or VNC |
| Gate NOT READY | Complete key item count in Macromatix; check `npm run gate-check` |
| `npm start` exits immediately | Already ran today — check `data/out/pipeline-complete-today.json` or use `--force` |
| Pipeline stops at report format | Re-run `npm run discover`; confirm `config/pipeline.json` report names |
| Some FRG/FRZ lines not filled | Item codes in Excel not on that order template — check logs for missed codes |
| Out of memory | Close other Chromium jobs; use Pi 4 4GB+; ensure only one Puppeteer job at a time |

---

## 12. Production checklist

- [ ] Chromium installed and `SCRAPER_EXECUTABLE_PATH` set
- [ ] `Build To JS.xlsx` in `data/workbooks/`
- [ ] `.env.production` mode `600`, credentials filled
- [ ] `npm run setup` and `config/*.json` reviewed
- [ ] `npm run login` + `gate-check` succeeded once
- [ ] `npm run dry-run` produced files in `data/inbox/`
- [ ] `npm start` completed all vendor orders once
- [ ] `./deploy/systemd/install-units.sh <user>` run
- [ ] `mmx-gate-watch.service` enabled (Restart=always)
- [ ] `mmx-git-pull.timer` enabled
- [ ] `/etc/sudoers.d/mmx-report-automation` installed (optional but recommended)
- [ ] `mmx-pipeline.timer` enabled at the right local time
- [ ] `git pull` works non-interactively (credential.helper store + PAT)
- [ ] Pi timezone or `MMX_TIME_ZONE` matches the store
