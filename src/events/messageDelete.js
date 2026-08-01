const { getGuildData } = require("../utils/playerStore");
const { recreateChatPlayMessage } = require("../services/sessionManager");

module.exports = {
    name: "messageDelete",
    async execute(client, message) {
        const guildId = message.guildId ?? message.guild?.id;
        if (!guildId) return;

        const guildData = getGuildData(guildId);
        if (!guildData.chatPlayChannelId) return;

        const channelId = message.channelId ?? message.channel?.id;
        if (channelId !== guildData.chatPlayChannelId) return;
        if (!guildData.chatPlayMessageId || guildData.chatPlayMessageId !== message.id) return;

        guildData.chatPlayMessageId = null;
        await recreateChatPlayMessage(client, guildId);
    },
};
