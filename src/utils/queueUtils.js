/**
 * Find where a track URI appears in the player (now playing or queued).
 * Queue positions are 1-indexed.
 */
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

function formatDuplicateTrackMessage(title, position) {
    const safeTitle = title || "Unknown";
    if (!position) return null;

    if (position.type === "playing") {
        return `**${safeTitle}** is already playing!`;
    }

    return `**${safeTitle}** is already in the queue at **#${position.position}**!`;
}

module.exports = {
    getTrackQueuePosition,
    formatDuplicateTrackMessage,
};
