const { clearUpdateInterval } = require("./playerStore");
const { getDiscordErrorCode, isChannelAccessError } = require("./discordErrors");

function isPlayerUiBlocked(guildData) {
    return Boolean(guildData?.playerUiBlocked);
}

function markPlayerUiBlocked(guildData) {
    guildData.playerUiBlocked = true;
    clearUpdateInterval(guildData);
}

function clearPlayerUiBlocked(guildData) {
    guildData.playerUiBlocked = false;
}

function logMessageDeliveryError(guildId, channelId, err, context) {
    const code = getDiscordErrorCode(err);
    const codeSuffix = code ? ` (code ${code})` : "";
    console.error(
        `[Musicify] ${context} for guild ${guildId} channel ${channelId}${codeSuffix}:`,
        err?.message || err
    );
}

/**
 * Handle a failed player UI edit/send. Returns true when retries should stop.
 */
function handleMessageDeliveryError(guildId, channelId, err, guildData, context) {
    if (isChannelAccessError(err)) {
        if (!guildData.playerUiBlocked) {
            logMessageDeliveryError(guildId, channelId, err, context);
        }
        markPlayerUiBlocked(guildData);
        return true;
    }

    logMessageDeliveryError(guildId, channelId, err, context);
    return false;
}

module.exports = {
    isPlayerUiBlocked,
    markPlayerUiBlocked,
    clearPlayerUiBlocked,
    handleMessageDeliveryError,
};
