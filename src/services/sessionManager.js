const { MessageFlags, AttachmentBuilder } = require("discord.js");
const { getGuildData, clearUpdateInterval } = require("../utils/playerStore");
const { setGuildSetting, getGuildSettings } = require("../utils/database");
const {
    createChatPlayIdleContainer,
    createChatPlayNowPlayingContainer,
} = require("../utils/components");
const { generateMusicCard } = require("../utils/musicard");

const IDLE_LEAVE_MS = 30 * 1000;
const ALONE_LEAVE_MS = 30 * 1000;
const AUTOPLAY_WATCHDOG_MS = 8 * 1000;
const recreatingChatPlay = new Set();

function cancelScheduledLeave(guildData) {
    if (guildData.idleTimeout) {
        clearTimeout(guildData.idleTimeout);
        guildData.idleTimeout = null;
    }
}

function cancelAloneLeaveTimer(guildData) {
    if (guildData.aloneLeaveTimeout) {
        clearTimeout(guildData.aloneLeaveTimeout);
        guildData.aloneLeaveTimeout = null;
    }
}

function isPlayerIdle(player) {
    if (!player) return true;
    const hasQueue = player.queue?.length > 0;
    return !player.playing && !player.paused && !hasQueue;
}

async function resetChatPlayToIdle(client, guildId) {
    const guildData = getGuildData(guildId);
    if (!guildData.chatPlayChannelId || !guildData.chatPlayMessageId) return;

    try {
        const channel = client.channels.cache.get(guildData.chatPlayChannelId);
        if (!channel) return;

        const msg = await channel.messages.fetch(guildData.chatPlayMessageId);
        await msg.edit({
            components: [createChatPlayIdleContainer(guildData)],
            attachments: [],
            flags: MessageFlags.IsComponentsV2,
        });
    } catch (err) {
        await recreateChatPlayMessage(client, guildId);
    }
}

async function recreateChatPlayMessage(client, guildId) {
    if (recreatingChatPlay.has(guildId)) return null;

    const guildData = getGuildData(guildId);
    if (!guildData.chatPlayChannelId) return null;

    recreatingChatPlay.add(guildId);
    try {
        const channel = client.channels.cache.get(guildData.chatPlayChannelId);
        if (!channel) return null;

        const player = client.riffy?.players?.get(guildId);
        let container;
        let files = [];

        if (player?.current) {
            const musicardBuffer = await generateMusicCard(player.current, player, guildData);
            container = createChatPlayNowPlayingContainer(
                player.current,
                player,
                guildData,
                musicardBuffer
            );
            if (musicardBuffer) {
                files.push(new AttachmentBuilder(musicardBuffer, { name: "musicard.png" }));
            }
        } else {
            container = createChatPlayIdleContainer(guildData);
        }

        const chatMsg = await channel.send({
            components: [container],
            files,
            flags: MessageFlags.IsComponentsV2,
        });

        guildData.chatPlayMessageId = chatMsg.id;
        setGuildSetting(guildId, "chatPlayMessageId", chatMsg.id);

        if (guildData.chatPlayPinPlayerMessage) {
            const { pinChatPlayPlayerMessage } = require("../utils/chatPlaySetup");
            await pinChatPlayPlayerMessage(channel, chatMsg, channel.guild.members.me);
        }

        console.log(`[Musicify] Recreated ChatPlay message for guild ${guildId}`);
        return chatMsg;
    } catch (err) {
        console.error(
            `[Musicify] Failed to recreate ChatPlay message for guild ${guildId}:`,
            err.message
        );
        return null;
    } finally {
        recreatingChatPlay.delete(guildId);
    }
}

async function clearRegularPlayerMessage(client, guildData) {
    if (!guildData.playerMessageId || !guildData.playerChannelId) return;

    try {
        const channel = client.channels.cache.get(guildData.playerChannelId);
        if (channel) {
            const msg = await channel.messages.fetch(guildData.playerMessageId);
            await msg.delete();
        }
    } catch (err) {
        // message already deleted
    }

    guildData.playerMessageId = null;
    guildData.playerChannelId = null;
}

