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
    finalizeChatPlaySetup,
    deleteChatPlay,
} = require("../utils/chatPlaySetup");
const { getSession, deleteSession, auditChannelPermissions } = require("../utils/chatPlaySetupSession");
const { getGuildData } = require("../utils/playerStore");
const { setGuildSetting } = require("../utils/database");
const { toggleTwentyFourSeven } = require("../services/sessionManager");
const { refreshChatPlayPlayer } = require("../services/chatPlayPlayer");
const { safeInteractionUpdate, ephemeralV2, buildErrorContainer } = require("../utils/replies");

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
]);

function canManageChatPlay(memberPermissions) {
    return (
        memberPermissions?.has(PermissionFlagsBits.ManageChannels) ||
        memberPermissions?.has(PermissionFlagsBits.Administrator)
    );
}

async function handleChatPlayManageButton(client, interaction) {
    if (!canManageChatPlay(interaction.memberPermissions)) {
        return interaction.reply(
            ephemeralV2(
                buildErrorContainer(
                    "**Permission required**\n-# You need **Manage Channels** or **Administrator** to manage ChatPlay."
                )
            )
        );
    }

    const guildId = interaction.guild.id;
    const guildData = getGuildData(guildId);
    const customId = interaction.customId;

    if (!guildData.chatPlayChannelId) {
        return safeInteractionUpdate(interaction, {
            components: [
                buildErrorContainer(
                    "**Not set up**\n-# ChatPlay isn't configured. Run `/chatplay` to set it up."
                ),
            ],
            flags: MessageFlags.IsComponentsV2,
        });
    }

    if (customId === "cp_manage_enable") {
        guildData.chatPlayEnabled = true;
        setGuildSetting(guildId, "chatPlayEnabled", true);
        await refreshChatPlayPlayer(client, guildId);
        return safeInteractionUpdate(interaction, {
            components: [await buildChatPlayManageContainer(guildData, interaction.guild, client)],
            flags: MessageFlags.IsComponentsV2,
        });
    }

    if (customId === "cp_manage_disable") {
        guildData.chatPlayEnabled = false;
        setGuildSetting(guildId, "chatPlayEnabled", false);
        await refreshChatPlayPlayer(client, guildId);
        return safeInteractionUpdate(interaction, {
            components: [await buildChatPlayManageContainer(guildData, interaction.guild, client)],
            flags: MessageFlags.IsComponentsV2,
        });
    }

    if (customId === "cp_manage_toggle_247") {
        const enabling = !guildData.twentyFourSeven;
        const voiceChannel = interaction.member.voice?.channel;

        if (!voiceChannel) {
            return interaction.reply(
                ephemeralV2(
                    buildErrorContainer(
                        enabling
                            ? "**Join a voice channel**\n-# Join a VC first — the bot will stay in that channel 24/7."
                            : "**Join a voice channel**\n-# Join a voice channel to change 24/7 mode."
                    )
                )
            );
        }

        await toggleTwentyFourSeven(client, guildId, {
            voiceChannelId: voiceChannel.id,
            textChannelId: guildData.chatPlayChannelId,
            enabled: enabling,
        });

        return safeInteractionUpdate(interaction, {
            components: [await buildChatPlayManageContainer(getGuildData(guildId), interaction.guild, client)],
            flags: MessageFlags.IsComponentsV2,
        });
    }

    if (customId === "cp_manage_delete") {
        return safeInteractionUpdate(interaction, {
            components: [buildChatPlayDeleteConfirmContainer(guildData, interaction.guild)],
            flags: MessageFlags.IsComponentsV2,
        });
    }

    if (customId === "cp_manage_delete_cancel") {
        return safeInteractionUpdate(interaction, {
            components: [await buildChatPlayManageContainer(guildData, interaction.guild, client)],
            flags: MessageFlags.IsComponentsV2,
        });
    }

    if (customId === "cp_manage_delete_confirm") {
        await deleteChatPlay(client, interaction.guild, guildData);
        return safeInteractionUpdate(interaction, {
            components: [buildChatPlayDeletedContainer()],
            flags: MessageFlags.IsComponentsV2,
        });
    }
}

