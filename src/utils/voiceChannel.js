/**
 * Detect when a user tries to play from a different VC than the bot (or 24/7 bound channel).
 */
function getVoiceChannelMismatch(guildData, userVoiceChannelId, player) {
    if (
        guildData.twentyFourSeven &&
        guildData.boundVoiceChannelId &&
        guildData.boundVoiceChannelId !== userVoiceChannelId
    ) {
        return { type: "247", channelId: guildData.boundVoiceChannelId };
    }

    if (player?.voiceChannel && player.voiceChannel !== userVoiceChannelId) {
        return { type: "player", channelId: player.voiceChannel };
    }

    return null;
}

function formatVoiceChannelMismatch(guild, mismatch) {
    const channel = guild.channels.cache.get(mismatch.channelId);
    const name = channel?.name || "another voice channel";

    if (mismatch.type === "247") {
        return (
            `❌ 24/7 mode is connected to **${name}**.\n` +
            "-# Join that channel or use `/247` to disable 24/7 before playing here."
        );
    }

    return (
        `❌ I'm already in **${name}**.\n` +
        "-# Join that voice channel to request songs."
    );
}

module.exports = { getVoiceChannelMismatch, formatVoiceChannelMismatch };
