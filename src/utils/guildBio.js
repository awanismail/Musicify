const MAX_BIO_LENGTH = 190;
const SESSION_TTL_MS = 5 * 60 * 1000;

/** @type {Map<string, { prefill: string, serverBio: string | null, expires: number }>} */
const bioEditSessions = new Map();

function countBioLength(text) {
    return [...text].length;
}

function containsMarkdownHyperlink(text) {
    return /\[[^\]]+\]\([^)]+\)/.test(text);
}

function validateGuildMemberBio(text) {
    const trimmed = text.trim();

    if (!trimmed) {
        return { ok: true, value: null };
    }

    const length = countBioLength(trimmed);
    if (length > MAX_BIO_LENGTH) {
        return {
            ok: false,
            key: "commands.profile.bioTooLong",
            params: { length, max: MAX_BIO_LENGTH },
        };
    }

    if (containsMarkdownHyperlink(trimmed)) {
        return { ok: false, key: "commands.profile.bioHyperlinksNotAllowed" };
    }

    return { ok: true, value: trimmed };
}

function sessionKey(guildId, userId) {
    return `${guildId}:${userId}`;
}

function storeBioEditSession(guildId, userId, { prefill, serverBio }) {
    bioEditSessions.set(sessionKey(guildId, userId), {
        prefill,
        serverBio,
        expires: Date.now() + SESSION_TTL_MS,
    });
}

function consumeBioEditSession(guildId, userId) {
    const key = sessionKey(guildId, userId);
    const session = bioEditSessions.get(key);
    bioEditSessions.delete(key);

    if (!session || session.expires < Date.now()) {
        return null;
    }

    return session;
}

function resolveBioModalPrefill(serverBio, globalBio) {
    if (serverBio?.trim()) {
        return serverBio.trim();
    }
    return globalBio?.trim() || "";
}

function hasCustomServerBio(serverBio) {
    return Boolean(serverBio?.trim());
}

module.exports = {
    MAX_BIO_LENGTH,
    countBioLength,
    validateGuildMemberBio,
    storeBioEditSession,
    consumeBioEditSession,
    resolveBioModalPrefill,
    hasCustomServerBio,
};
