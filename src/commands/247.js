const {
    MessageFlags,
    ContainerBuilder,
    TextDisplayBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require("discord.js");
const { getGuildSettings } = require("../utils/database");
const { slashMeta, getT } = require("../i18n");

function build247ConfirmContainer(t, isEnabled, inVoiceChannel = true) {
    const container = new ContainerBuilder();
    const voiceNote = inVoiceChannel ? "" : t("commands.247.joinVcNote");

    if (isEnabled) {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${t("commands.247.confirmHeading")}\n\n` +
                    t("commands.247.enabledStatus") +
                    "\n\n" +
                    t("commands.247.enabledPrompt") +
                    voiceNote
            )
        );

        container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("247_disable")
                    .setLabel(t("commands.247.disableButton"))
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId("247_cancel")
                    .setLabel(t("common.cancel"))
                    .setStyle(ButtonStyle.Secondary)
            )
        );
    } else {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${t("commands.247.confirmHeading")}\n\n` +
                    t("commands.247.disabledStatus") +
                    "\n\n" +
                    t("commands.247.disabledPrompt") +
                    voiceNote
            )
        );

        container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("247_enable")
                    .setLabel(t("commands.247.enableButton"))
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId("247_cancel")
                    .setLabel(t("common.cancel"))
                    .setStyle(ButtonStyle.Secondary)
            )
        );
    }

    return container;
}

function build247CancelledContainer(t) {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `${t("commands.247.cancelledHeading")}\n\n${t("commands.247.cancelledBody")}`
        )
    );
    return container;
}

module.exports = {
    data: slashMeta("247"),

    async execute(interaction, client) {
        const t = getT(interaction, client);
        const isEnabled = Boolean(getGuildSettings(interaction.guild.id).twentyFourSeven);
        const inVoiceChannel = Boolean(interaction.member.voice?.channel);

        await interaction.reply({
            components: [build247ConfirmContainer(t, isEnabled, inVoiceChannel)],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    },

    build247ConfirmContainer,
    build247CancelledContainer,
};
