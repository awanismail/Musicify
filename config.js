require("dotenv").config();

function buildNodes() {
    const nodes = [];

    if (process.env.LAVALINK_HOST && process.env.LAVALINK_PASSWORD) {
        nodes.push({
            host: process.env.LAVALINK_HOST,
            password: process.env.LAVALINK_PASSWORD,
            port: Number(process.env.LAVALINK_PORT || 443),
            secure: process.env.LAVALINK_SECURE !== "false",
            name: process.env.LAVALINK_NAME || "Main",
        });
    }

    if (process.env.LAVALINK_BACKUP_HOST && process.env.LAVALINK_BACKUP_PASSWORD) {
        nodes.push({
            host: process.env.LAVALINK_BACKUP_HOST,
            password: process.env.LAVALINK_BACKUP_PASSWORD,
            port: Number(process.env.LAVALINK_BACKUP_PORT || 443),
            secure: process.env.LAVALINK_BACKUP_SECURE !== "false",
            name: process.env.LAVALINK_BACKUP_NAME || "Backup",
        });
    }

    return nodes;
}

module.exports = {
    nodes: buildNodes(),

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
