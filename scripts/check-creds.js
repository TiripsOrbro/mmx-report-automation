#!/usr/bin/env node
/** Verify Macromatix credentials load (no password printed). */
const { getSettings } = require('../src/config');
const { getMacromatixCredentials } = require('../src/macromatix/auth');
const path = require('path');
const fs = require('fs');

getSettings();
const { username, password } = getMacromatixCredentials();
const dashProd = path.join(__dirname, '../live-dashboard-app/.env.production');
const dashEnv = path.join(__dirname, '../live-dashboard-app/.env');

console.log('SCRAPER_USERNAME:', username || '(missing)');
console.log('SCRAPER_PASSWORD length:', password ? password.length : 0);
console.log('MMX_USE_DASHBOARD_CREDENTIALS:', process.env.MMX_USE_DASHBOARD_CREDENTIALS || '(not set)');
console.log('MMX_EPHEMERAL_BROWSER:', process.env.MMX_EPHEMERAL_BROWSER || '(not set)');
console.log('Dashboard .env.production exists:', fs.existsSync(dashProd));
console.log('Dashboard .env exists:', fs.existsSync(dashEnv));

if (!username || !password) {
    process.exit(1);
}
