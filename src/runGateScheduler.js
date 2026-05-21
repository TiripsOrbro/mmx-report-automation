#!/usr/bin/env node
/**
 * Automatic Orders — scheduled gate checks (9 AM–11 PM store time).
 * When the key-item gate is READY and today's pipeline has not run yet,
 * starts the full pipeline (reports → Excel → vendor order entry).
 *
 *   npm run automatic-orders
 *
 * Env: MMX_GATE_SCHEDULE_START=9, MMX_GATE_SCHEDULE_END=23, MMX_TIME_ZONE=Australia/Melbourne
 *      MMX_GATE_CHECK_INTERVAL_MINUTES=60  (use 15 for testing)
 */
const path = require('path');
const { spawn } = require('child_process');
const { ROOT, getSettings } = require('./config');
const { isPipelineDoneToday, msUntilNextGateSession } = require('./utils/dailyLock');
const log = require('./utils/logging');

const TZ = process.env.MMX_TIME_ZONE || process.env.DASHBOARD_TIME_ZONE || 'Australia/Melbourne';
const START_HOUR = Number(process.env.MMX_GATE_SCHEDULE_START ?? 9);
const END_HOUR = Number(process.env.MMX_GATE_SCHEDULE_END ?? 23);
const CHECK_INTERVAL_MINUTES = Math.min(
    60,
    Math.max(1, Number(process.env.MMX_GATE_CHECK_INTERVAL_MINUTES ?? 60) || 60)
);
const GATE_READY_EXIT = 10;

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

function msUntilNextScheduledCheck(now = new Date()) {
    const { hour, minute } = localHourMinute(now);
    const msIntoMinute = now.getSeconds() * 1000 + now.getMilliseconds();

    if (hour < START_HOUR) {
        const hoursUntilStart = START_HOUR - hour;
        return hoursUntilStart * 3600000 - minute * 60000 - msIntoMinute;
    }
    if (hour > END_HOUR) {
        const hoursUntilTomorrowStart = 24 - hour + START_HOUR;
        return hoursUntilTomorrowStart * 3600000 - minute * 60000 - msIntoMinute;
    }

    if (CHECK_INTERVAL_MINUTES >= 60) {
        if (minute === 0 && msIntoMinute < 5000 && isWithinWindow(now)) return 0;
        return Math.max(1000, (60 - minute) * 60000 - msIntoMinute);
    }

    const slotStart = Math.floor(minute / CHECK_INTERVAL_MINUTES) * CHECK_INTERVAL_MINUTES;
    if (minute === slotStart && msIntoMinute < 5000 && isWithinWindow(now)) return 0;

    const nextMinute = slotStart + CHECK_INTERVAL_MINUTES;
    if (nextMinute >= 60) {
        return Math.max(1000, (60 - minute) * 60000 - msIntoMinute);
    }
    return Math.max(1000, (nextMinute - minute) * 60000 - msIntoMinute);
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
        `Automatic orders already completed today — paused until tomorrow (~${formatMs(wait)}, resume ~${formatResumeTime(wait)})`
    );
    await sleep(wait);
    return true;
}

function spawnNode(args, label) {
    return new Promise((resolve) => {
        log.info(`Starting ${label}…`);
        const child = spawn(process.execPath, args, {
            cwd: ROOT,
            stdio: 'inherit',
            env: { ...process.env, MMX_KEEP_BROWSER_OPEN: 'false' },
        });
        child.on('exit', (code) => resolve(code ?? 1));
        child.on('error', (err) => {
            log.error(`${label} failed to start: ${err.message}`);
            resolve(1);
        });
    });
}

function runGateCheck() {
    return spawnNode([path.join(ROOT, 'src/run.js'), '--gate-only'], 'gate check');
}

function runFullPipeline() {
    return spawnNode([path.join(ROOT, 'src/run.js')], 'full pipeline (reports → Excel → vendor orders)');
}

async function maybeRunPipelineAfterGate(workDir, gateExitCode) {
    if (gateExitCode !== GATE_READY_EXIT) {
        if (gateExitCode === 0) {
            log.info('Gate not ready yet — will check again on next scheduled interval');
        } else {
            log.warn(`Gate check exited with code ${gateExitCode}`);
        }
        return;
    }
    if (isPipelineDoneToday(workDir)) {
        log.info('Gate ready but pipeline already completed today — skipping');
        return;
    }
    log.info('Gate READY — launching automatic orders pipeline');
    const pipelineCode = await runFullPipeline();
    if (pipelineCode === 0) {
        log.info('Automatic orders pipeline finished successfully');
    } else {
        log.warn(`Automatic orders pipeline exited with code ${pipelineCode} — will retry on a later gate check`);
    }
}

async function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function main() {
    const { workDir } = getSettings();
    const intervalLabel =
        CHECK_INTERVAL_MINUTES >= 60 ? 'hourly' : `every ${CHECK_INTERVAL_MINUTES} min`;
    log.info(
        `Automatic Orders: ${intervalLabel} gate checks ${START_HOUR}:00–${END_HOUR}:59 (${TZ}); runs full pipeline when gate is READY (once per day).`
    );

    if (await sleepUntilNextGateSession(workDir)) {
        // resumed next day
    } else if (isWithinWindow()) {
        const { minute } = localHourMinute();
        const atIntervalStart =
            CHECK_INTERVAL_MINUTES >= 60
                ? minute < 5
                : minute % CHECK_INTERVAL_MINUTES < 5;
        if (atIntervalStart) {
            const gateCode = await runGateCheck();
            await maybeRunPipelineAfterGate(workDir, gateCode);
        }
    }

    // eslint-disable-next-line no-constant-condition
    while (true) {
        if (await sleepUntilNextGateSession(workDir)) {
            continue;
        }

        const wait = msUntilNextScheduledCheck();
        const { hour, minute } = localHourMinute();
        log.info(
            `Next gate check ~${formatMs(wait)} (local ${hour}:${String(minute).padStart(2, '0')}, every ${CHECK_INTERVAL_MINUTES} min, window ${START_HOUR}–${END_HOUR})`
        );
        await sleep(wait);

        if (await sleepUntilNextGateSession(workDir)) {
            continue;
        }

        if (!isWithinWindow()) {
            log.info('Outside gate window — waiting for next scheduled check');
            continue;
        }

        const gateCode = await runGateCheck();
        await maybeRunPipelineAfterGate(workDir, gateCode);
    }
}

main().catch((err) => {
    log.error(err.message, err.stack);
    process.exit(1);
});
