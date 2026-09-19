const config = require("../../config");

const DEEZER_SHORT_LINK_PATTERN = /^https?:\/\/link\.deezer\.com\/s\/[A-Za-z0-9]+(?:[/?#]|$)/i;
const DEEZER_TRACK_URL_PATTERN =
    /^https?:\/\/(?:www\.)?deezer\.com\/(?:\w{2}\/)?track\/(\d+)(?:[/?#]|$)/i;
const DEEZER_TRACK_PATTERN = /deezer\.com\/(?:\w{2}\/)?track\/(\d+)/i;
const SOUNDCLOUD_URL_PATTERN = /^https?:\/\/(?:www\.)?(?:on\.|m\.)?soundcloud\.com\//i;
const SOUNDCLOUD_SHORT_LINK_PATTERN = /^https?:\/\/on\.soundcloud\.com\//i;
const SOUNDCLOUD_PLAYLIST_PATTERN =
    /^https?:\/\/(?:www\.)?(?:m\.)?soundcloud\.com\/[^/?]+\/(?:sets|album)\/[^/?#]+/i;
const YOUTUBE_MUSIC_URL_PATTERN = /^https?:\/\/music\.youtube\.com\//i;

const SOUNDCLOUD_RESOLVE_TIMEOUT_MS = 8000;
const MIN_MATCH_SCORE = 0.35;

async function fetchJson(url, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                Accept: "application/json",
                "User-Agent": "Musicify/1.0",
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

function splitQuery(query) {
    const trimmed = (query || "").trim();
    if (!trimmed) {
        return { firstToken: "", rest: "" };
    }

    const firstToken = trimmed.split(/\s+/)[0];
    return {
        firstToken,
        rest: trimmed.slice(firstToken.length).trim(),
    };
}

function withRest(firstToken, rest) {
    return rest ? `${firstToken} ${rest}` : firstToken;
}

function isSoundCloudUrl(url) {
    return SOUNDCLOUD_URL_PATTERN.test(url || "") || SOUNDCLOUD_SHORT_LINK_PATTERN.test(url || "");
}

function isSoundCloudPlaylistUrl(url) {
    return SOUNDCLOUD_PLAYLIST_PATTERN.test(url || "");
}

async function isSoundCloudPlaylistQuery(query) {
    const { firstToken } = splitQuery(query);
    if (!isSoundCloudUrl(firstToken) && !SOUNDCLOUD_SHORT_LINK_PATTERN.test(firstToken)) {
        return false;
    }

    const expandedUrl = (await expandSoundCloudShortLink(firstToken)) || firstToken;
    const scUrl = expandedUrl.split("?")[0];

    if (isSoundCloudPlaylistUrl(scUrl)) {
        return true;
    }

    const clientId = config.soundcloudClientId;
    if (!clientId) {
        return false;
    }

    const resolved = await fetchJson(
        `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(scUrl)}&client_id=${encodeURIComponent(clientId)}`
    );
    return resolved?.kind === "playlist";
}

function normalizeMatchText(text) {
    return (text || "")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^\p{L}\p{N}\s]/gu, "")
        .replace(/\s+/g, " ")
        .trim();
}

function textSimilarity(a, b) {
    const left = normalizeMatchText(a);
    const right = normalizeMatchText(b);
    if (!left || !right) return 0;
    if (left === right) return 1;
    if (left.includes(right) || right.includes(left)) return 0.9;

    const leftWords = new Set(left.split(" "));
    const rightWords = new Set(right.split(" "));
    let overlap = 0;
    for (const word of leftWords) {
        if (rightWords.has(word)) overlap++;
    }

    return overlap / Math.max(leftWords.size, rightWords.size, 1);
}

function durationSimilarity(expectedMs, actualMs) {
    if (!expectedMs || !actualMs) return 0;
    const diff = Math.abs(expectedMs - actualMs);
    if (diff <= 2000) return 1;
    if (diff <= 8000) return 0.6;
    if (diff <= 15000) return 0.3;
    return 0;
}

function pickBestSearchMatch(tracks, expected) {
    if (!tracks?.length) return null;
    if (!expected?.title && !expected?.author) return tracks[0];

    let bestTrack = null;
    let bestScore = -1;

    for (const track of tracks.slice(0, 8)) {
        const titleScore = textSimilarity(track.info?.title, expected.title);
        const authorScore = Math.max(
            textSimilarity(track.info?.author, expected.author),
            textSimilarity(track.info?.author, expected.permalink)
        );
        const durationScore = durationSimilarity(expected.durationMs, track.info?.length);

        const score = titleScore * 0.55 + authorScore * 0.3 + durationScore * 0.15;
        if (score > bestScore) {
            bestScore = score;
            bestTrack = track;
        }
    }

    if (bestScore >= MIN_MATCH_SCORE) return bestTrack;
    return tracks[0];
}

function getSoundCloudTrackAuthor(track) {
    return (
        track?.user?.username ||
        track?.user?.permalink ||
        track?.publisher_metadata?.artist ||
        ""
    );
}

function buildSearchQueries(author, title) {
    const cleanAuthor = (author || "").trim();
    let cleanTitle = (title || "").trim();
    if (!cleanTitle && !cleanAuthor) return [];

    if (cleanAuthor) {
        const suffix = ` by ${cleanAuthor}`;
        if (cleanTitle.toLowerCase().endsWith(suffix.toLowerCase())) {
            cleanTitle = cleanTitle.slice(0, -suffix.length).trim();
        }
    }

    const platform = config.defaultSearchPlatform || "ytmsearch";
    const queries = [];

    if (cleanAuthor && cleanTitle) {
        queries.push(`${platform}:${cleanAuthor} - ${cleanTitle}`);
        queries.push(`${platform}:${cleanTitle} ${cleanAuthor}`);
    } else if (cleanTitle) {
        queries.push(`${platform}:${cleanTitle}`);
    } else if (cleanAuthor) {
        queries.push(`${platform}:${cleanAuthor}`);
    }

    return queries.slice(0, 2);
}

function buildSoundCloudEntryFromTrack(track) {
    const author = getSoundCloudTrackAuthor(track);
    const title = track?.title?.trim() || "";
    const searches = buildSearchQueries(author, title);

    if (!searches.length) return null;

    return {
        title,
        author,
        permalink: track?.user?.permalink || null,
        durationMs: track?.duration || null,
        searches,
    };
}

function buildSoundCloudEntryFromOembed(oembed) {
    const author = oembed?.author_name?.trim() || "";
    const title = oembed?.title?.trim() || "";
    const searches = buildSearchQueries(author, title);
    if (!searches.length) return null;

    return {
        title,
        author,
        permalink: null,
        durationMs: null,
        searches,
    };
}

async function resolveWithTimeout(client, searchQuery, requester, node, timeoutMs = SOUNDCLOUD_RESOLVE_TIMEOUT_MS) {
    let timer;
    try {
        return await Promise.race([
            client.riffy.resolve({
                query: searchQuery,
                requester,
                node: node ?? undefined,
            }),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error("SOUNDCLOUD_RESOLVE_TIMEOUT")), timeoutMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function resolveSoundCloudEntry(client, entry, requester, node) {
    for (const searchQuery of entry.searches) {
        try {
            const result = await resolveWithTimeout(client, searchQuery, requester, node);
            const tracks = result?.tracks || [];
            if (!tracks.length) continue;

            const match = pickBestSearchMatch(tracks, entry);
            if (match) return match;
        } catch (err) {
            if (err.message !== "SOUNDCLOUD_RESOLVE_TIMEOUT") {
                console.error("[Musicify] SoundCloud resolve failed:", err.message);
            }
        }
    }

    return null;
}

function extractDeezerTrackUrlFromLocation(location) {
    if (!location) return null;

    const directMatch = location.match(DEEZER_TRACK_PATTERN);
    if (directMatch) {
        return `https://www.deezer.com/track/${directMatch[1]}`;
    }

    try {
        const url = new URL(location, "https://link.deezer.com");
        for (const param of ["dest", "awf", "gwf", "iwf"]) {
            const value = url.searchParams.get(param);
            if (!value) continue;
            const trackMatch = value.match(DEEZER_TRACK_PATTERN);
            if (trackMatch) {
                return `https://www.deezer.com/track/${trackMatch[1]}`;
            }
        }
    } catch {
        // ignore malformed redirect URLs
    }

    return null;
}

async function followRedirectUrl(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    try {
        const response = await fetch(url, {
            method: "HEAD",
            redirect: "manual",
            signal: controller.signal,
        });
        return response.headers.get("location");
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function expandDeezerShortLink(url) {
    return extractDeezerTrackUrlFromLocation(await followRedirectUrl(url));
}

async function expandSoundCloudShortLink(url) {
    if (!SOUNDCLOUD_SHORT_LINK_PATTERN.test(url)) return null;

    let location = await followRedirectUrl(url);
    for (let i = 0; i < 3 && location; i++) {
        if (isSoundCloudUrl(location) && !SOUNDCLOUD_SHORT_LINK_PATTERN.test(location)) {
            return location.split("?")[0];
        }
        location = await followRedirectUrl(location);
    }

    return null;
}

function normalizeDeezerTrackUrl(url) {
    const match = url.match(DEEZER_TRACK_URL_PATTERN);
    if (!match) return null;
    return `https://www.deezer.com/track/${match[1]}`;
}

function normalizeYouTubeMusicUrl(url) {
    if (!YOUTUBE_MUSIC_URL_PATTERN.test(url || "")) return url;

    try {
        const parsed = new URL(url);
        const videoId = parsed.searchParams.get("v");
        const listId = parsed.searchParams.get("list");

        // Playlist-only URLs load the full list; watch?v=&list= often returns a single track.
        if (listId) {
            return `https://www.youtube.com/playlist?list=${listId}`;
        }

        if (videoId) {
            return `https://music.youtube.com/watch?v=${videoId}`;
        }

        return `${parsed.origin}${parsed.pathname}`;
    } catch {
        return url;
    }
}

function extractYouTubeListId(url) {
    try {
        return new URL(url).searchParams.get("list");
    } catch {
        return null;
    }
}

function extractYouTubeVideoId(url) {
    try {
        return new URL(url).searchParams.get("v");
    } catch {
        return null;
    }
}

function isYouTubeMusicPlaylistUrl(url) {
    if (!YOUTUBE_MUSIC_URL_PATTERN.test(url || "")) return false;
    return /music\.youtube\.com\/playlist/i.test(url) || /\blist=/i.test(url);
}

function isYouTubePlaylistQuery(url) {
    if (!url) return false;
    if (isYouTubeMusicPlaylistUrl(url)) return true;
    if (/(?:www\.)?youtube\.com\/playlist/i.test(url)) return true;
    if (/(?:www\.)?youtube\.com\/[^#\s]*\blist=/i.test(url)) return true;
    return false;
}

function getYouTubePlaylistResolveQueries(...urls) {
    const listId = urls.map(extractYouTubeListId).find(Boolean);
    if (!listId) {
        return [...new Set(urls.filter(Boolean))];
    }

    const videoId = urls.map(extractYouTubeVideoId).find(Boolean);
    const queries = [
        `https://www.youtube.com/playlist?list=${listId}`,
        `https://music.youtube.com/playlist?list=${listId}`,
    ];

    if (videoId) {
        queries.push(`https://www.youtube.com/watch?v=${videoId}&list=${listId}`);
        queries.push(`https://music.youtube.com/watch?v=${videoId}&list=${listId}`);
    }

    return [...new Set(queries)];
}

function isYouTubePlaylistResolveResult(result) {
    const loadType = String(result?.loadType || "").toLowerCase();
    if (loadType.includes("playlist") || result?.playlistInfo?.name) {
        return true;
    }

    return (result?.tracks?.length || 0) > 1;
}

function extractYouTubeLockupVideoIds(data, maxTracks) {
    const ids = [];
    const seen = new Set();

    function walk(node) {
        if (!node || typeof node !== "object" || ids.length >= maxTracks) return;

        const contentId = node.lockupViewModel?.contentId;
        if (typeof contentId === "string" && contentId.length === 11 && !seen.has(contentId)) {
            seen.add(contentId);
            ids.push(contentId);
        }

        for (const value of Object.values(node)) {
            if (Array.isArray(value)) {
                value.forEach(walk);
            } else if (value && typeof value === "object") {
                walk(value);
            }
        }
    }

    walk(data);
    return ids;
}

async function fetchYouTubePlaylistMetadata(listId, maxTracks = 100) {
    if (!listId) return null;

    const html = await fetchText(
        `https://www.youtube.com/playlist?list=${encodeURIComponent(listId)}`
    );
    if (!html) return null;

    const match = html.match(/var ytInitialData = ({.+?});<\/script>/);
    if (!match) return null;

    try {
        const data = JSON.parse(match[1]);
        const title = data?.metadata?.playlistMetadataRenderer?.title?.trim() || null;
        const videoIds = extractYouTubeLockupVideoIds(data, maxTracks);
        if (!videoIds.length) return null;

        return { title, videoIds };
    } catch {
        return null;
    }
}

function normalizeYouTubeMusicQuery(firstToken, rest) {
    if (!YOUTUBE_MUSIC_URL_PATTERN.test(firstToken)) return null;

    const normalized = normalizeYouTubeMusicUrl(firstToken);
    return { query: withRest(normalized, rest) };
}

async function resolveSoundCloudTrackEntry(url, clientId) {
    if (clientId) {
        const resolved = await fetchJson(
            `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(url)}&client_id=${encodeURIComponent(clientId)}`
        );
        if (resolved?.kind === "track") {
            return buildSoundCloudEntryFromTrack(resolved);
        }
    }

    const oembed = await fetchJson(
        `https://soundcloud.com/oembed?url=${encodeURIComponent(url)}&format=json`
    );
    if (!oembed) return null;
    return buildSoundCloudEntryFromOembed(oembed);
}

async function normalizeDeezerQuery(firstToken, rest) {
    if (DEEZER_SHORT_LINK_PATTERN.test(firstToken)) {
        const expanded = await expandDeezerShortLink(firstToken);
        if (expanded) {
            return { query: withRest(expanded, rest) };
        }
        return null;
    }

    const normalizedTrack = normalizeDeezerTrackUrl(firstToken);
    if (normalizedTrack) {
        return { query: withRest(normalizedTrack, rest) };
    }

    return null;
}

async function normalizeSoundCloudQuery(firstToken, rest, clientId) {
    const expandedUrl = (await expandSoundCloudShortLink(firstToken)) || firstToken;
    const scUrl = expandedUrl.split("?")[0];

    if (clientId) {
        const resolved = await fetchJson(
            `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(scUrl)}&client_id=${encodeURIComponent(clientId)}`
        );

        if (resolved?.kind === "track") {
            const entry = buildSoundCloudEntryFromTrack(resolved);
            if (entry) {
                return {
                    query: entry.searches[0],
                    soundcloudMatch: entry,
                };
            }
        }
    }

    const entry = await resolveSoundCloudTrackEntry(scUrl, clientId);
    if (entry) {
        return {
            query: entry.searches[0],
            soundcloudMatch: entry,
        };
    }

    return null;
}

/**
 * Normalize platform URLs before Lavalink resolve.
 * SoundCloud track links become ytmsearch queries with metadata-aware matching.
 */
async function preparePlayQuery(query, options = {}) {
    const trimmed = (query || "").trim();
    if (!trimmed) return { query: trimmed };

    const { firstToken, rest } = splitQuery(trimmed);
    const soundcloudClientId = options.soundcloudClientId ?? config.soundcloudClientId ?? null;

    if (isSoundCloudUrl(firstToken) || SOUNDCLOUD_SHORT_LINK_PATTERN.test(firstToken)) {
        const soundcloud = await normalizeSoundCloudQuery(firstToken, rest, soundcloudClientId);
        if (soundcloud) return soundcloud;
    }

    const deezer = await normalizeDeezerQuery(firstToken, rest);
    if (deezer) return deezer;

    const youtubeMusic = normalizeYouTubeMusicQuery(firstToken, rest);
    if (youtubeMusic) return youtubeMusic;

    return { query: trimmed };
}

async function normalizePlayQuery(query, options = {}) {
    const prepared = await preparePlayQuery(query, options);
    return prepared.query;
}

module.exports = {
    preparePlayQuery,
    normalizePlayQuery,
    resolveSoundCloudEntry,
    isSoundCloudPlaylistQuery,
    pickBestSearchMatch,
    extractDeezerTrackUrlFromLocation,
    normalizeDeezerTrackUrl,
    normalizeYouTubeMusicUrl,
    isYouTubeMusicPlaylistUrl,
    isYouTubePlaylistQuery,
    getYouTubePlaylistResolveQueries,
    isYouTubePlaylistResolveResult,
    extractYouTubeListId,
    fetchYouTubePlaylistMetadata,
    isSoundCloudUrl,
};
