const {
    PermissionFlagsBits,
    MessageFlags,
    ContainerBuilder,
    TextDisplayBuilder,
    SectionBuilder,
    SeparatorBuilder,
    ThumbnailBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");
const { slashMeta, getT, applySlashOption, buildSlashChoice, tEn } = require("../i18n");
const {
    buildErrorContainer,
    buildFeedbackContainer,
    buildSuccessContainer,
    ephemeralV2,
    replyError,
} = require("../utils/replies");
const {
    ProfileError,
    fetchAttachmentDataUri,
    fetchGuildMemberProfile,
    fetchGlobalBotBio,
    updateGuildMemberProfile,
    buildProfileSummary,
    resolveMemberAvatarUrl,
} = require("../utils/guildProfile");
const {
    validateGuildMemberBio,
    storeBioEditSession,
    consumeBioEditSession,
    resolveBioModalPrefill,
    MAX_BIO_LENGTH,
} = require("../utils/guildBio");
const { refreshChatPlayPlayer } = require("../services/chatPlayPlayer");
const { maybeAppendBrandWatermark } = require("../utils/guildBranding");

const COMMAND = "profile";
const PROFILE_EDIT_BIO = "profile_edit_bio";
const PROFILE_BIO_MODAL = "profile_bio_modal";
const PROFILE_BIO_INPUT = "profile_bio_input";

function buildProfileContainer(member, guildId, t, guild = null, client = null) {
    const container = new ContainerBuilder();
    container.addSectionComponents(
        new SectionBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(buildProfileSummary(member, guildId, t))
            )
            .setThumbnailAccessory(
                new ThumbnailBuilder().setURL(resolveMemberAvatarUrl(member, guildId))
            )
    );
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));
    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(PROFILE_EDIT_BIO)
                .setLabel(t("commands.profile.aboutMeButton"))
                .setStyle(ButtonStyle.Primary)
        )
    );
    maybeAppendBrandWatermark(container, t, guild, client);
    return container;
}

function buildBioModal(t, prefill) {
    const safePrefill = prefill.slice(0, MAX_BIO_LENGTH);

    return new ModalBuilder()
        .setCustomId(PROFILE_BIO_MODAL)
        .setTitle(t("commands.profile.bioModalTitle"))
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId(PROFILE_BIO_INPUT)
                    .setLabel(t("commands.profile.bioModalLabel"))
                    .setPlaceholder(t("commands.profile.bioModalPlaceholder"))
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
                    .setMaxLength(MAX_BIO_LENGTH)
                    .setValue(safePrefill)
            )
        );
}

function buildProfileCommandData() {
    return slashMeta(COMMAND)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
        .addSubcommand((sub) =>
            sub
                .setName("set")
                .setDescription(tEn("slash.profile.subcommands.set"))
                .addStringOption((option) =>
                    applySlashOption(option.setName("name").setMaxLength(32), COMMAND, "name")
                )
                .addAttachmentOption((option) =>
                    applySlashOption(option.setName("avatar"), COMMAND, "avatar")
                )
                .addAttachmentOption((option) =>
                    applySlashOption(option.setName("banner"), COMMAND, "banner")
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName("clear")
                .setDescription(tEn("slash.profile.subcommands.clear"))
                .addStringOption((option) =>
                    applySlashOption(
                        option
                            .setName("value")
                            .addChoices(
                                buildSlashChoice(COMMAND, "value", "name", "name"),
                                buildSlashChoice(COMMAND, "value", "avatar", "avatar"),
                                buildSlashChoice(COMMAND, "value", "banner", "banner"),
                                buildSlashChoice(COMMAND, "value", "bio", "bio")
                            ),
                        COMMAND,
                        "value"
                    )
                )
        );
}

async function refreshBotMemberCache(guild, client) {
    try {
        await guild.members.fetchMe({ force: true });
    } catch (error) {
        console.warn("[Musicify] Failed to refresh bot member cache after profile update:", error.message);
    }
}

function refreshGuildBranding(client, guildId) {
    refreshChatPlayPlayer(client, guildId).catch((error) => {
        console.warn("[Musicify] Failed to refresh ChatPlay after profile update:", error.message);
    });
}

async function getBotMember(guild) {
    return guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
}

function ensureManageNicknames(interaction, t) {
    if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageNicknames)) {
        return true;
    }

    interaction.reply(
        ephemeralV2(buildErrorContainer(t("commands.profile.permissionDenied"), t))
    );
    return false;
}

async function replyWithProfileView(interaction, client, t, member) {
    const container = buildProfileContainer(
        member,
        interaction.guild.id,
        t,
        interaction.guild,
        client
    );

    const payload = ephemeralV2(container);

    if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload);
    } else {
        await interaction.reply(payload);
    }
}

