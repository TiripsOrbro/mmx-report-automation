# Data directory (`mmx-report-automation`)

All Macromatix Excel files and downloads are stored here. The dashboard app (`live-dashboard-app`) only keeps audit JSON under its own `data/` folder.

| Path | Purpose |
|------|---------|
| `workbooks/Build To JS.xlsx` | Master **Build To JS** workbook (edit/open this file) |
| `inbox/` | Downloaded Macromatix reports (production runs) |
| `inbox/samples/` | Sample `Stock On Hand.xls` / `Stock On Order.xls` for `npm run excel-only` |
| `out/` | Backups and `paste-values-*.json` after each merge |
| `browser-profile/` | Chrome profile for saved login (gitignored) |

Run merges from the repo root:

```bash
cd mmx-report-automation
npm run excel-only
```
