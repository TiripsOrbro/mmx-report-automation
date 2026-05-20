# Workbooks

All Excel automation files live **in this repo** under `mmx-report-automation/data/` (not `live-dashboard-app`).

| File | Role |
|------|------|
| **Build To JS.xlsx** | Master template — Macromatix exports are merged into **STOCK ON HAND** and **STOCK ON ORDER** |

Canonical path:

```
mmx-report-automation/data/workbooks/Build To JS.xlsx
```

Set in `.env` as `MMX_TEMPLATE_LOCAL=./data/workbooks/Build To JS.xlsx` (default).

A timestamped backup is written to `data/out/` each run (`Build To JS-YYYYMMDD-HHmm.xlsx`).

Sample exports to merge: `data/inbox/samples/Stock On Hand.xls` and `Stock On Order.xls`.
