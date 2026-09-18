const { REST, Routes } = require("discord.js");
const { RESTJSONErrorCodes } = require("discord-api-types/v10");
const { DEFAULT_BOT_NAME } = require("./guildBranding");
const { getDiscordErrorCode } = require("./discordErrors");

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15000;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

class ProfileError extends Error {
    constructor(key, params = {}) {
        super(key);
        this.name = "ProfileError";
        this.key = key;
        this.params = params;
    }
}

function isImageAttachment(attachment) {
    if (attachment.contentType?.startsWith("image/")) return true;
    const name = attachment.name?.toLowerCase() || "";
    for (const ext of IMAGE_EXTENSIONS) {
        if (name.endsWith(ext)) return true;
    }
    return false;
}

function toDataUri(buffer, contentType) {
    const mime = contentType?.startsWith("image/") ? contentType : "image/png";
    return `data:${mime};base64,${buffer.toString("base64")}`;
}

async function fetchAttachmentDataUri(attachment) {
    if (!attachment?.url) {
        throw new ProfileError("commands.profile.invalidImage");
    }

    if (attachment.size > MAX_IMAGE_BYTES) {
        throw new ProfileError("commands.profile.imageTooLarge");
    }

    if (!isImageAttachment(attachment)) {
        throw new ProfileError("commands.profile.invalidImageFormat");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const response = await fetch(attachment.url, { signal: controller.signal });
        if (!response.ok) {
            throw new ProfileError("commands.profile.downloadFailed");
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > MAX_IMAGE_BYTES) {
            throw new ProfileError("commands.profile.imageTooLarge");
        }

        const contentType = response.headers.get("content-type") || attachment.contentType;
        if (contentType && !contentType.startsWith("image/")) {
            throw new ProfileError("commands.profile.invalidImageFormat");
        }

        return toDataUri(buffer, contentType || attachment.contentType);
    } catch (error) {
        if (error instanceof ProfileError) throw error;
        if (error.name === "AbortError") {
            throw new ProfileError("commands.profile.downloadFailed");
        }
        throw new ProfileError("commands.profile.downloadFailed");
    } finally {
        clearTimeout(timeout);
    }
}

function mapDiscordProfileError(error) {
    const code = getDiscordErrorCode(error);

    if (code === RESTJSONErrorCodes.MissingPermissions) {
        return new ProfileError("commands.profile.missingPermissions");
    }
    if (code === RESTJSONErrorCodes.InvalidFormBody) {
        return new ProfileError("commands.profile.invalidImage");
    }
    if (code === 429) {
        return new ProfileError("commands.profile.rateLimited");
    }

    return new ProfileError("commands.profile.updateFailed", {
        message: error?.message || "Unknown error",
    });
}

function getRest(client) {
    return new REST({ version: "10" }).setToken(client.token);
}

const GLOBAL_BIO_CACHE_TTL_MS = 5 * 60 * 1000;
/** @type {{ value: string, fetchedAt: number } | null} */
let globalBioCache = null;

async function fetchGlobalBotBio(client) {
    if (
        globalBioCache &&
        Date.now() - globalBioCache.fetchedAt < GLOBAL_BIO_CACHE_TTL_MS
    ) {
        return globalBioCache.value;
    }

    const rest = getRest(client);

    try {
        const user = await rest.get(Routes.user("@me"));
        const bio = typeof user.bio === "string" ? user.bio : "";
        globalBioCache = { value: bio, fetchedAt: Date.now() };
        return bio;
    } catch (error) {
        console.warn("[Musicify] Failed to fetch global bot bio:", error.message);
        return globalBioCache?.value ?? "";
    }
}

function invalidateGlobalBioCache() {
    globalBioCache = null;
}

async function fetchGuildMemberProfile(client, guildId, applicationId) {
    const rest = getRest(client);

    try {
        return await rest.patch(Routes.guildMember(guildId, "@me"), { body: {} });
    } catch (error) {
        const code = getDiscordErrorCode(error);
        if (
            code !== RESTJSONErrorCodes.UnknownMember &&
            code !== RESTJSONErrorCodes.UnknownGuild
        ) {
            console.warn("[Musicify] Profile empty PATCH failed, falling back to GET:", error.message);
        }

        try {
            return await rest.get(Routes.guildMember(guildId, applicationId));
        } catch (getError) {
            throw mapDiscordProfileError(getError);
        }
    }
}

async function updateGuildMemberProfile(client, guildId, body, reason) {
    const rest = getRest(client);

    try {
        return await rest.patch(Routes.guildMember(guildId, "@me"), { body, reason });
    } catch (error) {
        throw mapDiscordProfileError(error);
    }
}

function getMemberDisplayName(member) {
    return member.nick ?? member.user?.global_name ?? member.user?.username ?? DEFAULT_BOT_NAME;
}

function resolveMemberAvatarUrl(member, guildId) {
    if (member.avatar) {
        return `https://cdn.discordapp.com/guilds/${guildId}/users/${member.user.id}/avatars/${member.avatar}.png?size=256`;
    }

    if (member.user?.avatar) {
        return `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png?size=256`;
    }

    const index = Number((BigInt(member.user.id) >> 22n) % 6n);
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

function formatProfileStatus(value, t, customKey, defaultKey) {
    return value ? t(customKey) : t(defaultKey);
}

function buildProfileSummary(member, guildId, t) {
    const { hasCustomServerBio } = require("./guildBio");
    const displayName = getMemberDisplayName(member);

    return (
        `${t("commands.profile.viewHeading")}\n\n` +
        `${t("commands.profile.viewName", { name: displayName })}\n` +
        `${t("commands.profile.viewAvatar", {
            status: formatProfileStatus(
                member.avatar,
                t,
                "commands.profile.statusCustom",
                "commands.profile.statusDefault"
            ),
        })}\n` +
        `${t("commands.profile.viewBanner", {
            status: formatProfileStatus(
                member.banner,
                t,
                "commands.profile.statusCustom",
                "commands.profile.statusDefault"
            ),
        })}\n` +
        `${t("commands.profile.viewAboutMe", {
            status: formatProfileStatus(
                hasCustomServerBio(member.bio),
                t,
                "commands.profile.statusCustom",
                "commands.profile.statusDefault"
            ),
        })}\n\n` +
        t("commands.profile.viewFooter")
    );
}

module.exports = {
    ProfileError,
    fetchAttachmentDataUri,
    fetchGuildMemberProfile,
    fetchGlobalBotBio,
    invalidateGlobalBioCache,
    updateGuildMemberProfile,
    getMemberDisplayName,
    resolveMemberAvatarUrl,
    buildProfileSummary,
};
