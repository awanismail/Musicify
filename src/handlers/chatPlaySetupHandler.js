const { MessageFlags, PermissionFlagsBits } = require("discord.js");
const {
    buildSetupStep2Container,
    buildSetupStep3Container,
    buildSetupCancelledContainer,
    buildSetupSuccessContainer,
    buildChatPlayManageContainer,
    buildChatPlayDeleteConfirmContainer,
    buildChatPlayDeletedContainer,
    buildChangeChannelModal,
    buildManageChangeChannelModal,
    finalizeChatPlaySetup,
    deleteChatPlay,
    applyChatPlaySlowmode,
    applyChatPlayPin,
    relocateChatPlayChannel,
    getCommandMention,
} = require("../utils/chatPlaySetup");
const { getSession, deleteSession, auditChannelPermissions } = require("../utils/chatPlaySetupSession");
const { getGuildData } = require("../utils/playerStore");
const { setGuildSetting } = require("../utils/database");
const { toggleTwentyFourSeven } = require("../services/sessionManager");
const { refreshChatPlayPlayer } = require("../services/chatPlayPlayer");
const { safeInteractionUpdate, ephemeralV2, buildErrorContainer, buildFeedbackContainer } = require("../utils/replies");
const { getT } = require("../i18n");

const SETUP_BUTTONS = new Set([
    "cp_setup_cancel",
    "cp_setup_continue",
    "cp_setup_back",
    "cp_setup_confirm",
    "cp_setup_change_channel",
    "cp_setup_toggle_slowmode",
    "cp_setup_toggle_deletemsg",
    "cp_setup_toggle_pin",
    "cp_setup_toggle_247",
]);

const MANAGE_BUTTONS = new Set([
    "cp_manage_enable",
    "cp_manage_disable",
    "cp_manage_delete",
    "cp_manage_delete_confirm",
    "cp_manage_delete_cancel",
    "cp_manage_toggle_247",
    "cp_manage_toggle_slowmode",
    "cp_manage_toggle_deletemsg",
    "cp_manage_toggle_pin",
    "cp_manage_toggle_smartfilter",
    "cp_manage_change_channel",
]);

