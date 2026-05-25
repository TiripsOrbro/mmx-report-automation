# Workbooks

## Edit these first (in `.env`)

| Variable | Use |
|----------|-----|
| `MMX_BUILD_TO_DIR_ONEDRIVE` | Your PC / OneDrive Build To folder |
| `MMX_BUILD_TO_DIR_PI` | Pi Build To folder |
| `MMX_BUILD_TO_DIR_FALLBACK` | Local repo fallback folder `./data/workbooks` |
| `MMX_BUILD_TO_FILENAME` | Workbook file inside the folder, e.g. `Build to.xlsx` |

First workbook that **exists** on the machine wins. Downloads default to the selected Build To folder, so report exports sit beside the workbook.

Optional: `MMX_BUILD_TO_DIR` with semicolon-separated folders replaces the three named folder vars. `MMX_TEMPLATE_LOCAL` remains supported as a legacy workbook-path override.

---

| File | Role |
|------|------|
| **Build to.xlsx** | Default fallback template in this folder |

Backups: `data/out/Build To JS-YYYYMMDD-HHmm.xlsx`. Sample reports: `data/inbox/samples/`.