async function handleChatPlaySetupButton(client, interaction) {
    const session = getSession(interaction.guild.id, interaction.user.id);
    if (!session) {
        return interaction.reply(
            ephemeralV2(
                buildErrorContainer(
                    "**Setup expired**\n-# Run `/chatplay` again to start over."
                )
            )
        );
    }

    if (interaction.user.id !== session.userId) {
        return interaction.reply(
            ephemeralV2(
                buildErrorContainer("**Not your setup**\n-# Only the person who started setup can use these buttons.")
            )
        );
    }

    const customId = interaction.customId;
    const channel = interaction.guild.channels.cache.get(session.channelId);
    if (!channel && customId !== "cp_setup_cancel") {
        deleteSession(interaction.guild.id, interaction.user.id);
        return interaction.update({
            components: [
                buildErrorContainer("**Channel missing**\n-# The setup channel was deleted. Run `/chatplay` again."),
            ],
            flags: MessageFlags.IsComponentsV2,
        });
    }

    if (customId === "cp_setup_cancel") {
        deleteSession(interaction.guild.id, interaction.user.id);
        await safeInteractionUpdate(interaction, {
            components: [buildSetupCancelledContainer()],
            flags: MessageFlags.IsComponentsV2,
        });
        return;
    }

    if (customId === "cp_setup_change_channel") {
        return interaction.showModal(buildChangeChannelModal());
    }

    if (customId === "cp_setup_toggle_slowmode") {
        session.slowmode = !session.slowmode;
        await safeInteractionUpdate(interaction, {
            components: [buildSetupStep2Container(session, interaction.guild)],
            flags: MessageFlags.IsComponentsV2,
        });
        return;
    }

    if (customId === "cp_setup_toggle_deletemsg") {
        session.deleteMessages = !session.deleteMessages;
        await safeInteractionUpdate(interaction, {
            components: [buildSetupStep2Container(session, interaction.guild)],
            flags: MessageFlags.IsComponentsV2,
        });
        return;
    }

    if (customId === "cp_setup_toggle_pin") {
        session.pinPlayerMessage = !session.pinPlayerMessage;
        await safeInteractionUpdate(interaction, {
            components: [buildSetupStep2Container(session, interaction.guild)],
            flags: MessageFlags.IsComponentsV2,
        });
        return;
    }

    if (customId === "cp_setup_toggle_247") {
        if (!session.enable247) {
            const voiceChannelId = interaction.member.voice?.channelId;
            if (!voiceChannelId) {
                return interaction.reply(
                    ephemeralV2(
                        buildErrorContainer(
                            "**Join a voice channel**\n-# Join a VC first — the bot will stay in that channel 24/7."
                        )
                    )
                );
            }

            session.enable247 = true;
            session.voiceChannelIdFor247 = voiceChannelId;
        } else {
            session.enable247 = false;
            session.voiceChannelIdFor247 = null;
        }

        await safeInteractionUpdate(interaction, {
            components: [buildSetupStep2Container(session, interaction.guild)],
            flags: MessageFlags.IsComponentsV2,
        });
        return;
    }

    if (customId === "cp_setup_back") {
        session.step = 1;
        await safeInteractionUpdate(interaction, {
            components: [buildSetupStep2Container(session, interaction.guild)],
            flags: MessageFlags.IsComponentsV2,
        });
        return;
    }

    if (customId === "cp_setup_continue") {
        session.step = 2;
        await safeInteractionUpdate(interaction, {
            components: [buildSetupStep3Container(session, interaction.guild)],
            flags: MessageFlags.IsComponentsV2,
        });
        return;
    }

    if (customId === "cp_setup_confirm") {
        if (
            !interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) &&
            !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
        ) {
            return interaction.followUp(
                ephemeralV2(
                    buildErrorContainer(
                        "**Permission required**\n-# You need **Manage Channels** or **Administrator** to finish setup."
                    )
                )
            );
        }

        try {
            const { slowmodeWarning, twentyFourSevenWarning, pinWarning } = await finalizeChatPlaySetup(
                client,
                session,
                interaction.guild,
                { voiceChannelId: session.voiceChannelIdFor247 ?? null }
            );
            await safeInteractionUpdate(interaction, {
                components: [
                    buildSetupSuccessContainer(session, interaction.guild, {
                        slowmodeWarning,
                        twentyFourSevenWarning,
                        pinWarning,
                    }),
                ],
                flags: MessageFlags.IsComponentsV2,
            });
        } catch (err) {
            console.error("[Musicify] ChatPlay setup failed:", err.message);
            await safeInteractionUpdate(interaction, {
                components: [
                    buildErrorContainer(`**Setup failed**\n-# ${err.message}`),
                ],
                flags: MessageFlags.IsComponentsV2,
            });
        }
    }
}

async function handleChatPlaySetupModal(client, interaction) {
    if (interaction.customId !== "cp_setup_change_channel_modal") {
        return false;
    }

    const session = getSession(interaction.guild.id, interaction.user.id);
    if (!session) {
        await interaction.reply(
            ephemeralV2(
                buildErrorContainer(
                    "**Setup expired**\n-# Run `/chatplay` again to start over."
                )
            )
        );
        return true;
    }

    if (interaction.user.id !== session.userId) {
        await interaction.reply(
            ephemeralV2(
                buildErrorContainer("**Not your setup**\n-# Only the person who started setup can change the channel.")
            )
        );
        return true;
    }

    const selectedChannels = interaction.fields.getSelectedChannels("cp_setup_channel_select");
    const selectedChannel = selectedChannels.first();
    if (!selectedChannel) {
        await interaction.reply(
            ephemeralV2(
                buildErrorContainer("**No channel selected**\n-# Pick a text channel and try again.")
            )
        );
        return true;
    }

    const channel =
        interaction.guild.channels.cache.get(selectedChannel.id) ??
        (await interaction.guild.channels.fetch(selectedChannel.id).catch(() => null));

    if (!channel?.isTextBased?.()) {
        await interaction.reply(
            ephemeralV2(
                buildErrorContainer("**Invalid channel**\n-# ChatPlay needs a text channel where members can send messages.")
            )
        );
        return true;
    }

    const { canProceed } = auditChannelPermissions(interaction.guild, channel);
    if (!canProceed) {
        await interaction.reply(
            ephemeralV2(
                buildErrorContainer(
                    "**Missing permissions**\n-# Musicify needs **View Channel**, **Send Messages**, **Embed Links**, and **Connect & Speak** in a voice channel before ChatPlay can use that channel."
                )
            )
        );
        return true;
    }

    session.channelId = channel.id;
    await safeInteractionUpdate(interaction, {
        components: [buildSetupStep2Container(session, interaction.guild)],
        flags: MessageFlags.IsComponentsV2,
    });
    return true;
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
    handleChatPlayManageButton,
    isChatPlaySetupButton,
    isChatPlayManageButton,
};
