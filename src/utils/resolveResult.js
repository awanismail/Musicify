const config = require("../../config");
const { getPreferredNode } = require("./lavalink");
const { getTrackQueuePosition } = require("./queueUtils");

const COLLECTION_URL_PATTERN =
    /(?:open\.spotify\.com\/(?:playlist|album|artist|collection)|spotify:(?:playlist|album|artist):|soundcloud\.com\/[^/?]+\/sets\/|(?:www\.)?deezer\.com\/(?:\w{2}\/)?(?:playlist|album|artist)|music\.apple\.com\/[^?]*\/(?:album|playlist)|music\.youtube\.com\/playlist|music\.youtube\.com\/[^#\s]*\blist=|(?:www\.)?youtube\.com\/playlist|(?:www\.)?youtube\.com\/[^#\s]*\blist=|tidal\.com\/browse\/(?:playlist|album|mix|artist)|(?:open\.)?qobuz\.com\/[^?]*\/(?:playlist|album|artist|track)|(?:www\.)?jiosaavn\.com\/(?:album|playlist|featured|song|show))/i;

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

    if (/(?:music\.)?youtube\.com\/(?:playlist|[^#\s]*\blist=)/i.test(query || "") && tracks.length > 0) {
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

    const node = getPreferredNode(client);
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

async function fetchDeezerTrackUrls(query, maxTracks) {
    const url = toHttpCollectionUrl(query);
    if (!url) return null;

    const playlistMatch = url.match(/deezer\.com\/(?:\w{2}\/)?playlist\/(\d+)/i);
    if (playlistMatch) {
        const data = await fetchJson(
            `https://api.deezer.com/playlist/${playlistMatch[1]}/tracks?limit=${maxTracks}`
        );
        return data?.data?.map((track) => `https://www.deezer.com/track/${track.id}`) || null;
    }

    const albumMatch = url.match(/deezer\.com\/(?:\w{2}\/)?album\/(\d+)/i);
    if (albumMatch) {
        const data = await fetchJson(
            `https://api.deezer.com/album/${albumMatch[1]}/tracks?limit=${maxTracks}`
        );
        return data?.data?.map((track) => `https://www.deezer.com/track/${track.id}`) || null;
    }

    return null;
}

function getTrackIdentity(track) {
    if (track?.info?.uri) return track.info.uri;
    return `${track?.info?.author || ""}|${track?.info?.title || ""}`;
}

function shouldExpandPlaylist(query, result, maxTracks) {
    if (!isCollectionUrl(query) || !result?.tracks?.length) return false;
    if (result.tracks.length >= maxTracks) return false;

    const totalTracks = result.pluginInfo?.totalTracks;
    if (typeof totalTracks === "number" && totalTracks > result.tracks.length) {
        return true;
    }

    // Lavalink/LavaSrc album pages are commonly capped at 50 tracks.
    return /deezer\.com\/(?:\w{2}\/)?(?:playlist|album)\//i.test(query || "");
}

const YOUTUBE_RESOLVE_BATCH_SIZE = 4;
const YOUTUBE_EXPAND_DEADLINE_MS = 90000;
const YOUTUBE_TRACK_RESOLVE_TIMEOUT_MS = 12000;

/**
 * Lavalink on many hosts cannot load YouTube playlists (playlist URLs error, watch URLs return 1 track).
 * Fetch the video list from YouTube directly, then resolve each track via YT Music URLs.
 */
async function resolveYouTubePlaylistFromMetadata(
    client,
    metadata,
    requester,
    node,
    maxTracks = config.maxPlaylistTracks || 100
) {
    const { title, videoIds } = metadata;
    const tracks = [];
    const identities = new Set();
    const deadline = Date.now() + YOUTUBE_EXPAND_DEADLINE_MS;

    for (let index = 0; index < videoIds.length && tracks.length < maxTracks; index += YOUTUBE_RESOLVE_BATCH_SIZE) {
        if (Date.now() >= deadline) break;

        const batch = videoIds.slice(index, index + YOUTUBE_RESOLVE_BATCH_SIZE);
        const resolvedBatch = await Promise.all(
            batch.map(async (videoId) => {
                try {
                    const result = await Promise.race([
                        client.riffy.resolve({
                            query: `https://music.youtube.com/watch?v=${videoId}`,
                            requester,
                            node: node ?? undefined,
                        }),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error("YT_TRACK_TIMEOUT")), YOUTUBE_TRACK_RESOLVE_TIMEOUT_MS)
                        ),
                    ]);
                    return result?.tracks?.[0] ?? null;
                } catch {
                    return null;
                }
            })
        );

        for (const track of resolvedBatch) {
            if (!track || tracks.length >= maxTracks) continue;

            const identity = getTrackIdentity(track);
            if (identities.has(identity)) continue;

            identities.add(identity);
            tracks.push(track);
        }
    }

    if (!tracks.length) {
        return { loadType: "empty", tracks: [], playlistInfo: null };
    }

    return {
        loadType: "playlist",
        tracks,
        playlistInfo: { name: title || "Playlist" },
        pluginInfo: { type: "playlist", totalTracks: videoIds.length },
    };
}

/**
 * Lavalink often returns only the first page (e.g. 50 tracks) for albums/playlists.
 * Fetch the full list from platform APIs and resolve any missing tracks up to maxTracks.
 */
async function expandPlaylistTracks(client, query, result, maxTracks = config.maxPlaylistTracks || 100) {
    if (!shouldExpandPlaylist(query, result, maxTracks)) {
        if (result?.tracks?.length > maxTracks) {
            return { ...result, tracks: result.tracks.slice(0, maxTracks) };
        }
        return result;
    }

    const trackUrls = await fetchDeezerTrackUrls(query, maxTracks);
    if (!trackUrls?.length) {
        return { ...result, tracks: result.tracks.slice(0, maxTracks) };
    }

    const identities = new Set(result.tracks.map(getTrackIdentity));
    const merged = [...result.tracks];
    const node = getPreferredNode(client);
    const deadline = Date.now() + 60000;

    for (const trackUrl of trackUrls) {
        if (merged.length >= maxTracks || Date.now() >= deadline) break;

        const idMatch = trackUrl.match(/track\/(\d+)/i);
        if (
            idMatch &&
            merged.some((track) => String(track.info?.identifier || track.info?.uri || "").includes(idMatch[1]))
        ) {
            continue;
        }

        try {
            const extra = await Promise.race([
                client.riffy.resolve({
                    query: trackUrl,
                    node: node ?? undefined,
                }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("EXPAND_TRACK_TIMEOUT")), 10000)
                ),
            ]);
            const track = extra?.tracks?.[0];
            if (!track) continue;

            const identity = getTrackIdentity(track);
            if (identities.has(identity)) continue;

            identities.add(identity);
            merged.push(track);
        } catch (err) {
            if (err.message !== "EXPAND_TRACK_TIMEOUT") {
                console.error("[Musicify] Failed to expand playlist track:", err.message);
            }
        }
    }

    return { ...result, tracks: merged.slice(0, maxTracks) };
}

function queueResolvedTracks(player, tracks, requester, translator) {
    const unknown = translator ? translator("common.unknown") : "Unknown";
    const duplicates = [];
    const addedTracks = [];
    const maxTracks = config.maxPlaylistTracks || 100;

    for (const track of tracks.slice(0, maxTracks)) {
        track.info.requester = requester;

        const position = getTrackQueuePosition(player, track.info.uri);

        if (position) {
            duplicates.push(track.info.title || unknown);
        } else {
            player.queue.add(track);
            addedTracks.push(track.info.title || unknown);
        }
    }

    return { duplicates, addedTracks };
}

module.exports = {
    isCollectionUrl,
    classifyResolveResult,
    enrichResolveResult,
    expandPlaylistTracks,
    resolveYouTubePlaylistFromMetadata,
    getPlaylistDisplayName,
    queueResolvedTracks,
};
