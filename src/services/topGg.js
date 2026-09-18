const config = require("../../config");

const VOTE_CHECK_CACHE_MS = 10 * 60 * 1000;
const voteCheckCache = new Map();

function buildVoteUrl(guildId) {
    const base = config.vote.url;
    if (!guildId) return base;
    return `${base}?guild_id=${encodeURIComponent(guildId)}`;
}

function markUserAsVoted(userId) {
    if (!userId) return;
    voteCheckCache.set(userId, {
        voted: true,
        expiresAt: Date.now() + VOTE_CHECK_CACHE_MS,
    });
}

async function hasUserVotedRecently(userId) {
    if (!userId || !config.vote?.token) return false;

    const cached = voteCheckCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.voted;
    }

    try {
        const url = `https://top.gg/api/bots/${config.vote.botId}/check?userId=${userId}`;
        const res = await fetch(url, {
            headers: { Authorization: config.vote.token },
        });

        if (!res.ok) {
            console.warn(`[Musicify] top.gg vote check failed (${res.status}) for user ${userId}`);
            return false;
        }

        const data = await res.json();
        const voted = data?.voted === 1;

        voteCheckCache.set(userId, {
            voted,
            expiresAt: Date.now() + VOTE_CHECK_CACHE_MS,
        });

        return voted;
    } catch (err) {
        console.warn(`[Musicify] top.gg vote check error for user ${userId}:`, err.message);
        return false;
    }
}

module.exports = {
    buildVoteUrl,
    hasUserVotedRecently,
    markUserAsVoted,
};
