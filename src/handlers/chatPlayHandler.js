const { getGuildData } = require("../utils/playerStore");
const { playQuery } = require("../services/playQuery");
const { getT, translateError } = require("../i18n");
const { isLikelySongRequest } = require("../utils/chatPlayMessageFilter");

const FEEDBACK_DELETE_MS = 5000;
const FEEDBACK_DELETE_SHORT_MS = 3000;
const FEEDBACK_DELETE_LONG_MS = 8000;
/** Delay before removing a member's song request (avoids Discord ghost messages). */
const USER_REQUEST_DELETE_MS = 3500;

function shouldDeleteUserRequests(guildData) {
    return guildData.chatPlayDeleteMessages !== false;
}

function deleteUserRequestMessage(message) {
    setTimeout(() => {
        message.delete().catch(() => {});
    }, USER_REQUEST_DELETE_MS);
}

/** Bot confirmations/errors — always self-delete; independent of auto-delete requests setting. */
async function sendChatPlayFeedback(channel, content, timeoutMs = FEEDBACK_DELETE_MS) {
    try {
        const feedback = await channel.send({ content });
        setTimeout(() => feedback.delete().catch(() => {}), timeoutMs);
    } catch (err) {
        // Can't send in channel — ignore
    }
}

async function notifyPlayerFeedback(client, guildId, content, timeoutMs = 5000) {
    const guildData = getGuildData(guildId);
    const channelId = guildData.chatPlayChannelId || guildData.playerChannelId;
    if (!channelId) return;

    const channel = client.channels.cache.get(channelId);
    if (!channel) return;

    await sendChatPlayFeedback(channel, content, timeoutMs);
}

function formatPlayErrorFeedback(t, result) {
    const messageText = translateError(t, result.error);

    if (result.type === "duplicate") {
        return `⚠️ ${messageText}`;
    }

    const needsPrefix =
        !messageText.startsWith("❌") && !messageText.startsWith("⏳");
    return needsPrefix ? `❌ ${messageText}` : messageText;
}

/**
 * Handle ChatPlay messages
 * - Optionally deletes the member's request message (auto-delete setting)
 * - Bot feedback (errors, now playing, queue added) always self-deletes shortly
 * - Resolves the song via shared playQuery
 * - Edits the persistent ChatPlay message (never sends a new one)
 */
async function handleChatPlayMessage(client, message) {
    const guildData = getGuildData(message.guild.id);

    if (!guildData.chatPlayChannelId || message.channel.id !== guildData.chatPlayChannelId) {
        return false;
    }

    if (!guildData.chatPlayEnabled) return false;

    if (message.author.bot) return false;

    const query = message.content.trim();
    if (!query) return false;

    const deleteUserRequests = shouldDeleteUserRequests(guildData);

    const smartFilterOn = guildData.chatPlaySmartFilter !== false;
    if (smartFilterOn && !isLikelySongRequest(query)) {
        deleteUserRequestMessage(message);
        return true;
    }

    if (deleteUserRequests) {
        deleteUserRequestMessage(message);
    }

    const t = getT.forGuild(message.guild.id, client);

    const result = await playQuery(client, {
        guild: message.guild,
        member: message.member,
        query,
        textChannelId: message.channel.id,
        source: "chatplay",
        t,
    });

    if (!result.ok) {
        const feedback = formatPlayErrorFeedback(t, result);
        await sendChatPlayFeedback(
            message.channel,
            feedback,
            result.type === "lavalink_down" || result.type === "vc_mismatch"
                ? FEEDBACK_DELETE_LONG_MS
                : FEEDBACK_DELETE_MS
        );
        return true;
    }

    if (result.type === "playlist") {
        let feedbackMsg = t("chatplay.feedback.playlistAdded", {
            addedCount: result.addedCount,
            totalCount: result.totalCount,
            playlistName: result.playlistName || t("common.playlist"),
        });
        if (result.duplicates.length > 0) {
            const list = result.duplicates.slice(0, 3).join(", ");
            const suffix = result.duplicates.length > 3 ? "..." : "";
            feedbackMsg += `\n${t("chatplay.feedback.duplicatesSkipped", {
                count: result.duplicates.length,
                list: `${list}${suffix}`,
            })}`;
        }
        await sendChatPlayFeedback(message.channel, feedbackMsg);
        return true;
    }

    if (result.startedPlayback) {
        await sendChatPlayFeedback(
            message.channel,
            t("chatplay.feedback.nowPlaying", { title: result.title }),
            FEEDBACK_DELETE_SHORT_MS
        );
    } else {
        await sendChatPlayFeedback(
            message.channel,
            t("chatplay.feedback.addedToQueue", {
                title: result.title,
                position: result.queuePosition,
            }),
            FEEDBACK_DELETE_SHORT_MS
        );
    }

    return true;
}

function isChatPlayChannel(guildId, channelId) {
    const guildData = getGuildData(guildId);
    return Boolean(guildData.chatPlayChannelId && channelId === guildData.chatPlayChannelId);
}

function isActiveChatPlayChannel(guildId, channelId) {
    const guildData = getGuildData(guildId);
    return Boolean(
        guildData.chatPlayEnabled &&
        guildData.chatPlayChannelId &&
        channelId === guildData.chatPlayChannelId
    );
}

/**
 * In the ChatPlay channel, force slash/button/select replies to be ephemeral
 * so command output doesn't clutter the request channel.
 */
function applyChatPlayEphemeral(interaction) {
    if (!interaction.guild || !isChatPlayChannel(interaction.guild.id, interaction.channelId)) {
        return;
    }

    const { MessageFlags } = require("discord.js");
    const withEphemeral = (options) => {
        if (options == null) return { flags: MessageFlags.Ephemeral };
        if (typeof options === "string") {
            return { content: options, flags: MessageFlags.Ephemeral };
        }
        return { ...options, flags: (options.flags ?? 0) | MessageFlags.Ephemeral };
    };

    for (const method of ["reply", "deferReply", "followUp", "editReply"]) {
        if (typeof interaction[method] !== "function") continue;
        const original = interaction[method].bind(interaction);
        interaction[method] = (options) => original(withEphemeral(options));
    }
}

module.exports = {
    handleChatPlayMessage,
    sendChatPlayFeedback,
    notifyPlayerFeedback,
    isChatPlayChannel,
    isActiveChatPlayChannel,
    applyChatPlayEphemeral,
};
