const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const { slashMeta, getT } = require("../i18n");
const { requirePlayerControl } = require("../utils/playerControls");
const { refreshPlayerMessage } = require("../handlers/playerHandler");

module.exports = {
    data: slashMeta("replay"),

    async execute(interaction, client) {
        const t = getT(interaction, client);
        const ctx = await requirePlayerControl(interaction, client, t, { requireCurrent: true });
        if (!ctx) return;

        const { player } = ctx;
        player.seek(0);

        refreshPlayerMessage(client, interaction.guild.id).catch(() => {});

        const title = player.current.info.title || t("common.unknown");
        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${t("commands.replay.successHeading")}\n\n` +
                    `${t("common.labels.track")}\n` +
                    t("commands.replay.trackLine", { title })
            )
        );

        await interaction.reply({
            components: [container],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    },
};
