const { WebhookClient, MessageFlags } = require("discord.js");
const config = require("../../config");
const { buildStatusContainer } = require("../utils/statusPage");
const { getAppSetting, setAppSetting, deleteAppSetting } = require("../db/appSettings");

const UPDATE_INTERVAL_MS = 60 * 1000;
const STATUS_MESSAGE_KEY = "status_webhook_message_id";

let webhookClient = null;
let messageId = null;
let updateTimer = null;
let lastSnapshot = null;
let activeClient = null;

function loadMessageId() {
    return getAppSetting(STATUS_MESSAGE_KEY);
}

function saveMessageId(id) {
    if (id) {
        setAppSetting(STATUS_MESSAGE_KEY, id);
    } else {
        deleteAppSetting(STATUS_MESSAGE_KEY);
    }
}

function getStatusSnapshot(client) {
    const container = buildStatusContainer(client, { interactive: false });
    return JSON.stringify(container.toJSON());
}

async function pushStatusUpdate(client, force = false) {
    if (!config.statusWebhookUrl) return;

    const snapshot = getStatusSnapshot(client);
    if (!force && snapshot === lastSnapshot) return;

    lastSnapshot = snapshot;

    if (!webhookClient) {
        webhookClient = new WebhookClient({ url: config.statusWebhookUrl });
    }

    const container = buildStatusContainer(client, { interactive: false });
    const payload = {
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        withComponents: true,
    };

    try {
        if (messageId) {
            await webhookClient.editMessage(messageId, payload);
            return;
        }

        const message = await webhookClient.send(payload);
        messageId = message.id;
        saveMessageId(messageId);
    } catch (error) {
        if (error.code === 10008 && messageId) {
            messageId = null;
            saveMessageId();
            const message = await webhookClient.send(payload);
            messageId = message.id;
            saveMessageId(messageId);
            return;
        }

        console.error("[Musicify] Failed to update status webhook:", error.message);
    }
}

function scheduleStatusUpdate(client, force = false) {
    if (client) activeClient = client;
    if (!activeClient) return;

    pushStatusUpdate(activeClient, force).catch((error) => {
        console.error("[Musicify] Status update error:", error.message);
    });
}

function startStatusMonitor(client) {
    if (!config.statusWebhookUrl) {
        console.warn("[Musicify] STATUS_WEBHOOK_URL not set — status monitor disabled.");
        return;
    }

    activeClient = client;
    messageId = loadMessageId();

    setTimeout(() => {
        scheduleStatusUpdate(client, true);
    }, 3000);

    if (updateTimer) clearInterval(updateTimer);
    updateTimer = setInterval(() => {
        scheduleStatusUpdate(client, false);
    }, UPDATE_INTERVAL_MS);

    console.log("[Musicify] Status monitor started.");
}

module.exports = {
    startStatusMonitor,
    scheduleStatusUpdate,
    pushStatusUpdate,
};
