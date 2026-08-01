const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require("discord.js");
const { getGuildData } = require("../utils/playerStore");
const { buildErrorContainer, ephemeralV2 } = require("../utils/replies");
const { createSession, auditChannelPermissions } = require("../utils/chatPlaySetupSession");
const {
    buildSetupStep2Container,
    buildChatPlayManageContainer,
    hasChatPlayConfigured,
} = require("../utils/chatPlaySetup");

function canManageChatPlay(memberPermissions) {
    return (
        memberPermissions?.has(PermissionFlagsBits.ManageChannels) ||
        memberPermissions?.has(PermissionFlagsBits.Administrator)
    );
}

async function startChatPlaySetup(interaction) {
    if (!canManageChatPlay(interaction.memberPermissions)) {
        return interaction.reply(
            ephemeralV2(
                buildErrorContainer(
                    "**Permission required**\n-# You need **Manage Channels** or **Administrator** to set up ChatPlay."
                )
            )
        );
    }

    const { canProceed } = auditChannelPermissions(interaction.guild, interaction.channel);
    if (!canProceed) {
        return interaction.reply(
            ephemeralV2(
                buildErrorContainer(
                    "**Missing permissions**\n-# Musicify needs **View Channel**, **Send Messages**, **Embed Links**, and **Connect & Speak** in a voice channel before ChatPlay can be set up."
                )
            )
        );
    }

    const session = createSession(
        interaction.guild.id,
        interaction.user.id,
        interaction.channel.id
    );
    const container = buildSetupStep2Container(session, interaction.guild);

    await interaction.reply({
        components: [container],
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("chatplay")
        .setDescription("Set up or manage ChatPlay in this server"),

    async execute(interaction) {
        const guildData = getGuildData(interaction.guild.id);

        if (!hasChatPlayConfigured(guildData)) {
            return startChatPlaySetup(interaction);
        }

        if (!canManageChatPlay(interaction.memberPermissions)) {
            return interaction.reply(
                ephemeralV2(
                    buildErrorContainer(
                        "**Permission required**\n-# You need **Manage Channels** or **Administrator** to manage ChatPlay."
                    )
                )
            );
        }

        await interaction.reply({
            components: [await buildChatPlayManageContainer(guildData, interaction.guild, interaction.client)],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    },

    startChatPlaySetup,
};
