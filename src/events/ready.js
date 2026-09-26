const { ActivityType } = require("discord.js");
const { startStatusMonitor } = require("../services/statusMonitor");
const db = require("../db/sqlite");
const { startBackupScheduler } = require("../db/backup");
const { scheduleBackgroundStartupTasks } = require("../services/startupTasks");

module.exports = {
    name: "clientReady",
    once: true,
    async execute(client) {
        console.log(`[Musicify] Logged in as ${client.user.tag}`);
        console.log(`[Musicify] Serving ${client.guilds.cache.size} guild(s)`);

        client.riffy.init(client.user.id);

        startStatusMonitor(client);
        startBackupScheduler(db);

        const statuses = [
            "Pretending to be a DJ",
            "/help for commands",
            "Spinning tracks for servers",
            "ChatPlay mode activated",
            "Bass boosting servers",
            "Now playing: your favorite songs",
        ];

        client.user.setPresence({
            activities: [{ name: statuses[0], type: ActivityType.Playing }],
            status: "online",
        });

        let statusIndex = 0;
        setInterval(() => {
            statusIndex = (statusIndex + 1) % statuses.length;
            client.user.setPresence({
                activities: [{ name: statuses[statusIndex], type: ActivityType.Playing }],
                status: "online",
            });
        }, 120000);

        scheduleBackgroundStartupTasks(client);
        console.log("[Musicify] Core startup complete — ChatPlay restore and command deploy running in background.");
    },
};
