const { MessageFlags } = require("discord.js");
const { slashMeta, getT } = require("../i18n");
const { buildStatusContainer } = require("../utils/statusPage");

module.exports = {
    data: slashMeta("status"),

    async execute(interaction, client) {
        const t = getT.brandFromInteraction(interaction, client);
        const container = buildStatusContainer(client, { t });

        return interaction.reply({
            components: [container],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    },
};
