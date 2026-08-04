const Bottleneck = require("bottleneck");
const { enrichResolveResult } = require("./resolveResult");

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
        const result = await client.riffy.resolve({ query, requester });
        return enrichResolveResult(client, query, result);
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
