require("dotenv").config();

const fs = require("fs");
const path = require("path");
const {
    BACKUP_DIR,
    DB_PATH,
    listTimestampedBackups,
} = require("../src/db/backup");

function usage() {
    console.log("Usage: node scripts/restore-db.js [backup-file-or-name]");
    console.log("");
    console.log("Examples:");
    console.log("  node scripts/restore-db.js latest");
    console.log("  node scripts/restore-db.js musicify-2026-07-07T05-00-00.db");
    console.log("");
    console.log("Stop the bot before restoring.");
}

const arg = process.argv[2];
if (!arg) {
    usage();
    process.exit(1);
}

let sourcePath;
if (arg === "latest") {
    sourcePath = path.join(BACKUP_DIR, "musicify-latest.db");
} else if (path.isAbsolute(arg)) {
    sourcePath = arg;
} else if (arg.includes(path.sep)) {
    sourcePath = path.resolve(arg);
} else {
    sourcePath = path.join(BACKUP_DIR, arg);
}

if (!fs.existsSync(sourcePath)) {
    console.error(`[Musicify] Backup not found: ${sourcePath}`);
    console.error("");
    console.error("Available backups:");
    for (const backup of listTimestampedBackups()) {
        console.error(`  ${backup.name}`);
    }
    process.exit(1);
}

const safetyCopy = `${DB_PATH}.before-restore-${Date.now()}`;
if (fs.existsSync(DB_PATH)) {
    fs.copyFileSync(DB_PATH, safetyCopy);
    console.log(`[Musicify] Saved current database to ${safetyCopy}`);
}

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.copyFileSync(sourcePath, DB_PATH);
console.log(`[Musicify] Restored database from ${sourcePath}`);
