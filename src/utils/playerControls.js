const { MessageFlags } = require("discord.js");
const { getGuildData } = require("./playerStore");
const {
    getPlayerPermissionDenial,
    PLAYER_ACTIONS,
    DJ_DENIAL_KEY,
    VOICE_CHANNEL_DENIAL_KEY,
} = require("./permissions");
const { buildErrorContainer, ephemeralV2 } = require("./replies");

async function replyPermissionDenial(interaction, denial, t) {
    const message = t(denial.key);
    if (denial.key === DJ_DENIAL_KEY || denial.key === VOICE_CHANNEL_DENIAL_KEY) {
        await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
        return;
    }
    await interaction.reply(ephemeralV2(buildErrorContainer(message, t)));
}

async function requirePlayerControl(
    interaction,
    client,
    t,
    { requireCurrent = false, action = PLAYER_ACTIONS.CONTROL, track = null } = {}
) {
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

    const denial = getPlayerPermissionDenial(
        interaction.member,
        player,
        interaction.guild.id,
        action,
        { track }
    );
    if (denial) {
        await replyPermissionDenial(interaction, denial, t);
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
    replyPermissionDenial,
    cycleLoopMode,
};
