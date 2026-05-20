# Macromatix report automation

Standalone Node app (sibling to [live-dashboard-app](../live-dashboard-app)) that:

1. Logs into Macromatix (same credentials as the dashboard scraper)
2. Waits until a **key item count** gate is satisfied
3. Downloads two **Excel Data Only** reports to a local folder
4. Merges report data into a **local copy** of your company-server Excel template
5. Enters extracted values back into Macromatix

Runs in its **own process** with its **own browser profile** (`data/browser-profile`) so it does not conflict with the sales dashboard scraper.

## Prerequisites

- Node.js 16+
- Windows access to the company-server workbook path (UNC or mapped drive), if you use `MMX_TEMPLATE_SOURCE`
- Macromatix credentials in `.env` (same variables as the dashboard)

## Quick start (Excel only — no Macromatix login)

```bash
cd mmx-report-automation
npm install
cp .env.example .env
npm run setup
```

1. Place **Build To JS.xlsx** in `data/workbooks/Build To JS.xlsx` (see `data/README.md`).
2. Put sample exports in `data/inbox/samples/` as **`Stock On Hand.xls`** and **`Stock On Order.xls`** (or pass paths on the CLI).
3. Inspect sheets/headers:

```bash
npm run inspect -- data/workbooks/Build To JS.xlsx
npm run inspect -- "data/inbox/samples/Stock On Hand.xls"
```

4. Edit `config/excel-mapping.json` (sheet names, ranges, destination cells).
5. Merge:

```bash
npm run excel-only
```

Output: updated `data/workbooks/Build To JS.xlsx`, backup under `data/out/`, and `data/out/paste-values-*.json` for a later Macromatix step.

### Macromatix login + key item gate

Uses the same `SCRAPER_USERNAME` / `SCRAPER_PASSWORD` as the dashboard (mmx `.env` or `../live-dashboard-app/.env`).

```bash
# First time: visible browser (optional)
set SCRAPER_HEADLESS=false
npm run login

# Find menu URLs (Key Item Count, stock reports)
npm run discover
# → data/out/mmx-menu-links.json

# Gate: Count In Progress → latest dropdown = Key Item Count + Applied
npm run gate-check

# After gate passes — open Report Selection → Supply Chain
npm run reports-hub
```

### Full pipeline

```bash
# Edit config/pipeline.json (see docs/mmx-report-automation-discovery.md)
npm run dry-run
npm start
```

After all scheduled orders are updated, the browser **closes** and a daily lock prevents `npm start` from running again until the next calendar day (`data/out/pipeline-complete-today.json`). Use `npm start -- --force` to override.

### Hourly key-item gate check (9 AM–11 PM)

Runs **gate check only** (no downloads or orders), once per hour in `MMX_TIME_ZONE` (default Australia/Melbourne). After **`npm start`** completes for the day (same lock as `data/out/pipeline-complete-today.json`), gate-watch **sleeps until the next day** at `MMX_GATE_SCHEDULE_START` instead of logging in hourly.

```bash
npm run gate-watch
```

Leave this running in a terminal or register it as a Windows scheduled task / service. Configure hours with `MMX_GATE_SCHEDULE_START` / `MMX_GATE_SCHEDULE_END` in `.env`.

## Configuration

| File | Purpose |
|------|---------|
| `.env` | Credentials, paths, timeouts (see `.env.example`) |
| `config/pipeline.json` | Gate URL, two report URLs/export selectors, paste-back form |
| `config/excel-mapping.json` | Report ranges → template cells; cells → Macromatix paste keys |
| `docs/mmx-report-automation-discovery.md` | Checklist to fill before production |

### Environment highlights

- `MMX_TEMPLATE_SOURCE` — UNC path to master workbook on company server
- `MMX_TEMPLATE_LOCAL` — working workbook (default `./data/workbooks/Build To JS.xlsx`)
- `MMX_TEMPLATE_PUBLISH` — optional write-back to server after merge
- `MMX_USER_DATA_DIR` — Chrome profile for saved login session (default `./data/browser-profile`)
- `MMX_DOWNLOAD_DIR` — Macromatix Excel Data Only downloads (default `./data/inbox`)
- `MMX_STORE_NAME` — store to select in reports tree (default `3811 Chirnside Park`)

## Commands

| Command | Description |
|---------|-------------|
| `npm run setup` | Create `config/pipeline.json` and `config/excel-mapping.json` from examples |
| `npm run inspect -- <file.xlsx>` | List sheet names and row-1 headers (discovery) |
| `npm run excel-only` | Merge reports into **Build To JS.xlsx** (local files only) |
| `npm run login` | Log in only; store session in userDataDir |
| `npm run discover` | After login, list Macromatix menu links (find gate/report URLs) |
| `npm run gate-check` | Login + Stock Count → Count In Progress → latest = Key Item + Applied |
| `npm run reports-hub` | After gate passes, open **Report Selection → Supply Chain** (export TBD) |
| `npm run dry-run` | Gate + download + Excel merge; skip Macromatix paste submit |
| `npm start` | Full pipeline |
| `npm run gate-watch` | Hourly gate check (9 AM–11 PM); pauses until tomorrow after full pipeline; Pi: systemd |

Exit codes: `0` success or gate skipped (not ready); `1` error.

## Login session

Password-only login. First run can use `SCRAPER_HEADLESS=false` and `npm run login` to confirm the browser reaches Macromatix. Later runs reuse cookies in `MMX_USER_DATA_DIR` until the session expires.

**Do not** share `MMX_USER_DATA_DIR` with the dashboard’s browser profile.

## Scheduling

**Windows** — Task Scheduler:

```
cd Y:\Taco Bell Dashboard\mmx-report-automation
node src\run.js
```

**Raspberry Pi** — see **[docs/raspberry-pi-setup.md](docs/raspberry-pi-setup.md)** for Chromium, bootstrap, and **`./deploy/systemd/install-units.sh`** (gate-watch with auto-restart, git pull every 15 min, daily pipeline timer).

## Project layout

```
mmx-report-automation/
  config/           pipeline + excel mapping (gitignored when filled)
  data/
    workbooks/      Build To JS.xlsx (master workbook)
    inbox/          downloaded reports (+ samples/ for testing)
    out/            backups + paste-values JSON
    browser-profile/ saved login session (gitignored)
  docs/             discovery checklist + raspberry-pi-setup.md
  src/
    run.js          CLI entry
    macromatix/     login, browser launch
    pipeline/       gate, download, excel, paste
```

## Separation from live-dashboard-app

| | Dashboard | This app |
|---|-----------|----------|
| Express UI | Yes | No |
| Sales labour scrape | Yes | No |
| Puppeteer + MMX login | Yes | Yes (duplicated auth module) |
| exceljs | No | Yes |
| Scheduled with dashboard | No — use separate job |
