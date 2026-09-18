const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const { slashMeta, getT } = require("../i18n");
const { requirePlayerControl } = require("../utils/playerControls");
const { PLAYER_ACTIONS } = require("../utils/permissions");
const { refreshPlayerMessage } = require("../handlers/playerHandler");

module.exports = {
    data: slashMeta("pause"),

    async execute(interaction, client) {
        const t = getT(interaction, client);
        const ctx = await requirePlayerControl(interaction, client, t, {
            action: PLAYER_ACTIONS.CONTROL,
        });
        if (!ctx) return;

        const { player } = ctx;
        const wasPaused = player.paused;

        if (wasPaused) {
            player.pause(false);
        } else {
            player.pause(true);
        }

        refreshPlayerMessage(client, interaction.guild.id).catch(() => {});

        const title = player.current?.info?.title || t("common.unknown");
        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${t(wasPaused ? "commands.pause.resumedHeading" : "commands.pause.pausedHeading")}\n\n` +
                    `${t("common.labels.track")}\n` +
                    t("commands.pause.trackLine", { title })
            )
        );

        await interaction.reply({
            components: [container],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    },
};
