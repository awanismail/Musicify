const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const config = require("../../config");
const { getT, tEn } = require("../i18n");
const { DEFAULT_BOT_NAME } = require("../utils/guildBranding");
const { snoozeVotePrompt } = require("../utils/userPrefs");
const { markUserAsVoted } = require("./topGg");
const { clearPendingVotePrompt } = require("../utils/votePrompt");
const { resolvePlayerTextChannelId } = require("../utils/playerChannel");

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

function resolveThankYouChannelId(client, guild, guildData, player) {
    return resolvePlayerTextChannelId(client, guild, guildData, player, {
        voiceChannelId: player?.voiceChannel,
        fallbackChannelId: guildData.playerChannelId,
    });
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
    const player = client.riffy?.players.get(guildId);
    const channelId = resolveThankYouChannelId(client, guild, guildData, player);
    if (!channelId) return false;

    const channel =
        guild.channels.cache.get(channelId) ??
        (await guild.channels.fetch(channelId).catch(() => null));
    if (!channel || (typeof channel.isSendable === "function" && !channel.isSendable())) {
        return false;
    }

    const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
    const perms = channel.permissionsFor(me);
    if (!perms?.has("ViewChannel") || !perms?.has("SendMessages")) return false;

    try {
        const message = await channel.send({
            components: [buildThankYouContainer(t, userId)],
            flags: MessageFlags.IsComponentsV2,
        });

        setTimeout(() => message.delete().catch(() => {}), 15_000);
        return true;
    } catch (err) {
        console.warn(
            `[Musicify] Failed to send vote thank-you in guild ${guildId} channel ${channelId}:`,
            err.message
        );
        return false;
    }
}

async function handleVoteReceived(client, { userId, query }) {
    if (!userId || typeof userId !== "string" || !/^\d{5,}$/.test(userId)) {
        console.warn("[Musicify] Ignoring vote with invalid userId:", userId);
        return;
    }

    const guildId = parseGuildIdFromQuery(query);

    markUserAsVoted(userId);
    snoozeVotePrompt(userId, config.vote.postVoteSnoozeMs);
    await clearPendingVotePrompt(client, userId);

    const t = guildId
        ? getT.brand(guildId, client)
        : (key, params = {}) => tEn(key, { botName: DEFAULT_BOT_NAME, ...params });

    const dmSent = await sendThankYouDm(client, userId, t);
    if (!dmSent && guildId) {
        const guildSent = await sendThankYouInGuild(client, guildId, userId, t);
        if (!guildSent) {
            console.warn(
                `[Musicify] Vote thank-you could not be delivered to user ${userId}${guildId ? ` in guild ${guildId}` : ""} (DM closed or no usable channel).`
            );
        }
    } else if (!dmSent) {
        console.warn(`[Musicify] Vote thank-you DM could not be delivered to user ${userId}.`);
    }

    console.log(`[Musicify] Thanked user ${userId} for voting${guildId ? ` (guild ${guildId})` : ""}`);
}

module.exports = {
    handleVoteReceived,
    parseGuildIdFromQuery,
};
