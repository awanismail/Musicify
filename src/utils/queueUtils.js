function getTrackQueuePosition(player, uri) {
    if (!player || !uri) return null;

    if (player.current?.info?.uri === uri) {
        return { type: "playing" };
    }

    const index = player.queue.findIndex((t) => t.info?.uri === uri);
    if (index >= 0) {
        return { type: "queued", position: index + 1 };
    }

    return null;
}

function getDuplicateTrackError(title, position, t) {
    const safeTitle = title || (t ? t("common.unknown") : "Unknown");
    if (!position) return null;

    if (position.type === "playing") {
        return { key: "duplicate.playing", params: { title: safeTitle } };
    }

    return {
        key: "duplicate.queued",
        params: { title: safeTitle, position: position.position },
    };
}

function countUserQueuedTracks(player, userId) {
    if (!player || !userId) return 0;

    let count = 0;
    const { resolveRequesterId } = require("./permissions");
    const currentRequester = resolveRequesterId(player.current?.info?.requester);
    if (currentRequester === userId) {
        count++;
    }

    for (const track of player.queue) {
        if (resolveRequesterId(track?.info?.requester) === userId) {
            count++;
        }
    }

    return count;
}

function getRemainingQueueSlots(member, player, guildId) {
    const { getDjSettings, isDjPrivileged } = require("./permissions");
    const { djQueueLimit } = getDjSettings(guildId);

    if (!djQueueLimit || isDjPrivileged(member, guildId)) {
        return Infinity;
    }

    const used = countUserQueuedTracks(player, member?.id);
    return Math.max(0, djQueueLimit - used);
}

function getQueueLimitError(guildId) {
    const { getDjSettings } = require("./permissions");
    const { djQueueLimit } = getDjSettings(guildId);
    return {
        key: "errors.queueLimit",
        params: { limit: djQueueLimit },
    };
}

module.exports = {
    getTrackQueuePosition,
    getDuplicateTrackError,
    countUserQueuedTracks,
    getRemainingQueueSlots,
    getQueueLimitError,
};
