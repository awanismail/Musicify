const db = require("../db/sqlite");
const {
    camelToColumn,
    rowToSettings,
    serializeValue,
    settingsToColumns,
} = require("../db/guildColumns");

const SELECT_GUILD = db.prepare("SELECT * FROM guilds WHERE guild_id = ?");
const INSERT_GUILD = db.prepare("INSERT INTO guilds (guild_id) VALUES (?)");
const SELECT_ALL_GUILDS = db.prepare("SELECT * FROM guilds");

function ensureGuildRow(guildId) {
    const row = SELECT_GUILD.get(guildId);
    if (row) return row;

    INSERT_GUILD.run(guildId);
    return SELECT_GUILD.get(guildId);
}

function getGuildSettings(guildId) {
    return rowToSettings(ensureGuildRow(guildId));
}

function setGuildSetting(guildId, key, value) {
    const column = camelToColumn(key);
    if (!column) {
        throw new Error(`Unknown guild setting: ${key}`);
    }

    ensureGuildRow(guildId);
    db.prepare(`UPDATE guilds SET ${column} = ? WHERE guild_id = ?`).run(
        serializeValue(key, value),
        guildId
    );
}

function setGuildSettings(guildId, settings) {
    ensureGuildRow(guildId);

    db.exec("BEGIN");
    try {
        const columns = settingsToColumns(settings);
        for (const [column, value] of Object.entries(columns)) {
            db.prepare(`UPDATE guilds SET ${column} = ? WHERE guild_id = ?`).run(
                value,
                guildId
            );
        }
        db.exec("COMMIT");
    } catch (err) {
        db.exec("ROLLBACK");
        throw err;
    }
}

function deleteGuildSetting(guildId, key) {
    const column = camelToColumn(key);
    if (!column) return;

    db.prepare(`UPDATE guilds SET ${column} = NULL WHERE guild_id = ?`).run(guildId);
}

function persistGuildPlaybackSettings(guildId, guildData) {
    setGuildSettings(guildId, {
        defaultVolume: guildData.volume,
        defaultAutoplay: guildData.autoplay,
    });
}

function readDB() {
    const result = {};
    for (const row of SELECT_ALL_GUILDS.all()) {
        result[row.guild_id] = rowToSettings(row);
    }
    return result;
}

function writeDB(data) {
    db.exec("BEGIN");
    try {
        for (const [guildId, settings] of Object.entries(data)) {
            ensureGuildRow(guildId);
            const columns = settingsToColumns(settings);
            for (const [column, value] of Object.entries(columns)) {
                db.prepare(`UPDATE guilds SET ${column} = ? WHERE guild_id = ?`).run(
                    value,
                    guildId
                );
            }
        }
        db.exec("COMMIT");
    } catch (err) {
        db.exec("ROLLBACK");
        throw err;
    }
}

module.exports = {
    getGuildSettings,
    setGuildSetting,
    setGuildSettings,
    deleteGuildSetting,
    persistGuildPlaybackSettings,
    readDB,
    writeDB,
};
