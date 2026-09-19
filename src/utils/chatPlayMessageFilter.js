const CHAT_BLOCKLIST = new Set([
    "lol",
    "lmao",
    "lmfao",
    "rofl",
    "brb",
    "gtg",
    "g2g",
    "bbl",
    "ttyl",
    "afk",
    "ty",
    "thx",
    "thanks",
    "np",
    "nvm",
    "idk",
    "ikr",
    "tbh",
    "imo",
    "imho",
    "gg",
    "rip",
    "oof",
    "ok",
    "k",
    "kk",
    "yes",
    "no",
    "yep",
    "nah",
    "yea",
    "yup",
    "nope",
    "hi",
    "sup",
    "yo",
    "wtf",
    "wth",
    "omg",
    "omfg",
    "hmm",
    "mhm",
    "ugh",
    "meh",
    "gn",
    "gm",
    "same",
    "true",
    "false",
    "maybe",
    "sure",
    "fr",
    "ong",
    "bet",
    "cap",
    "sus",
    "ratio",
    "l",
    "w",
    "+1",
    "-1",
]);

const URL_PATTERN = /(?:https?:\/\/|spotify:|soundcloud\.com|deezer\.com|music\.apple\.com|music\.youtube\.com|tidal\.com)/i;
const DISCORD_MENTION_PATTERN = /^<(@[!&]?|#\d+|@everyone|@here)/;
const CUSTOM_EMOJI_PATTERN = /^<a?:\w+:\d+>$/;
const UNICODE_EMOJI_PATTERN =
    /^(?:\p{Extended_Pictographic}|\u200d|\ufe0f|\u20e3|\s)+$/u;
const PUNCTUATION_ONLY_PATTERN = /^[\s\p{P}\p{S}]+$/u;
const SINGLE_TOKEN_MAX_LENGTH = 12;

function normalizeChatToken(text) {
    return text
        .toLowerCase()
        .replace(/[\s._\-!?,…]+/g, "")
        .replace(/(.)\1+/g, "$1");
}

function isBlockedChatToken(text) {
    const normalized = normalizeChatToken(text);
    if (!normalized || normalized.length > SINGLE_TOKEN_MAX_LENGTH) {
        return false;
    }
    return CHAT_BLOCKLIST.has(normalized);
}

function isLikelySongRequest(content) {
    const trimmed = (content || "").trim();
    if (!trimmed) return false;

    // Keep the filter conservative: known music links always pass, and only
    // obvious chat-only messages are rejected. Everything else is searchable.
    if (URL_PATTERN.test(trimmed)) {
        return true;
    }

    if (UNICODE_EMOJI_PATTERN.test(trimmed) || CUSTOM_EMOJI_PATTERN.test(trimmed)) {
        return false;
    }

    if (PUNCTUATION_ONLY_PATTERN.test(trimmed)) {
        return false;
    }

    const withoutMentions = trimmed.replace(/<@!?(\d+)>/g, "").replace(/<@&(\d+)>/g, "").trim();
    if (!withoutMentions && DISCORD_MENTION_PATTERN.test(trimmed)) {
        return false;
    }

    if (isBlockedChatToken(trimmed)) {
        return false;
    }

    return true;
}

module.exports = {
    isLikelySongRequest,
    normalizeChatToken,
    isBlockedChatToken,
    CHAT_BLOCKLIST,
};
