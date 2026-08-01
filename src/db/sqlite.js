const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { runMigrations } = require("./migrations");

const DB_PATH = path.join(__dirname, "..", "..", "data", "musicify.db");

function ensureDataDir() {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

ensureDataDir();

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

runMigrations(db);

const { importJsonIfNeeded } = require("./migrate-from-json");
importJsonIfNeeded(db);

module.exports = db;