async function handleProfileSet(interaction, client, t) {
    const guild = interaction.guild;
    const name = interaction.options.getString("name")?.trim() || null;
    const avatarAttachment = interaction.options.getAttachment("avatar");
    const bannerAttachment = interaction.options.getAttachment("banner");

    if (!name && !avatarAttachment && !bannerAttachment) {
        const member = await fetchGuildMemberProfile(client, guild.id, client.user.id);
        return replyWithProfileView(interaction, client, t, member);
    }

    if (name) {
        const botMember = await getBotMember(guild);
        if (!botMember?.permissions.has(PermissionFlagsBits.ChangeNickname)) {
            return interaction.reply(
                ephemeralV2(buildErrorContainer(t("commands.profile.botMissingChangeNickname"), t))
            );
        }
    }

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    });

    const body = {};
    if (name) body.nick = name;
    if (avatarAttachment) body.avatar = await fetchAttachmentDataUri(avatarAttachment);
    if (bannerAttachment) body.banner = await fetchAttachmentDataUri(bannerAttachment);

    const reason = `${interaction.user.tag} (${interaction.user.id}) via /profile set`;
    const member = await updateGuildMemberProfile(client, guild.id, body, reason);
    await refreshBotMemberCache(guild, client);
    refreshGuildBranding(client, guild.id);

    await replyWithProfileView(interaction, client, t, member);
}

async function handleProfileClear(interaction, client, t) {
    const guild = interaction.guild;
    const value = interaction.options.getString("value");
    const clearsNick = !value || value === "name";

    if (clearsNick) {
        const botMember = await getBotMember(guild);
        if (!botMember?.permissions.has(PermissionFlagsBits.ChangeNickname)) {
            return interaction.reply(
                ephemeralV2(buildErrorContainer(t("commands.profile.botMissingChangeNickname"), t))
            );
        }
    }

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    });

    const body = {};
    if (value === "name") {
        body.nick = null;
    } else if (value === "avatar") {
        body.avatar = null;
    } else if (value === "banner") {
        body.banner = null;
    } else if (value === "bio") {
        body.bio = null;
    } else {
        body.nick = null;
        body.avatar = null;
        body.banner = null;
        body.bio = null;
    }

    const reason = `${interaction.user.tag} (${interaction.user.id}) via /profile clear`;
    const member = await updateGuildMemberProfile(client, guild.id, body, reason);
    await refreshBotMemberCache(guild, client);
    refreshGuildBranding(client, guild.id);

    if (value === "bio") {
        return replyWithProfileView(interaction, client, t, member);
    }

    const messageKey = value
        ? `commands.profile.clearFieldSuccess.${value}`
        : "commands.profile.clearAllSuccess";

    await interaction.editReply(ephemeralV2(buildSuccessContainer(t(messageKey))));
}

function isProfileInteraction(interaction) {
    return interaction.isButton() && interaction.customId === PROFILE_EDIT_BIO;
}

function isProfileBioModal(interaction) {
    return interaction.isModalSubmit() && interaction.customId === PROFILE_BIO_MODAL;
}

async function handleProfileInteraction(client, interaction) {
    const t = getT(interaction, client);

    if (!ensureManageNicknames(interaction, t)) {
        return;
    }

    const member = await fetchGuildMemberProfile(client, interaction.guild.id, client.user.id);
    const globalBio = await fetchGlobalBotBio(client);
    const prefill = resolveBioModalPrefill(member.bio, globalBio);

    storeBioEditSession(interaction.guild.id, interaction.user.id, {
        prefill,
        serverBio: member.bio?.trim() || null,
    });

    return interaction.showModal(buildBioModal(t, prefill));
}

async function handleProfileBioModal(client, interaction) {
    if (!isProfileBioModal(interaction)) {
        return false;
    }

    const t = getT(interaction, client);

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageNicknames)) {
        await interaction.reply(
            ephemeralV2(buildErrorContainer(t("commands.profile.permissionDenied"), t))
        );
        return true;
    }

    const submitted = interaction.fields.getTextInputValue(PROFILE_BIO_INPUT);
    const session = consumeBioEditSession(interaction.guild.id, interaction.user.id);
    const globalBio = await fetchGlobalBotBio(client);

    if (session && submitted === session.prefill) {
        await interaction.reply(
            ephemeralV2(buildFeedbackContainer(t("commands.profile.bioUnchanged")))
        );
        return true;
    }

    const validation = validateGuildMemberBio(submitted);
    if (!validation.ok) {
        await interaction.reply(
            ephemeralV2(buildErrorContainer(t(validation.key, validation.params), t))
        );
        return true;
    }

    let bio = validation.value;
    if (bio && bio === globalBio.trim()) {
        bio = null;
    }

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    });

    const reason = `${interaction.user.tag} (${interaction.user.id}) via /profile bio modal`;
    const member = await updateGuildMemberProfile(client, interaction.guild.id, { bio }, reason);
    await refreshBotMemberCache(interaction.guild, client);
    refreshGuildBranding(client, interaction.guild.id);

    await replyWithProfileView(interaction, client, t, member);
    return true;
}

module.exports = {
    data: buildProfileCommandData(),

    async execute(interaction, client) {
        const t = getT(interaction, client);

        if (!interaction.inGuild()) {
            return interaction.reply(
                ephemeralV2(buildErrorContainer(t("commands.profile.guildOnly"), t))
            );
        }

        try {
            const subcommand = interaction.options.getSubcommand();
            if (subcommand === "set") {
                await handleProfileSet(interaction, client, t);
            } else if (subcommand === "clear") {
                await handleProfileClear(interaction, client, t);
            }
        } catch (error) {
            if (error instanceof ProfileError) {
                return replyError(
                    interaction,
                    { key: error.key, params: error.params },
                    { deferred: interaction.deferred, t }
                );
            }
            throw error;
        }
    },

    isProfileInteraction,
    isProfileBioModal,
    handleProfileInteraction,
    handleProfileBioModal,
};
