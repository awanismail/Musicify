const { PermissionFlagsBits } = require("discord.js");

const SETUP_TTL_MS = 15 * 60 * 1000;
const sessions = new Map();

function sessionKey(guildId, userId) {
    return `${guildId}:${userId}`;
}

function createSession(guildId, userId, channelId) {
    const key = sessionKey(guildId, userId);
    const session = {
        step: 1,
        guildId,
        userId,
        channelId,
        slowmode: true,
        deleteMessages: true,
        pinPlayerMessage: true,
        enable247: false,
        voiceChannelIdFor247: null,
        expiresAt: Date.now() + SETUP_TTL_MS,
    };
    sessions.set(key, session);
    return session;
}

function getSession(guildId, userId) {
    const key = sessionKey(guildId, userId);
    const session = sessions.get(key);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
        sessions.delete(key);
        return null;
    }
    return session;
}

function deleteSession(guildId, userId) {
    sessions.delete(sessionKey(guildId, userId));
}

function auditChannelPermissions(guild, channel) {
    const botMember = guild.members.me;
    if (!botMember) {
        return { checks: [], canProceed: false };
    }

    const perms = botMember.permissionsIn(channel);
    const checks = [
        {
            label: "View Channel",
            ok: perms.has(PermissionFlagsBits.ViewChannel),
        },
        {
            label: "Send Messages",
            ok: perms.has(PermissionFlagsBits.SendMessages),
        },
        {
            label: "Embed Links",
            ok: perms.has(PermissionFlagsBits.EmbedLinks),
        },
        {
            label: "Manage Channels",
            ok: perms.has(PermissionFlagsBits.ManageChannels),
            optional: true,
        },
    ];

    const voiceChannels = guild.channels.cache.filter((c) => c.isVoiceBased?.());
    let voiceOk = false;
    for (const vc of voiceChannels.values()) {
        const vcPerms = botMember.permissionsIn(vc);
        if (
            vcPerms.has(PermissionFlagsBits.Connect) &&
            vcPerms.has(PermissionFlagsBits.Speak)
        ) {
            voiceOk = true;
            break;
        }
    }

    checks.push({
        label: "Connect & Speak",
        ok: voiceOk,
    });

    const required = checks.filter((c) => !c.optional);
    const canProceed = required.every((c) => c.ok);

    return { checks, canProceed };
}

module.exports = {
    createSession,
    getSession,
    deleteSession,
    auditChannelPermissions,
};
