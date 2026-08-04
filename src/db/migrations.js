const SCHEMA_VERSION = 7;

function getSchemaVersion(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    `);

    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'schema_version'").get();
    return row ? Number(row.value) : 0;
}

function setSchemaVersion(db, version) {
    db.prepare(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('schema_version', ?)"
    ).run(String(version));
}

function migrateToV1(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS guilds (
            guild_id TEXT PRIMARY KEY,
            chat_play_channel_id TEXT,
            chat_play_message_id TEXT,
            chat_play_enabled INTEGER,
            chat_play_slowmode INTEGER,
            chat_play_delete_messages INTEGER,
            chat_play_pin_player_message INTEGER,
            twenty_four_seven INTEGER,
            bound_voice_channel_id TEXT,
            default_volume INTEGER
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS incidents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER NOT NULL,
            component TEXT NOT NULL,
            description TEXT NOT NULL
        )
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_incidents_timestamp
        ON incidents(timestamp DESC)
    `);
}

function migrateToV5(db) {
    db.exec("DROP TABLE IF EXISTS playlist_tracks");
    db.exec("DROP TABLE IF EXISTS playlists");
}

function migrateToV6(db) {
    const columns = db.prepare("PRAGMA table_info(guilds)").all();
    if (!columns.some((col) => col.name === "default_autoplay")) {
        db.exec("ALTER TABLE guilds ADD COLUMN default_autoplay INTEGER");
    }
}

function migrateToV7(db) {
    const columns = db.prepare("PRAGMA table_info(guilds)").all();
    if (!columns.some((col) => col.name === "locale")) {
        db.exec("ALTER TABLE guilds ADD COLUMN locale TEXT");
    }
}

function runMigrations(db) {
    let version = getSchemaVersion(db);

    if (version < 1) {
        migrateToV1(db);
        setSchemaVersion(db, 1);
        version = 1;
    }

    if (version < 5) {
        migrateToV5(db);
        setSchemaVersion(db, 5);
        version = 5;
    }

    if (version < 6) {
        migrateToV6(db);
        setSchemaVersion(db, 6);
        version = 6;
    }

    if (version < 7) {
        migrateToV7(db);
        setSchemaVersion(db, 7);
        version = 7;
    }

    if (version !== SCHEMA_VERSION) {
        throw new Error(
            `[Musicify] Unsupported database schema version ${version} (expected ${SCHEMA_VERSION})`
        );
    }
}

module.exports = {
    runMigrations,
    SCHEMA_VERSION,
};
