const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const { handleStop } = require("../services/sessionManager");
const { slashMeta, getT } = require("../i18n");
const { buildErrorContainer, ephemeralV2 } = require("../utils/replies");
const { requirePlayerControl } = require("../utils/playerControls");
const { PLAYER_ACTIONS } = require("../utils/permissions");

module.exports = {
    data: slashMeta("stop"),

    async execute(interaction, client) {
        const t = getT(interaction, client);
        const ctx = await requirePlayerControl(interaction, client, t, {
            action: PLAYER_ACTIONS.STOP,
        });
        if (!ctx) return;

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
