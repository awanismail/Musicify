const { MessageFlags, PermissionFlagsBits } = require("discord.js");
const {
    buildSetupSuccessContainer,
    buildChatPlayManageContainer,
    buildChatPlayDeleteConfirmContainer,
    buildChatPlayDeletedContainer,
    buildManageSettingsModal,
    finalizeChatPlaySetup,
    deleteChatPlay,
    applyChatPlaySettings,
    SETUP_BEHAVIOUR_GROUP_ID,
    MANAGE_SETTINGS_MODAL_ID,
    MANAGE_BEHAVIOUR_GROUP_ID,
    MANAGE_CHANNEL_SELECT_ID,
    parseSetupBehaviourSelection,
    getCommandMention,
} = require("../utils/chatPlaySetup");
const { auditChannelPermissions, formatPermissionAuditFailure } = require("../utils/chatPlaySetupSession");
const { getGuildData } = require("../utils/playerStore");
const { setGuildSetting } = require("../utils/database");
const { refreshChatPlayPlayer } = require("../services/chatPlayPlayer");
const { safeInteractionUpdate, ephemeralV2, buildErrorContainer, buildFeedbackContainer, isInteractionExpired } = require("../utils/replies");
const { getT } = require("../i18n");

const MANAGE_BUTTONS = new Set([
    "cp_manage_enable",
    "cp_manage_disable",
    "cp_manage_settings",
    "cp_manage_delete",
    "cp_manage_delete_confirm",
    "cp_manage_delete_cancel",
]);

function canManageChatPlay(memberPermissions) {
    return (
        memberPermissions?.has(PermissionFlagsBits.ManageChannels) ||
        memberPermissions?.has(PermissionFlagsBits.Administrator)
    );
}

function buildSetupSessionFromModal(interaction) {
    const behaviour = parseSetupBehaviourSelection(
        interaction.fields.getCheckboxGroup(SETUP_BEHAVIOUR_GROUP_ID)
    );

    return {
        guildId: interaction.guild.id,
        userId: interaction.user.id,
        channelId: interaction.fields.getSelectedChannels("cp_setup_channel_select").first()?.id,
        slowmode: behaviour.slowmode,
        deleteMessages: behaviour.deleteMessages,
        pinPlayerMessage: behaviour.pinPlayerMessage,
        smartFilter: behaviour.smartFilter,
        enable247: behaviour.enable247,
        voiceChannelIdFor247: behaviour.enable247
            ? interaction.member.voice?.channelId ?? null
            : null,
    };
}

function buildManageSettingsFromModal(interaction) {
    const behaviour = parseSetupBehaviourSelection(
        interaction.fields.getCheckboxGroup(MANAGE_BEHAVIOUR_GROUP_ID)
    );

    return {
        channelId: interaction.fields.getSelectedChannels(MANAGE_CHANNEL_SELECT_ID).first()?.id,
        slowmode: behaviour.slowmode,
        deleteMessages: behaviour.deleteMessages,
        pinPlayerMessage: behaviour.pinPlayerMessage,
        smartFilter: behaviour.smartFilter,
        enable247: behaviour.enable247,
        voiceChannelIdFor247: behaviour.enable247
            ? interaction.member.voice?.channelId ?? null
            : null,
    };
}

async function refreshManagePanel(client, interaction, t, tGuild, warnings = null) {
    const guildData = getGuildData(interaction.guild.id);
    await safeInteractionUpdate(
        interaction,
        {
            components: [
                await buildChatPlayManageContainer(tGuild, guildData, interaction.guild, client),
            ],
            flags: MessageFlags.IsComponentsV2,
        },
        t
    );

    const warningList = Array.isArray(warnings) ? warnings : warnings ? [warnings] : [];
    const filtered = warningList.filter(Boolean);
    if (filtered.length) {
        await interaction.followUp(
            ephemeralV2(
                buildFeedbackContainer(
                    `${tGuild("common.labels.note")}\n-# ${filtered.join("\n-# ")}`
                )
            )
        );
    }
}

