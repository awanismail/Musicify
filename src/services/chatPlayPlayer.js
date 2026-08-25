const { MessageFlags, AttachmentBuilder } = require("discord.js");
const { getGuildData } = require("../utils/playerStore");
const { setGuildSetting } = require("../utils/database");
const {
    createChatPlayIdleContainer,
    createChatPlayLoadingContainer,
    createChatPlayNowPlayingContainer,
} = require("../utils/components");
const { generateMusicCard } = require("../utils/musicard");
const { getT } = require("../i18n");

async function sendChatPlayPlayerMessage(client, guild, channel, guildData, t) {
    const player = client.riffy?.players.get(guild.id);
    let container;
    let files = [];

    if (guildData.chatPlayEnabled !== false && player?.current) {
        const musicardBuffer = await generateMusicCard(player.current, player, guildData, t);
        container = createChatPlayNowPlayingContainer(
            t,
            player.current,
            player,
            guildData,
            musicardBuffer
        );
        if (musicardBuffer) {
            files.push(new AttachmentBuilder(musicardBuffer, { name: "musicard.png" }));
        }
    } else {
        container = createChatPlayIdleContainer(t, guildData);
    }

    return channel.send({
        components: [container],
        files,
        flags: MessageFlags.IsComponentsV2,
    });
}

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
        console.error("[Musicify] Failed to edit ChatPlay message, recreating:", err.message);
        return recreateChatPlayMessageContent(client, guildId, container, files);
    }
}

async function recreateChatPlayMessageContent(client, guildId, container, files = []) {
    const guildData = getGuildData(guildId);
    if (!guildData.chatPlayChannelId) return false;

    try {
        const channel = client.channels.cache.get(guildData.chatPlayChannelId);
        if (!channel) return false;

        const msg = await channel.send({
            components: [container],
            files,
            flags: MessageFlags.IsComponentsV2,
        });

        guildData.chatPlayMessageId = msg.id;
        setGuildSetting(guildId, "chatPlayMessageId", msg.id);

        if (guildData.chatPlayPinPlayerMessage) {
            const { pinChatPlayPlayerMessage } = require("../utils/chatPlaySetup");
            const t = getT.forGuild(guildId, client);
            await pinChatPlayPlayerMessage(channel, msg, channel.guild.members.me, t);
        }

        return true;
    } catch (sendErr) {
        console.error("[Musicify] Failed to recreate ChatPlay message:", sendErr.message);
        return false;
    }
}

async function showChatPlayLoading(client, guildId) {
    const t = getT.forGuild(guildId, client);
    return editChatPlayMessage(client, guildId, createChatPlayLoadingContainer(t));
}

async function refreshChatPlayPlayer(client, guildId) {
    const guildData = getGuildData(guildId);
    if (!guildData.chatPlayChannelId || !guildData.chatPlayMessageId) return;

    const t = getT.forGuild(guildId, client);

    if (!guildData.chatPlayEnabled) {
        await editChatPlayMessage(client, guildId, createChatPlayIdleContainer(t, guildData));
        return;
    }

    const player = client.riffy?.players.get(guildId);
    if (player?.current) {
        const musicardBuffer = await generateMusicCard(player.current, player, guildData, t);
        const container = createChatPlayNowPlayingContainer(
            t,
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

    await editChatPlayMessage(client, guildId, createChatPlayIdleContainer(t, guildData));
}

module.exports = {
    editChatPlayMessage,
    showChatPlayLoading,
    refreshChatPlayPlayer,
    sendChatPlayPlayerMessage,
};
