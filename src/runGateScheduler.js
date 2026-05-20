#!/usr/bin/env node
/**
 * Hourly key-item gate checks between 9:00 and 23:00 (store timezone).
 * Does not run the full pipeline — only `npm run gate-check`.
 * After today's full pipeline completes (daily lock), sleeps until the next day.
 *
 *   npm run gate-watch
 *
 * Env: MMX_GATE_SCHEDULE_START=9, MMX_GATE_SCHEDULE_END=23, MMX_TIME_ZONE=Australia/Melbourne
 */
const path = require('path');
const { spawn } = require('child_process');
const { ROOT, getSettings } = require('./config');
const { isPipelineDoneToday, msUntilNextGateSession } = require('./utils/dailyLock');
const log = require('./utils/logging');

const TZ = process.env.MMX_TIME_ZONE || process.env.DASHBOARD_TIME_ZONE || 'Australia/Melbourne';
const START_HOUR = Number(process.env.MMX_GATE_SCHEDULE_START ?? 9);
const END_HOUR = Number(process.env.MMX_GATE_SCHEDULE_END ?? 23);

function localHourMinute(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: TZ,
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
    }).formatToParts(now);
    const map = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
    return { hour: parseInt(map.hour, 10), minute: parseInt(map.minute, 10) };
}

function isWithinWindow(now = new Date()) {
    const { hour } = localHourMinute(now);
    return hour >= START_HOUR && hour <= END_HOUR;
}

function msUntilNextTopOfHour(now = new Date()) {
    const { hour, minute } = localHourMinute(now);
    const msToNextHour = (60 - minute) * 60 * 1000 - now.getMilliseconds() - now.getSeconds() * 1000;

    if (hour < START_HOUR) {
        const hoursUntilStart = START_HOUR - hour;
        return hoursUntilStart * 3600000 - minute * 60000 - now.getSeconds() * 1000 - now.getMilliseconds();
    }
    if (hour > END_HOUR) {
        const hoursUntilTomorrowStart = 24 - hour + START_HOUR;
        return hoursUntilTomorrowStart * 3600000 - minute * 60000 - now.getSeconds() * 1000 - now.getMilliseconds();
    }
    if (minute === 0 && isWithinWindow(now)) return 0;
    return Math.max(1000, msToNextHour);
}

function formatMs(ms) {
    const m = Math.ceil(ms / 60000);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return rm ? `${h}h ${rm}m` : `${h}h`;
}

function formatResumeTime(ms) {
    try {
        return new Date(Date.now() + ms).toLocaleString('en-AU', { timeZone: TZ });
    } catch {
        return formatMs(ms);
    }
}

async function sleepUntilNextGateSession(workDir) {
    const wait = msUntilNextGateSession(workDir, { timeZone: TZ, startHour: START_HOUR });
    if (wait == null) return false;
    log.info(
        `Full pipeline already completed today — gate watch paused until tomorrow (~${formatMs(wait)}, resume ~${formatResumeTime(wait)})`
    );
    await sleep(wait);
    return true;
}

function runGateCheck() {
    return new Promise((resolve) => {
        log.info('Running scheduled gate check…');
        const child = spawn(process.execPath, [path.join(ROOT, 'src/run.js'), '--gate-only'], {
            cwd: ROOT,
            stdio: 'inherit',
            env: { ...process.env, MMX_KEEP_BROWSER_OPEN: 'false' },
        });
        child.on('exit', (code) => resolve(code ?? 1));
        child.on('error', (err) => {
            log.error(err.message);
            resolve(1);
        });
    });
}

async function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function main() {
    const { workDir } = getSettings();
    log.info(
        `Gate watch: hourly ${START_HOUR}:00–${END_HOUR}:59 (${TZ}). Pauses after today's full pipeline (npm start).`
    );

    if (await sleepUntilNextGateSession(workDir)) {
        // resumed next day
    } else if (isWithinWindow()) {
        const { hour, minute } = localHourMinute();
        if (minute < 5) {
            await runGateCheck();
        }
    }

    // eslint-disable-next-line no-constant-condition
    while (true) {
        if (await sleepUntilNextGateSession(workDir)) {
            continue;
        }

        const wait = msUntilNextTopOfHour();
        const { hour } = localHourMinute();
        log.info(`Next gate check ~${formatMs(wait)} (local hour ${hour}, window ${START_HOUR}–${END_HOUR})`);
        await sleep(wait);

        if (await sleepUntilNextGateSession(workDir)) {
            continue;
        }

        if (!isWithinWindow()) {
            log.info('Outside gate window — waiting for next scheduled hour');
            continue;
        }

        await runGateCheck();
    }
}

main().catch((err) => {
    log.error(err.message, err.stack);
    process.exit(1);
});
