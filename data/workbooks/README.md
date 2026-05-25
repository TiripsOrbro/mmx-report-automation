# Workbooks

## Edit these first (in `.env`)

| Variable | Use |
|----------|-----|
| `MMX_TEMPLATE_ONEDRIVE` | Your PC / OneDrive Build To file |
| `MMX_TEMPLATE_PI` | Pi path (add when ready; skipped until file exists) |
| `MMX_TEMPLATE_FALLBACK` | Local repo copy `./data/workbooks/Build To JS.xlsx` |

First path that **exists** on the machine wins. On Windows you get OneDrive; on Pi (before the Pi file exists) you get the fallback.

Optional: `MMX_TEMPLATE_LOCAL` with semicolons replaces all three named vars.

---

| File | Role |
|------|------|
| **Build To JS.xlsx** | Default fallback template in this folder |

Backups: `data/out/Build To JS-YYYYMMDD-HHmm.xlsx`. Sample reports: `data/inbox/samples/`.
