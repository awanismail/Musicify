const { PermissionFlagsBits } = require("discord.js");

function auditChannelPermissions(guild, channel) {
    const botMember = guild.members.me;
    if (!botMember) {
        return { checks: [], canProceed: false };
    }

    const perms = botMember.permissionsIn(channel);
    const checks = [
        {
            labelKey: "chatplay.permissions.viewChannel",
            ok: perms.has(PermissionFlagsBits.ViewChannel),
        },
        {
            labelKey: "chatplay.permissions.sendMessages",
            ok: perms.has(PermissionFlagsBits.SendMessages),
        },
        {
            labelKey: "chatplay.permissions.embedLinks",
            ok: perms.has(PermissionFlagsBits.EmbedLinks),
        },
        {
            labelKey: "chatplay.permissions.manageChannels",
            ok: perms.has(PermissionFlagsBits.ManageChannels),
            optional: true,
        },
    ];

    const voiceChannels = guild.channels.cache.filter((c) => c.isVoiceBased?.());
    let voiceOk = false;
    for (const vc of voiceChannels.values()) {
        const vcPerms = botMember.permissionsIn(vc);
        if (
            vcPerms.has(PermissionFlagsBits.Connect) &&
            vcPerms.has(PermissionFlagsBits.Speak)
        ) {
            voiceOk = true;
            break;
        }
    }

    checks.push({
        labelKey: "chatplay.permissions.connectSpeak",
        ok: voiceOk,
    });

    const required = checks.filter((c) => !c.optional);
    const canProceed = required.every((c) => c.ok);

    return { checks, canProceed };
}

function formatPermissionAuditFailure(t, checks) {
    const failedRequired = checks.filter((check) => !check.ok && !check.optional);
    if (!failedRequired.length) {
        return t("chatplay.handlers.missingPermissionsChannel");
    }

    const list = failedRequired.map((check) => `-# ${t(check.labelKey)}`).join("\n");
    return t("chatplay.handlers.missingPermissionsList", { list });
}

module.exports = {
    auditChannelPermissions,
    formatPermissionAuditFailure,
};
