const { PermissionFlagsBits } = require("discord.js");

function canDeliverPlayerUi(botMember, channel) {
    if (!channel || !botMember) return false;

    if (typeof channel.isSendable === "function" && !channel.isSendable()) {
        return false;
    }

    const perms = channel.permissionsFor(botMember);
    if (!perms) return false;

    return (
        perms.has(PermissionFlagsBits.ViewChannel) &&
        perms.has(PermissionFlagsBits.SendMessages) &&
        perms.has(PermissionFlagsBits.EmbedLinks)
    );
}

function getVoiceChannel(client, guild, voiceChannelId) {
    if (!voiceChannelId) return null;
    return guild.channels.cache.get(voiceChannelId) || client.channels.cache.get(voiceChannelId) || null;
}

function isChatPlayActive(guildData) {
    return Boolean(guildData?.chatPlayChannelId && guildData.chatPlayEnabled !== false);
}

function resolvePlayerTextChannelId(client, guild, guildData, player, options = {}) {
    const { voiceChannelId, fallbackChannelId } = options;

    if (isChatPlayActive(guildData)) {
        return guildData.chatPlayChannelId;
    }

    const preferredVoiceChannelId =
        voiceChannelId || player?.voiceChannel || guildData.boundVoiceChannelId || null;

    if (preferredVoiceChannelId) {
        const voiceChannel = getVoiceChannel(client, guild, preferredVoiceChannelId);
        if (voiceChannel?.isVoiceBased?.() && canDeliverPlayerUi(guild.members.me, voiceChannel)) {
            return preferredVoiceChannelId;
        }
    }

    return fallbackChannelId || guildData.playerChannelId || player?.textChannel || null;
}

function resolveLavalinkNotifyChannelId(client, guild, guildData, player) {
    if (isChatPlayActive(guildData) && guildData.chatPlayChannelId) {
        return guildData.chatPlayChannelId;
    }

    if (guildData.playerChannelId && guildData.playerMessageId) {
        return guildData.playerChannelId;
    }

    return resolvePlayerTextChannelId(client, guild, guildData, player, {
        voiceChannelId: player?.voiceChannel || guildData.boundVoiceChannelId,
        fallbackChannelId: player?.textChannel,
    });
}

function isVoiceChannelPlayerChat(guildData, channelId, voiceChannelId) {
    return (
        !isChatPlayActive(guildData) &&
        Boolean(voiceChannelId) &&
        channelId === voiceChannelId
    );
}

module.exports = {
    canDeliverPlayerUi,
    isChatPlayActive,
    resolvePlayerTextChannelId,
    resolveLavalinkNotifyChannelId,
    isVoiceChannelPlayerChat,
};
