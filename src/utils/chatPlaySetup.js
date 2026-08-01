const {
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SectionBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    PermissionFlagsBits,
    MessageType,
    ModalBuilder,
    LabelBuilder,
    ChannelSelectMenuBuilder,
    ChannelType,
} = require("discord.js");
const { getGuildData } = require("../utils/playerStore");
const { setGuildSettings } = require("../utils/database");
const { createChatPlayIdleContainer } = require("./components");
const { toggleTwentyFourSeven } = require("../services/sessionManager");
const { deleteSession } = require("./chatPlaySetupSession");

const SETUP_LOGO = "<:Musicify_Logo:1517828581638541493>";
const SETUP_STEPS = 2;
const EMOJI_UNCHECKED = { id: "1522858566141214844", name: "Musicify_Unchecked" };
const EMOJI_CHECKED = { id: "1522858608478388275", name: "Musicify_Checked" };

function buildSetupStepHeader(step) {
    return `## ${SETUP_LOGO} Musicify ChatPlay\n-# Step ${step} of ${SETUP_STEPS}`;
}

function buildToggleButton(customId, enabled) {
    return new ButtonBuilder()
        .setCustomId(customId)
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(enabled ? EMOJI_CHECKED : EMOJI_UNCHECKED);
}

function buildBehaviourSection(title, description, customId, enabled) {
    return new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`${title}\n-# ${description}`)
        )
        .setButtonAccessory(buildToggleButton(customId, enabled));
}

async function deletePinNotification(channel) {
    for (let attempt = 0; attempt < 4; attempt++) {
        if (attempt > 0) {
            await new Promise((resolve) => setTimeout(resolve, 350));
        }
        const messages = await channel.messages.fetch({ limit: 10 });
        const pinNotice = messages.find((m) => m.type === MessageType.ChannelPinnedMessage);
        if (pinNotice) {
            await pinNotice.delete().catch(() => {});
            return;
        }
    }
}

async function pinChatPlayPlayerMessage(channel, message, botMember) {
    const perms = botMember?.permissionsIn(channel);
    const canPin =
        perms?.has(PermissionFlagsBits.PinMessages) ||
        perms?.has(PermissionFlagsBits.ManageMessages);

    if (!canPin) {
        return {
            ok: false,
            warning:
                "Couldn't pin the player message — grant **Pin Messages** or **Manage Messages** in this channel.",
        };
    }

    try {
        await message.pin();
        await deletePinNotification(channel);
        return { ok: true };
    } catch (err) {
        return {
            ok: false,
            warning: "Couldn't pin the player message — check **Pin Messages** permission.",
        };
    }
}

function buildChannelSection(session, guild) {
    const channel = guild.channels.cache.get(session.channelId);
    const channelLine = channel ? `<#${session.channelId}>` : "Unknown channel";

    return new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `**ChatPlay channel**\n-# ChatPlay will be set up in ${channelLine}.`
            )
        )
        .setButtonAccessory(
            new ButtonBuilder()
                .setCustomId("cp_setup_change_channel")
                .setLabel("Edit")
                .setStyle(ButtonStyle.Secondary)
        );
}

function buildChangeChannelModal() {
    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId("cp_setup_channel_select")
        .setPlaceholder("Choose a text channel")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

    const channelLabel = new LabelBuilder()
        .setLabel("ChatPlay channel")
        .setDescription("Where members type song names to request music")
        .setChannelSelectMenuComponent(channelSelect);

    return new ModalBuilder()
        .setCustomId("cp_setup_change_channel_modal")
        .setTitle("Edit ChatPlay channel")
        .addLabelComponents(channelLabel);
}

function buildReviewSection(title, description, customId, valueLabel) {
    return new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`${title}\n-# ${description}`)
        )
        .setButtonAccessory(
            new ButtonBuilder()
                .setCustomId(customId)
                .setLabel(valueLabel)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true)
        );
}

function buildManage247Section(guildData, command247) {
    const enable247 = Boolean(guildData.twentyFourSeven);

    return new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `**24/7 mode**\n-# Click **${enable247 ? "Turn off" : "Turn on"}** to toggle, or use ${command247}.`
            )
        )
        .setButtonAccessory(
            new ButtonBuilder()
                .setCustomId("cp_manage_toggle_247")
                .setLabel(enable247 ? "Turn off" : "Turn on")
                .setStyle(enable247 ? ButtonStyle.Secondary : ButtonStyle.Success)
        );
}

