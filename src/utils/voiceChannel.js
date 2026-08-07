function getVoiceChannelMismatch(guildData, userVoiceChannelId, player, botVoiceChannelId = null) {
    if (
        guildData.twentyFourSeven &&
        guildData.boundVoiceChannelId &&
        guildData.boundVoiceChannelId !== userVoiceChannelId &&
        botVoiceChannelId === guildData.boundVoiceChannelId
    ) {
        return { type: "247", channelId: guildData.boundVoiceChannelId };
    }

    if (player?.voiceChannel && player.voiceChannel !== userVoiceChannelId) {
        return { type: "player", channelId: player.voiceChannel };
    }

    return null;
}

function getVoiceChannelMismatchError(guild, mismatch) {
    const channel = guild.channels.cache.get(mismatch.channelId);
    return {
        key:
            mismatch.type === "247"
                ? "errors.voiceChannel.mismatch247"
                : "errors.voiceChannel.mismatchPlayer",
        params: { name: channel?.name || "" },
        needsFallbackName: !channel?.name,
    };
}

module.exports = { getVoiceChannelMismatch, getVoiceChannelMismatchError };
