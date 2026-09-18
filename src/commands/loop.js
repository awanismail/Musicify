const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const { slashMeta, getT, applySlashOption, buildSlashChoice } = require("../i18n");
const { requirePlayerControl, cycleLoopMode } = require("../utils/playerControls");
const { refreshPlayerMessage } = require("../handlers/playerHandler");

const LOOP_CHOICE_KEYS = { none: "off", track: "track", queue: "queue" };
const LOOP_EMOJIS = { none: "➡️", track: "🔂", queue: "🔁" };

module.exports = {
    data: slashMeta("loop").addStringOption((opt) =>
        applySlashOption(
            opt
                .setName("mode")
                .setRequired(false)
                .addChoices(
                    buildSlashChoice("loop", "mode", "off", "none"),
                    buildSlashChoice("loop", "mode", "track", "track"),
                    buildSlashChoice("loop", "mode", "queue", "queue")
                ),
            "loop",
            "mode"
        )
    ),

    async execute(interaction, client) {
        const t = getT(interaction, client);
        const ctx = await requirePlayerControl(interaction, client, t);
        if (!ctx) return;

        const { player, guildData } = ctx;
        const selectedMode = interaction.options.getString("mode");
        const mode = selectedMode ?? cycleLoopMode(guildData.loop || "none");

        guildData.loop = mode;
        player.setLoop(mode);

        refreshPlayerMessage(client, interaction.guild.id).catch(() => {});

        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${t("commands.loop.successHeading", { emoji: LOOP_EMOJIS[mode] })}\n\n` +
                    `${t("common.labels.mode")}\n` +
                    `-# ${t(`slash.loop.choices.mode.${LOOP_CHOICE_KEYS[mode]}`)}`
            )
        );
        await interaction.reply({
            components: [container],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    },
};
