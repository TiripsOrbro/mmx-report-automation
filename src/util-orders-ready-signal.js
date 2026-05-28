const fs = require('fs');
const path = require('path');
const { resolveConfigPath } = require('./config');

const ROOT = path.join(__dirname, '..');

function resolveSignalPath() {
    const env = String(process.env.DASHBOARD_ORDERS_READY_FILE || '').trim();
    if (env) return resolveConfigPath(env, ROOT);
    return path.join(ROOT, '../live-dashboard-app/data/orders-ready-for-review.json');
}

function shouldSignalOrdersReady(ordersOk, ordersTotal) {
    const ok = Number(ordersOk);
    const total = Number(ordersTotal);
    if (!Number.isFinite(ok) || !Number.isFinite(total) || total <= 0) return false;
    return ok === total;
}

function signalOrdersReadyForReview(meta = {}) {
    const p = resolveSignalPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(
        p,
        JSON.stringify(
            {
                completedAt: new Date().toISOString(),
                ...meta,
            },
            null,
            2
        ),
        'utf8'
    );
    return p;
}

module.exports = {
    resolveSignalPath,
    shouldSignalOrdersReady,
    signalOrdersReadyForReview,
};