async function getCommandMention(client, name) {
    try {
        const commands = await client.application.commands.fetch();
        const cmd = commands?.find((c) => c.name === name);
        if (cmd) return `</${name}:${cmd.id}>`;
    } catch {}
    return `\`/${name}\``;
}

const SETUP_BEHAVIOURS = [
    {
        title: "**Slowmode (5s)** *(recommended)*",
        description: "Reduces spam in the request channel.",
        toggleCustomId: "cp_setup_toggle_slowmode",
        reviewCustomId: "cp_setup_review_slowmode",
        isEnabled: (session) => session.slowmode,
        reviewValue: (session) => (session.slowmode ? "5 seconds" : "Off"),
    },
    {
        title: "**Auto-delete requests** *(recommended)*",
        description: "Removes song messages to keep the channel clean.",
        toggleCustomId: "cp_setup_toggle_deletemsg",
        reviewCustomId: "cp_setup_review_deletemsg",
        isEnabled: (session) => session.deleteMessages,
        reviewValue: (session) => (session.deleteMessages ? "On" : "Off"),
    },
    {
        title: "**Pin player message** *(recommended)*",
        description: "Pins the player message so it stays easy to find.",
        toggleCustomId: "cp_setup_toggle_pin",
        reviewCustomId: "cp_setup_review_pin",
        isEnabled: (session) => session.pinPlayerMessage,
        reviewValue: (session) => (session.pinPlayerMessage ? "On" : "Off"),
    },
    {
        title: "**24/7 mode**",
        description: "Join a VC to enable — bot stays in that channel 24/7.",
        toggleCustomId: "cp_setup_toggle_247",
        reviewCustomId: "cp_setup_review_247",
        isEnabled: (session) => session.enable247,
        reviewValue: (session) => (session.enable247 ? "On" : "Off"),
    },
];

function getBehaviourDescription(option, session, guild) {
    if (typeof option.getDescription === "function") {
        return option.getDescription(session, guild);
    }
    return option.description;
}

function buildSetupStep2Container(session, guild) {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(buildSetupStepHeader(1))
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));

    container.addSectionComponents(buildChannelSection(session, guild));

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            "**Channel behaviour**\n" +
            "-# Tap the toggle next to each option."
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addSectionComponents(
        ...SETUP_BEHAVIOURS.map((option) =>
            buildBehaviourSection(
                option.title,
                getBehaviourDescription(option, session, guild),
                option.toggleCustomId,
                option.isEnabled(session)
            )
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));

    const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("cp_setup_cancel")
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("cp_setup_continue")
            .setLabel("Continue")
            .setStyle(ButtonStyle.Primary)
    );

    container.addActionRowComponents(navRow);
    return container;
}

function stripRecommended(title) {
    return title.replace(/ \*\(recommended\)\*/g, "");
}

function buildSetupStep3Container(session, guild) {
    const channel = guild.channels.cache.get(session.channelId);

    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `${buildSetupStepHeader(2)}\n\n` +
            "**Review & confirm**\n" +
            `-# Channel: ${channel ? `<#${session.channelId}>` : "Unknown"}`
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            "**Your settings**\n" +
            "-# Review your choices before creating ChatPlay."
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addSectionComponents(
        ...SETUP_BEHAVIOURS.map((option) =>
            buildReviewSection(
                stripRecommended(option.title),
                getBehaviourDescription(option, session, guild),
                option.reviewCustomId,
                option.reviewValue(session, guild)
            )
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("cp_setup_back")
            .setLabel("Back")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("cp_setup_confirm")
            .setLabel("Create ChatPlay")
            .setStyle(ButtonStyle.Success)
    );

    container.addActionRowComponents(row);
    return container;
}

function buildSetupCancelledContainer() {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            "### Setup cancelled\n\n-# ChatPlay was not changed."
        )
    );
    return container;
}

function hasChatPlayConfigured(guildData) {
    return Boolean(guildData.chatPlayChannelId);
}

function buildManageSettingsSections(guildData, command247) {
    const slowmode = guildData.chatPlaySlowmode !== false;
    const deleteMessages = guildData.chatPlayDeleteMessages !== false;
    const pinPlayer = guildData.chatPlayPinPlayerMessage !== false;

    return [
        buildReviewSection(
            "**Slowmode (5s)**",
            "Reduces spam in the request channel.",
            "cp_manage_review_slowmode",
            slowmode ? "5 seconds" : "Off"
        ),
        buildReviewSection(
            "**Auto-delete requests**",
            "Removes song messages to keep the channel clean.",
            "cp_manage_review_deletemsg",
            deleteMessages ? "On" : "Off"
        ),
        buildReviewSection(
            "**Pin player message**",
            "Pins the player message so it stays easy to find.",
            "cp_manage_review_pin",
            pinPlayer ? "On" : "Off"
        ),
        buildManage247Section(guildData, command247),
    ];
}

