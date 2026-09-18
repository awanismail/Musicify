const { MessageFlags } = require("discord.js");
const { handleButtonInteraction } = require("../handlers/buttonHandler");
const { handleChatPlaySetupModal } = require("../handlers/chatPlaySetupHandler");
const { applyChatPlayEphemeral } = require("../handlers/chatPlayHandler");
const { getT } = require("../i18n");
const {
    isInteractionExpired,
    replyExpiredInteraction,
    buildErrorContainer,
    ephemeralV2,
} = require("../utils/replies");

module.exports = {
    name: "interactionCreate",
    async execute(client, interaction) {
        if (interaction.guild) {
            applyChatPlayEphemeral(interaction);
        }

        if (interaction.isAutocomplete()) {
            const command = client.commands.get(interaction.commandName);
            if (!command?.autocomplete) return;

            try {
                await command.autocomplete(interaction, client);
            } catch (error) {
                console.error(
                    `[Musicify] Autocomplete error (${interaction.commandName}):`,
                    error.message
                );
                try {
                    await interaction.respond([]);
                } catch {
                    // interaction already answered
                }
            }
            return;
        }

        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) return;

            const t = getT(interaction, client);

            try {
                await command.execute(interaction, client);
            } catch (error) {
                console.error(`[Musicify] Command error (${interaction.commandName}):`, error);

                if (isInteractionExpired(error)) {
                    await replyExpiredInteraction(interaction, t);
                    return;
                }

                try {
                    const payload = ephemeralV2(
                        buildErrorContainer(t("errors.unexpected"), t)
                    );
                    if (interaction.replied || interaction.deferred) {
                        await interaction.followUp(payload);
                    } else {
                        await interaction.reply(payload);
                    }
                } catch (replyError) {
                    if (isInteractionExpired(replyError)) {
                        await replyExpiredInteraction(interaction, t);
                    } else {
                        console.error("[Musicify] Error sending error reply:", replyError);
                    }
                }
            }
            return;
        }

        if (interaction.isModalSubmit()) {
            const t = getT(interaction, client);

            try {
                const { handleDjModal } = require("../commands/dj");
                if (await handleDjModal(client, interaction)) return;

                const { handleProfileBioModal } = require("../commands/profile");
                if (await handleProfileBioModal(client, interaction)) return;

                const handled = await handleChatPlaySetupModal(client, interaction);
                if (handled) return;
            } catch (error) {
                console.error("[Musicify] Modal interaction error:", error);
                if (isInteractionExpired(error)) {
                    await replyExpiredInteraction(interaction, t);
                    return;
                }
                try {
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply(
                            ephemeralV2(
                                buildErrorContainer(t("errors.interactionFailed"), t)
                            )
                        );
                    }
                } catch (replyError) {
                    if (isInteractionExpired(replyError)) {
                        await replyExpiredInteraction(interaction, t);
                    }
                }
            }
            return;
        }

        if (
            interaction.isButton() ||
            interaction.isStringSelectMenu() ||
            interaction.isRoleSelectMenu()
        ) {
            const t = getT(interaction, client);

            try {
                await handleButtonInteraction(client, interaction);
            } catch (error) {
                console.error("[Musicify] Interaction error:", error);
                if (isInteractionExpired(error)) {
                    await replyExpiredInteraction(interaction, t);
                    return;
                }
                try {
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply(
                            ephemeralV2(
                                buildErrorContainer(t("errors.interactionFailed"), t)
                            )
                        );
                    }
                } catch (replyError) {
                    if (isInteractionExpired(replyError)) {
                        await replyExpiredInteraction(interaction, t);
                    }
                }
            }
        }
    },
};
