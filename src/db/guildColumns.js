const GUILD_COLUMN_MAP = {
    chatPlayChannelId: "chat_play_channel_id",
    chatPlayMessageId: "chat_play_message_id",
    chatPlayEnabled: "chat_play_enabled",
    chatPlaySlowmode: "chat_play_slowmode",
    chatPlayDeleteMessages: "chat_play_delete_messages",
    chatPlayPinPlayerMessage: "chat_play_pin_player_message",
    chatPlaySmartFilter: "chat_play_smart_filter",
    twentyFourSeven: "twenty_four_seven",
    boundVoiceChannelId: "bound_voice_channel_id",
    defaultVolume: "default_volume",
    defaultAutoplay: "default_autoplay",
    locale: "locale",
    djRoleIds: "dj_role_ids",
    djMode: "dj_mode",
    djQueueLimit: "dj_queue_limit",
};

const JSON_ARRAY_KEYS = new Set(["djRoleIds"]);

const INTEGER_KEYS = new Set(["djQueueLimit"]);

const BOOLEAN_KEYS = new Set([
    "chatPlayEnabled",
    "chatPlaySlowmode",
    "chatPlayDeleteMessages",
    "chatPlayPinPlayerMessage",
    "chatPlaySmartFilter",
    "twentyFourSeven",
    "defaultAutoplay",
]);

const REVERSE_MAP = Object.fromEntries(
    Object.entries(GUILD_COLUMN_MAP).map(([camel, column]) => [column, camel])
);

function camelToColumn(key) {
    return GUILD_COLUMN_MAP[key] ?? null;
}

function serializeValue(key, value) {
    if (value === null || value === undefined) {
        return null;
    }
    if (BOOLEAN_KEYS.has(key)) {
        return value ? 1 : 0;
    }
    if (JSON_ARRAY_KEYS.has(key)) {
        return JSON.stringify(Array.isArray(value) ? value : []);
    }
    if (INTEGER_KEYS.has(key)) {
        const parsed = Number.parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return value;
}

function rowToSettings(row) {
    if (!row) return {};

    const settings = {};
    for (const [column, camelKey] of Object.entries(REVERSE_MAP)) {
        const value = row[column];
        if (value === null || value === undefined) continue;

        if (BOOLEAN_KEYS.has(camelKey)) {
            settings[camelKey] = value === 1;
        } else if (JSON_ARRAY_KEYS.has(camelKey)) {
            try {
                const parsed = JSON.parse(value);
                settings[camelKey] = Array.isArray(parsed) ? parsed : [];
            } catch {
                settings[camelKey] = [];
            }
        } else if (INTEGER_KEYS.has(camelKey)) {
            const parsed = Number.parseInt(value, 10);
            settings[camelKey] = Number.isFinite(parsed) ? parsed : 0;
        } else {
            settings[camelKey] = value;
        }
    }
    return settings;
}

function settingsToColumns(settings) {
    const columns = {};
    for (const [key, value] of Object.entries(settings)) {
        const column = camelToColumn(key);
        if (!column) continue;
        columns[column] = serializeValue(key, value);
    }
    return columns;
}

module.exports = {
    GUILD_COLUMN_MAP,
    camelToColumn,
    serializeValue,
    rowToSettings,
    settingsToColumns,
};
