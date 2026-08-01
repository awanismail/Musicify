const { sendGuildWelcome } = require("../utils/guildWelcome");

module.exports = {
    name: "guildCreate",
    once: false,
    async execute(client, guild) {
        await sendGuildWelcome(client, guild);
    },
};
