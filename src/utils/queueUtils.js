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

module.exports = {
    getTrackQueuePosition,
    getDuplicateTrackError,
};
