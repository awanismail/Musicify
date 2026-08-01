const { PermissionFlagsBits } = require("discord.js");

function getVoicePermissionError(member, guild) {
    const voiceChannel = member?.voice?.channel;
    if (!voiceChannel) {
        return {
            code: "NO_VC",
            message: "❌ You need to join a voice channel first!",
        };
    }

    const userPerms = voiceChannel.permissionsFor(member);
    if (!userPerms?.has(PermissionFlagsBits.Connect)) {
        return {
            code: "USER_CONNECT",
            message:
                "❌ You don't have **Connect** permission in that voice channel.\n" +
                "-# Join a channel you can connect to, or ask a moderator for access.",
        };
    }

    const botMember = guild.members.me;
    if (!botMember) {
        return {
            code: "BOT_MISSING",
            message: "❌ Something went wrong checking bot permissions. Try again.",
        };
    }

    const botPerms = voiceChannel.permissionsFor(botMember);
    if (!botPerms?.has(PermissionFlagsBits.ViewChannel)) {
        return {
            code: "BOT_VIEW",
            message:
                "❌ I can't see that voice channel.\n" +
                "-# Grant **View Channel** for the bot in that channel.",
        };
    }
    if (!botPerms?.has(PermissionFlagsBits.Connect)) {
        return {
            code: "BOT_CONNECT",
            message:
                "❌ I don't have **Connect** permission in your voice channel.\n" +
                "-# Ask a moderator to grant Connect (and Speak) for Musicify.",
        };
    }
    if (!botPerms?.has(PermissionFlagsBits.Speak)) {
        return {
            code: "BOT_SPEAK",
            message:
                "❌ I don't have **Speak** permission in your voice channel.\n" +
                "-# Ask a moderator to grant Speak for Musicify.",
        };
    }

    return null;
}

module.exports = { getVoicePermissionError };
