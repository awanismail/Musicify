const {
    MessageFlags,
    PermissionsBitField,
    ContainerBuilder,
    TextDisplayBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
} = require("discord.js");
const config = require("../../config");
const { getT } = require("../i18n");
const { getGuildData } = require("./playerStore");
const { isVotePromptSnoozed, snoozeVotePrompt } = require("./userPrefs");
const { hasUserVotedRecently, buildVoteUrl } = require("../services/topGg");

const PROMPT_TTL_MS = 2 * 60 * 1000;
const GUILD_COOLDOWN_MS = 45 * 60 * 1000;
const QUEUE_END_CHANCE = 0.18;
const SLASH_PLAY_CHANCE = 0.1;

const VOTE_PROMPT_DISMISS_ID = "vote_prompt_dismiss";
const promptDeleteTimers = new Map();
const chatPlayCounters = new Map();
const pendingVotePrompts = new Map();

function randomChatPlayThreshold() {
    return 5 + Math.floor(Math.random() * 6);
}

function resolveRequesterId(requester) {
    if (!requester) return null;
    if (typeof requester === "string") return requester;
    return requester.id ?? null;
}

function canSendInChannel(channel, me) {
    if (!channel?.isTextBased?.()) return false;
    const perms = channel.permissionsFor(me);
    return (
        perms?.has(PermissionsBitField.Flags.ViewChannel) &&
        perms?.has(PermissionsBitField.Flags.SendMessages)
    );
}

function buildVotePromptContainer(t, guildId, deleteAtUnix) {
    const container = new ContainerBuilder();

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `${t("votePrompt.heading")}\n\n${t("votePrompt.body")}`
        ),
        new TextDisplayBuilder().setContent(
            t("votePrompt.deleteNotice", { timestamp: deleteAtUnix })
        )
    );

    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel(t("common.vote"))
                .setStyle(ButtonStyle.Link)
                .setURL(buildVoteUrl(guildId)),
            new ButtonBuilder()
                .setCustomId(VOTE_PROMPT_DISMISS_ID)
                .setLabel(t("votePrompt.dismissButton"))
                .setStyle(ButtonStyle.Secondary)
        )
    );

    return container;
}

function cancelPromptDeleteTimer(messageId) {
    const timer = promptDeleteTimers.get(messageId);
    if (timer) {
        clearTimeout(timer);
        promptDeleteTimers.delete(messageId);
    }
}

async function canPromptUser(userId, guildData) {
    if (!userId) return false;
    if (isVotePromptSnoozed(userId)) return false;

    if (
        guildData.lastVotePromptAt &&
        Date.now() - guildData.lastVotePromptAt < GUILD_COOLDOWN_MS
    ) {
        return false;
    }

    if (await hasUserVotedRecently(userId)) return false;

    return true;
}

async function sendVotePrompt(client, guild, channelId, userId) {
    const guildData = getGuildData(guild.id);
    if (!(await canPromptUser(userId, guildData))) return false;

    const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
    const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
    if (!canSendInChannel(channel, me)) return false;

    const t = getT.brand(guild.id, client, guild);
    const deleteAt = Math.floor((Date.now() + PROMPT_TTL_MS) / 1000);

    try {
        const message = await channel.send({
            components: [buildVotePromptContainer(t, guild.id, deleteAt)],
            flags: MessageFlags.IsComponentsV2,
        });

        guildData.lastVotePromptAt = Date.now();
        pendingVotePrompts.set(userId, {
            guildId: guild.id,
            channelId,
            messageId: message.id,
        });

        const timer = setTimeout(() => {
            cancelPromptDeleteTimer(message.id);
            pendingVotePrompts.delete(userId);
            message.delete().catch(() => {});
        }, PROMPT_TTL_MS);

        promptDeleteTimers.set(message.id, timer);
        return true;
    } catch (err) {
        console.warn(
            `[Musicify] Failed to send vote prompt in guild ${guild.id} channel ${channelId}:`,
            err.message
        );
        return false;
    }
}

function recordChatPlaySong(guildId, userId) {
    const key = `${guildId}:${userId}`;
    let state = chatPlayCounters.get(key);
    if (!state) {
        state = { count: 0, threshold: randomChatPlayThreshold() };
        chatPlayCounters.set(key, state);
    }

    state.count += 1;
    return state.count >= state.threshold;
}

function resetChatPlayCounter(guildId, userId) {
    chatPlayCounters.set(`${guildId}:${userId}`, {
        count: 0,
        threshold: randomChatPlayThreshold(),
    });
}

function resolvePromptChannelId(guildData, player) {
    return (
        guildData.chatPlayChannelId ||
        guildData.playerChannelId ||
        player?.textChannel ||
        null
    );
}

async function maybePromptOnQueueEnd(client, guildId, player) {
    if (Math.random() > QUEUE_END_CHANCE) return;

    const guildData = getGuildData(guildId);
    const userId = guildData.lastTrackRequesterId;
    const channelId = resolvePromptChannelId(guildData, player);
    if (!userId || !channelId) return;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    await sendVotePrompt(client, guild, channelId, userId);
}

async function maybePromptOnChatPlaySong(client, guild, userId) {
    if (!recordChatPlaySong(guild.id, userId)) return;

    const guildData = getGuildData(guild.id);
    if (!guildData.chatPlayChannelId) return;

    const shown = await sendVotePrompt(
        client,
        guild,
        guildData.chatPlayChannelId,
        userId
    );
    if (shown) {
        resetChatPlayCounter(guild.id, userId);
    }
}

async function maybePromptOnSlashPlay(client, guild, channelId, userId) {
    if (Math.random() > SLASH_PLAY_CHANCE) return;

    await sendVotePrompt(client, guild, channelId, userId);
}

function rememberTrackRequester(guildId, requester) {
    const userId = resolveRequesterId(requester);
    if (!userId) return;

    getGuildData(guildId).lastTrackRequesterId = userId;
}

async function dismissVotePrompt(interaction) {
    snoozeVotePrompt(interaction.user.id, config.vote.snoozeMs);
    pendingVotePrompts.delete(interaction.user.id);
    cancelPromptDeleteTimer(interaction.message.id);

    try {
        await interaction.deferUpdate();
    } catch {
        // message may already be gone
    }

    await interaction.message.delete().catch(() => {});
}

async function clearPendingVotePrompt(client, userId) {
    const pending = pendingVotePrompts.get(userId);
    if (!pending) return;

    pendingVotePrompts.delete(userId);
    cancelPromptDeleteTimer(pending.messageId);

    try {
        const channel =
            client.channels.cache.get(pending.channelId) ??
            (await client.channels.fetch(pending.channelId).catch(() => null));
        if (!channel) return;

        const message = await channel.messages.fetch(pending.messageId).catch(() => null);
        await message?.delete().catch(() => {});
    } catch {
        // prompt already gone
    }
}

module.exports = {
    VOTE_PROMPT_DISMISS_ID,
    rememberTrackRequester,
    maybePromptOnQueueEnd,
    maybePromptOnChatPlaySong,
    maybePromptOnSlashPlay,
    dismissVotePrompt,
    clearPendingVotePrompt,
};
