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

    vote: {
        botId: process.env.TOP_GG_BOT_ID || "1502977716196999309",
        url: `https://top.gg/bot/${process.env.TOP_GG_BOT_ID || "1502977716196999309"}/vote`,
        token: process.env.TOP_GG_TOKEN || null,
        webhookSecret: process.env.TOP_GG_WEBHOOK_SECRET || null,
        webhookPath: process.env.TOP_GG_WEBHOOK_PATH || "/webhooks/topgg/vote",
        snoozeMs: 2 * 24 * 60 * 60 * 1000,
        postVoteSnoozeMs: 12 * 60 * 60 * 1000,
    },

    musicard: {
        theme: "Bloom",
        progressBarColor: "#FACC15",
        backgroundColor: "#2b2d31",
    },
};
