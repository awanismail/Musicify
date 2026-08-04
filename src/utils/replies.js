const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const { translateError } = require("../i18n");

const INTERACTION_EXPIRED_CODE = 10062;

function buildFeedbackContainer(content, { error = false } = {}) {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    return container;
}

function buildErrorContainer(body, t) {
    const heading = t("errors.errorHeading");
    return buildFeedbackContainer(
        typeof body === "string" ? `${heading}\n\n${body}` : body,
        { error: true }
    );
}

function buildSuccessContainer(body) {
    return buildFeedbackContainer(typeof body === "string" ? body : body);
}

function ephemeralV2(components) {
    return {
        components: Array.isArray(components) ? components : [components],
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    };
}

async function replyExpiredInteraction(interaction, t) {
    const container = buildErrorContainer(t("errors.timedOut"), t);
    try {
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp(ephemeralV2(container));
        } else {
            await interaction.reply(ephemeralV2(container));
        }
    } catch (err) {
        if (err.code !== INTERACTION_EXPIRED_CODE) {
            console.error("[Musicify] Failed to send expiry notice:", err.message);
        }
    }
}

function isInteractionExpired(error) {
    return error?.code === INTERACTION_EXPIRED_CODE;
}

async function safeInteractionUpdate(interaction, options, t) {
    try {
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(options);
        } else {
            await interaction.update(options);
        }
    } catch (error) {
        if (isInteractionExpired(error)) {
            if (t) await replyExpiredInteraction(interaction, t);
            return false;
        }
        throw error;
    }
    return true;
}

async function replyError(interaction, body, { deferred = false, t } = {}) {
    const message = t && body?.key ? translateError(t, body) : body;
    const payload = ephemeralV2(buildErrorContainer(message, t));
    if (deferred || interaction.deferred) {
        await interaction.editReply(payload);
    } else if (interaction.replied) {
        await interaction.followUp(payload);
    } else {
        await interaction.reply(payload);
    }
}

module.exports = {
    INTERACTION_EXPIRED_CODE,
    buildFeedbackContainer,
    buildErrorContainer,
    buildSuccessContainer,
    ephemeralV2,
    replyExpiredInteraction,
    isInteractionExpired,
    safeInteractionUpdate,
    replyError,
};
