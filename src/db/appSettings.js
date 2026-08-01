const db = require("./sqlite");

function getAppSetting(key) {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key);
    return row?.value ?? null;
}

function setAppSetting(key, value) {
    db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)").run(
        key,
        value
    );
}

function deleteAppSetting(key) {
    db.prepare("DELETE FROM app_settings WHERE key = ?").run(key);
}

module.exports = {
    getAppSetting,
    setAppSetting,
    deleteAppSetting,
};
