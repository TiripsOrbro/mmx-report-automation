# Macromatix report automation — discovery checklist

Fill this in during a manual Macromatix session before production runs. The automation reads `config/pipeline.json` and `config/excel-mapping.json` (copy from `.example` files).

## 1. Key item count (gate)

| Field | Your value |
|-------|------------|
| Menu path | **Inventory → Stock Count** |
| Page URL | `https://tacobellau.macromatix.net/MMS_Stores_StockCount.aspx?MenuCustomItemID=156` |
| Default tab on load | **New Count** (ignore — do not read Count Type / When dropdowns) |
| Tab to open | **Count In Progress** |
| Dropdown on that tab | Latest count (top of list) |
| Pass when | Latest = **Key Item Count** and **Applied** appears in the status box below the count dropdown (Batch # row), not item rows in the grid |

Config: `gate.countTypeText`, `gate.appliedStatusText`. Check: `npm run gate-check`.

## 2. Reports (Supply Chain)

| Field | Your value |
|-------|------------|
| URL | `https://tacobellau.macromatix.net/MMS_System_Reports.aspx?MenuCustomItemID=12` |
| Group | **Supply Chain** |
| Stock On Hand | **SCM - Items On Hand (Flat)** |
| Stock On Order | **SCM - Items On Order (Flat)** |
| Format | **Excel Data Only** |
| Start date (On Hand) | **Last week Monday** (`startDate: "lastWeekMonday"`, Melbourne TZ) |
| Start / End (On Order) | **7 days ago** / **21 days from now** (`daysAgo:7`, `daysFromNow:21`, `dateOnly: true`) |
| Store | **Chirnside Park** (default) |

Commands: `npm run reports-hub` (navigate only), `npm run download-on-hand` (gate + download On Hand).

**Config keys:** `gate.url`, `gate.readySelector`, `gate.completeSelector`, `gate.minCompleteCount`, optional `gate.evaluateComplete` (custom JS string for `page.evaluate`).

## 3. Report exports (Excel Data Only)

### Report 1

| Field | Your value |
|-------|------------|
| Report name | |
| Page URL | `reports[0].url` |
| Steps before export | _filters, date range, Go button_ |
| Export control | _button text or selector_ |
| Export format | **Excel Data Only** (confirm in UI) |
| Typical download filename | |

### Report 2

| Field | Your value |
|-------|------------|
| Report name | |
| Page URL | `reports[1].url` |
| Export control | |
| Typical download filename | |

**Config keys:** `reports[].url`, `reports[].exportButtonSelector`, `reports[].exportLinkText`, `reports[].waitAfterNavigateMs`, `reports[].expectedHeaders` (array of column headers to validate).

## 4. Company server template (Excel)

| Field | Your value |
|-------|------------|
| UNC or mapped path | `MMX_TEMPLATE_SOURCE` |
| Sheet name(s) | |
| Cells filled from report 1 | _e.g. Sheet1!B5:B20_ |
| Cells filled from report 2 | |
| Formulas to preserve | _list sheets that must not be overwritten_ |
| Publish target | `MMX_TEMPLATE_PUBLISH` (same file or dated copy on share) |

**Config keys:** `excel-mapping.json` — see `config/excel-mapping.json.example`.

## 5. Paste back into Macromatix

| Field | Your value |
|-------|------------|
| Entry screen URL | `paste.url` |
| Field mapping | _template cell → input selector / name_ |
| Submit / Save control | |
| Validation after save | _success message or redirect URL_ |

**Config keys:** `paste.url`, `paste.fields[]` with `{ sourceCell, selector, type: "text"|"select" }`.

## 6. Browser session

| Field | Your value |
|-------|------------|
| Profile directory | `./data/browser-profile` (default; separate from dashboard) |
| Session typical lifetime | |

**Procedure:** Run once with `SCRAPER_HEADLESS=false` and `npm run login` if you want to watch the first login. Later runs reuse `userDataDir` until expiry.

## 7. Network / paths (automation PC)

| Field | Your value |
|-------|------------|
| Can read `MMX_TEMPLATE_SOURCE`? | |
| Can write `MMX_TEMPLATE_PUBLISH`? | |
| Chromium path (Pi) | `SCRAPER_EXECUTABLE_PATH` if needed |
