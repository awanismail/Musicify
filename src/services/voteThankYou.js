const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const config = require("../../config");
const { getT, tEn } = require("../i18n");
const { snoozeVotePrompt } = require("../utils/userPrefs");
const { markUserAsVoted } = require("./topGg");
const { clearPendingVotePrompt } = require("../utils/votePrompt");

function parseGuildIdFromQuery(query) {
    if (!query) return null;

    const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
    const guildId = params.get("guild_id");
    return guildId || null;
}

function buildThankYouContainer(t, userId = null) {
    const container = new ContainerBuilder();
    const content = userId
        ? t("votePrompt.thankYouChannel", { user: `<@${userId}>` })
        : t("votePrompt.thankYouDm");

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    return container;
}

function resolveThankYouChannelId(guildData) {
    return guildData.chatPlayChannelId || guildData.playerChannelId || null;
}

async function sendThankYouDm(client, userId, t) {
    try {
        const user = await client.users.fetch(userId);
        await user.send({
            components: [buildThankYouContainer(t)],
            flags: MessageFlags.IsComponentsV2,
        });
        return true;
    } catch {
        return false;
    }
}

async function sendThankYouInGuild(client, guildId, userId, t) {
    const guild = client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId).catch(() => null));
    if (!guild) return false;

    const guildData = require("../utils/playerStore").getGuildData(guildId);
    const channelId = resolveThankYouChannelId(guildData);
    if (!channelId) return false;

    const channel =
        guild.channels.cache.get(channelId) ??
        (await guild.channels.fetch(channelId).catch(() => null));
    if (!channel?.isTextBased?.()) return false;

    const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
    const perms = channel.permissionsFor(me);
    if (!perms?.has("ViewChannel") || !perms?.has("SendMessages")) return false;

    const message = await channel.send({
        components: [buildThankYouContainer(t, userId)],
        flags: MessageFlags.IsComponentsV2,
    });

    setTimeout(() => message.delete().catch(() => {}), 15_000);
    return true;
}

async function handleVoteReceived(client, { userId, query }) {
    if (!userId) return;

    const guildId = parseGuildIdFromQuery(query);

    markUserAsVoted(userId);
    snoozeVotePrompt(userId, config.vote.postVoteSnoozeMs);
    await clearPendingVotePrompt(client, userId);

    const t = guildId
        ? getT.forGuild(guildId, client)
        : (key, params) => tEn(key, params);

    const dmSent = await sendThankYouDm(client, userId, t);
    if (!dmSent && guildId) {
        await sendThankYouInGuild(client, guildId, userId, t);
    }

    console.log(`[Musicify] Thanked user ${userId} for voting${guildId ? ` (guild ${guildId})` : ""}`);
}

module.exports = {
    handleVoteReceived,
    parseGuildIdFromQuery,
};
