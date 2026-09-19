const Bottleneck = require("bottleneck");
const config = require("../../config");
const { enrichResolveResult, expandPlaylistTracks, resolveYouTubePlaylistFromMetadata } = require("./resolveResult");
const { getPreferredNode } = require("./lavalink");
const {
    preparePlayQuery,
    resolveSoundCloudEntry,
    isYouTubePlaylistQuery,
    getYouTubePlaylistResolveQueries,
    isYouTubePlaylistResolveResult,
    extractYouTubeListId,
    fetchYouTubePlaylistMetadata,
} = require("./normalizeQuery");

const PRIORITY_PLAY = 5;
const PRIORITY_SUGGESTIONS = 1;

class ResolveRateLimitError extends Error {
    constructor() {
        super("RATE_LIMIT");
        this.name = "ResolveRateLimitError";
    }
}

function checkRateLimit(guildId, userId) {
    const guildLimiter = getGuildLimiter(guildId);
    const guildCounts = guildLimiter.counts();
    if (guildCounts.QUEUED >= 8) {
        throw new ResolveRateLimitError();
    }

    if (userId) {
        const userLimiter = getUserLimiter(userId);
        const userCounts = userLimiter.counts();
        if (userCounts.RUNNING >= 2 || userCounts.QUEUED >= 1) {
            throw new ResolveRateLimitError();
        }
    }
}

const globalLimiter = new Bottleneck({
    maxConcurrent: 25,
    minTime: 25,
});

const guildLimiters = new Map();
const userLimiters = new Map();

function getGuildLimiter(guildId) {
    if (!guildLimiters.has(guildId)) {
        guildLimiters.set(
            guildId,
            new Bottleneck({
                maxConcurrent: 10,
                minTime: 100,
            })
        );
    }
    return guildLimiters.get(guildId);
}

function getUserLimiter(userId) {
    if (!userLimiters.has(userId)) {
        userLimiters.set(
            userId,
            new Bottleneck({
                maxConcurrent: 3,
                minTime: 500,
            })
        );
    }
    return userLimiters.get(userId);
}

/**
 * Run a Lavalink resolve through layered rate limiters.
 * Jobs queue rather than fail — users may wait briefly under heavy load.
 */
function limitedResolve(client, { query, requester, guildId, userId, priority = PRIORITY_PLAY }) {
    checkRateLimit(guildId, userId);

    const resolve = async () => {
        const maxTracks = config.maxPlaylistTracks || 100;
        let prepared = await preparePlayQuery(query);
        const node = getPreferredNode(client);

        if (prepared.soundcloudMatch) {
            const track = await resolveSoundCloudEntry(
                client,
                prepared.soundcloudMatch,
                requester,
                node
            );

            return {
                loadType: track ? "track" : "empty",
                tracks: track ? [track] : [],
            };
        }

        let result;
        if (isYouTubePlaylistQuery(query) || isYouTubePlaylistQuery(prepared.query)) {
            const listId = extractYouTubeListId(query) || extractYouTubeListId(prepared.query);

            if (listId) {
                const metadata = await fetchYouTubePlaylistMetadata(listId, maxTracks);
                if (metadata?.videoIds?.length) {
                    result = await resolveYouTubePlaylistFromMetadata(
                        client,
                        metadata,
                        requester,
                        node,
                        maxTracks
                    );
                    prepared.query = `https://www.youtube.com/playlist?list=${listId}`;
                }
            }

            if (!result?.tracks?.length) {
                const candidates = getYouTubePlaylistResolveQueries(prepared.query, query);
                let bestResult = null;

                for (const candidate of candidates) {
                    const attempt = await client.riffy.resolve({
                        query: candidate,
                        requester,
                        node: node ?? undefined,
                    });

                    if (isYouTubePlaylistResolveResult(attempt)) {
                        result = attempt;
                        prepared.query = candidate;
                        break;
                    }

                    if (
                        !bestResult ||
                        (attempt?.tracks?.length || 0) > (bestResult?.tracks?.length || 0)
                    ) {
                        bestResult = attempt;
                    }
                }

                result ??= bestResult ?? { loadType: "empty", tracks: [] };
            }
        } else {
            result = await client.riffy.resolve({
                query: prepared.query,
                requester,
                node: node ?? undefined,
            });
        }

        const enriched = await enrichResolveResult(client, prepared.query, result);
        return expandPlaylistTracks(client, query, enriched, maxTracks);
    };

    return globalLimiter.schedule({ priority }, () =>
        getGuildLimiter(guildId).schedule({ priority }, () => {
            if (!userId) return resolve();
            return getUserLimiter(userId).schedule({ priority }, resolve);
        })
    );
}

module.exports = {
    limitedResolve,
    PRIORITY_PLAY,
    PRIORITY_SUGGESTIONS,
    ResolveRateLimitError,
};
