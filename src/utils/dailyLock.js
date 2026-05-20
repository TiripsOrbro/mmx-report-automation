const fs = require('fs');
const path = require('path');

function todayKey(timeZone) {
    const tz = timeZone || process.env.MMX_TIME_ZONE || process.env.DASHBOARD_TIME_ZONE || 'Australia/Melbourne';
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
        new Date()
    );
}

function lockPath(workDir) {
    return path.join(workDir, 'out', 'pipeline-complete-today.json');
}

function isPipelineDoneToday(workDir, timeZone) {
    const p = lockPath(workDir);
    if (!fs.existsSync(p)) return false;
    try {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        return data.date === todayKey(timeZone);
    } catch {
        return false;
    }
}

function markPipelineDoneToday(workDir, meta = {}, timeZone) {
    const p = lockPath(workDir);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(
        p,
        JSON.stringify(
            {
                date: todayKey(timeZone),
                completedAt: new Date().toISOString(),
                ...meta,
            },
            null,
            2
        ),
        'utf8'
    );
}

function clearPipelineDoneToday(workDir) {
    const p = lockPath(workDir);
    if (fs.existsSync(p)) fs.unlinkSync(p);
}

module.exports = {
    todayKey,
    lockPath,
    isPipelineDoneToday,
    markPipelineDoneToday,
    clearPipelineDoneToday,
};
