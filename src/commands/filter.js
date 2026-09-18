const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const { slashMeta, getT, applySlashOption, buildSlashChoice } = require("../i18n");
const { buildErrorContainer, ephemeralV2 } = require("../utils/replies");
const { requirePlayerControl } = require("../utils/playerControls");
const { PLAYER_ACTIONS } = require("../utils/permissions");

const FILTER_PRESETS = {
    bassboost: { emoji: "🔊", apply: (p) => p.filters.setBassboost(true, { value: 4 }) },
    nightcore: { emoji: "🌙", apply: (p) => p.filters.setTimescale(true, { speed: 1.2, pitch: 1.2, rate: 1.0 }) },
    vaporwave: { emoji: "🌊", apply: (p) => p.filters.setVaporwave(true, { pitch: 0.5 }) },
    "8d": { emoji: "🎧", apply: (p) => p.filters.set8D(true, { rotationHz: 0.2 }) },
    tremolo: { emoji: "〰️", apply: (p) => p.filters.setTremolo(true, { frequency: 4.0, depth: 0.75 }) },
    vibrato: { emoji: "🎸", apply: (p) => p.filters.setVibrato(true, { frequency: 4.0, depth: 0.75 }) },
    karaoke: { emoji: "🎤", apply: (p) => p.filters.setKaraoke(true, { level: 1.0, monoLevel: 1.0, filterBand: 220.0, filterWidth: 100.0 }) },
    lowpass: { emoji: "🔈", apply: (p) => p.filters.setLowPass(true, { smoothing: 20.0 }) },
    slowmode: { emoji: "🐌", apply: (p) => p.filters.setSlowmode(true, { rate: 0.8 }) },
    distortion: { emoji: "💥", apply: (p) => p.filters.setDistortion(true, { sinOffset: 0, sinScale: 1, cosOffset: 0, cosScale: 1, tanOffset: 0, tanScale: 1, offset: 0, scale: 1 }) },
};

module.exports = {
    data: slashMeta("filter").addStringOption((opt) =>
        applySlashOption(
            opt
                .setName("preset")
                .setRequired(true)
                .addChoices(
                    buildSlashChoice("filter", "preset", "bassboost", "bassboost"),
                    buildSlashChoice("filter", "preset", "nightcore", "nightcore"),
                    buildSlashChoice("filter", "preset", "vaporwave", "vaporwave"),
                    buildSlashChoice("filter", "preset", "8d", "8d"),
                    buildSlashChoice("filter", "preset", "tremolo", "tremolo"),
                    buildSlashChoice("filter", "preset", "vibrato", "vibrato"),
                    buildSlashChoice("filter", "preset", "karaoke", "karaoke"),
                    buildSlashChoice("filter", "preset", "lowpass", "lowpass"),
                    buildSlashChoice("filter", "preset", "slowmode", "slowmode"),
                    buildSlashChoice("filter", "preset", "distortion", "distortion"),
                    buildSlashChoice("filter", "preset", "reset", "reset")
                ),
            "filter",
            "preset"
        )
    ),

    async execute(interaction, client) {
        const t = getT(interaction, client);
        const ctx = await requirePlayerControl(interaction, client, t, {
            action: PLAYER_ACTIONS.CONTROL,
            requireCurrent: true,
        });
        if (!ctx) return;

        const { player } = ctx;
        const preset = interaction.options.getString("preset");

        if (preset === "reset") {
            player.filters.clearFilters();
            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `${t("commands.filter.resetHeading")}\n\n` +
                        `${t("common.labels.status")}\n` +
                        t("commands.filter.resetStatus")
                )
            );
            return interaction.reply({
                components: [container],
                flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
            });
        }

        const filter = FILTER_PRESETS[preset];
        if (!filter) {
            return interaction.reply(
                ephemeralV2(buildErrorContainer(t("commands.filter.unknownPreset"), t))
            );
        }

        const presetName = t(`commands.filter.presets.${preset}`);

        try {
            filter.apply(player);
        } catch (err) {
            console.error(`[Musicify] Filter "${preset}" error:`, err.message);
            return interaction.reply(
                ephemeralV2(
                    buildErrorContainer(
                        t("commands.filter.applyFailed", { name: presetName }),
                        t
                    )
                )
            );
        }

        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${t("commands.filter.successHeading", { emoji: filter.emoji })}\n\n` +
                    `${t("common.labels.preset")}\n` +
                    `-# ${presetName}\n\n` +
                    `${t("common.labels.track")}\n` +
                    `-# ${player.current.info.title}`
            )
        );
        await interaction.reply({
            components: [container],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    },
};
