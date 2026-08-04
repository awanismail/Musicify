const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const { handleStop } = require("../services/sessionManager");
const { slashMeta, getT } = require("../i18n");
const { buildErrorContainer, ephemeralV2 } = require("../utils/replies");

module.exports = {
    data: slashMeta("stop"),

    async execute(interaction, client) {
        const t = getT(interaction, client);
        const player = client.riffy.players.get(interaction.guild.id);
        if (!player) {
            return interaction.reply(
                ephemeralV2(buildErrorContainer(t("commands.stop.noActivePlayer"), t))
            );
        }

        if (!interaction.member.voice?.channel) {
            return interaction.reply(
                ephemeralV2(buildErrorContainer(t("errors.voiceChannelRequiredFormatted"), t))
            );
        }

        const { stayed } = await handleStop(client, interaction.guild.id);

        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                stayed ? t("commands.stop.stayed247") : t("commands.stop.disconnected")
            )
        );
        await interaction.reply({
            components: [container],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    },
};
