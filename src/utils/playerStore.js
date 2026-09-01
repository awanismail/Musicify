/**
 * Per-guild data store for Musicify
 * Stores: player message, chatplay state, loop/autoplay/volume settings
 */
class GuildData {
    constructor() {
        this.playerMessageId = null;
        this.playerChannelId = null;
        this.chatPlayChannelId = null;
        this.chatPlayMessageId = null;
        this.chatPlayEnabled = false;
        this.chatPlaySlowmode = true;
        this.chatPlayDeleteMessages = true;
        this.chatPlayPinPlayerMessage = true;
        this.chatPlaySmartFilter = false;
        this.autoplay = false;
        this.loop = "none"; // "none" | "track" | "queue"
        this.volume = 75;
        this.shuffle = false;
        this.previousTracks = [];
        this.suggestions = [];
        this.twentyFourSeven = false;
        this.boundVoiceChannelId = null;
        this.aloneLeaveTimeout = null;
        this.autoplayWatchdog = null;
        this.queuePages = new Map(); // per-user queue page state
        this.updateInterval = null; // 15s musicard auto-update timer
        this.idleTimeout = null; // 30s disconnect timeout
        this.stopConfirmPending = null; // user id awaiting stop confirmation
        this.lavalinkSuspended = false;
        this.pendingLavalinkSeek = null;
        this.pendingLavalinkPause = false;
        this.lavalinkRecovering = false;
        this.lavalinkNotifyMessageId = null;
        this.lavalinkNotifyChannelId = null;
        this.playerUiBlocked = false;
        this.lastTrackRequesterId = null;
        this.lastVotePromptAt = null;
    }
}

function clearUpdateInterval(guildData) {
    if (guildData.updateInterval) {
        clearInterval(guildData.updateInterval);
        guildData.updateInterval = null;
    }
}

const guildStore = new Map();

function getGuildData(guildId) {
    if (!guildStore.has(guildId)) {
        guildStore.set(guildId, new GuildData());
    }
    return guildStore.get(guildId);
}

function deleteGuildData(guildId) {
    guildStore.delete(guildId);
}

function listGuildData() {
    return [...guildStore.entries()];
}

module.exports = { getGuildData, deleteGuildData, clearUpdateInterval, GuildData, listGuildData };