async function handleChatPlayManageButton(client, interaction) {
    const t = getT(interaction, client);
    const tGuild = getT.forGuild(interaction.guild.id, client);

    if (!canManageChatPlay(interaction.memberPermissions)) {
        return interaction.reply(
            ephemeralV2(
                buildErrorContainer(t("commands.chatplay.permissionManage"), t)
            )
        );
    }

    const guildId = interaction.guild.id;
    const guildData = getGuildData(guildId);
    const customId = interaction.customId;

    if (!guildData.chatPlayChannelId) {
        const cmdChatplay = await getCommandMention(client, "chatplay");
        return safeInteractionUpdate(
            interaction,
            {
                components: [
                    buildErrorContainer(
                        t("chatplay.handlers.notConfigured", { cmdChatplay }),
                        t
                    ),
                ],
                flags: MessageFlags.IsComponentsV2,
            },
            t
        );
    }

    if (customId === "cp_manage_enable") {
        guildData.chatPlayEnabled = true;
        setGuildSetting(guildId, "chatPlayEnabled", true);
        await refreshChatPlayPlayer(client, guildId);
        return refreshManagePanel(client, interaction, t, tGuild);
    }

    if (customId === "cp_manage_disable") {
        guildData.chatPlayEnabled = false;
        setGuildSetting(guildId, "chatPlayEnabled", false);
        await refreshChatPlayPlayer(client, guildId);
        return refreshManagePanel(client, interaction, t, tGuild);
    }

    if (customId === "cp_manage_settings") {
        return interaction.showModal(buildManageSettingsModal(tGuild, guildData));
    }

    if (customId === "cp_manage_delete") {
        return safeInteractionUpdate(
            interaction,
            {
                components: [buildChatPlayDeleteConfirmContainer(tGuild, guildData, interaction.guild)],
                flags: MessageFlags.IsComponentsV2,
            },
            t
        );
    }

    if (customId === "cp_manage_delete_cancel") {
        return refreshManagePanel(client, interaction, t, tGuild);
    }

    if (customId === "cp_manage_delete_confirm") {
        await deleteChatPlay(client, interaction.guild, guildData);
        return safeInteractionUpdate(
            interaction,
            {
                components: [await buildChatPlayDeletedContainer(tGuild, client)],
                flags: MessageFlags.IsComponentsV2,
            },
            t
        );
    }
}

async function handleSetupModalSubmit(client, interaction) {
    const t = getT(interaction, client);
    const tGuild = getT.forGuild(interaction.guild.id, client);

    if (!canManageChatPlay(interaction.memberPermissions)) {
        await interaction.reply(
            ephemeralV2(buildErrorContainer(t("commands.chatplay.permissionSetup"), t))
        );
        return true;
    }

    const session = buildSetupSessionFromModal(interaction);

    if (!session.channelId) {
        await interaction.reply(
            ephemeralV2(buildErrorContainer(t("chatplay.handlers.noChannelSelected"), t))
        );
        return true;
    }

    const channel =
        interaction.guild.channels.cache.get(session.channelId) ??
        (await interaction.guild.channels.fetch(session.channelId).catch(() => null));

    if (!channel?.isTextBased?.()) {
        await interaction.reply(
            ephemeralV2(buildErrorContainer(t("chatplay.handlers.invalidChannel"), t))
        );
        return true;
    }

    const { canProceed, checks } = auditChannelPermissions(interaction.guild, channel);
    if (!canProceed) {
        await interaction.reply(
            ephemeralV2(
                buildErrorContainer(formatPermissionAuditFailure(t, checks), t)
            )
        );
        return true;
    }

    if (session.enable247 && !session.voiceChannelIdFor247) {
        await interaction.reply(
            ephemeralV2(buildErrorContainer(t("chatplay.handlers.joinVcEnable247"), t))
        );
        return true;
    }

    try {
        await interaction.deferReply({
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });

        const { slowmodeWarning, twentyFourSevenWarning, pinWarning } =
            await finalizeChatPlaySetup(client, session, interaction.guild, {
                voiceChannelId: session.voiceChannelIdFor247,
                t: tGuild,
            });

        await interaction.editReply(
            ephemeralV2(
                await buildSetupSuccessContainer(
                    tGuild,
                    session,
                    interaction.guild,
                    client,
                    {
                        slowmodeWarning,
                        twentyFourSevenWarning,
                        pinWarning,
                    }
                )
            )
        );
    } catch (err) {
        console.error("[Musicify] ChatPlay setup failed:", err.message);
        const errorContainer = buildErrorContainer(
            t("chatplay.handlers.setupFailed", { message: err.message }),
            t
        );

        try {
            if (interaction.deferred) {
                await interaction.editReply(ephemeralV2(errorContainer));
            } else {
                await interaction.reply(ephemeralV2(errorContainer));
            }
        } catch (replyErr) {
            if (!isInteractionExpired(replyErr)) {
                console.error("[Musicify] Failed to send setup error reply:", replyErr.message);
            }
        }
    }

    return true;
}

