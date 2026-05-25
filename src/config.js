const fs = require('fs');
const path = require('path');
const { platformEnvSuffix } = require('./utils/platform');

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

function loadEnvFile(name, { override = false } = {}) {
    const p = path.join(ROOT, name);
    if (fs.existsSync(p)) {
        require('dotenv').config({ path: p, override });
    }
}

/** Shared → platform overlay (.env.windows / .env.pi) → production. Machine readable paths stay out of git. */
function loadEnv() {
    loadEnvFile('.env');
    loadEnvFile(`.env.${platformEnvSuffix()}`, { override: true });
    loadEnvFile('.env.production', { override: true });

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

/** Resolve env path: absolute/UNC as-is; relative paths from `baseDir` (repo root by default). */
function resolveConfigPath(raw, baseDir = ROOT) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return null;
    if (path.isAbsolute(trimmed) || trimmed.startsWith('\\\\')) {
        return path.normalize(trimmed);
    }
    return path.resolve(baseDir, trimmed);
}

/**
 * Build ordered workbook candidates. First existing file wins on each machine.
 * Preferred:
 * - MMX_BUILD_TO_DIR — semicolon-separated list of folders
 * - Or: MMX_BUILD_TO_DIR_ONEDRIVE, MMX_BUILD_TO_DIR_PI, MMX_BUILD_TO_DIR_FALLBACK
 * - MMX_BUILD_TO_FILENAME — workbook name inside the chosen folder
 *
 * Backward compatible:
 * - MMX_TEMPLATE_LOCAL — semicolon-separated list (overrides named vars when set)
 * - Or: MMX_TEMPLATE_ONEDRIVE, MMX_TEMPLATE_PI, MMX_TEMPLATE_FALLBACK (one path per line)
 */
function splitConfigPathList(raw) {
    return String(raw || '')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
}

function buildToFilename() {
    return String(process.env.MMX_BUILD_TO_FILENAME || 'Build to.xlsx').trim();
}

function buildBuildToDirCandidates(workDir, baseDir = ROOT) {
    const explicitList = splitConfigPathList(process.env.MMX_BUILD_TO_DIR);
    if (explicitList.length) {
        return explicitList.map((p) => resolveConfigPath(p, baseDir));
    }

    const named = [
        process.env.MMX_BUILD_TO_DIR_ONEDRIVE,
        process.env.MMX_BUILD_TO_DIR_PI,
        process.env.MMX_BUILD_TO_DIR_FALLBACK,
    ]
        .map((s) => String(s || '').trim())
        .filter(Boolean)
        .map((p) => resolveConfigPath(p, baseDir));

    if (named.length) return named;

    return [resolveConfigPath(path.join(workDir, 'workbooks'), baseDir)];
}

function buildTemplateLocalCandidates(workDir, baseDir = ROOT) {
    const explicitList = splitConfigPathList(process.env.MMX_TEMPLATE_LOCAL);

    if (explicitList.length) {
        return explicitList.map((p) => resolveConfigPath(p, baseDir));
    }

    const buildToDirs = buildBuildToDirCandidates(workDir, baseDir);
    const filename = buildToFilename();
    if (
        process.env.MMX_BUILD_TO_DIR ||
        process.env.MMX_BUILD_TO_DIR_ONEDRIVE ||
        process.env.MMX_BUILD_TO_DIR_PI ||
        process.env.MMX_BUILD_TO_DIR_FALLBACK ||
        process.env.MMX_BUILD_TO_FILENAME
    ) {
        return buildToDirs.map((dir) => path.join(dir, filename));
    }

    const named = [
        process.env.MMX_TEMPLATE_ONEDRIVE,
        process.env.MMX_TEMPLATE_PI,
        process.env.MMX_TEMPLATE_FALLBACK,
    ]
        .map((s) => String(s || '').trim())
        .filter(Boolean)
        .map((p) => resolveConfigPath(p, baseDir));

    if (named.length) return named;

    return [resolveConfigPath(path.join(workDir, 'workbooks', 'Build To JS.xlsx'), baseDir)];
}

/** Pick first existing candidate, or first in list (create/copy target) if none exist yet. */
function resolveTemplateLocal(workDir, baseDir = ROOT) {
    const candidates = buildTemplateLocalCandidates(workDir, baseDir);
    const existing = candidates.find((p) => fs.existsSync(p));
    return {
        path: existing || candidates[0],
        candidates,
        exists: Boolean(existing),
    };
}

function logTemplateLocalChoice(settings) {
    const log = require('./utils/logging');
    const status = settings.templateLocalExists ? 'using existing' : 'target (not found yet)';
    log.info(`Build To workbook (${status}): ${settings.templateLocal}`);
    if (settings.templateLocalCandidates.length > 1) {
        const checked = settings.templateLocalCandidates
            .map((p) => `${p}${fs.existsSync(p) ? ' ✓' : ''}`)
            .join('\n  ');
        log.info(`  Paths checked (first ✓ wins):\n  ${checked}`);
    }
    log.info(`Report downloads folder: ${settings.downloadDir}`);
}

function resolveDownloadDir(templatePath, baseDir = ROOT) {
    const raw = String(process.env.MMX_DOWNLOAD_DIR || '').trim();
    if (!raw || /^same-as-workbook$/i.test(raw)) {
        return path.dirname(templatePath);
    }
    return resolveConfigPath(raw, baseDir);
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
    const workDir = resolveConfigPath(process.env.MMX_WORK_DIR || './data', ROOT);
    const ephemeralBrowser = /^(1|true|yes|on)$/i.test(String(process.env.MMX_EPHEMERAL_BROWSER ?? '').trim());
    const userDataDirRaw = String(process.env.MMX_USER_DATA_DIR ?? '').trim();
    const userDataDir = ephemeralBrowser
        ? null
        : userDataDirRaw
          ? resolveConfigPath(userDataDirRaw, ROOT)
          : path.join(workDir, 'browser-profile');
    const template = resolveTemplateLocal(workDir, ROOT);
    return {
        root: ROOT,
        workDir,
        downloadDir: resolveDownloadDir(template.path, ROOT),
        templateLocal: template.path,
        templateLocalCandidates: template.candidates,
        templateLocalExists: template.exists,
        templateSource: process.env.MMX_TEMPLATE_SOURCE
            ? resolveConfigPath(process.env.MMX_TEMPLATE_SOURCE, ROOT)
            : null,
        templatePublish: process.env.MMX_TEMPLATE_PUBLISH
            ? resolveConfigPath(process.env.MMX_TEMPLATE_PUBLISH, ROOT)
            : null,
        templateAlwaysCopy: !/^(0|false|no|off)$/i.test(
            String(process.env.MMX_TEMPLATE_ALWAYS_COPY ?? 'false').trim()
        ),
        templateSyncPaths: (process.env.MMX_TEMPLATE_SYNC || '')
            .split(';')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((p) => resolveConfigPath(p, ROOT)),
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

module.exports = {
    ROOT,
    loadEnv,
    loadEnvFile,
    getSettings,
    loadJson,
    resolveConfigPath,
    buildTemplateLocalCandidates,
    resolveTemplateLocal,
    logTemplateLocalChoice,
};
