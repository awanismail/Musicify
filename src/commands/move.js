const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const { slashMeta, getT, applySlashOption } = require("../i18n");
const { buildErrorContainer, ephemeralV2 } = require("../utils/replies");
const { requirePlayerControl } = require("../utils/playerControls");
const { PLAYER_ACTIONS } = require("../utils/permissions");

module.exports = {
    data: slashMeta("move")
        .addIntegerOption((opt) =>
            applySlashOption(
                opt.setName("from").setRequired(true).setMinValue(1),
                "move",
                "from"
            )
        )
        .addIntegerOption((opt) =>
            applySlashOption(opt.setName("to").setRequired(true).setMinValue(1), "move", "to")
        ),

    async execute(interaction, client) {
        const t = getT(interaction, client);
        const ctx = await requirePlayerControl(interaction, client, t, {
            action: PLAYER_ACTIONS.MOVE,
        });
        if (!ctx) return;

        const { player } = ctx;
        const from = interaction.options.getInteger("from");
        const to = interaction.options.getInteger("to");
        const queueLen = player.queue.length;

        if (from > queueLen || to > queueLen) {
            return interaction.reply(
                ephemeralV2(
                    buildErrorContainer(
                        t("commands.move.invalidPosition", { count: queueLen }),
                        t
                    )
                )
            );
        }

        if (from === to) {
            return interaction.reply(
                ephemeralV2(buildErrorContainer(t("commands.move.samePosition"), t))
            );
        }

        const [track] = player.queue.splice(from - 1, 1);
        player.queue.splice(to - 1, 0, track);

        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${t("commands.move.successHeading")}\n\n` +
                    `${t("common.labels.track")}\n` +
                    `-# ${track.info.title}\n\n` +
                    `${t("common.labels.position")}\n` +
                    t("commands.move.positionLine", { from, to })
            )
        );
        await interaction.reply({
            components: [container],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    },
};
