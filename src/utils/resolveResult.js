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

async function fetchJson(url, timeoutMs = 5000, headers = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                Accept: "application/json",
                "User-Agent": "Musicify/1.0",
                ...headers,
            },
        });
        if (!response.ok) return null;
        return await response.json();
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function fetchText(url, timeoutMs = 10000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                Accept: "text/html,application/xhtml+xml",
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
        });
        if (!response.ok) return null;
        return await response.text();
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

function parseSpotifyCollectionQuery(query) {
    const url = toHttpCollectionUrl(query);
    if (!url) return null;

    const playlistMatch = url.match(/open\.spotify\.com\/playlist\/([a-zA-Z0-9]+)/i);
    if (playlistMatch) {
        return { type: "playlist", id: playlistMatch[1] };
    }

    const albumMatch = url.match(/open\.spotify\.com\/album\/([a-zA-Z0-9]+)/i);
    if (albumMatch) {
        return { type: "album", id: albumMatch[1] };
    }

    return null;
}

function isSpotifyCollectionQuery(query) {
    return Boolean(parseSpotifyCollectionQuery(query));
}

function spotifyTrackIdFromUrl(trackUrl) {
    return trackUrl.match(/(?:open\.spotify\.com\/track\/|spotify:track:)([a-zA-Z0-9]+)/i)?.[1] || null;
}

let spotifyTokenCache = { token: null, expiresAt: 0 };

async function getSpotifyAccessToken() {
    const clientId = config.spotifyClientId;
    const clientSecret = config.spotifyClientSecret;
    if (!clientId || !clientSecret) return null;

    if (spotifyTokenCache.token && Date.now() < spotifyTokenCache.expiresAt - 60_000) {
        return spotifyTokenCache.token;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    try {
        const response = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            signal: controller.signal,
            headers: {
                Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({ grant_type: "client_credentials" }),
        });

        if (!response.ok) return null;

        const data = await response.json();
        spotifyTokenCache = {
            token: data.access_token,
            expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
        };

        return spotifyTokenCache.token;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function fetchSpotifyApiTrackUrls(collection, maxTracks, token) {
    const urls = [];
    let offset = 0;
    const pageSize = 50;

    while (urls.length < maxTracks) {
        const limit = Math.min(pageSize, maxTracks - urls.length);
        const endpoint =
            collection.type === "album"
                ? `https://api.spotify.com/v1/albums/${collection.id}/tracks?limit=${limit}&offset=${offset}`
                : `https://api.spotify.com/v1/playlists/${collection.id}/tracks?limit=${limit}&offset=${offset}&fields=items(track(uri,type)),next`;

        const data = await fetchJson(endpoint, 8000, {
            Authorization: `Bearer ${token}`,
        });

        const items = data?.items || [];
        if (!items.length) break;

        for (const item of items) {
            const track = collection.type === "album" ? item : item?.track;
            if (track?.type !== "track" && collection.type !== "album") continue;

            const trackId = track?.id || track?.uri?.replace("spotify:track:", "");
            if (!trackId) continue;

            urls.push(`https://open.spotify.com/track/${trackId}`);
            if (urls.length >= maxTracks) break;
        }

        if (urls.length >= maxTracks || items.length < limit) break;
        if (collection.type === "playlist" && !data?.next) break;

        offset += limit;
    }

    return urls.length ? urls : null;
}

async function fetchSpotifyEmbedTrackUrls(collection, maxTracks) {
    if (collection.type !== "playlist") return null;

    const html = await fetchText(`https://open.spotify.com/embed/playlist/${collection.id}`);
    if (!html) return null;

    const ids = [...html.matchAll(/spotify:track:([a-zA-Z0-9]+)/g)].map((match) => match[1]);
    const uniqueIds = [...new Set(ids)].slice(0, maxTracks);
    if (!uniqueIds.length) return null;

    return uniqueIds.map((id) => `https://open.spotify.com/track/${id}`);
}

async function fetchSpotifyTrackUrls(query, maxTracks) {
    const collection = parseSpotifyCollectionQuery(query);
    if (!collection) return null;

    const token = await getSpotifyAccessToken();
    if (token) {
        const apiUrls = await fetchSpotifyApiTrackUrls(collection, maxTracks, token);
        if (apiUrls?.length) return apiUrls;
    }

    return fetchSpotifyEmbedTrackUrls(collection, maxTracks);
}

async function fetchCollectionTrackUrls(query, maxTracks) {
    return (await fetchSpotifyTrackUrls(query, maxTracks)) || (await fetchDeezerTrackUrls(query, maxTracks));
}

function trackUrlAlreadyPresent(merged, trackUrl) {
    const trackId = trackUrl.match(/track\/([a-zA-Z0-9]+)/i)?.[1];
    if (!trackId) return false;

    return merged.some((track) => {
        const identifier = String(track.info?.identifier || track.info?.uri || "");
        return identifier.includes(trackId);
    });
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
    if (/deezer\.com\/(?:\w{2}\/)?(?:playlist|album)\//i.test(query || "")) {
        return true;
    }

    if (isSpotifyCollectionQuery(query) && result.tracks.length < maxTracks) {
        return true;
    }

    return false;
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

    const trackUrls = await fetchCollectionTrackUrls(query, maxTracks);
    if (!trackUrls?.length) {
        return { ...result, tracks: result.tracks.slice(0, maxTracks) };
    }

    const identities = new Set(result.tracks.map(getTrackIdentity));
    const merged = [...result.tracks];
    const node = getPreferredNode(client);
    const deadline = Date.now() + 60000;

    for (const trackUrl of trackUrls) {
        if (merged.length >= maxTracks || Date.now() >= deadline) break;

        if (trackUrlAlreadyPresent(merged, trackUrl)) {
            continue;
        }

        const spotifyId = spotifyTrackIdFromUrl(trackUrl);
        if (spotifyId && identities.has(`https://open.spotify.com/track/${spotifyId}`)) {
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
