# Raspberry Pi setup — mmx-report-automation

Deploy the Macromatix pipeline on a fresh Pi alongside [live-dashboard-app](https://github.com/TiripsOrbro/live-dashboard-app). The dashboard and this app use **separate** browser profiles and **separate** systemd units.

## What runs on the Pi

| Job | Command | Purpose |
|-----|---------|---------|
| **Gate watch** (always on) | `npm run gate-watch` | Hourly key-item gate check, 9 AM–11 PM store time |
| **Full pipeline** (scheduled) | `npm start` | Gate → 3 reports → Excel → all scheduled orders (once per day) |

`gate-watch` only logs whether the gate is READY. It does **not** start downloads or orders. Schedule `npm start` separately (or run it manually when logs show READY).

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

## 5. systemd — gate watch (hourly 9 AM–11 PM)

Create `/etc/systemd/system/mmx-gate-watch.service`:

```ini
[Unit]
Description=Macromatix key item gate watch (hourly)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/mmx-report-automation
EnvironmentFile=/home/pi/mmx-report-automation/.env.production
ExecStart=/usr/bin/npm run gate-watch
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
```

Enable:

```bash
sudo systemctl daemon-reload
sudo systemctl enable mmx-gate-watch
sudo systemctl start mmx-gate-watch
journalctl -u mmx-gate-watch -f
```

---

## 6. systemd — full pipeline (daily timer)

The full pipeline exits immediately if it already completed today (`data/out/pipeline-complete-today.json`). Schedule one run after the store typically finishes the key item count (adjust time to your store).

**Service** — `/etc/systemd/system/mmx-pipeline.service`:

```ini
[Unit]
Description=Macromatix full pipeline (gate, reports, Excel, orders)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=pi
WorkingDirectory=/home/pi/mmx-report-automation
EnvironmentFile=/home/pi/mmx-report-automation/.env.production
ExecStart=/usr/bin/npm start
# Allow ~15–25 min for reports + five vendor orders
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
set -a && source .env.production && set +a
npm start -- --force
```

---

## 7. Running with live-dashboard-app on the same Pi

| | live-dashboard-app | mmx-report-automation |
|---|-------------------|------------------------|
| Port / UI | `npm start` → Express | No UI |
| Browser profile | Dashboard `userDataDir` | `data/browser-profile` |
| Schedule | `live-dashboard.service` | `mmx-gate-watch` + `mmx-pipeline.timer` |
| Credentials | Can share via `.env` | Same `SCRAPER_*` vars |

Do **not** point both apps at the same `userDataDir`.

---

## 8. Useful commands

```bash
# Gate watch logs
journalctl -u mmx-gate-watch -n 50 --no-pager

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

## 9. Troubleshooting

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

## 10. Production checklist

- [ ] Chromium installed and `SCRAPER_EXECUTABLE_PATH` set
- [ ] `Build To JS.xlsx` in `data/workbooks/`
- [ ] `.env.production` mode `600`, credentials filled
- [ ] `npm run setup` and `config/*.json` reviewed
- [ ] `npm run login` + `gate-check` succeeded once
- [ ] `npm run dry-run` produced files in `data/inbox/`
- [ ] `npm start` completed all vendor orders once
- [ ] `mmx-gate-watch.service` enabled
- [ ] `mmx-pipeline.timer` enabled at the right local time
- [ ] Pi timezone or `MMX_TIME_ZONE` matches the store
