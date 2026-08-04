const { MessageFlags, PermissionFlagsBits } = require("discord.js");
const { getGuildData } = require("../utils/playerStore");
const { slashMeta, getT } = require("../i18n");
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

async function startChatPlaySetup(interaction, client) {
    const t = getT(interaction, client);

    if (!canManageChatPlay(interaction.memberPermissions)) {
        return interaction.reply(
            ephemeralV2(buildErrorContainer(t("commands.chatplay.permissionSetup"), t))
        );
    }

    const { canProceed } = auditChannelPermissions(interaction.guild, interaction.channel);
    if (!canProceed) {
        return interaction.reply(
            ephemeralV2(buildErrorContainer(t("commands.chatplay.missingPermissions"), t))
        );
    }

    const session = createSession(
        interaction.guild.id,
        interaction.user.id,
        interaction.channel.id
    );
    const tGuild = getT.forGuild(interaction.guild.id, client);
    const container = buildSetupStep2Container(tGuild, session, interaction.guild);

    await interaction.reply({
        components: [container],
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    });
}

module.exports = {
    data: slashMeta("chatplay"),

    async execute(interaction, client) {
        const t = getT(interaction, client);
        const guildData = getGuildData(interaction.guild.id);

        if (!hasChatPlayConfigured(guildData)) {
            return startChatPlaySetup(interaction, client);
        }

        if (!canManageChatPlay(interaction.memberPermissions)) {
            return interaction.reply(
                ephemeralV2(buildErrorContainer(t("commands.chatplay.permissionManage"), t))
            );
        }

        const tGuild = getT.forGuild(interaction.guild.id, client);
        await interaction.reply({
            components: [
                await buildChatPlayManageContainer(tGuild, guildData, interaction.guild, interaction.client),
            ],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    },

    startChatPlaySetup,
};
