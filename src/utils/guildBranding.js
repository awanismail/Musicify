const { TextDisplayBuilder, SeparatorBuilder } = require("discord.js");

const DEFAULT_BOT_NAME = "Musicify";

function getBotMember(guild, client) {
    if (!guild || !client?.user) return null;
    return guild.members?.me ?? guild.members?.cache?.get(client.user.id) ?? null;
}

/**
 * Resolve the bot's display name in a guild (custom nick, else global name, else default brand).
 */
function resolveBotDisplayName(guild, client, fallback = DEFAULT_BOT_NAME) {
    if (!client?.user) return fallback;

    const member = getBotMember(guild, client);
    if (member?.displayName) return member.displayName;

    return client.user.displayName || client.user.username || fallback;
}

/**
 * Prefer guild avatar when the bot has a server-specific profile image.
 */
function resolveBotAvatarUrl(guild, client, options = { size: 256 }) {
    if (!client?.user) return null;

    const member = getBotMember(guild, client);
    if (member) {
        return member.displayAvatarURL(options);
    }

    return client.user.displayAvatarURL(options);
}

function resolveBotInviteUrl(client) {
    const clientId =
        client?.user?.id ||
        process.env.CLIENT_ID ||
        process.env.TOP_GG_BOT_ID ||
        null;

    if (!clientId) {
        return "https://discord.com/oauth2/authorize";
    }

    return `https://discord.com/oauth2/authorize?client_id=${clientId}`;
}

/**
 * True when the bot has a custom server nick, avatar, or banner via /profile.
 */
function hasCustomGuildBranding(guild, client) {
    const member = getBotMember(guild, client);
    if (!member) return false;

    return Boolean(member.nickname || member.avatar || member.banner || member.bio);
}

function getBrandWatermarkContent(t, client) {
    return t("common.brandWatermark", {
        inviteUrl: resolveBotInviteUrl(client),
        brandName: DEFAULT_BOT_NAME,
    });
}

function maybeAppendBrandWatermark(container, t, guild, client) {
    if (!container || !t || !hasCustomGuildBranding(guild, client)) {
        return container;
    }

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(getBrandWatermarkContent(t, client))
    );

    return container;
}

function resolveGuild(client, guildId, guild = null) {
    return guild ?? client?.guilds?.cache?.get(guildId) ?? null;
}

module.exports = {
    DEFAULT_BOT_NAME,
    getBotMember,
    resolveBotDisplayName,
    resolveBotAvatarUrl,
    resolveBotInviteUrl,
    hasCustomGuildBranding,
    getBrandWatermarkContent,
    maybeAppendBrandWatermark,
    resolveGuild,
};
