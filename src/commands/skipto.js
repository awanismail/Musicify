const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const { slashMeta, getT, applySlashOption } = require("../i18n");
const { buildErrorContainer, ephemeralV2 } = require("../utils/replies");
const { requirePlayerControl } = require("../utils/playerControls");
const { PLAYER_ACTIONS } = require("../utils/permissions");

module.exports = {
    data: slashMeta("skipto").addIntegerOption((opt) =>
        applySlashOption(
            opt.setName("position").setRequired(true).setMinValue(1),
            "skipto",
            "position"
        )
    ),

    async execute(interaction, client) {
        const t = getT(interaction, client);
        const ctx = await requirePlayerControl(interaction, client, t, {
            action: PLAYER_ACTIONS.SKIP,
        });
        if (!ctx) return;

        const { player } = ctx;
        const position = interaction.options.getInteger("position");
        const queueLen = player.queue.length;

        if (queueLen === 0) {
            if (position > 1) {
                return interaction.reply(
                    ephemeralV2(
                        buildErrorContainer(t("commands.skipto.invalidPosition", { count: 0 }), t)
                    )
                );
            }

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
            return interaction.reply({
                components: [container],
                flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
            });
        }

        if (position > queueLen) {
            return interaction.reply(
                ephemeralV2(
                    buildErrorContainer(
                        t("commands.skipto.invalidPosition", { count: queueLen }),
                        t
                    )
                )
            );
        }

        const targetTrack = player.queue[position - 1];
        const targetTitle = targetTrack?.info?.title || t("common.unknown");
        const removedCount = position - 1;

        if (removedCount > 0) {
            player.queue.splice(0, removedCount);
        }

        player.stop();

        const lines = [`${t("commands.skipto.successHeading")}\n`];

        if (removedCount > 0) {
            lines.push(
                `${t("commands.skipto.skippedLine", { count: removedCount })}\n`
            );
        }

        lines.push(
            `${t("common.labels.track")}\n` + `-# ${targetTitle}`
        );

        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(lines.join("\n"))
        );
        await interaction.reply({
            components: [container],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    },
};
