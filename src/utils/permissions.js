const { PermissionFlagsBits } = require("discord.js");
const { getGuildSettings } = require("./database");

const VOICE_CHANNEL_DENIAL_KEY = "errors.permissions.voiceChannelDenial";
const DJ_DENIAL_KEY = "errors.permissions.djDenial";

const DJ_MODES = {
    EVERYONE: "everyone",
    DJ_ONLY: "dj_only",
    DJ_AND_REQUESTER: "dj_and_requester",
};

const VALID_DJ_MODES = new Set(Object.values(DJ_MODES));

function normalizeDjMode(mode) {
    return VALID_DJ_MODES.has(mode) ? mode : DJ_MODES.EVERYONE;
}

const PLAYER_ACTIONS = {
    PLAY: "play",
    VIEW_QUEUE: "view_queue",
    NOW_PLAYING: "now_playing",
    CONTROL: "control",
    SKIP: "skip",
    STOP: "stop",
    CLEAR: "clear",
    REMOVE: "remove",
    MOVE: "move",
};

function resolveRequesterId(requester) {
    if (!requester) return null;
    if (typeof requester === "string") return requester;
    return requester.id ?? null;
}

function getDjSettings(guildId) {
    const settings = getGuildSettings(guildId);
    const rawLimit = Number.parseInt(settings.djQueueLimit, 10);
    return {
        djMode: normalizeDjMode(settings.djMode),
        djRoleIds: settings.djRoleIds || [],
        djQueueLimit: Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 0,
    };
}

function hasAdminBypass(member) {
    return (
        member?.permissions?.has(PermissionFlagsBits.Administrator) ||
        member?.permissions?.has(PermissionFlagsBits.ManageGuild)
    );
}

function isDj(member, djRoleIds) {
    if (!member || !djRoleIds?.length) return false;
    return djRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

function canAccessVoiceMusic(member, player) {
    const memberChannel = member?.voice?.channel;
    if (!memberChannel || !player?.voiceChannel) return false;
    return memberChannel.id === player.voiceChannel;
}

function isDjPrivileged(member, guildId) {
    const { djRoleIds } = getDjSettings(guildId);
    return hasAdminBypass(member) || isDj(member, djRoleIds);
}

function canPerformPlayerAction(member, player, guildId, action, options = {}) {
    const { djMode } = getDjSettings(guildId);

    if (isDjPrivileged(member, guildId)) {
        return true;
    }

    if (
        action === PLAYER_ACTIONS.PLAY ||
        action === PLAYER_ACTIONS.VIEW_QUEUE ||
        action === PLAYER_ACTIONS.NOW_PLAYING
    ) {
        return true;
    }

    if (djMode === DJ_MODES.EVERYONE) {
        return true;
    }

    if (djMode === DJ_MODES.DJ_ONLY) {
        return false;
    }

    if (djMode === DJ_MODES.DJ_AND_REQUESTER) {
        const memberId = member?.id;
        if (!memberId) return false;

        if (action === PLAYER_ACTIONS.SKIP) {
            const currentRequester = resolveRequesterId(player?.current?.info?.requester);
            return currentRequester === memberId;
        }

        if (action === PLAYER_ACTIONS.REMOVE) {
            const track = options.track;
            const trackRequester = resolveRequesterId(track?.info?.requester);
            return trackRequester === memberId;
        }

        return false;
    }

    return false;
}

function getPlayerPermissionDenial(member, player, guildId, action, options = {}) {
    if (!member?.voice?.channel) {
        return { key: "errors.voiceChannelRequired" };
    }

    if (player && !canAccessVoiceMusic(member, player)) {
        return { key: VOICE_CHANNEL_DENIAL_KEY };
    }

    if (!canPerformPlayerAction(member, player, guildId, action, options)) {
        return { key: DJ_DENIAL_KEY };
    }

    return null;
}

/** @deprecated Use canAccessVoiceMusic — kept for gradual migration */
function canControlMusic(member, player) {
    return canAccessVoiceMusic(member, player);
}

module.exports = {
    VOICE_CHANNEL_DENIAL_KEY,
    DJ_DENIAL_KEY,
    DJ_MODES,
    normalizeDjMode,
    PLAYER_ACTIONS,
    canControlMusic,
    canAccessVoiceMusic,
    canPerformPlayerAction,
    getPlayerPermissionDenial,
    isDjPrivileged,
    getDjSettings,
    resolveRequesterId,
};
