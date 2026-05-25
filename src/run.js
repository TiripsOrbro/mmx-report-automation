#!/usr/bin/env node
/**
 * Macromatix report automation — standalone CLI (separate from live-dashboard-app).
 *
 * Usage:
 *   node src/run.js              # full pipeline (once per day; closes browser after orders)
 *   node src/run.js --force      # run full pipeline again same day
 *   node src/run.js --login-only # bootstrap saved browser session
 *   node src/run.js --dry-run    # gate + downloads + excel; skip MMX submit
 *   node src/run.js --dry-run --skip-gate --force  # test download + merge without gate/daily lock
 *   node src/run.js --gate-only      # login + key item gate check only
 *   node src/run.js --reports-hub       # login + gate + open Supply Chain reports
 *   node src/run.js --download-on-hand  # login + gate + download Items On Hand only
 *   node src/run.js --download-on-order # login + gate + download Items On Order only
 *   node src/run.js --download-inventory-event # gate + Inventory Special Event CSV (AC and RGM only)
 *   npm run orders-test              # Excel → scheduled orders → Update only; browser stays open
 */
const path = require('path');
const fs = require('fs');
const { getSettings, ROOT, logTemplateLocalChoice } = require('./config');
const { launchBrowser, loginMacromatix } = require('./macromatix/auth');
const { isKeyItemCountComplete, gateUrlConfigured } = require('./pipeline/gateKeyItemCount');
const { downloadReports, openReportsHub, reportsConfigured } = require('./pipeline/downloadReports');
const { runExcelTransform } = require('./pipeline/excelTransform');
const { uploadToMacromatix } = require('./pipeline/uploadToMacromatix');
const { runVendorOrderEntry } = require('./pipeline/enterVendorOrders');
const { ensureDir, archiveFile } = require('./utils/files');
const { isPipelineDoneToday, markPipelineDoneToday } = require('./utils/dailyLock');
const { shouldSignalOrdersReady, signalOrdersReadyForReview } = require('./utils/ordersReadySignal');
const log = require('./utils/logging');

const args = new Set(process.argv.slice(2));
const forceRun = args.has('--force');
const loginOnly = args.has('--login-only');
const gateOnly = args.has('--gate-only');
const reportsHub = args.has('--reports-hub');
const downloadOnHand = args.has('--download-on-hand');
const downloadOnOrder = args.has('--download-on-order');
const downloadInventoryEvent = args.has('--download-inventory-event');
const dryRun = args.has('--dry-run');
const skipGate =
    args.has('--skip-gate') || /^(1|true|yes|on)$/i.test(String(process.env.MMX_SKIP_GATE ?? '').trim());
const ordersOnly = args.has('--orders-only');
const keepBrowserOpen = !/^(0|false|no|off)$/i.test(String(process.env.MMX_KEEP_BROWSER_OPEN ?? '').trim());

function notifyDashboardOrdersReady(orderResult) {
    const orderCount = orderResult.processed?.length ?? 1;
    const ordersOk = orderResult.processed?.filter((p) => p.ok).length ?? orderCount;
    if (!shouldSignalOrdersReady(ordersOk, orderCount)) {
        if (ordersOk < orderCount) {
            log.warn('Not notifying dashboard — some orders failed');
        }
        return { ordersOk, orderCount };
    }
    try {
        const signalPath = signalOrdersReadyForReview({ ordersOk, ordersTotal: orderCount });
        log.info(`Notified sales dashboard: orders ready for review (${signalPath})`);
    } catch (err) {
        log.warn(`Could not notify sales dashboard: ${err.message}`);
    }
    return { ordersOk, orderCount };
}

function isFullPipelineRun() {
    return (
        !loginOnly &&
        !gateOnly &&
        !reportsHub &&
        !downloadOnHand &&
        !downloadOnOrder &&
        !downloadInventoryEvent &&
        !dryRun &&
        !ordersOnly
    );
}

async function ensureConfigExists() {
    const pipeline = path.join(ROOT, 'config/pipeline.json');
    const mapping = path.join(ROOT, 'config/excel-mapping.json');
    if (!fs.existsSync(pipeline) || !fs.existsSync(mapping)) {
        console.error(
            'Missing config/pipeline.json or config/excel-mapping.json.\n' +
                'Copy config/*.example to config/*.json and complete docs/mmx-report-automation-discovery.md'
        );
        process.exit(1);
    }
}

