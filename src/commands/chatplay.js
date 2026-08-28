const { MessageFlags, PermissionFlagsBits } = require("discord.js");
const { getGuildData } = require("../utils/playerStore");
const { slashMeta, getT } = require("../i18n");
const { buildErrorContainer, ephemeralV2 } = require("../utils/replies");
const {
    buildSetupModal,
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

    const tGuild = getT.forGuild(interaction.guild.id, client);
    return interaction.showModal(buildSetupModal(tGuild, { channel: interaction.channel }));
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