async function buildChatPlayManageContainer(guildData, guild, client) {
    const command247 = await getCommandMention(client, "247");
    const channel = guild.channels.cache.get(guildData.chatPlayChannelId);
    const channelLine = channel ? `<#${guildData.chatPlayChannelId}>` : "Unknown channel";
    const statusLine = guildData.chatPlayEnabled
        ? `Enabled in ${channelLine}`
        : `Disabled in ${channelLine}`;

    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `## ${SETUP_LOGO} Musicify ChatPlay\n\n` +
            "**Status**\n" +
            `-# ${statusLine}`
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent("**Your settings**")
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addSectionComponents(...buildManageSettingsSections(guildData, command247));

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));

    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("cp_manage_enable")
                .setLabel("Enable")
                .setStyle(ButtonStyle.Success)
                .setDisabled(Boolean(guildData.chatPlayEnabled)),
            new ButtonBuilder()
                .setCustomId("cp_manage_disable")
                .setLabel("Disable")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!guildData.chatPlayEnabled),
            new ButtonBuilder()
                .setCustomId("cp_manage_delete")
                .setLabel("Delete ChatPlay")
                .setStyle(ButtonStyle.Danger)
        )
    );

    return container;
}

function buildChatPlayDeleteConfirmContainer(guildData, guild) {
    const channel = guild.channels.cache.get(guildData.chatPlayChannelId);
    const channelLine = channel ? `<#${guildData.chatPlayChannelId}>` : "Unknown channel";

    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            "## ⚠️ Delete ChatPlay\n\n" +
            "**This action is permanent**\n" +
            `-# ChatPlay will be removed from ${channelLine}.\n\n` +
            "**What will be deleted**\n" +
            "-# • The player message in this channel\n" +
            "-# • All ChatPlay settings for this server\n\n" +
            "-# This cannot be undone. Press **Confirm** to proceed."
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));

    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("cp_manage_delete_confirm")
                .setLabel("Confirm")
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId("cp_manage_delete_cancel")
                .setLabel("Cancel")
                .setStyle(ButtonStyle.Secondary)
        )
    );

    return container;
}

function buildChatPlayDeletedContainer() {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            "### 🗑 ChatPlay Deleted\n\n" +
            "**Removed**\n" +
            "-# ChatPlay has been removed from this server.\n\n" +
            "**Set up again**\n" +
            "-# Run `/chatplay` in your music channel to start fresh."
        )
    );
    return container;
}

async function deleteChatPlay(client, guild, guildData) {
    const guildId = guild.id;
    const channelId = guildData.chatPlayChannelId;

    if (channelId && guildData.chatPlayMessageId) {
        const messageId = guildData.chatPlayMessageId;
        guildData.chatPlayMessageId = null;
        setGuildSettings(guildId, { chatPlayMessageId: null });

        try {
            const channel =
                client.channels.cache.get(channelId) ?? (await client.channels.fetch(channelId));
            const msg = await channel.messages.fetch(messageId);
            await msg.delete();
        } catch {}
    }

    if (channelId && guildData.chatPlaySlowmode) {
        try {
            const channel = guild.channels.cache.get(channelId);
            const botMember = guild.members.me;
            if (
                channel &&
                botMember?.permissionsIn(channel)?.has(PermissionFlagsBits.ManageChannels)
            ) {
                await channel.setRateLimitPerUser(0, "ChatPlay removed");
            }
        } catch {}
    }

    guildData.chatPlayChannelId = null;
    guildData.chatPlayMessageId = null;
    guildData.chatPlayEnabled = false;

    if (guildData.playerChannelId === channelId) {
        guildData.playerChannelId = null;
    }

    setGuildSettings(guildId, {
        chatPlayChannelId: null,
        chatPlayMessageId: null,
        chatPlayEnabled: false,
    });
}

