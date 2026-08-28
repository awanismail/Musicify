function getDiscordErrorCode(err) {
    if (!err) return null;
    if (typeof err.code === "number") return err.code;
    if (typeof err.rawError?.code === "number") return err.rawError.code;
    return null;
}

/** Discord errors that won't resolve by retrying message delivery. */
function isChannelAccessError(err) {
    const code = getDiscordErrorCode(err);
    return code === 50001 || code === 50013 || code === 10003;
}

module.exports = {
    getDiscordErrorCode,
    isChannelAccessError,
};
