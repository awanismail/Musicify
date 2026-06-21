require("dotenv").config();

module.exports = {
    nodes: [
        {
            host: "your.lavalink.host",
            password: "your_lavalink_password",
            port: 443,
            secure: true,
            name: "Main",
        },
    ],

    defaultSearchPlatform: "ytmsearch",
    restVersion: "v4",

    accentColor: 0x2b2d31,
    statusWebhookUrl: process.env.STATUS_WEBHOOK_URL,

    musicard: {
        theme: "Bloom",
        progressBarColor: "#FACC15",
        backgroundColor: "#2b2d31",
    },
};
