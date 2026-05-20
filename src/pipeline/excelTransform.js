const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { copyFileSafe, ensureDir } = require('../utils/files');
const log = require('../utils/logging');
const {
    loadSourceWorkbook,
    resolveSourceSheet,
    getSourceCell,
    resolveSourceRange,
    parseCellRef,
} = require('../utils/sourceWorkbook');

async function copyTemplate(settings) {
    const local = settings.templateLocal;
    ensureDir(path.dirname(local));

    if (!fs.existsSync(local)) {
        if (settings.templateSource && fs.existsSync(settings.templateSource)) {
            log.info(`Copying template from ${settings.templateSource}`);
            copyFileSafe(settings.templateSource, local);
        } else {
            throw new Error(
                `Template not found: ${local}\nCopy "Build To JS.xlsx" into data/workbooks/ (see data/workbooks/README.md).`
            );
        }
    } else if (settings.templateSource && fs.existsSync(settings.templateSource) && settings.templateAlwaysCopy) {
        log.info(`Refreshing template from ${settings.templateSource}`);
        copyFileSafe(settings.templateSource, local);
    }
    return local;
}

function parseRangeStatic(range) {
    const [a, b] = String(range).split(':');
    const start = parseCellRef(`X!${a}`);
    const end = parseCellRef(`X!${b}`);
    return {
        startCol: start.col,
        startRow: start.row,
        endCol: end.col,
        endRow: end.row,
    };
}

/** Wipe destination tab so leftover rows cannot show stale Macromatix data. */
function clearDestinationBeforePaste(destSheet, destStart, map) {
    if (map.clearBeforePaste === false) return;

    let endRow;
    let endCol;
    if (map.clearRange) {
        const area = parseRangeStatic(map.clearRange);
        endRow = area.endRow;
        endCol = area.endCol;
    } else {
        endRow = Math.max(destSheet.rowCount || 0, 250);
        endCol = Math.max(destSheet.columnCount || 0, 15);
    }

    const startRow = destStart.row;
    const startCol = destStart.col;
    let cleared = 0;

    for (let r = startRow; r <= endRow; r++) {
        for (let c = startCol; c <= endCol; c++) {
            const cell = destSheet.getCell(r, c);
            if (cell.value != null && cell.value !== '') {
                cell.value = null;
                cleared++;
            } else if (cell.formula) {
                cell.value = null;
                cleared++;
            }
        }
    }

    log.info(
        `Cleared "${destSheet.name}" ${map.clearRange || `rows ${startRow}-${endRow}, cols ${startCol}-${endCol}`} (${cleared} cells)`
    );
}

function getTemplateSyncPaths(settings) {
    const local = path.normalize(settings.templateLocal);
    return (settings.templateSyncPaths || []).filter((p) => path.normalize(p) !== local);
}

function syncTemplateCopies(sourcePath, settings) {
    const synced = [];
    for (const target of getTemplateSyncPaths(settings)) {
        try {
            ensureDir(path.dirname(target));
            copyFileSafe(sourcePath, target);
            synced.push(target);
            log.info(`Synced workbook → ${target}`);
        } catch (e) {
            log.warn(`Could not sync to ${target}: ${e.message}`);
        }
    }
    return synced;
}

async function applyMapping(wb, reportPaths, mapping) {
    for (const map of mapping.mappings || []) {
        const srcPath = reportPaths[map.fromReport];
        if (!srcPath) {
            log.info(`Skipping mapping for ${map.fromReport} (not in this run)`);
            continue;
        }
        const srcLoaded = await loadSourceWorkbook(srcPath);
        const srcSheet = resolveSourceSheet(srcLoaded, map.fromSheet);
        if (!srcSheet) throw new Error(`Sheet "${map.fromSheet}" not found in ${srcPath}`);

        const destSheetName = map.toSheet || mapping.templateSheet || 'Data';
        let destSheet = wb.getWorksheet(destSheetName);
        if (!destSheet) {
            destSheet = wb.addWorksheet(destSheetName);
        }

        const range = resolveSourceRange(srcSheet, map.fromRange);
        const destStart = parseCellRef(`${destSheetName}!${map.toStartCell}`);

        clearDestinationBeforePaste(destSheet, destStart, map);

        const pastedRows = range.endRow - range.startRow + 1;
        const pastedCols = range.endCol - range.startCol + 1;

        let dr = destStart.row;
        for (let r = range.startRow; r <= range.endRow; r++) {
            let dc = destStart.col;
            for (let c = range.startCol; c <= range.endCol; c++) {
                const val = getSourceCell(srcSheet, r, c);
                destSheet.getCell(dr, dc).value = val;
                dc++;
            }
            dr++;
        }
        log.info(
            `Mapped ${map.fromReport} ${map.fromRange} (${pastedRows}x${pastedCols}) → ${destSheetName}!${map.toStartCell}`
        );
    }
}

async function extractValuesForPaste(wb, mapping) {
    const out = {};
    for (const item of mapping.extractForMacromatix || []) {
        const { sheet, col, row } = parseCellRef(item.cell);
        const ws = wb.getWorksheet(sheet) || wb.worksheets[0];
        const cell = ws.getCell(row, col);
        let v = cell.value;
        if (v && typeof v === 'object' && v.result !== undefined) v = v.result;
        if (v && typeof v === 'object' && v.text) v = v.text;
        out[item.key] = v == null ? '' : String(v);
    }
    return out;
}

async function runExcelTransform(settings, reportPaths) {
    const templatePath = await copyTemplate(settings);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(templatePath);

    await applyMapping(wb, reportPaths, settings.excelMapping);
    await wb.xlsx.writeFile(templatePath);
    log.info(`Updated working template: ${templatePath}`);

    const syncedPaths = getTemplateSyncPaths(settings).length
        ? syncTemplateCopies(templatePath, settings)
        : [];

    const pasteValues = await extractValuesForPaste(wb, settings.excelMapping);

    if (settings.templatePublish && settings.templatePublish !== settings.templateLocal) {
        try {
            copyFileSafe(templatePath, settings.templatePublish);
            log.info(`Published template to ${settings.templatePublish}`);
        } catch (e) {
            log.warn(`Could not publish to server (file locked?): ${e.message}`);
        }
    }

    const outPath = path.join(settings.outDir, `paste-values-${Date.now()}.json`);
    ensureDir(settings.outDir);
    fs.writeFileSync(outPath, JSON.stringify(pasteValues, null, 2));
    log.info(`Paste payload written: ${outPath}`);

    return { templatePath, pasteValues, pasteValuesPath: outPath, syncedPaths };
}

module.exports = { runExcelTransform, copyTemplate };
