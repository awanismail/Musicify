require("dotenv").config();

const db = require("../src/db/sqlite");
const { runBackup } = require("../src/db/backup");

runBackup(db, { force: true })
    .then((backupPath) => {
        if (!backupPath) {
            console.error("[Musicify] No database file found to back up.");
            process.exit(1);
        }
        process.exit(0);
    })
    .catch((err) => {
        console.error("[Musicify] Backup failed:", err.message);
        process.exit(1);
    });
