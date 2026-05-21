/**
 * PM2 config for Raspberry Pi (optional alternative to systemd).
 *
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *
 * Requires .env.production (or .env) in repo root with SCRAPER_* and MMX_* vars.
 */
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;

function loadEnvFile(name) {
    const p = path.join(ROOT, name);
    if (!fs.existsSync(p)) return {};
    const out = {};
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
        ) {
            val = val.slice(1, -1);
        }
        out[key] = val;
    }
    return out;
}

const env = {
    ...loadEnvFile('.env'),
    ...loadEnvFile('.env.production'),
    NODE_ENV: 'production',
};

module.exports = {
    apps: [
        {
            name: 'mmx-gate-watch',
            cwd: ROOT,
            script: 'src/runGateScheduler.js',
            interpreter: 'node',
            autorestart: true,
            max_restarts: 20,
            restart_delay: 30000,
            env,
        },
    ],
};
