const { MessageFlags } = require("discord.js");
const { slashMeta, applySlashOption, getT } = require("../i18n");
const { replyError } = require("../utils/replies");
const { createQueueContainer } = require("../utils/components");

module.exports = {
    data: slashMeta("queue").addIntegerOption((opt) =>
        applySlashOption(
            opt.setName("page").setRequired(false).setMinValue(1),
            "queue",
            "page"
        )
    ),

    async execute(interaction, client) {
        const t = getT(interaction, client);
        const player = client.riffy.players.get(interaction.guild.id);

        if (!player) {
            return replyError(interaction, { key: "errors.noActivePlayer" }, { t });
        }

        const page = (interaction.options.getInteger("page") || 1) - 1;
        const container = createQueueContainer(t, player.queue, player.current, page);

        await interaction.reply({
            components: [container],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    },
};