function scheduleIdleLeave(client, guildId) {
    const guildData = getGuildData(guildId);
    if (guildData.twentyFourSeven) return;

    cancelScheduledLeave(guildData);

    guildData.idleTimeout = setTimeout(() => {
        try {
            const currentGuildData = getGuildData(guildId);
            if (currentGuildData.twentyFourSeven) return;

            const player = client.riffy?.players.get(guildId);
            if (player && isPlayerIdle(player)) {
                player.destroy();
            }
        } catch (err) {
            // player already destroyed
        }
        guildData.idleTimeout = null;
    }, IDLE_LEAVE_MS);
}

function scheduleAloneLeave(client, guildId) {
    const guildData = getGuildData(guildId);
    if (guildData.twentyFourSeven) return;

    cancelAloneLeaveTimer(guildData);

    guildData.aloneLeaveTimeout = setTimeout(async () => {
        guildData.aloneLeaveTimeout = null;

        const currentGuildData = getGuildData(guildId);
        if (currentGuildData.twentyFourSeven) return;

        const guild = client.guilds.cache.get(guildId);
        const botMember = guild?.members.cache.get(client.user.id);
        const voiceChannel = botMember?.voice?.channel;

        if (!voiceChannel) return;

        const humans = voiceChannel.members.filter((m) => !m.user.bot);
        if (humans.size > 0) return;

        const player = client.riffy?.players.get(guildId);
        if (player) {
            await transitionToIdle(client, guildId, { scheduleLeave: false });
            player.destroy();
        }
    }, ALONE_LEAVE_MS);
}

function cancelAloneLeaveIfUsersPresent(client, guildId) {
    const guild = client.guilds.cache.get(guildId);
    const botMember = guild?.members.cache.get(client.user.id);
    const voiceChannel = botMember?.voice?.channel;
    if (!voiceChannel) return;

    const humans = voiceChannel.members.filter((m) => !m.user.bot);
    if (humans.size > 0) {
        cancelAloneLeaveTimer(getGuildData(guildId));
    }
}

async function transitionToIdle(client, guildId, { scheduleLeave = true } = {}) {
    const guildData = getGuildData(guildId);

    clearUpdateInterval(guildData);
    guildData.suggestions = [];

    if (guildData.chatPlayChannelId && guildData.chatPlayMessageId) {
        await resetChatPlayToIdle(client, guildId);
    } else {
        await clearRegularPlayerMessage(client, guildData);
    }

    if (scheduleLeave) {
        scheduleIdleLeave(client, guildId);
    }
}

async function handleQueueEnd(client, player) {
    const guildData = getGuildData(player.guildId);
    clearUpdateInterval(guildData);

    if (guildData.autoplay) {
        try {
            player.autoplay(player);
        } catch (err) {
            console.error("[Musicify] Autoplay failed:", err.message);
            await transitionToIdle(client, player.guildId);
            return;
        }

        if (guildData.autoplayWatchdog) {
            clearTimeout(guildData.autoplayWatchdog);
        }

        guildData.autoplayWatchdog = setTimeout(async () => {
            guildData.autoplayWatchdog = null;
            const currentPlayer = client.riffy?.players.get(player.guildId);
            if (!currentPlayer?.current && !currentPlayer?.playing) {
                await transitionToIdle(client, player.guildId);
            }
        }, AUTOPLAY_WATCHDOG_MS);

        return;
    }

    await transitionToIdle(client, player.guildId);
}

async function handlePlayerDisconnect(client, player) {
    const guildData = getGuildData(player.guildId);

    clearUpdateInterval(guildData);
    cancelScheduledLeave(guildData);
    cancelAloneLeaveTimer(guildData);

    if (guildData.autoplayWatchdog) {
        clearTimeout(guildData.autoplayWatchdog);
        guildData.autoplayWatchdog = null;
    }

    if (guildData.chatPlayChannelId && guildData.chatPlayMessageId) {
        await resetChatPlayToIdle(client, player.guildId);
    } else {
        await clearRegularPlayerMessage(client, guildData);
    }

    guildData.suggestions = [];
    guildData.previousTracks = [];
}

async function ensureVoiceConnection(client, guildId, voiceChannelId, textChannelId) {
    let player = client.riffy?.players.get(guildId);
    if (!player) {
        player = client.riffy.createConnection({
            guildId,
            voiceChannel: voiceChannelId,
            textChannel: textChannelId,
            deaf: true,
        });
    }
    return player;
}

