const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadJson(relPath, required = true) {
    const p = path.join(ROOT, relPath);
    if (!fs.existsSync(p)) {
        if (required) {
            throw new Error(
                `Missing ${relPath}. Copy from ${relPath.replace('.json', '.json.example')} and fill in discovery values.`
            );
        }
        return null;
    }
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function loadEnv() {
    require('dotenv').config({ path: path.join(ROOT, '.env') });
    require('dotenv').config({ path: path.join(ROOT, '.env.production'), override: true });

    const dashboardEnv = path.join(ROOT, '../live-dashboard-app/.env');
    if (!fs.existsSync(dashboardEnv)) return;

    const parsed = require('dotenv').parse(fs.readFileSync(dashboardEnv));
    for (const [key, value] of Object.entries(parsed)) {
        if (value == null || value === '') continue;
        if (process.env[key] === undefined || process.env[key] === '') {
            process.env[key] = value;
        }
    }
}

function augmentPipeline(pipeline) {
    const next = { ...pipeline, gate: { ...(pipeline.gate || {}) } };
    const gateUrl = String(process.env.MMX_GATE_URL || '').trim();
    if (gateUrl) next.gate.url = gateUrl;

    const storeName = String(process.env.MMX_STORE_NAME || '3811 Chirnside Park').trim();
    next.reports = (pipeline.reports || []).map((r) => ({
        ...r,
        storeName: r.storeName || storeName,
    }));

    return next;
}

function getSettings() {
    loadEnv();
    const workDir = path.resolve(ROOT, process.env.MMX_WORK_DIR || './data');
    return {
        root: ROOT,
        workDir,
        downloadDir: path.resolve(ROOT, process.env.MMX_DOWNLOAD_DIR || path.join(workDir, 'inbox')),
        templateLocal: path.resolve(
            ROOT,
            process.env.MMX_TEMPLATE_LOCAL || path.join(workDir, 'workbooks', 'Build To JS.xlsx')
        ),
        templateSource: process.env.MMX_TEMPLATE_SOURCE
            ? path.resolve(process.env.MMX_TEMPLATE_SOURCE)
            : null,
        templatePublish: process.env.MMX_TEMPLATE_PUBLISH
            ? path.resolve(process.env.MMX_TEMPLATE_PUBLISH)
            : null,
        templateAlwaysCopy: !/^(0|false|no|off)$/i.test(
            String(process.env.MMX_TEMPLATE_ALWAYS_COPY ?? 'false').trim()
        ),
        templateSyncPaths: (process.env.MMX_TEMPLATE_SYNC || '')
            .split(';')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((p) => path.resolve(ROOT, p)),
        userDataDir: path.resolve(ROOT, process.env.MMX_USER_DATA_DIR || path.join(workDir, 'browser-profile')),
        loginSuccessUrlPart: process.env.MMX_LOGIN_SUCCESS_URL_PART || '/MMS_',
        navTimeoutMs: Number(process.env.MMX_NAV_TIMEOUT_MS || 45000),
        downloadWaitMs: Number(process.env.MMX_DOWNLOAD_WAIT_MS || 120000),
        loginWaitMs: Number(process.env.MMX_LOGIN_WAIT_MS || 300000),
        outDir: path.join(workDir, 'out'),
        storeName: String(process.env.MMX_STORE_NAME || '3811 Chirnside Park').trim(),
        pipeline: augmentPipeline(loadJson('config/pipeline.json')),
        excelMapping: loadJson('config/excel-mapping.json'),
        vendorOrders: loadJson('config/vendor-orders.json', false),
    };
}

module.exports = { ROOT, loadEnv, getSettings, loadJson };
