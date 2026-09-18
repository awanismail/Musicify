const { isLavalinkAvailable } = require("./lavalink");
const { limitedResolve, PRIORITY_SUGGESTIONS, ResolveRateLimitError } = require("./resolveLimiter");
const { classifyResolveResult } = require("./resolveResult");

const AUTOCOMPLETE_PREFIX = "musicify:track:";
const CACHE_TTL_MS = 2 * 60 * 1000;
const MIN_QUERY_LENGTH = 2;
const MAX_CHOICES = 25;

/** @type {Map<string, { tracks: object[], expires: number }>} */
const autocompleteCaches = new Map();

function isYouTubeQuery(query) {
    return /(?:youtube\.com|youtu\.be)/i.test(query || "");
}

function truncate(text, max) {
    const value = (text || "").trim();
    if (value.length <= max) return value;
    return `${value.slice(0, max - 1)}…`;
}

function storeAutocompleteTracks(userId, tracks) {
    autocompleteCaches.set(userId, {
        tracks: tracks.slice(0, MAX_CHOICES),
        expires: Date.now() + CACHE_TTL_MS,
    });
}

function getCachedTrack(userId, index) {
    const entry = autocompleteCaches.get(userId);
    if (!entry || entry.expires <= Date.now()) {
        autocompleteCaches.delete(userId);
        return null;
    }
    return entry.tracks[index] ?? null;
}

function buildChoiceValue(track, index) {
    const uri = track.info?.uri;
    if (uri && uri.length <= 100 && !isYouTubeQuery(uri)) {
        return uri;
    }
    return `${AUTOCOMPLETE_PREFIX}${index}`;
}

function resolveAutocompleteSelection(userId, query) {
    if (!query?.startsWith(AUTOCOMPLETE_PREFIX)) {
        return { query, track: null };
    }

    const index = Number.parseInt(query.slice(AUTOCOMPLETE_PREFIX.length), 10);
    if (!Number.isInteger(index)) {
        return { query, track: null };
    }

    const track = getCachedTrack(userId, index);
    if (!track) {
        return { query, track: null };
    }

    return { query: track.info?.uri || query, track };
}

async function fetchPlayAutocompleteChoices(client, interaction) {
    const focused = interaction.options.getFocused()?.trim() ?? "";

    if (focused.length < MIN_QUERY_LENGTH) {
        return [];
    }

    if (isYouTubeQuery(focused) || /^https?:\/\//i.test(focused)) {
        return [];
    }

    if (!isLavalinkAvailable(client)) {
        return [];
    }

    try {
        const result = await limitedResolve(client, {
            query: focused,
            guildId: interaction.guild.id,
            userId: interaction.user.id,
            priority: PRIORITY_SUGGESTIONS,
        });

        const classified = classifyResolveResult(result, focused);
        if (classified.mode === "empty" || classified.mode === "playlist") {
            return [];
        }

        const tracks = classified.tracks.slice(0, MAX_CHOICES);
        if (!tracks.length) return [];

        storeAutocompleteTracks(interaction.user.id, tracks);

        return tracks.map((track, index) => ({
            name: truncate(
                `${track.info?.title || "Unknown"} — ${track.info?.author || "Unknown"}`,
                100
            ),
            value: buildChoiceValue(track, index),
        }));
    } catch (err) {
        if (err instanceof ResolveRateLimitError) {
            return [];
        }
        console.error("[Musicify] Play autocomplete error:", err.message);
        return [];
    }
}

module.exports = {
    fetchPlayAutocompleteChoices,
    resolveAutocompleteSelection,
    isYouTubeQuery,
};
