const { REST } = require("discord.js");
const { getDiscordErrorCode } = require("./discordErrors");
const { getT } = require("../i18n");

const MAX_STATUS_LENGTH = 500;

function getRest(client) {
    return new REST({ version: "10" }).setToken(client.token);
}

function resolveVoiceChannelId(player, guildData) {
    return player?.voiceChannel || guildData?.boundVoiceChannelId || null;
}

function formatTrackStatus(t, track, { paused = false } = {}) {
    const title = track?.info?.title?.trim() || t("common.unknown");
    const author = track?.info?.author?.trim();

    if (author) {
        return t(paused ? "voiceChannelStatus.paused" : "voiceChannelStatus.playing", {
            author,
            title,
        });
    }

    return t("voiceChannelStatus.playingTitleOnly", { title });
}

function truncateStatus(status) {
    if (status.length <= MAX_STATUS_LENGTH) return status;
    return `${status.slice(0, MAX_STATUS_LENGTH - 1)}…`;
}

async function setVoiceChannelStatus(client, channelId, status) {
    if (!channelId) return;

    const rest = getRest(client);
    const body = { status: status ? truncateStatus(status) : null };

    try {
        await rest.put(`/channels/${channelId}/voice-status`, { body });
    } catch (error) {
        const code = getDiscordErrorCode(error);
        if (code === 50013 || code === 50001) {
            console.warn(
                `[Musicify] Missing permission to set voice channel status on ${channelId}`
            );
            return;
        }
        console.warn(
            `[Musicify] Failed to set voice channel status on ${channelId}:`,
            error.message
        );
    }
}

async function clearVoiceChannelStatus(client, channelId) {
    return setVoiceChannelStatus(client, channelId, null);
}

async function updateVoiceChannelStatusForPlayer(client, player, track, options = {}) {
    const { getGuildData } = require("./playerStore");
    const guildData = getGuildData(player.guildId);
    const channelId = resolveVoiceChannelId(player, guildData);
    if (!channelId || !track) return;

    const t = getT.forGuild(player.guildId, client);
    const paused = options.paused ?? Boolean(player.paused);
    const status = formatTrackStatus(t, track, { paused });
    await setVoiceChannelStatus(client, channelId, status);
}

async function clearVoiceChannelStatusForPlayer(client, player) {
    const { getGuildData } = require("./playerStore");
    const guildData = getGuildData(player.guildId);
    const channelId = resolveVoiceChannelId(player, guildData);
    await clearVoiceChannelStatus(client, channelId);
}

async function clearVoiceChannelStatusForGuild(client, guildId, voiceChannelId = null) {
    const { getGuildData } = require("./playerStore");
    const guildData = getGuildData(guildId);
    const channelId = voiceChannelId || guildData.boundVoiceChannelId;
    await clearVoiceChannelStatus(client, channelId);
}

async function syncVoiceChannelStatusForPlayer(client, player) {
    if (!player?.current) {
        await clearVoiceChannelStatusForPlayer(client, player);
        return;
    }

    await updateVoiceChannelStatusForPlayer(client, player, player.current, {
        paused: player.paused,
    });
}

module.exports = {
    setVoiceChannelStatus,
    clearVoiceChannelStatus,
    updateVoiceChannelStatusForPlayer,
    clearVoiceChannelStatusForPlayer,
    clearVoiceChannelStatusForGuild,
    syncVoiceChannelStatusForPlayer,
};