function canManageChatPlay(memberPermissions) {
    return (
        memberPermissions?.has(PermissionFlagsBits.ManageChannels) ||
        memberPermissions?.has(PermissionFlagsBits.Administrator)
    );
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

    if (customId === "cp_manage_toggle_slowmode") {
        guildData.chatPlaySlowmode = !(guildData.chatPlaySlowmode !== false);
        setGuildSetting(guildId, "chatPlaySlowmode", guildData.chatPlaySlowmode);
        const warning = await applyChatPlaySlowmode(interaction.guild, guildData, tGuild);
        return refreshManagePanel(client, interaction, t, tGuild, warning);
    }

    if (customId === "cp_manage_toggle_deletemsg") {
        guildData.chatPlayDeleteMessages = !(guildData.chatPlayDeleteMessages !== false);
        setGuildSetting(guildId, "chatPlayDeleteMessages", guildData.chatPlayDeleteMessages);
        return refreshManagePanel(client, interaction, t, tGuild);
    }

    if (customId === "cp_manage_toggle_pin") {
        guildData.chatPlayPinPlayerMessage = !(guildData.chatPlayPinPlayerMessage !== false);
        setGuildSetting(guildId, "chatPlayPinPlayerMessage", guildData.chatPlayPinPlayerMessage);
        const warning = await applyChatPlayPin(interaction.guild, guildData, tGuild);
        return refreshManagePanel(client, interaction, t, tGuild, warning);
    }

    if (customId === "cp_manage_toggle_smartfilter") {
        guildData.chatPlaySmartFilter = !(guildData.chatPlaySmartFilter !== false);
        setGuildSetting(guildId, "chatPlaySmartFilter", guildData.chatPlaySmartFilter);
        return refreshManagePanel(client, interaction, t, tGuild);
    }

    if (customId === "cp_manage_toggle_247") {
        const enabling = !guildData.twentyFourSeven;

        if (enabling) {
            const voiceChannel = interaction.member.voice?.channel;
            if (!voiceChannel) {
                return interaction.reply(
                    ephemeralV2(
                        buildErrorContainer(t("chatplay.handlers.joinVcEnable247"), t)
                    )
                );
            }

            await interaction.deferUpdate();

            await toggleTwentyFourSeven(client, guildId, {
                voiceChannelId: voiceChannel.id,
                textChannelId: guildData.chatPlayChannelId,
                enabled: true,
            });
        } else {
            await interaction.deferUpdate();

            await toggleTwentyFourSeven(client, guildId, {
                textChannelId: guildData.chatPlayChannelId,
                enabled: false,
            });
        }

        return refreshManagePanel(client, interaction, t, tGuild);
    }

    if (customId === "cp_manage_change_channel") {
        return interaction.showModal(buildManageChangeChannelModal(tGuild));
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

async function handleChatPlaySetupButton(client, interaction) {
    const t = getT(interaction, client);
    const tGuild = getT.forGuild(interaction.guild.id, client);
    const session = getSession(interaction.guild.id, interaction.user.id);

    if (!session) {
        const cmdChatplay = await getCommandMention(client, "chatplay");
        return interaction.reply(
            ephemeralV2(
                buildErrorContainer(t("chatplay.handlers.setupExpired", { cmdChatplay }), t)
            )
        );
    }

    if (interaction.user.id !== session.userId) {
        return interaction.reply(
            ephemeralV2(buildErrorContainer(t("chatplay.handlers.notYourSetup"), t))
        );
    }

    const customId = interaction.customId;
    const channel = interaction.guild.channels.cache.get(session.channelId);
    if (!channel && customId !== "cp_setup_cancel") {
        deleteSession(interaction.guild.id, interaction.user.id);
        const cmdChatplay = await getCommandMention(client, "chatplay");
        return interaction.update({
            components: [
                buildErrorContainer(t("chatplay.handlers.channelMissing", { cmdChatplay }), t),
            ],
            flags: MessageFlags.IsComponentsV2,
        });
    }

    if (customId === "cp_setup_cancel") {
        deleteSession(interaction.guild.id, interaction.user.id);
        await safeInteractionUpdate(
            interaction,
            {
                components: [buildSetupCancelledContainer(tGuild)],
                flags: MessageFlags.IsComponentsV2,
            },
            t
        );
        return;
    }

    if (customId === "cp_setup_change_channel") {
        return interaction.showModal(buildChangeChannelModal(tGuild));
    }

    if (customId === "cp_setup_toggle_slowmode") {
        session.slowmode = !session.slowmode;
        await safeInteractionUpdate(
            interaction,
            {
                components: [buildSetupStep2Container(tGuild, session, interaction.guild)],
                flags: MessageFlags.IsComponentsV2,
            },
            t
        );
        return;
    }

    if (customId === "cp_setup_toggle_deletemsg") {
        session.deleteMessages = !session.deleteMessages;
        await safeInteractionUpdate(
            interaction,
            {
                components: [buildSetupStep2Container(tGuild, session, interaction.guild)],
                flags: MessageFlags.IsComponentsV2,
            },
            t
        );
        return;
    }

    if (customId === "cp_setup_toggle_pin") {
        session.pinPlayerMessage = !session.pinPlayerMessage;
        await safeInteractionUpdate(
            interaction,
            {
                components: [buildSetupStep2Container(tGuild, session, interaction.guild)],
                flags: MessageFlags.IsComponentsV2,
            },
            t
        );
        return;
    }

    if (customId === "cp_setup_toggle_247") {
        if (!session.enable247) {
            const voiceChannelId = interaction.member.voice?.channelId;
            if (!voiceChannelId) {
                return interaction.reply(
                    ephemeralV2(
                        buildErrorContainer(t("chatplay.handlers.joinVcEnable247"), t)
                    )
                );
            }

            session.enable247 = true;
            session.voiceChannelIdFor247 = voiceChannelId;
        } else {
            session.enable247 = false;
            session.voiceChannelIdFor247 = null;
        }

        await safeInteractionUpdate(
            interaction,
            {
                components: [buildSetupStep2Container(tGuild, session, interaction.guild)],
                flags: MessageFlags.IsComponentsV2,
            },
            t
        );
        return;
    }

    if (customId === "cp_setup_back") {
        session.step = 1;
        await safeInteractionUpdate(
            interaction,
            {
                components: [buildSetupStep2Container(tGuild, session, interaction.guild)],
                flags: MessageFlags.IsComponentsV2,
            },
            t
        );
        return;
    }

    if (customId === "cp_setup_continue") {
        session.step = 2;
        await safeInteractionUpdate(
            interaction,
            {
                components: [buildSetupStep3Container(tGuild, session, interaction.guild)],
                flags: MessageFlags.IsComponentsV2,
            },
            t
        );
        return;
    }

    if (customId === "cp_setup_confirm") {
        if (
            !interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) &&
            !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
        ) {
            return interaction.followUp(
                ephemeralV2(buildErrorContainer(t("chatplay.handlers.permissionFinish"), t))
            );
        }

        try {
            const { slowmodeWarning, twentyFourSevenWarning, pinWarning } =
                await finalizeChatPlaySetup(client, session, interaction.guild, {
                    voiceChannelId: session.voiceChannelIdFor247 ?? null,
                    t: tGuild,
                });
            await safeInteractionUpdate(
                interaction,
                {
                    components: [
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
                        ),
                    ],
                    flags: MessageFlags.IsComponentsV2,
                },
                t
            );
        } catch (err) {
            console.error("[Musicify] ChatPlay setup failed:", err.message);
            await safeInteractionUpdate(
                interaction,
                {
                    components: [
                        buildErrorContainer(
                            t("chatplay.handlers.setupFailed", { message: err.message }),
                            t
                        ),
                    ],
                    flags: MessageFlags.IsComponentsV2,
                },
                t
            );
        }
    }
}

