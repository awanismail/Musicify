const { getGuildData } = require("../utils/playerStore");
const { isLavalinkAvailable, getLavalinkUnavailableError } = require("../utils/lavalink");
const { getVoiceChannelMismatch, getVoiceChannelMismatchError } = require("../utils/voiceChannel");
const { getVoicePermissionError } = require("../utils/voicePermissions");
const { VOICE_ERROR_KEYS } = require("../i18n");
const {
    limitedResolve,
    ResolveRateLimitError,
} = require("../utils/resolveLimiter");
const {
    classifyResolveResult,
    getPlaylistDisplayName,
    queueResolvedTracks,
} = require("../utils/resolveResult");
const { getTrackQueuePosition, getDuplicateTrackError } = require("../utils/queueUtils");
const { showChatPlayLoading, refreshChatPlayPlayer } = require("./chatPlayPlayer");

const YOUTUBE_PATTERN = /(?:youtube\.com|youtu\.be)/i;

function isYouTubeQuery(query) {
    return YOUTUBE_PATTERN.test(query);
}

async function playQuery(client, { guild, member, query, textChannelId, source, t }) {
    const guildId = guild.id;
    const guildData = getGuildData(guildId);
    const isChatPlay = source === "chatplay";

    if (isYouTubeQuery(query)) {
        return {
            ok: false,
            type: "youtube_blocked",
            error: { key: "errors.youtubeNotSupported" },
        };
    }

    const voiceError = getVoicePermissionError(member, guild);
    if (voiceError) {
        return {
            ok: false,
            type: voiceError.code,
            error: { key: VOICE_ERROR_KEYS[voiceError.code] },
        };
    }

    if (!isLavalinkAvailable(client)) {
        return {
            ok: false,
            type: "lavalink_down",
            error: await getLavalinkUnavailableError(client),
        };
    }

    const voiceChannelId = member.voice.channel.id;
    const existingPlayer = client.riffy.players.get(guildId);
    const mismatch = getVoiceChannelMismatch(guildData, voiceChannelId, existingPlayer);
    if (mismatch) {
        return {
            ok: false,
            type: "vc_mismatch",
            error: getVoiceChannelMismatchError(guild, mismatch),
        };
    }

    let player = existingPlayer;
    if (!player) {
        player = client.riffy.createConnection({
            guildId,
            voiceChannel: voiceChannelId,
            textChannel: textChannelId,
            deaf: true,
        });
        if (source === "slash") {
            guildData.playerChannelId = textChannelId;
        }
    }

    player.setVolume(guildData.volume);

    const hasActivePlayback =
        existingPlayer?.current && (existingPlayer.playing || existingPlayer.paused);

    if (isChatPlay && !hasActivePlayback) {
        await showChatPlayLoading(client, guildId);
    }

    let result;
    try {
        const resolveResult = await limitedResolve(client, {
            query,
            requester: member.user,
            guildId,
            userId: isChatPlay ? member.user.id : undefined,
        });

        const classified = classifyResolveResult(resolveResult, query);

        if (classified.mode === "empty") {
            result = {
                ok: false,
                type: "no_results",
                error: { key: "errors.noResults" },
            };
            return result;
        }

        if (classified.mode === "playlist") {
            const { duplicates, addedTracks } = queueResolvedTracks(
                player,
                classified.tracks,
                member.user
            );

            if (!player.playing && !player.paused && !player.current) {
                player.play();
            }

            result = {
                ok: true,
                type: "playlist",
                playlistName: getPlaylistDisplayName(classified.playlistInfo),
                addedCount: addedTracks.length,
                totalCount: classified.tracks.length,
                duplicates,
            };
            return result;
        }

        const track = classified.tracks[0];
        if (!track) {
            result = {
                ok: false,
                type: "no_results",
                error: { key: "errors.noResults" },
            };
            return result;
        }

        const duplicatePosition = getTrackQueuePosition(player, track.info.uri);
        if (duplicatePosition) {
            result = {
                ok: false,
                type: "duplicate",
                error: getDuplicateTrackError(track.info.title, duplicatePosition, t),
                title: track.info.title,
            };
            return result;
        }

        const wasIdle = !player.current && !player.playing && !player.paused;
        track.info.requester = member.user;
        player.queue.add(track);

        if (wasIdle) {
            player.play();
            result = {
                ok: true,
                type: "track",
                title: track.info.title,
                author: track.info.author,
                queuePosition: null,
                startedPlayback: true,
            };
        } else {
            result = {
                ok: true,
                type: "track",
                title: track.info.title,
                author: track.info.author,
                queuePosition: player.queue.length,
                startedPlayback: false,
            };
        }
        return result;
    } catch (error) {
        if (error instanceof ResolveRateLimitError) {
            result = {
                ok: false,
                type: "rate_limit",
                error: { key: "errors.rateLimit.message" },
            };
            return result;
        }

        console.error(`[Musicify] playQuery error (${source}):`, error);
        result = {
            ok: false,
            type: "error",
            error: isLavalinkAvailable(client)
                ? { key: "errors.searchFailed" }
                : await getLavalinkUnavailableError(client),
        };
        return result;
    } finally {
        if (isChatPlay) {
            const player = client.riffy?.players.get(guildId);
            const shouldRefresh =
                !result?.ok ||
                result?.type === "track" ||
                result?.type === "playlist" ||
                Boolean(player?.current && (player.playing || player.paused));
            if (shouldRefresh) {
                await refreshChatPlayPlayer(client, guildId);
            }
        }
    }
}

module.exports = {
    playQuery,
    isYouTubeQuery,
};