async function toggleTwentyFourSeven(client, guildId, { voiceChannelId, textChannelId, enabled = null }) {
    const guildData = getGuildData(guildId);
    const dbSettings = getGuildSettings(guildId);
    const newState = enabled !== null ? enabled : !dbSettings.twentyFourSeven;

    guildData.twentyFourSeven = newState;
    setGuildSetting(guildId, "twentyFourSeven", newState);

    if (newState) {
        cancelScheduledLeave(guildData);
        cancelAloneLeaveTimer(guildData);

        guildData.boundVoiceChannelId = voiceChannelId;
        setGuildSetting(guildId, "boundVoiceChannelId", voiceChannelId);

        await ensureVoiceConnection(client, guildId, voiceChannelId, textChannelId);
    } else {
        guildData.boundVoiceChannelId = null;
        setGuildSetting(guildId, "boundVoiceChannelId", null);

        const player = client.riffy?.players.get(guildId);
        if (isPlayerIdle(player)) {
            await transitionToIdle(client, guildId, { scheduleLeave: false });
            if (player) {
                player.destroy();
            }
        }
    }

    if (guildData.chatPlayChannelId && guildData.chatPlayMessageId) {
        const player = client.riffy?.players.get(guildId);
        if (player?.current) {
            const { refreshPlayerMessage } = require("../handlers/playerHandler");
            await refreshPlayerMessage(client, guildId);
        } else {
            await resetChatPlayToIdle(client, guildId);
        }
    }

    return newState;
}

function restoreSessionFromDatabase(guildId, settings) {
    const guildData = getGuildData(guildId);

    if (settings.twentyFourSeven) {
        guildData.twentyFourSeven = true;
    }
    if (settings.boundVoiceChannelId) {
        guildData.boundVoiceChannelId = settings.boundVoiceChannelId;
    }
    if (typeof settings.defaultVolume === "number") {
        guildData.volume = settings.defaultVolume;
    }
    if (typeof settings.defaultAutoplay === "boolean") {
        guildData.autoplay = settings.defaultAutoplay;
    }
}

async function reconnectTwentyFourSeven(client, guildId) {
    const guildData = getGuildData(guildId);
    if (!guildData.twentyFourSeven || !guildData.boundVoiceChannelId) return;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const voiceChannel = guild.channels.cache.get(guildData.boundVoiceChannelId);
    if (!voiceChannel) return;

    const botMember = guild.members.cache.get(client.user.id);
    if (botMember?.voice?.channelId === guildData.boundVoiceChannelId) return;

    const textChannelId = guildData.chatPlayChannelId || guildData.playerChannelId;
    if (!textChannelId) return;

    try {
        await ensureVoiceConnection(
            client,
            guildId,
            guildData.boundVoiceChannelId,
            textChannelId
        );
    } catch (err) {
        console.error(`[Musicify] Failed to restore 24/7 connection for guild ${guildId}:`, err.message);
    }
}

async function handleStop(client, guildId, { destroyPlayer = null } = {}) {
    const guildData = getGuildData(guildId);
    const player = client.riffy?.players.get(guildId);

    clearUpdateInterval(guildData);
    cancelScheduledLeave(guildData);
    guildData.suggestions = [];
    guildData.previousTracks = [];

    if (player) {
        player.queue.clear();
        player.stop();
    }

    const shouldStay = destroyPlayer === false || (destroyPlayer === null && guildData.twentyFourSeven);

    if (shouldStay) {
        await resetChatPlayToIdle(client, guildId);
        if (!guildData.chatPlayChannelId) {
            await clearRegularPlayerMessage(client, guildData);
        }
        return { stayed: true };
    }

    await transitionToIdle(client, guildId, { scheduleLeave: false });
    if (player) {
        player.destroy();
    }

    return { stayed: false };
}

module.exports = {
    cancelScheduledLeave,
    cancelAloneLeaveTimer,
    cancelAloneLeaveIfUsersPresent,
    scheduleAloneLeave,
    resetChatPlayToIdle,
    recreateChatPlayMessage,
    clearRegularPlayerMessage,
    transitionToIdle,
    handleQueueEnd,
    handlePlayerDisconnect,
    toggleTwentyFourSeven,
    restoreSessionFromDatabase,
    reconnectTwentyFourSeven,
    handleStop,
    isPlayerIdle,
};
