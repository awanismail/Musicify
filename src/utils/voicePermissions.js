const { PermissionFlagsBits } = require("discord.js");

function getVoicePermissionError(member, guild) {
    const voiceChannel = member?.voice?.channel;
    if (!voiceChannel) {
        return { code: "NO_VC" };
    }

    const userPerms = voiceChannel.permissionsFor(member);
    if (!userPerms?.has(PermissionFlagsBits.Connect)) {
        return { code: "USER_CONNECT" };
    }

    const botMember = guild.members.me;
    if (!botMember) {
        return { code: "BOT_MISSING" };
    }

    const botPerms = voiceChannel.permissionsFor(botMember);
    if (!botPerms?.has(PermissionFlagsBits.ViewChannel)) {
        return { code: "BOT_VIEW" };
    }
    if (!botPerms?.has(PermissionFlagsBits.Connect)) {
        return { code: "BOT_CONNECT" };
    }
    if (!botPerms?.has(PermissionFlagsBits.Speak)) {
        return { code: "BOT_SPEAK" };
    }

    return null;
}

module.exports = { getVoicePermissionError };
