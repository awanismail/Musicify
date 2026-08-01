const { getTrackQueuePosition } = require("./queueUtils");

const COLLECTION_URL_PATTERN =
    /(?:open\.spotify\.com\/(?:playlist|album|artist|collection)|spotify:(?:playlist|album|artist):|soundcloud\.com\/[^/?]+\/sets\/|(?:www\.)?deezer\.com\/(?:\w{2}\/)?(?:playlist|album|artist)|music\.apple\.com\/[^?]*\/(?:album|playlist)|tidal\.com\/browse\/(?:playlist|album|mix|artist)|(?:open\.)?qobuz\.com\/[^?]*\/(?:playlist|album|artist|track)|(?:www\.)?jiosaavn\.com\/(?:album|playlist|featured|song|show))/i;

const PLUGIN_COLLECTION_TYPES = new Set(["playlist", "album", "artist", "recommendations"]);

function isCollectionUrl(query) {
    return COLLECTION_URL_PATTERN.test(query || "");
}

function normalizeLoadType(loadType) {
    if (!loadType) return "";
    const lower = String(loadType).toLowerCase();
    if (lower === "playlist_loaded") return "playlist";
    if (lower === "search_result") return "search";
    if (lower === "track_loaded") return "track";
    return lower;
}

function toHttpCollectionUrl(query) {
    const trimmed = (query || "").trim();
    if (!trimmed) return null;

    if (/^https?:\/\//i.test(trimmed)) {
        return trimmed.split("?")[0];
    }

    const spotifyMatch = trimmed.match(/^spotify:(playlist|album|artist):([a-zA-Z0-9]+)/i);
    if (spotifyMatch) {
        const segment = spotifyMatch[1] === "artist" ? "artist" : spotifyMatch[1];
        return `https://open.spotify.com/${segment}/${spotifyMatch[2]}`;
    }

    return null;
}

function extractNameFromPluginInfo(pluginInfo) {
    if (!pluginInfo || typeof pluginInfo !== "object") return null;

    for (const key of ["name", "title", "playlistName", "albumName", "artistName"]) {
        const value = pluginInfo[key];
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
    }

    return null;
}

function extractNameFromLoadResponse(raw) {
    if (!raw) return null;

    const loadType = normalizeLoadType(raw.loadType);

    if (loadType === "playlist") {
        const name = raw.data?.info?.name ?? raw.playlistInfo?.name;
        if (typeof name === "string" && name.trim()) {
            return name.trim();
        }
    }

    const pluginInfo = raw.data?.pluginInfo ?? raw.pluginInfo ?? null;
    return extractNameFromPluginInfo(pluginInfo);
}

async function fetchJson(url, timeoutMs = 5000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) return null;
        return await response.json();
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Fallback when Lavalink/LavaSrc returns a collection as search with no playlistInfo.name.
 */
async function fetchCollectionTitleFromUrl(query) {
    const url = toHttpCollectionUrl(query);
    if (!url) return null;

    if (/open\.spotify\.com\//i.test(url)) {
        const data = await fetchJson(
            `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`
        );
        return data?.title?.trim() || null;
    }

    const deezerMatch = url.match(/deezer\.com\/(?:\w{2}\/)?playlist\/(\d+)/i);
    if (deezerMatch) {
        const data = await fetchJson(`https://api.deezer.com/playlist/${deezerMatch[1]}`);
        return data?.title?.trim() || null;
    }

    if (/soundcloud\.com\/[^/?]+\/sets\//i.test(url)) {
        const data = await fetchJson(
            `https://soundcloud.com/oembed?url=${encodeURIComponent(url)}&format=json`
        );
        return data?.title?.trim() || null;
    }

    return null;
}

/**
 * Decide whether a Lavalink resolve should queue multiple tracks.
 * Spotify and other platform playlists sometimes come back as "search" instead of "playlist".
 */
function classifyResolveResult(result, query) {
    const { loadType, tracks = [], playlistInfo, pluginInfo } = result;
    const normalizedType = normalizeLoadType(loadType);

    if (
        normalizedType === "empty" ||
        loadType === "NO_MATCHES" ||
        normalizedType === "error" ||
        loadType === "LOAD_FAILED" ||
        !tracks.length
    ) {
        return { mode: "empty", tracks: [], playlistInfo: null };
    }

    const pluginType = pluginInfo?.type;
    const isPluginCollection = PLUGIN_COLLECTION_TYPES.has(pluginType);

    if (
        normalizedType === "playlist" ||
        playlistInfo?.name ||
        isPluginCollection
    ) {
        return { mode: "playlist", tracks, playlistInfo };
    }

    if (isCollectionUrl(query) && tracks.length > 1) {
        return {
            mode: "playlist",
            tracks,
            playlistInfo,
        };
    }

    return { mode: "single", tracks, playlistInfo: null };
}

function getPlaylistDisplayName(playlistInfo) {
    const name = playlistInfo?.name?.trim();
    return name || "Playlist";
}

/**
 * Riffy sometimes omits playlistInfo for collection URLs (especially loadType "search").
 * Re-fetch from Lavalink and fall back to platform oEmbed/API when needed.
 */
async function enrichResolveResult(client, query, result) {
    if (result.playlistInfo?.name?.trim()) return result;
    if (!isCollectionUrl(query)) return result;

    let name =
        extractNameFromPluginInfo(result.pluginInfo) ||
        extractNameFromLoadResponse(result);

    let mergedPluginInfo = result.pluginInfo || {};

    const node = client.riffy?.leastUsedNodes?.[0];
    if (!name && node) {
        const identifier = /^https?:\/\//i.test(query)
            ? query
            : `${client.riffy.defaultSearchPlatform}:${query}`;

        try {
            const raw = await node.rest.makeRequest(
                "GET",
                `/${node.rest.version}/loadtracks?identifier=${encodeURIComponent(identifier)}`
            );

            name = extractNameFromLoadResponse(raw);
            const pluginInfo = raw?.data?.pluginInfo ?? raw?.pluginInfo ?? null;
            if (pluginInfo) {
                mergedPluginInfo = { ...mergedPluginInfo, ...pluginInfo };
            }
        } catch (err) {
            console.error("[Musicify] Failed to enrich playlist info:", err.message);
        }
    }

    if (!name) {
        name = await fetchCollectionTitleFromUrl(query);
    }

    if (!name) return result;

    return {
        ...result,
        playlistInfo: { ...(result.playlistInfo || {}), name },
        pluginInfo: mergedPluginInfo,
    };
}

function queueResolvedTracks(player, tracks, requester) {
    const duplicates = [];
    const addedTracks = [];

    for (const track of tracks) {
        track.info.requester = requester;

        const position = getTrackQueuePosition(player, track.info.uri);

        if (position) {
            duplicates.push(track.info.title || "Unknown");
        } else {
            player.queue.add(track);
            addedTracks.push(track.info.title || "Unknown");
        }
    }

    return { duplicates, addedTracks };
}

module.exports = {
    isCollectionUrl,
    classifyResolveResult,
    enrichResolveResult,
    getPlaylistDisplayName,
    queueResolvedTracks,
};
