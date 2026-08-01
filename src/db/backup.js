const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const DB_PATH = path.join(DATA_DIR, "musicify.db");

const DEFAULT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_RETAIN = 4;

let schedulerTimer = null;

function getBackupConfig() {
    return {
        enabled: process.env.BACKUP_ENABLED !== "false",
        intervalMs: Math.max(
            60_000,
            Number(process.env.BACKUP_INTERVAL_MS) || DEFAULT_INTERVAL_MS
        ),
        retain: Math.max(2, Number(process.env.BACKUP_RETAIN_COUNT) || DEFAULT_RETAIN),
    };
}

function ensureBackupDir() {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function formatTimestamp(date = new Date()) {
    return date.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function escapeSqlPath(filePath) {
    return filePath.replace(/'/g, "''");
}

function listTimestampedBackups() {
    if (!fs.existsSync(BACKUP_DIR)) return [];

    return fs
        .readdirSync(BACKUP_DIR)
        .filter(
            (name) =>
                name.startsWith("musicify-") &&
                name.endsWith(".db") &&
                name !== "musicify-latest.db"
        )
        .map((name) => {
            const fullPath = path.join(BACKUP_DIR, name);
            return {
                name,
                path: fullPath,
                mtimeMs: fs.statSync(fullPath).mtimeMs,
            };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function pruneOldBackups(retain) {
    ensureBackupDir();

    for (const backup of listTimestampedBackups().slice(retain)) {
        fs.unlinkSync(backup.path);
    }
}

function getLatestBackupAgeMs() {
    const latestPath = path.join(BACKUP_DIR, "musicify-latest.db");
    if (fs.existsSync(latestPath)) {
        return Date.now() - fs.statSync(latestPath).mtimeMs;
    }

    const backups = listTimestampedBackups();
    if (backups.length === 0) {
        return Infinity;
    }

    return Date.now() - backups[0].mtimeMs;
}

async function createBackup(db) {
    if (!fs.existsSync(DB_PATH)) {
        return null;
    }

    ensureBackupDir();

    const stamp = formatTimestamp();
    const backupPath = path.join(BACKUP_DIR, `musicify-${stamp}.db`);
    const latestPath = path.join(BACKUP_DIR, "musicify-latest.db");

    db.exec(`VACUUM INTO '${escapeSqlPath(backupPath)}'`);
    fs.copyFileSync(backupPath, latestPath);

    return backupPath;
}

async function runBackup(db, { force = false } = {}) {
    const { retain, intervalMs } = getBackupConfig();

    if (!force && getLatestBackupAgeMs() < intervalMs) {
        return null;
    }

    try {
        const backupPath = await createBackup(db);
        if (!backupPath) {
            return null;
        }

        pruneOldBackups(retain);
        console.log(`[Musicify] Database backup saved to ${backupPath}`);
        return backupPath;
    } catch (err) {
        console.error("[Musicify] Database backup failed:", err.message);
        return null;
    }
}

function startBackupScheduler(db) {
    const config = getBackupConfig();
    if (!config.enabled) {
        console.log("[Musicify] Database backups disabled (BACKUP_ENABLED=false)");
        return;
    }

    ensureBackupDir();
    pruneOldBackups(config.retain);

    const latestAgeMs = getLatestBackupAgeMs();
    if (latestAgeMs >= config.intervalMs) {
        void runBackup(db);
    }

    if (schedulerTimer) {
        clearInterval(schedulerTimer);
    }

    schedulerTimer = setInterval(() => {
        void runBackup(db);
    }, config.intervalMs);

    const dayMs = 24 * 60 * 60 * 1000;
    const intervalLabel =
        config.intervalMs >= dayMs
            ? `${config.intervalMs / dayMs} day(s)`
            : `${config.intervalMs / (60 * 60 * 1000)}h`;
    console.log(
        `[Musicify] Database backups enabled — every ${intervalLabel}, keeping ${config.retain} snapshot(s)`
    );
}

function stopBackupScheduler() {
    if (schedulerTimer) {
        clearInterval(schedulerTimer);
        schedulerTimer = null;
    }
}

module.exports = {
    BACKUP_DIR,
    DATA_DIR,
    DB_PATH,
    listTimestampedBackups,
    runBackup,
    startBackupScheduler,
    stopBackupScheduler,
};
