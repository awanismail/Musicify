const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const { slashMeta, getT } = require("../i18n");
const { requirePlayerControl } = require("../utils/playerControls");
const { PLAYER_ACTIONS } = require("../utils/permissions");

module.exports = {
    data: slashMeta("skip"),

    async execute(interaction, client) {
        const t = getT(interaction, client);
        const ctx = await requirePlayerControl(interaction, client, t, {
            action: PLAYER_ACTIONS.SKIP,
            requireCurrent: true,
        });
        if (!ctx) return;

        const { player } = ctx;
        const skippedTitle = player.current?.info?.title || t("common.unknown");
        player.stop();

        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${t("commands.skip.successHeading")}\n\n` +
                `${t("common.labels.track")}\n` +
                `-# ${skippedTitle}`
            )
        );
        await interaction.reply({
            components: [container],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    },
};
