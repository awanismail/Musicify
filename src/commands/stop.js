const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const { handleStop } = require("../services/sessionManager");
const { buildErrorContainer, ephemeralV2 } = require("../utils/replies");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("stop")
        .setDescription("Stop playback and clear the queue (disconnects unless 24/7 is on)"),

    async execute(interaction, client) {
        const player = client.riffy.players.get(interaction.guild.id);
        if (!player) {
            return interaction.reply(
                ephemeralV2(buildErrorContainer("**No active player**\n-# Nothing is playing right now."))
            );
        }

        if (!interaction.member.voice?.channel) {
            return interaction.reply(
                ephemeralV2(buildErrorContainer("**Voice channel required**\n-# Join a voice channel first."))
            );
        }

        const { stayed } = await handleStop(client, interaction.guild.id);

        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                stayed
                    ? "### ⏹ Stopped\n\n**Status**\n-# Queue cleared. Staying in voice channel (24/7 mode)."
                    : "### ⏹ Stopped\n\n**Status**\n-# Queue cleared and disconnected from voice channel."
            )
        );
        await interaction.reply({
            components: [container],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    },
};
