const { getGuildData } = require("../utils/playerStore");
const { playQuery } = require("../services/playQuery");

async function sendChatPlayFeedback(channel, content, timeoutMs = 5000) {
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

/**
 * Handle ChatPlay messages
 * - Deletes user's message
 * - Resolves the song via shared playQuery
 * - Plays in user's VC
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

    if (guildData.chatPlayDeleteMessages !== false) {
        try {
            await message.delete();
        } catch (err) {
            console.error("[Musicify ChatPlay] Failed to delete message:", err.message);
        }
    }

    const result = await playQuery(client, {
        guild: message.guild,
        member: message.member,
        query,
        textChannelId: message.channel.id,
        source: "chatplay",
    });

    if (!result.ok) {
        const prefix =
            result.type === "duplicate"
                ? "⚠️"
                : result.message.startsWith("❌") || result.message.startsWith("⏳")
                  ? ""
                  : "❌";
        const feedback = prefix ? `${prefix} ${result.message}` : result.message;
        await sendChatPlayFeedback(
            message.channel,
            feedback,
            result.type === "lavalink_down" || result.type === "vc_mismatch" ? 8000 : 5000
        );
        return true;
    }

    if (result.type === "playlist") {
        let feedbackMsg = `✅ Added **${result.addedCount}** of **${result.totalCount}** tracks from **${result.playlistName}**!`;
        if (result.duplicates.length > 0) {
            feedbackMsg += `\n⚠️ Skipped ${result.duplicates.length} duplicate(s): ${result.duplicates.slice(0, 3).join(", ")}${result.duplicates.length > 3 ? "..." : ""}`;
        }
        await sendChatPlayFeedback(message.channel, feedbackMsg);
        return true;
    }

    if (result.startedPlayback) {
        await sendChatPlayFeedback(message.channel, `✅ Now playing **${result.title}**!`, 3000);
    } else {
        await sendChatPlayFeedback(
            message.channel,
            `✅ Added **${result.title}** — **#${result.queuePosition}** in queue!`,
            3000
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
