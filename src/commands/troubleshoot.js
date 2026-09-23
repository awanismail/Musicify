const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const { slashMeta, getT } = require("../i18n");
const { auditGuildPermissions } = require("../utils/guildPermissionsAudit");
const { buildFeedbackContainer, ephemeralV2 } = require("../utils/replies");

function sectionPlace(t, section) {
    if (section.id === "textChannel" || section.id === "voiceChannel") {
        return `<#${section.channelId}>`;
    }
    if (section.id === "voiceGeneral") {
        return t("commands.troubleshoot.placeVoice");
    }
    return "";
}

function buildFailureLines(t, audit) {
    const lines = [];

    for (const section of audit.sections) {
        if (section.id === "optional") continue;

        const failed = section.checks.filter((check) => !check.optional && !check.ok);
        if (!failed.length) continue;

        const place = sectionPlace(t, section);
        const labels = failed.map((check) => t(check.labelKey)).join(", ");
        lines.push(t("commands.troubleshoot.missingLine", { place, labels }));

        if (section.showVoiceHint && section.id === "voiceGeneral") {
            lines.push(t("commands.troubleshoot.voiceHintShort"));
        }
    }

    return lines;
}

function buildTroubleshootContainer(t, audit) {
    const container = new ContainerBuilder();

    if (audit.allRequiredOk) {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(t("commands.troubleshoot.allGood"))
        );
        return container;
    }

    const body = [t("commands.troubleshoot.summaryFail"), ...buildFailureLines(t, audit)].join(
        "\n"
    );

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
    return container;
}

module.exports = {
    data: slashMeta("troubleshoot"),

    async execute(interaction, client) {
        const t = getT(interaction, client);

        if (!interaction.inGuild()) {
            return interaction.reply(
                ephemeralV2(buildFeedbackContainer(t("commands.troubleshoot.guildOnly")))
            );
        }

        const audit = auditGuildPermissions(interaction.guild, {
            textChannel: interaction.channel,
            member: interaction.member,
        });

        if (audit.botMissing) {
            return interaction.reply(
                ephemeralV2(buildFeedbackContainer(t("commands.troubleshoot.botMissing")))
            );
        }

        const container = buildTroubleshootContainer(t, audit);

        return interaction.reply({
            components: [container],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    },
};
