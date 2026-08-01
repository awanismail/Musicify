const { getGuildData } = require("../utils/playerStore");
const {
    resetChatPlayToIdle,
    clearRegularPlayerMessage,
    scheduleAloneLeave,
    cancelAloneLeaveIfUsersPresent,
    cancelAloneLeaveTimer,
} = require("../services/sessionManager");

module.exports = {
    name: "voiceStateUpdate",
    async execute(client, oldState, newState) {
        const guildId = oldState.guild.id;

        // Bot was disconnected from voice — reset UI and destroy player
        if (oldState.id === client.user.id && !newState.channelId) {
            const player = client.riffy?.players.get(guildId);
            if (player) {
                await resetChatPlayIfActive(client, guildId);
                player.destroy();
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

    if (guildData.chatPlayChannelId && guildData.chatPlayMessageId) {
        await resetChatPlayToIdle(client, guildId);
    } else if (guildData.playerMessageId && guildData.playerChannelId) {
        await clearRegularPlayerMessage(client, guildData);
    }

    cancelAloneLeaveTimer(guildData);
}
