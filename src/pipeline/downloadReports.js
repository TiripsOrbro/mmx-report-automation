const path = require('path');
const fs = require('fs');
const { GOTO_OPTS } = require('../macromatix/browser');
const { withPageContextRetry } = require('../macromatix/contextRetry');
const { ensureDir, waitForNewDownload, timestampSlug } = require('../utils/files');
const log = require('../utils/logging');
const { navigateToSupplyChainReports } = require('../macromatix/navigation');
const { runSupplyChainReport, isSupplyChainReport } = require('./supplyChainReports');
const { runStoreReport, isStoreReport } = require('./storeReports');

const DOWNLOAD_EXTS = ['.xls', '.xlsx', '.csv'];

function reportsConfigured(reports) {
    return (reports || []).every((r) => {
        if (isSupplyChainReport(r) || isStoreReport(r)) return Boolean(r.reportName);
        return r.url && !r.url.includes('REPLACE');
    });
}

async function configureDownloadPath(page, downloadDir) {
    ensureDir(downloadDir);
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloadDir,
    });
}

async function clickExportExcelDataOnly(page, report) {
    if (report.exportButtonSelector) {
        await page.waitForSelector(report.exportButtonSelector, { timeout: 30000 });
        await page.click(report.exportButtonSelector);
        await page.waitForTimeout(400);
    }

    if (report.exportLinkText) {
        const clicked = await page.evaluate((text) => {
            const want = String(text).toLowerCase();
            for (const el of document.querySelectorAll('a, button, input, span')) {
                const label = (el.textContent || el.value || '').trim().toLowerCase();
                if (label.includes(want) || label === want) {
                    el.click();
                    return true;
                }
            }
            return false;
        }, report.exportLinkText);
        if (!clicked) {
            log.warn(`Export link "${report.exportLinkText}" not found; trying generic Excel link`);
            await page.evaluate(() => {
                for (const el of document.querySelectorAll('a')) {
                    const t = (el.textContent || '').toLowerCase();
                    if (t.includes('excel') && (t.includes('data') || t.includes('only'))) {
                        el.click();
                        return;
                    }
                }
            });
        }
    }
}

async function validateReportHeaders(filePath, expectedHeaders) {
    if (!expectedHeaders || !expectedHeaders.length) return;
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.xls') {
        log.info(`Skipping header validation for .xls (${path.basename(filePath)})`);
        return;
    }
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const sheet = wb.worksheets[0];
    if (!sheet) throw new Error(`No sheet in ${filePath}`);
    const row = sheet.getRow(1);
    const headers = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
        headers[col - 1] = String(cell.value || '').trim();
    });
    for (const h of expectedHeaders) {
        const found = headers.some((x) => x.toLowerCase() === String(h).toLowerCase());
        if (!found) {
            throw new Error(`Expected header "${h}" not found in ${path.basename(filePath)}. Got: ${headers.join(', ')}`);
        }
    }
}

async function waitForReportDownload(downloadDir, timeoutMs, preferredExt) {
    const order = preferredExt
        ? [preferredExt, ...DOWNLOAD_EXTS.filter((e) => e !== preferredExt)]
        : DOWNLOAD_EXTS;
    for (const ext of order) {
        try {
            return await waitForNewDownload(downloadDir, { timeoutMs, ext });
        } catch (e) {
            if (ext === order[order.length - 1]) throw e;
        }
    }
    throw new Error('No download received');
}

async function downloadSupplyChainReport(page, report, settings) {
    log.info(`Downloading: ${report.label || report.id} (${report.reportName})`);
    await runSupplyChainReport(page, report, settings);

    const downloaded = await waitForReportDownload(
        settings.downloadDir,
        settings.downloadWaitMs,
        report.downloadExt
    );
    const ext = path.extname(downloaded) || report.downloadExt || '.xls';
    const slug = timestampSlug();
    const dest = path.join(settings.downloadDir, `${slug}-${report.id || 'report'}${ext}`);
    if (downloaded !== dest) {
        fs.renameSync(downloaded, dest);
    }
    await validateReportHeaders(dest, report.expectedHeaders);
    log.info(`Saved ${report.id} → ${dest}`);
    return dest;
}

async function downloadStoreReport(page, report, settings) {
    log.info(`Downloading: ${report.label || report.id} (${report.reportName})`);
    await runStoreReport(page, report, settings);

    const downloaded = await waitForReportDownload(
        settings.downloadDir,
        settings.downloadWaitMs,
        report.downloadExt || '.csv'
    );
    const ext = path.extname(downloaded) || report.downloadExt || '.csv';
    const slug = timestampSlug();
    const dest = path.join(settings.downloadDir, `${slug}-${report.id || 'report'}${ext}`);
    if (downloaded !== dest) {
        fs.renameSync(downloaded, dest);
    }
    await validateReportHeaders(dest, report.expectedHeaders);
    log.info(`Saved ${report.id} → ${dest}`);
    return dest;
}

async function openReportsHub(page, settings) {
    const reportNav = settings.pipeline.reportNavigation;
    if (!reportNav) {
        throw new Error('Missing reportNavigation in config/pipeline.json');
    }
    await navigateToSupplyChainReports(page, reportNav, settings.navTimeoutMs);
}

async function downloadReports(page, settings) {
    const reports = settings.pipeline.reports || [];
    const paths = {};

    if (!reports.length) {
        throw new Error('No reports configured in config/pipeline.json');
    }

    if (!reportsConfigured(reports)) {
        log.warn('Reports not fully configured — opening Report Selection only');
        await openReportsHub(page, settings);
        return paths;
    }

    await configureDownloadPath(page, settings.downloadDir);

    for (const report of reports) {
        if (report.skip) continue;

        if (isSupplyChainReport(report)) {
            paths[report.id] = await downloadSupplyChainReport(page, report, settings);
            continue;
        }

        if (isStoreReport(report)) {
            paths[report.id] = await downloadStoreReport(page, report, settings);
            continue;
        }

        if (!report.url || report.url.includes('REPLACE')) {
            throw new Error(`Report "${report.id || report.label}" URL not configured`);
        }

        log.info(`Downloading: ${report.label || report.id}`);
        await page.goto(report.url, { ...GOTO_OPTS, timeout: settings.navTimeoutMs });
        if (report.waitAfterNavigateMs) {
            await page.waitForTimeout(report.waitAfterNavigateMs);
        }

        await withPageContextRetry(page, `export ${report.id}`, async () => {
            await clickExportExcelDataOnly(page, report);
        });

        const downloaded = await waitForReportDownload(settings.downloadDir, settings.downloadWaitMs);
        const ext = path.extname(downloaded) || '.xlsx';
        const slug = timestampSlug();
        const dest = path.join(settings.downloadDir, `${slug}-${report.id || 'report'}${ext}`);
        if (downloaded !== dest) {
            fs.renameSync(downloaded, dest);
        }
        await validateReportHeaders(dest, report.expectedHeaders);
        paths[report.id] = dest;
        log.info(`Saved ${report.id} → ${dest}`);
    }

    return paths;
}

module.exports = { downloadReports, openReportsHub, reportsConfigured, configureDownloadPath };
