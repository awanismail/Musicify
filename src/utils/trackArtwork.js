const DEFAULT_ARTWORK_URL = "https://i.imgur.com/4YFmJMi.png";

function resolveTrackArtworkUrl(track) {
    const info = track?.info;
    if (!info) return DEFAULT_ARTWORK_URL;

    for (const candidate of [info.artworkUrl, info.thumbnail]) {
        if (typeof candidate === "string" && candidate.trim()) {
            return candidate.trim();
        }
    }

    return DEFAULT_ARTWORK_URL;
}

module.exports = { DEFAULT_ARTWORK_URL, resolveTrackArtworkUrl };
