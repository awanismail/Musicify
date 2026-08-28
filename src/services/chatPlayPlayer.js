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
const {
    isPlayerUiBlocked,
    clearPlayerUiBlocked,
    handleMessageDeliveryError,
} = require("../utils/playerMessageDelivery");

const recreatingChatPlay = new Set();

function isChatPlayMessage(guildData, channelId) {
    return Boolean(
        guildData.chatPlayChannelId &&
            channelId === guildData.chatPlayChannelId &&
            guildData.chatPlayMessageId
    );
}

async function persistChatPlayMessageId(guildId, messageId) {
    const guildData = getGuildData(guildId);
    guildData.chatPlayMessageId = messageId;
    setGuildSetting(guildId, "chatPlayMessageId", messageId);
}

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

async function recreateChatPlayMessage(client, guildId, container, files = []) {
    if (recreatingChatPlay.has(guildId)) return false;

    const guildData = getGuildData(guildId);
    if (!guildData.chatPlayChannelId) return false;
    if (isPlayerUiBlocked(guildData)) return false;

    recreatingChatPlay.add(guildId);
    try {
        const channel = client.channels.cache.get(guildData.chatPlayChannelId);
        if (!channel) return false;

        const msg = await channel.send({
            components: [container],
            files,
            flags: MessageFlags.IsComponentsV2,
        });

        await persistChatPlayMessageId(guildId, msg.id);
        clearPlayerUiBlocked(guildData);

        if (guildData.chatPlayPinPlayerMessage) {
            const { pinChatPlayPlayerMessage } = require("../utils/chatPlaySetup");
            const t = getT.forGuild(guildId, client);
            await pinChatPlayPlayerMessage(channel, msg, channel.guild.members.me, t);
        }

        return true;
    } catch (sendErr) {
        handleMessageDeliveryError(
            guildId,
            guildData.chatPlayChannelId,
            sendErr,
            guildData,
            "Failed to recreate ChatPlay message"
        );
        return false;
    } finally {
        recreatingChatPlay.delete(guildId);
    }
}

async function recreateChatPlayMessageFromState(client, guildId) {
    if (recreatingChatPlay.has(guildId)) return null;

    const guildData = getGuildData(guildId);
    if (!guildData.chatPlayChannelId) return null;
    if (isPlayerUiBlocked(guildData)) return null;

    recreatingChatPlay.add(guildId);
    try {
        const channel = client.channels.cache.get(guildData.chatPlayChannelId);
        if (!channel) return null;

        const t = getT.forGuild(guildId, client);
        const player = client.riffy?.players?.get(guildId);
        let container;
        let files = [];

        if (player?.current) {
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

        const chatMsg = await channel.send({
            components: [container],
            files,
            flags: MessageFlags.IsComponentsV2,
        });

        await persistChatPlayMessageId(guildId, chatMsg.id);
        clearPlayerUiBlocked(guildData);

        if (guildData.chatPlayPinPlayerMessage) {
            const { pinChatPlayPlayerMessage } = require("../utils/chatPlaySetup");
            await pinChatPlayPlayerMessage(channel, chatMsg, channel.guild.members.me, t);
        }

        return chatMsg;
    } catch (err) {
        handleMessageDeliveryError(
            guildId,
            guildData.chatPlayChannelId,
            err,
            guildData,
            "Failed to recreate ChatPlay message from state"
        );
        return null;
    } finally {
        recreatingChatPlay.delete(guildId);
    }
}

async function editChatPlayMessage(client, guildId, container, files = []) {
    const guildData = getGuildData(guildId);
    if (!guildData.chatPlayChannelId || !guildData.chatPlayMessageId) return false;
    if (isPlayerUiBlocked(guildData)) return false;

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
        clearPlayerUiBlocked(guildData);
        return true;
    } catch (err) {
        if (handleMessageDeliveryError(
            guildId,
            guildData.chatPlayChannelId,
            err,
            guildData,
            "Failed to edit ChatPlay message"
        )) {
            return false;
        }

        return recreateChatPlayMessage(client, guildId, container, files);
    }
}

async function showChatPlayLoading(client, guildId) {
    const t = getT.forGuild(guildId, client);
    return editChatPlayMessage(client, guildId, createChatPlayLoadingContainer(t));
}

async function refreshChatPlayPlayer(client, guildId) {
    const guildData = getGuildData(guildId);
    if (!guildData.chatPlayChannelId || !guildData.chatPlayMessageId) return;
    if (isPlayerUiBlocked(guildData)) return;

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
    isChatPlayMessage,
    editChatPlayMessage,
    recreateChatPlayMessage,
    recreateChatPlayMessageFromState,
    showChatPlayLoading,
    refreshChatPlayPlayer,
    sendChatPlayPlayerMessage,
};
