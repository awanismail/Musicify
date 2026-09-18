const { MessageFlags } = require("discord.js");
const { getGuildData } = require("./playerStore");
const { canControlMusic, VOICE_CHANNEL_DENIAL_KEY } = require("./permissions");
const { buildErrorContainer, ephemeralV2 } = require("./replies");

async function requirePlayerControl(interaction, client, t, { requireCurrent = false } = {}) {
    const player = client.riffy.players.get(interaction.guild.id);

    if (!player || (requireCurrent && !player.current)) {
        await interaction.reply(
            ephemeralV2(
                buildErrorContainer(
                    t(requireCurrent ? "errors.nothingPlaying" : "errors.noActivePlayer"),
                    t
                )
            )
        );
        return null;
    }

    if (!interaction.member.voice?.channel) {
        await interaction.reply(
            ephemeralV2(buildErrorContainer(t("errors.voiceChannelRequired"), t))
        );
        return null;
    }

    if (!canControlMusic(interaction.member, player)) {
        await interaction.reply({
            content: t(VOICE_CHANNEL_DENIAL_KEY),
            flags: MessageFlags.Ephemeral,
        });
        return null;
    }

    return { player, guildData: getGuildData(interaction.guild.id) };
}

async function requireVoiceForPlay(interaction, t) {
    if (!interaction.member.voice?.channel) {
        await interaction.reply(
            ephemeralV2(buildErrorContainer(t("errors.voiceChannelRequiredFormatted"), t))
        );
        return false;
    }
    return true;
}

function cycleLoopMode(current) {
    if (current === "track") return "queue";
    if (current === "queue") return "none";
    return "track";
}

module.exports = {
    requirePlayerControl,
    requireVoiceForPlay,
    cycleLoopMode,
};
