const { MessageFlags, AttachmentBuilder } = require("discord.js");
const { getGuildData } = require("../utils/playerStore");
const {
    createChatPlayIdleContainer,
    createChatPlayLoadingContainer,
    createChatPlayNowPlayingContainer,
} = require("../utils/components");
const { generateMusicCard } = require("../utils/musicard");

async function editChatPlayMessage(client, guildId, container, files = []) {
    const guildData = getGuildData(guildId);
    if (!guildData.chatPlayChannelId || !guildData.chatPlayMessageId) return false;

    try {
        const channel = client.channels.cache.get(guildData.chatPlayChannelId);
        if (!channel) return false;

        const msg = await channel.messages.fetch(guildData.chatPlayMessageId);
        await msg.edit({
            components: [container],
            files,
            attachments: [],
            flags: MessageFlags.IsComponentsV2,
        });
        return true;
    } catch (err) {
        console.error("[Musicify] Failed to edit ChatPlay message:", err.message);
        return false;
    }
}

async function showChatPlayLoading(client, guildId) {
    return editChatPlayMessage(client, guildId, createChatPlayLoadingContainer());
}

async function refreshChatPlayPlayer(client, guildId) {
    const guildData = getGuildData(guildId);
    if (!guildData.chatPlayChannelId || !guildData.chatPlayMessageId) return;

    if (!guildData.chatPlayEnabled) {
        await editChatPlayMessage(client, guildId, createChatPlayIdleContainer(guildData));
        return;
    }

    const player = client.riffy?.players.get(guildId);
    if (player?.current) {
        const musicardBuffer = await generateMusicCard(player.current, player, guildData);
        const container = createChatPlayNowPlayingContainer(
            player.current,
            player,
            guildData,
            musicardBuffer
        );
        const files = musicardBuffer
            ? [new AttachmentBuilder(musicardBuffer, { name: "musicard.png" })]
            : [];
        await editChatPlayMessage(client, guildId, container, files);
        return;
    }

    await editChatPlayMessage(client, guildId, createChatPlayIdleContainer(guildData));
}

module.exports = {
    editChatPlayMessage,
    showChatPlayLoading,
    refreshChatPlayPlayer,
};
