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

    loadSiblingEnv('../live-dashboard-app/.env', { fillEmpty: true });
    loadSiblingEnv('../live-dashboard-app/.env.production', { fillEmpty: true });

    if (/^(1|true|yes|on)$/i.test(String(process.env.MMX_USE_DASHBOARD_CREDENTIALS ?? '').trim())) {
        loadSiblingEnv('../live-dashboard-app/.env.production', {
            override: true,
            keys: ['SCRAPER_USERNAME', 'SCRAPER_PASSWORD', 'SCRAPER_CREDENTIALS_ENCRYPTED', 'SCRAPER_CREDENTIALS_KEY'],
        });
        loadSiblingEnv('../live-dashboard-app/.env', {
            override: true,
            keys: ['SCRAPER_USERNAME', 'SCRAPER_PASSWORD', 'SCRAPER_CREDENTIALS_ENCRYPTED', 'SCRAPER_CREDENTIALS_KEY'],
        });
    }
}

function loadSiblingEnv(relPath, { override = false, fillEmpty = false, keys = null } = {}) {
    const p = path.join(ROOT, relPath);
    if (!fs.existsSync(p)) return;

    const parsed = require('dotenv').parse(fs.readFileSync(p));
    for (const [key, value] of Object.entries(parsed)) {
        if (value == null || value === '') continue;
        if (keys && !keys.includes(key)) continue;
        if (override) {
            process.env[key] = value;
        } else if (fillEmpty && (process.env[key] === undefined || process.env[key] === '')) {
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
    const ephemeralBrowser = /^(1|true|yes|on)$/i.test(String(process.env.MMX_EPHEMERAL_BROWSER ?? '').trim());
    const userDataDirRaw = String(process.env.MMX_USER_DATA_DIR ?? '').trim();
    const userDataDir = ephemeralBrowser
        ? null
        : userDataDirRaw
          ? path.resolve(ROOT, userDataDirRaw)
          : path.resolve(workDir, 'browser-profile');
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
        userDataDir,
        ephemeralBrowser,
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