async function handleManageSettingsModalSubmit(client, interaction) {
    const t = getT(interaction, client);
    const tGuild = getT.forGuild(interaction.guild.id, client);

    if (!canManageChatPlay(interaction.memberPermissions)) {
        await interaction.reply(
            ephemeralV2(buildErrorContainer(t("commands.chatplay.permissionManage"), t))
        );
        return true;
    }

    const guildData = getGuildData(interaction.guild.id);
    const settings = buildManageSettingsFromModal(interaction);

    if (!settings.channelId) {
        await interaction.reply(
            ephemeralV2(buildErrorContainer(t("chatplay.handlers.noChannelSelected"), t))
        );
        return true;
    }

    const channel =
        interaction.guild.channels.cache.get(settings.channelId) ??
        (await interaction.guild.channels.fetch(settings.channelId).catch(() => null));

    if (!channel?.isTextBased?.()) {
        await interaction.reply(
            ephemeralV2(buildErrorContainer(t("chatplay.handlers.invalidChannel"), t))
        );
        return true;
    }

    const { canProceed, checks } = auditChannelPermissions(interaction.guild, channel);
    if (!canProceed) {
        await interaction.reply(
            ephemeralV2(
                buildErrorContainer(formatPermissionAuditFailure(t, checks), t)
            )
        );
        return true;
    }

    if (settings.enable247 && !settings.voiceChannelIdFor247 && !guildData.twentyFourSeven) {
        await interaction.reply(
            ephemeralV2(buildErrorContainer(t("chatplay.handlers.joinVcEnable247"), t))
        );
        return true;
    }

    await interaction.deferUpdate();

    try {
        const { warnings } = await applyChatPlaySettings(
            client,
            interaction.guild,
            guildData,
            settings,
            tGuild
        );

        await refreshChatPlayPlayer(client, interaction.guild.id);
        await refreshManagePanel(client, interaction, t, tGuild, warnings);
    } catch (err) {
        console.error("[Musicify] ChatPlay settings update failed:", err.message);
        await interaction.followUp(
            ephemeralV2(
                buildErrorContainer(
                    t("chatplay.handlers.settingsFailed", {
                        message: err.message || t("errors.unexpected"),
                    }),
                    t
                )
            )
        );
    }

    return true;
}

async function handleChatPlayModal(client, interaction) {
    if (interaction.customId === "cp_setup_modal") {
        return handleSetupModalSubmit(client, interaction);
    }

    if (interaction.customId === MANAGE_SETTINGS_MODAL_ID) {
        return handleManageSettingsModalSubmit(client, interaction);
    }

    return false;
}

/** @deprecated Use handleChatPlayModal */
async function handleChatPlaySetupModal(client, interaction) {
    return handleChatPlayModal(client, interaction);
}

function isChatPlayManageButton(customId) {
    return MANAGE_BUTTONS.has(customId);
}

module.exports = {
    handleChatPlaySetupModal,
    handleChatPlayModal,
    handleChatPlayManageButton,
    isChatPlayManageButton,
};
