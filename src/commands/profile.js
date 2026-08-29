const {
    PermissionFlagsBits,
    MessageFlags,
    ContainerBuilder,
    TextDisplayBuilder,
    SectionBuilder,
    ThumbnailBuilder,
} = require("discord.js");
const { slashMeta, getT, applySlashOption, buildSlashChoice, tEn } = require("../i18n");
const {
    buildErrorContainer,
    buildSuccessContainer,
    ephemeralV2,
    replyError,
} = require("../utils/replies");
const {
    ProfileError,
    fetchAttachmentDataUri,
    fetchGuildMemberProfile,
    updateGuildMemberProfile,
    buildProfileSummary,
    resolveMemberAvatarUrl,
} = require("../utils/guildProfile");
const { refreshChatPlayPlayer } = require("../services/chatPlayPlayer");
const { maybeAppendBrandWatermark } = require("../utils/guildBranding");

const COMMAND = "profile";

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
    maybeAppendBrandWatermark(container, t, guild, client);
    return container;
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
                                buildSlashChoice(COMMAND, "value", "banner", "banner")
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

async function handleProfileSet(interaction, client, t) {
    const guild = interaction.guild;
    const name = interaction.options.getString("name")?.trim() || null;
    const avatarAttachment = interaction.options.getAttachment("avatar");
    const bannerAttachment = interaction.options.getAttachment("banner");

    if (!name && !avatarAttachment && !bannerAttachment) {
        const member = await fetchGuildMemberProfile(client, guild.id, client.user.id);
        return interaction.reply(
            ephemeralV2(buildProfileContainer(member, guild.id, t, guild, client))
        );
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

    await interaction.editReply(
        ephemeralV2(buildProfileContainer(member, guild.id, t, guild, client))
    );
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
    } else {
        body.nick = null;
        body.avatar = null;
        body.banner = null;
    }

    const reason = `${interaction.user.tag} (${interaction.user.id}) via /profile clear`;
    await updateGuildMemberProfile(client, guild.id, body, reason);
    await refreshBotMemberCache(guild, client);
    refreshGuildBranding(client, guild.id);

    const messageKey = value
        ? `commands.profile.clearFieldSuccess.${value}`
        : "commands.profile.clearAllSuccess";

    await interaction.editReply(ephemeralV2(buildSuccessContainer(t(messageKey))));
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
};