async function main() {
    ensureConfigExists();
    const settings = getSettings();
    logTemplateLocalChoice(settings);
    ensureDir(settings.downloadDir);
    ensureDir(settings.outDir);
    ensureDir(path.dirname(settings.templateLocal));
    if (settings.userDataDir) {
        ensureDir(settings.userDataDir);
    }

    if (isFullPipelineRun() && !forceRun && isPipelineDoneToday(settings.workDir)) {
        log.info(
            'Full pipeline already completed today — skipping (gate + reports + Excel + orders). Use --force to run again.'
        );
        process.exit(0);
    }

    let browser;
    let page;
    try {
        ({ browser, page } = await launchBrowser(settings));
        await loginMacromatix(page, {
            navTimeoutMs: settings.navTimeoutMs,
            loginWaitMs: settings.loginWaitMs,
            loginSuccessUrlPart: settings.loginSuccessUrlPart,
        });

        if (loginOnly) {
            log.info(
                settings.userDataDir
                    ? 'Login-only complete. Session stored in userDataDir.'
                    : 'Login-only complete (ephemeral browser — session not saved).'
            );
            process.exit(0);
        }

        if (ordersOnly) {
            const result = await runVendorOrderEntry(page, settings, {
                vendorId: process.env.MMX_ORDER_VENDOR_ID || undefined,
            });
            if (result.processed?.length > 1) {
                log.info(
                    'Orders-only complete:',
                    `${result.processed.filter((p) => p.ok).length}/${result.processed.length} orders`
                );
            } else {
                log.info('Orders-only complete:', result.vendor?.label, `${result.lines?.length ?? 0} lines`);
            }
            notifyDashboardOrdersReady(result);
            if (keepBrowserOpen) {
                log.info('Browser left open — press Ctrl+C to exit.');
                browser = null;
                page = null;
                await new Promise(() => {});
            }
            process.exit(0);
        }

        if (!gateUrlConfigured(settings.pipeline.gate)) {
            log.warn(
                'Key item gate URL is not set. Run: npm run discover\n' +
                    'Then set gate.url in config/pipeline.json or MMX_GATE_URL in .env'
            );
            if (gateOnly) process.exit(1);
        }

        let gateOk = true;
        if (!skipGate) {
            gateOk = await isKeyItemCountComplete(page, settings.pipeline.gate, settings.navTimeoutMs, {
                saveDiagnostics: gateOnly,
                outDir: settings.outDir,
            });
        } else {
            log.warn('Skipping key item gate (--skip-gate or MMX_SKIP_GATE)');
        }

        if (gateOnly) {
            log.info(gateOk ? 'Gate check: READY — downloads would run next.' : 'Gate check: NOT READY');
            await browser.close().catch(() => {});
            browser = null;
            // Exit 10 = gate ready (used by automatic-orders scheduler). 0 = not ready. 1 = error.
            process.exit(gateOk ? 10 : 0);
        }

        if (!gateOk) {
            log.info('Key item count not complete — exiting without download (exit 0)');
            process.exit(0);
        }

        if (reportsHub) {
            await openReportsHub(page, settings);
            log.info('At Report Selection → Supply Chain (configure report, then Generate).');
            await page.waitForTimeout(5000);
            process.exit(0);
        }

        let reportsToRun = settings.pipeline.reports || [];
        if (downloadOnHand) {
            reportsToRun = reportsToRun.filter((r) => r.id === 'report1');
            log.info('Download mode: Stock On Hand only');
        } else if (downloadOnOrder) {
            reportsToRun = reportsToRun.filter((r) => r.id === 'report2');
            log.info('Download mode: Stock On Order only');
        } else if (downloadInventoryEvent) {
            reportsToRun = reportsToRun.filter((r) => r.id === 'report3');
            log.info('Download mode: Inventory Special Event (AC and RGM only) only');
        }

        const reportPaths = await downloadReports(page, {
            ...settings,
            pipeline: { ...settings.pipeline, reports: reportsToRun },
        });

        if (downloadOnHand) {
            log.info('Stock On Hand download complete:', reportPaths);
            process.exit(0);
        }
        if (downloadOnOrder) {
            log.info('Stock On Order download complete:', reportPaths);
            process.exit(0);
        }
        if (downloadInventoryEvent) {
            await browser.close();
            browser = null;
            page = null;
            if (Object.keys(reportPaths).length) {
                const result = await runExcelTransform(settings, reportPaths);
                log.info('Excel merge complete:', result.templatePath);
            }
            log.info('Inventory Special Event download complete:', reportPaths);
            process.exit(0);
        }

        if (!Object.keys(reportPaths).length) {
            log.error(
                'No report files downloaded — check config/pipeline.json on this machine (copy from your PC; it is not in git).'
            );
            process.exit(1);
        }

        const excelResult = await runExcelTransform(settings, reportPaths);

        if (dryRun) {
            log.info('Dry-run: skipping vendor order entry');
            await browser.close().catch(() => {});
            browser = null;
            process.exit(0);
        }

        if (!settings.vendorOrders) {
            throw new Error('Missing config/vendor-orders.json for order entry step');
        }

        const orderResult = await runVendorOrderEntry(page, settings, {
            vendorId: process.env.MMX_ORDER_VENDOR_ID || undefined,
        });
        if (orderResult.processed?.length > 1) {
            log.info(
                `Vendor orders entered: ${orderResult.processed.filter((p) => p.ok).length}/${orderResult.processed.length} (Update only)`
            );
        } else if (orderResult.vendor) {
            log.info(
                `Vendor orders entered: ${orderResult.vendor.label} (${orderResult.lines?.length ?? 0} lines, Update only)`
            );
        }

        const { ordersOk, orderCount } = notifyDashboardOrdersReady(orderResult);
        markPipelineDoneToday(settings.workDir, {
            ordersOk,
            ordersTotal: orderCount,
        });
        log.info('Marked full pipeline complete for today — will not run again until tomorrow (use --force to override).');

        await browser.close().catch(() => {});
        browser = null;
        page = null;

        if (keepBrowserOpen) {
            log.info('MMX_KEEP_BROWSER_OPEN is set but full pipeline already closed the browser after orders.');
        }

        for (const p of Object.values(reportPaths)) {
            try {
                archiveFile(p, path.join(settings.outDir, 'archived-downloads'));
            } catch (e) {
                log.warn(`Could not archive ${p}: ${e.message}`);
            }
        }

        log.info('Pipeline finished successfully');
        process.exit(0);
    } catch (err) {
        log.error(err.message, err.stack);
        process.exit(1);
    } finally {
        if (browser) {
            await browser.close().catch(() => {});
        }
    }
}

main();
