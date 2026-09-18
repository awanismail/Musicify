const { getGuildData } = require("../utils/playerStore");
const {
    resetChatPlayToIdle,
    clearRegularPlayerMessage,
    scheduleAloneLeave,
    cancelAloneLeaveIfUsersPresent,
    cancelAloneLeaveTimer,
    scheduleTwentyFourSevenReconnect,
    savePending247Snapshot,
} = require("../services/sessionManager");
const { clearVoiceChannelStatus } = require("../utils/voiceChannelStatus");
const { isChatPlayActive } = require("../utils/playerChannel");

module.exports = {
    name: "voiceStateUpdate",
    async execute(client, oldState, newState) {
        const guildId = oldState.guild.id;

        // Bot was disconnected from voice — reset UI and destroy player
        if (oldState.id === client.user.id && !newState.channelId) {
            const guildData = getGuildData(guildId);
            const player = client.riffy?.players.get(guildId);
            let savedPlayback = false;

            if (oldState.channelId) {
                await clearVoiceChannelStatus(client, oldState.channelId);
            }

            if (player && guildData.twentyFourSeven && guildData.boundVoiceChannelId) {
                savedPlayback = savePending247Snapshot(client, player);
            }

            if (!savedPlayback) {
                await resetChatPlayIfActive(client, guildId);
            }

            if (player) {
                player.destroy();
            }

            if (guildData.twentyFourSeven && guildData.boundVoiceChannelId) {
                scheduleTwentyFourSevenReconnect(client, guildId);
            }
            return;
        }

        // User joined the bot's voice channel — cancel alone-leave timer
        if (newState.channelId && !newState.member.user.bot) {
            const botMember = newState.guild.members.cache.get(client.user.id);
            if (botMember?.voice?.channelId === newState.channelId) {
                cancelAloneLeaveIfUsersPresent(client, guildId);
            }
        }

        // Last human left the bot's voice channel
        if (oldState.channelId && oldState.channel && !oldState.member.user.bot) {
            const botMember = oldState.guild.members.cache.get(client.user.id);
            if (botMember?.voice?.channelId !== oldState.channelId) return;

            const members = oldState.channel.members.filter((m) => !m.user.bot);
            if (members.size === 0) {
                const guildData = getGuildData(guildId);
                if (guildData.twentyFourSeven) return;
                scheduleAloneLeave(client, guildId);
            }
        }
    },
};

async function resetChatPlayIfActive(client, guildId) {
    const guildData = getGuildData(guildId);

    if (isChatPlayActive(guildData) && guildData.chatPlayMessageId) {
        await resetChatPlayToIdle(client, guildId);
    } else if (guildData.playerMessageId && guildData.playerChannelId) {
        await clearRegularPlayerMessage(client, guildData);
    }

    cancelAloneLeaveTimer(guildData);
}