async function handleChatPlayModal(client, interaction) {
    const isSetup = interaction.customId === "cp_setup_change_channel_modal";
    const isManage = interaction.customId === "cp_manage_change_channel_modal";
    if (!isSetup && !isManage) {
        return false;
    }

    const t = getT(interaction, client);
    const tGuild = getT.forGuild(interaction.guild.id, client);
    const selectField = isSetup ? "cp_setup_channel_select" : "cp_manage_channel_select";

    if (isSetup) {
        const session = getSession(interaction.guild.id, interaction.user.id);

        if (!session) {
            const cmdChatplay = await getCommandMention(client, "chatplay");
            await interaction.reply(
                ephemeralV2(
                    buildErrorContainer(t("chatplay.handlers.setupExpired", { cmdChatplay }), t)
                )
            );
            return true;
        }

        if (interaction.user.id !== session.userId) {
            await interaction.reply(
                ephemeralV2(buildErrorContainer(t("chatplay.handlers.notYourSetupChannel"), t))
            );
            return true;
        }
    } else if (!canManageChatPlay(interaction.memberPermissions)) {
        await interaction.reply(
            ephemeralV2(buildErrorContainer(t("commands.chatplay.permissionManage"), t))
        );
        return true;
    }

    const selectedChannels = interaction.fields.getSelectedChannels(selectField);
    const selectedChannel = selectedChannels.first();
    if (!selectedChannel) {
        await interaction.reply(
            ephemeralV2(buildErrorContainer(t("chatplay.handlers.noChannelSelected"), t))
        );
        return true;
    }

    const channel =
        interaction.guild.channels.cache.get(selectedChannel.id) ??
        (await interaction.guild.channels.fetch(selectedChannel.id).catch(() => null));

    if (!channel?.isTextBased?.()) {
        await interaction.reply(
            ephemeralV2(buildErrorContainer(t("chatplay.handlers.invalidChannel"), t))
        );
        return true;
    }

    const { canProceed } = auditChannelPermissions(interaction.guild, channel);
    if (!canProceed) {
        await interaction.reply(
            ephemeralV2(
                buildErrorContainer(t("chatplay.handlers.missingPermissionsChannel"), t)
            )
        );
        return true;
    }

    if (isSetup) {
        const session = getSession(interaction.guild.id, interaction.user.id);
        session.channelId = channel.id;
        await safeInteractionUpdate(
            interaction,
            {
                components: [buildSetupStep2Container(tGuild, session, interaction.guild)],
                flags: MessageFlags.IsComponentsV2,
            },
            t
        );
        return true;
    }

    const guildData = getGuildData(interaction.guild.id);

    try {
        const warnings = await relocateChatPlayChannel(
            client,
            interaction.guild,
            guildData,
            channel.id,
            tGuild
        );
        await refreshManagePanel(client, interaction, t, tGuild, warnings);
    } catch (err) {
        console.error("[Musicify] ChatPlay channel move failed:", err.message);
        await interaction.reply(
            ephemeralV2(
                buildErrorContainer(
                    t("chatplay.handlers.channelMoveFailed", {
                        message: err.message || t("errors.unexpected"),
                    }),
                    t
                )
            )
        );
    }

    return true;
}

/** @deprecated Use handleChatPlayModal */
async function handleChatPlaySetupModal(client, interaction) {
    return handleChatPlayModal(client, interaction);
}

function isChatPlaySetupButton(customId) {
    return SETUP_BUTTONS.has(customId);
}

function isChatPlayManageButton(customId) {
    return MANAGE_BUTTONS.has(customId);
}

module.exports = {
    handleChatPlaySetupButton,
    handleChatPlaySetupModal,
    handleChatPlayModal,
    handleChatPlayManageButton,
    isChatPlaySetupButton,
    isChatPlayManageButton,
};
