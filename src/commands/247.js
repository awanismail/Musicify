const {
    SlashCommandBuilder,
    MessageFlags,
    ContainerBuilder,
    TextDisplayBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require("discord.js");
const { getGuildSettings } = require("../utils/database");

function build247ConfirmContainer(isEnabled, inVoiceChannel = true) {
    const container = new ContainerBuilder();
    const voiceNote = inVoiceChannel
        ? ""
        : "\n\n-# Join a voice channel to enable or disable 24/7.";

    if (isEnabled) {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                "### 24/7 Mode\n\n" +
                "**Current status**\n" +
                "-# Enabled — I stay in voice even when the queue is empty.\n\n" +
                "**Disable 24/7?**\n" +
                "-# I'll leave the voice channel once playback stops and the queue is empty." +
                voiceNote
            )
        );

        container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("247_disable")
                    .setLabel("Disable 24/7")
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId("247_cancel")
                    .setLabel("Cancel")
                    .setStyle(ButtonStyle.Secondary)
            )
        );
    } else {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                "### 24/7 Mode\n\n" +
                "**Current status**\n" +
                "-# Inactive — I leave when the queue is empty.\n\n" +
                "**Enable 24/7?**\n" +
                "-# I'll stay connected to your voice channel even between songs." +
                voiceNote
            )
        );

        container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("247_enable")
                    .setLabel("Enable 24/7")
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId("247_cancel")
                    .setLabel("Cancel")
                    .setStyle(ButtonStyle.Secondary)
            )
        );
    }

    return container;
}

function build247ResultContainer(isEnabled) {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            isEnabled
                ? "### ✅ 24/7 Enabled\n\n**Status**\n-# I'll stay in the voice channel even when nothing is playing."
                : "### ⏹ 24/7 Disabled\n\n**Status**\n-# I'll leave the voice channel when the queue is empty."
        )
    );
    return container;
}

function build247CancelledContainer() {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent("### Cancelled\n\n-# 24/7 mode was not changed.")
    );
    return container;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("247")
        .setDescription("Toggle 24/7 mode — bot stays in VC even when queue is empty"),

    async execute(interaction) {
        const isEnabled = Boolean(getGuildSettings(interaction.guild.id).twentyFourSeven);
        const inVoiceChannel = Boolean(interaction.member.voice?.channel);

        await interaction.reply({
            components: [build247ConfirmContainer(isEnabled, inVoiceChannel)],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    },

    build247ConfirmContainer,
    build247ResultContainer,
    build247CancelledContainer,
};
