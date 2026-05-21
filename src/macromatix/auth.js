const crypto = require('crypto');
const puppeteer = require('puppeteer');
const { BASE_URL, GOTO_OPTS, getPuppeteerLaunchOptions } = require('./browser');
const { patchPageWaitForTimeout } = require('../utils/delay');
const { clearChromeProfileSingletonLocks } = require('../utils/files');
const log = require('../utils/logging');

function decryptCredentialPayload(encryptedPayload, keyText) {
    if (!encryptedPayload || !keyText) return null;

    const key = crypto.createHash('sha256').update(String(keyText)).digest();
    const parsed = JSON.parse(Buffer.from(String(encryptedPayload), 'base64').toString('utf8'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(parsed.data, 'base64')),
        decipher.final(),
    ]);
    return JSON.parse(decrypted.toString('utf8'));
}

function getMacromatixCredentials() {
    const encrypted = String(process.env.SCRAPER_CREDENTIALS_ENCRYPTED || '').trim();
    if (encrypted) {
        if (!String(process.env.SCRAPER_CREDENTIALS_KEY || '').trim()) {
            throw new Error('SCRAPER_CREDENTIALS_KEY is required when SCRAPER_CREDENTIALS_ENCRYPTED is set');
        }
        let decrypted;
        try {
            decrypted = decryptCredentialPayload(encrypted, process.env.SCRAPER_CREDENTIALS_KEY);
        } catch (e) {
            throw new Error(`Failed to decrypt SCRAPER_CREDENTIALS_ENCRYPTED: ${e.message}`);
        }
        return {
            username: decrypted && decrypted.username != null ? String(decrypted.username).trim() : '',
            password: decrypted && decrypted.password != null ? String(decrypted.password).trim() : '',
        };
    }
    return {
        username: String(process.env.SCRAPER_USERNAME || '').trim(),
        password: String(process.env.SCRAPER_PASSWORD || '').trim(),
    };
}

function isMacromatixLogonPage(url, hasLoginForm) {
    if (hasLoginForm) return true;
    return /\/MMS_Logon\.aspx/i.test(url || '') || /\/login/i.test(url || '');
}

async function readLoginPageError(page) {
    try {
        return await page.evaluate(() => {
            const selectors = [
                '.validation-summary-errors',
                '#Login_FailureText',
                '[id*="Failure"]',
                '[id*="Error"]',
                '.error',
            ];
            for (const sel of selectors) {
                const el = document.querySelector(sel);
                const text = (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
                if (text) return text.slice(0, 240);
            }
            const body = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
            const lower = body.toLowerCase();
            if (lower.includes('invalid') || lower.includes('incorrect') || lower.includes('failed')) {
                return body.slice(0, 240);
            }
            return '';
        });
    } catch {
        return '';
    }
}

async function submitLoginForm(page, username, password, navTimeout) {
    await page.waitForSelector('#Login_UserName', { timeout: navTimeout });
    await page.evaluate(() => {
        const u = document.querySelector('#Login_UserName');
        const p = document.querySelector('#Login_Password');
        if (u) u.value = '';
        if (p) p.value = '';
    });
    await page.type('#Login_UserName', username, { delay: 25 });
    await page.type('#Login_Password', password, { delay: 25 });

    const loginButton = await page.$('input[type="submit"]');
    if (!loginButton) throw new Error('Login button not found');

    log.info('Login submit clicked (Log On)');
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'load', timeout: navTimeout }).catch(() => {}),
        loginButton.click(),
    ]);
}

async function waitForPostLogin(page, loginSuccessUrlPart, loginWaitMs) {
    const needle = String(loginSuccessUrlPart || 'MMS_Stores').replace(/^\//, '');
    const start = Date.now();
    let lastLogAt = 0;
    while (Date.now() - start < loginWaitMs) {
        let url = '';
        let onLogin = null;
        try {
            url = page.url() || '';
            onLogin = await page.$('#Login_UserName');
        } catch {
            await page.waitForTimeout(500);
            continue;
        }

        if (Date.now() - lastLogAt >= 15000) {
            const onLoginPage = isMacromatixLogonPage(url, Boolean(onLogin));
            const loginError = onLoginPage ? await readLoginPageError(page) : '';
            log.info(
                `Waiting for login… (${Math.round((Date.now() - start) / 1000)}s) url=${url.slice(0, 80)} onLoginPage=${onLoginPage}${
                    loginError ? ` error="${loginError}"` : ''
                }`
            );
            lastLogAt = Date.now();
        }

        if (isMacromatixLogonPage(url, Boolean(onLogin))) {
            await page.waitForTimeout(1000);
            continue;
        }
        if (needle && url.includes(needle)) {
            return true;
        }
        if (/macromatix\.net/i.test(url)) {
            return true;
        }
        await page.waitForTimeout(1000);
    }
    return false;
}

async function loginMacromatix(page, options = {}) {
    const { username, password } = getMacromatixCredentials();
    if (!username || !password) {
        throw new Error(
            'Macromatix credentials missing. Set SCRAPER_USERNAME/SCRAPER_PASSWORD or SCRAPER_CREDENTIALS_ENCRYPTED in .env'
        );
    }

    const navTimeout = options.navTimeoutMs || GOTO_OPTS.timeout;
    const loginWaitMs = options.loginWaitMs || 300000;
    const loginSuccessUrlPart = options.loginSuccessUrlPart || 'MMS_Stores';

    log.info('Navigating to Macromatix login…');
    await page.goto(BASE_URL, { ...GOTO_OPTS, timeout: navTimeout });

    const alreadyIn = await waitForPostLogin(page, loginSuccessUrlPart, 3000);
    if (alreadyIn) {
        log.info('Session already active (userDataDir); skipping password entry');
        return;
    }

    log.info(`Entering credentials for user "${username}"…`);
    await submitLoginForm(page, username, password, navTimeout);

    log.info('Credentials submitted — waiting for Macromatix session…');
    const ok = await waitForPostLogin(page, loginSuccessUrlPart, loginWaitMs);
    if (!ok) {
        const loginError = await readLoginPageError(page);
        let hint = '';
        try {
            hint = ` Last url: ${page.url()}.`;
        } catch {
            /* ignore */
        }
        if (loginError) {
            hint += ` Login page message: ${loginError}`;
        }
        throw new Error(
            `Login did not complete within ${loginWaitMs}ms.${hint} Check SCRAPER_USERNAME/SCRAPER_PASSWORD in .env.production, or copy data/browser-profile from your PC.`
        );
    }
    log.info('Logged in to Macromatix');
}

async function launchBrowser(settings) {
    const launchOpts = getPuppeteerLaunchOptions(settings.userDataDir);
    const clearedLocks = clearChromeProfileSingletonLocks(settings.userDataDir);
    if (clearedLocks.length) {
        log.info(`Cleared stale browser profile locks: ${clearedLocks.join(', ')}`);
    }
    log.info(`Launching browser (headless=${launchOpts.headless}, profile=${settings.userDataDir})`);
    const browser = await puppeteer.launch(launchOpts);
    const page = patchPageWaitForTimeout(await browser.newPage());
    await page.setViewport({ width: 1280, height: 720 });
    return { browser, page };
}

module.exports = {
    getMacromatixCredentials,
    loginMacromatix,
    launchBrowser,
    waitForPostLogin,
};
