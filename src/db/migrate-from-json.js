const fs = require("fs");
const path = require("path");
const { settingsToColumns } = require("./guildColumns");

const DATA_DIR = path.join(__dirname, "..", "..", "data");

const JSON_FILES = {
    guilds: path.join(DATA_DIR, "guilds.json"),
    incidents: path.join(DATA_DIR, "incidents.json"),
    statusWebhook: path.join(DATA_DIR, "status-webhook.json"),
};

function backupPath(filePath) {
    return `${filePath}.bak`;
}

function fileExists(filePath) {
    return fs.existsSync(filePath);
}

function renameToBackup(filePath) {
    if (!fileExists(filePath)) return false;
    fs.renameSync(filePath, backupPath(filePath));
    return true;
}

function importGuilds(db) {
    const jsonPath = JSON_FILES.guilds;
    if (fileExists(backupPath(jsonPath))) return 0;
    if (!fileExists(jsonPath)) return 0;

    const existingCount = db.prepare("SELECT COUNT(*) AS count FROM guilds").get().count;
    if (existingCount > 0) {
        renameToBackup(jsonPath);
        return 0;
    }

    let imported = 0;
    const raw = fs.readFileSync(jsonPath, "utf-8");
    const data = JSON.parse(raw);

    const insertGuild = db.prepare("INSERT INTO guilds (guild_id) VALUES (?)");

    db.exec("BEGIN");
    try {
        for (const [guildId, settings] of Object.entries(data)) {
            if (!settings || typeof settings !== "object") continue;

            insertGuild.run(guildId);
            const columns = settingsToColumns(settings);

            for (const [column, value] of Object.entries(columns)) {
                db.prepare(`UPDATE guilds SET ${column} = ? WHERE guild_id = ?`).run(
                    value,
                    guildId
                );
            }
            imported++;
        }
        db.exec("COMMIT");
    } catch (err) {
        db.exec("ROLLBACK");
        throw err;
    }

    renameToBackup(jsonPath);
    return imported;
}

function importIncidents(db) {
    const jsonPath = JSON_FILES.incidents;
    if (fileExists(backupPath(jsonPath))) return 0;
    if (!fileExists(jsonPath)) return 0;

    let imported = 0;
    const raw = fs.readFileSync(jsonPath, "utf-8");
    const parsed = JSON.parse(raw);
    const incidents = Array.isArray(parsed) ? parsed : [];

    const insert = db.prepare(
        "INSERT INTO incidents (timestamp, component, description) VALUES (?, ?, ?)"
    );

    db.exec("BEGIN");
    try {
        for (const incident of incidents) {
            if (!incident?.timestamp || !incident?.component || !incident?.description) {
                continue;
            }
            insert.run(incident.timestamp, incident.component, incident.description);
            imported++;
        }
        db.exec("COMMIT");
    } catch (err) {
        db.exec("ROLLBACK");
        throw err;
    }

    renameToBackup(jsonPath);
    return imported;
}

function importStatusWebhook(db) {
    const jsonPath = JSON_FILES.statusWebhook;
    if (fileExists(backupPath(jsonPath))) return false;
    if (!fileExists(jsonPath)) return false;

    let messageId = null;
    try {
        const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
        messageId = data.messageId || null;
    } catch {
        messageId = null;
    }

    if (messageId) {
        db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)").run(
            "status_webhook_message_id",
            messageId
        );
    }

    renameToBackup(jsonPath);
    return Boolean(messageId);
}

function importJsonIfNeeded(db) {
    const guildCount = importGuilds(db);
    const incidentCount = importIncidents(db);
    const statusImported = importStatusWebhook(db);

    if (guildCount > 0 || incidentCount > 0 || statusImported) {
        console.log(
            `[Musicify] Migrated JSON data to SQLite (${guildCount} guild(s), ${incidentCount} incident(s)${statusImported ? ", status webhook" : ""})`
        );
    }
}

module.exports = {
    importJsonIfNeeded,
};