function buildSetupSuccessContainer(session, guild, extras = {}) {
    const lines = [
        "### ✅ ChatPlay is live\n",
        "**Try it now**",
        "1. Join a voice channel",
        `2. Type a song name in <#${session.channelId}>`,
    ];

    if (session.pinPlayerMessage && !extras.pinWarning) {
        lines.push("", "-# Player message pinned in this channel.");
    } else if (!session.pinPlayerMessage) {
        lines.push("", "**Recommended**", "• Pin the player message so it stays visible");
    }

    if (session.enable247) {
        lines.push("-# 24/7 mode is enabled — the bot will stay in voice between songs.");
    }

    if (extras.twentyFourSevenWarning) {
        lines.push("", "**Note**", `-# ${extras.twentyFourSevenWarning}`);
    }

    if (extras.slowmodeWarning) {
        lines.push("", "**Note**", `-# ${extras.slowmodeWarning}`);
    }

    if (extras.pinWarning) {
        lines.push("", "**Note**", `-# ${extras.pinWarning}`);
    }

    lines.push("", "**Manage**", "-# Run `/chatplay` to enable, disable, or delete ChatPlay.");

    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(lines.join("\n"))
    );
    return container;
}

async function finalizeChatPlaySetup(client, session, guild, { voiceChannelId = null } = {}) {
    const guildId = session.guildId;
    const guildData = getGuildData(guildId);
    const channel = guild.channels.cache.get(session.channelId);

    if (!channel) {
        throw new Error("Setup channel no longer exists.");
    }

    if (guildData.chatPlayChannelId && guildData.chatPlayMessageId) {
        const oldMessageId = guildData.chatPlayMessageId;
        guildData.chatPlayMessageId = null;
        setGuildSettings(guildId, { chatPlayMessageId: null });

        try {
            const oldChannel = client.channels.cache.get(guildData.chatPlayChannelId);
            if (oldChannel) {
                const oldMsg = await oldChannel.messages.fetch(oldMessageId);
                await oldMsg.delete();
            }
        } catch {}
    }

    guildData.chatPlaySlowmode = session.slowmode;
    guildData.chatPlayDeleteMessages = session.deleteMessages;
    guildData.chatPlayPinPlayerMessage = session.pinPlayerMessage;

    let twentyFourSevenWarning = "";
    const voiceChannelIdFor247 = session.voiceChannelIdFor247 ?? voiceChannelId ?? null;
    if (session.enable247) {
        if (voiceChannelIdFor247) {
            await toggleTwentyFourSeven(client, guildId, {
                voiceChannelId: voiceChannelIdFor247,
                textChannelId: session.channelId,
                enabled: true,
            });
        } else {
            twentyFourSevenWarning =
                "24/7 wasn't enabled — join a voice channel and run `/247` to turn it on.";
        }
    }

    const container = createChatPlayIdleContainer(guildData);
    const chatMsg = await channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
    });

    let slowmodeWarning = "";
    let pinWarning = "";
    const botMember = guild.members.me;
    const canManageChannel = botMember
        ?.permissionsIn(channel)
        ?.has(PermissionFlagsBits.ManageChannels);

    if (canManageChannel) {
        try {
            await channel.setRateLimitPerUser(
                session.slowmode ? 5 : 0,
                session.slowmode ? "ChatPlay setup — prevents spam" : "ChatPlay setup — slowmode disabled"
            );
        } catch (err) {
            slowmodeWarning = "Couldn't update slowmode — check **Manage Channels** permission.";
        }
    } else if (session.slowmode) {
        slowmodeWarning = "Slowmode wasn't applied — grant **Manage Channels** in this channel.";
    }

    if (session.pinPlayerMessage) {
        const pinResult = await pinChatPlayPlayerMessage(channel, chatMsg, botMember);
        if (!pinResult.ok) {
            pinWarning = pinResult.warning;
        }
    }

    guildData.chatPlayChannelId = session.channelId;
    guildData.chatPlayMessageId = chatMsg.id;
    guildData.chatPlayEnabled = true;
    guildData.playerChannelId = session.channelId;

    setGuildSettings(guildId, {
        chatPlayChannelId: session.channelId,
        chatPlayMessageId: chatMsg.id,
        chatPlayEnabled: true,
        chatPlaySlowmode: session.slowmode,
        chatPlayDeleteMessages: session.deleteMessages,
        chatPlayPinPlayerMessage: session.pinPlayerMessage,
    });

    deleteSession(guildId, session.userId);

    return { slowmodeWarning, twentyFourSevenWarning, pinWarning };
}

module.exports = {
    buildSetupStep2Container,
    buildSetupStep3Container,
    buildChangeChannelModal,
    buildSetupCancelledContainer,
    buildSetupSuccessContainer,
    buildChatPlayManageContainer,
    buildChatPlayDeleteConfirmContainer,
    buildChatPlayDeletedContainer,
    hasChatPlayConfigured,
    finalizeChatPlaySetup,
    deleteChatPlay,
    pinChatPlayPlayerMessage,
};
