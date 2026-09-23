const { PermissionFlagsBits } = require("discord.js");

const TEXT_CHANNEL_CHECKS = [
    { labelKey: "chatplay.permissions.viewChannel", bit: PermissionFlagsBits.ViewChannel },
    { labelKey: "chatplay.permissions.sendMessages", bit: PermissionFlagsBits.SendMessages },
    { labelKey: "chatplay.permissions.embedLinks", bit: PermissionFlagsBits.EmbedLinks },
];

const VOICE_CHANNEL_CHECKS = [
    { labelKey: "chatplay.permissions.viewChannel", bit: PermissionFlagsBits.ViewChannel },
    { labelKey: "commands.troubleshoot.connect", bit: PermissionFlagsBits.Connect },
    { labelKey: "commands.troubleshoot.speak", bit: PermissionFlagsBits.Speak },
];

function mapPermissionChecks(perms, definitions, { optional = false } = {}) {
    return definitions.map(({ labelKey, bit }) => ({
        labelKey,
        optional,
        ok: Boolean(perms?.has(bit)),
    }));
}

function guildHasVoiceConnectSpeak(botMember, guild) {
    const voiceChannels = guild.channels.cache.filter((channel) => channel.isVoiceBased?.());
    for (const channel of voiceChannels.values()) {
        const perms = botMember.permissionsIn(channel);
        if (perms.has(PermissionFlagsBits.Connect) && perms.has(PermissionFlagsBits.Speak)) {
            return true;
        }
    }
    return false;
}

/**
 * Audit bot permissions needed for music, player UI, and optional ChatPlay/profile features.
 * @returns {{ botMissing: boolean, sections: object[], allRequiredOk: boolean }}
 */
function auditGuildPermissions(guild, { textChannel, member } = {}) {
    const botMember = guild?.members?.me;
    if (!botMember) {
        return { botMissing: true, sections: [], allRequiredOk: false };
    }

    const sections = [];

    if (textChannel?.isTextBased?.()) {
        const textPerms = botMember.permissionsIn(textChannel);
        sections.push({
            id: "textChannel",
            channelId: textChannel.id,
            checks: mapPermissionChecks(textPerms, TEXT_CHANNEL_CHECKS),
        });

        const optionalChecks = [
            {
                labelKey: "chatplay.permissions.manageChannels",
                optional: true,
                ok: textPerms.has(PermissionFlagsBits.ManageChannels),
            },
            {
                labelKey: "commands.troubleshoot.pinOrManageMessages",
                optional: true,
                ok:
                    textPerms.has(PermissionFlagsBits.PinMessages) ||
                    textPerms.has(PermissionFlagsBits.ManageMessages),
            },
        ];
        optionalChecks.push({
            labelKey: "commands.troubleshoot.changeNickname",
            optional: true,
            ok: botMember.permissions.has(PermissionFlagsBits.ChangeNickname),
        });
        sections.push({
            id: "optional",
            checks: optionalChecks,
        });
    } else {
        sections.push({
            id: "optional",
            checks: [
                {
                    labelKey: "commands.troubleshoot.changeNickname",
                    optional: true,
                    ok: botMember.permissions.has(PermissionFlagsBits.ChangeNickname),
                },
            ],
        });
    }

    const voiceChannel = member?.voice?.channel;
    if (voiceChannel) {
        const voicePerms = botMember.permissionsIn(voiceChannel);
        sections.push({
            id: "voiceChannel",
            channelId: voiceChannel.id,
            checks: mapPermissionChecks(voicePerms, VOICE_CHANNEL_CHECKS),
        });
    } else {
        sections.push({
            id: "voiceGeneral",
            showVoiceHint: true,
            checks: [
                {
                    labelKey: "chatplay.permissions.connectSpeak",
                    optional: false,
                    ok: guildHasVoiceConnectSpeak(botMember, guild),
                },
            ],
        });
    }

    const allRequiredOk = sections.every((section) =>
        section.checks.filter((check) => !check.optional).every((check) => check.ok)
    );

    return { botMissing: false, sections, allRequiredOk };
}

module.exports = {
    auditGuildPermissions,
    guildHasVoiceConnectSpeak,
};
