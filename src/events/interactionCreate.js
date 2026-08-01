const { MessageFlags } = require("discord.js");
const { handleButtonInteraction } = require("../handlers/buttonHandler");
const { handleChatPlaySetupModal } = require("../handlers/chatPlaySetupHandler");
const { applyChatPlayEphemeral } = require("../handlers/chatPlayHandler");
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

        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) return;

            try {
                await command.execute(interaction, client);
            } catch (error) {
                console.error(`[Musicify] Command error (${interaction.commandName}):`, error);

                if (isInteractionExpired(error)) {
                    await replyExpiredInteraction(interaction);
                    return;
                }

                try {
                    const payload = ephemeralV2(
                        buildErrorContainer("**Something went wrong**\n-# An unexpected error occurred. Try again.")
                    );
                    if (interaction.replied || interaction.deferred) {
                        await interaction.followUp(payload);
                    } else {
                        await interaction.reply(payload);
                    }
                } catch (replyError) {
                    if (isInteractionExpired(replyError)) {
                        await replyExpiredInteraction(interaction);
                    } else {
                        console.error("[Musicify] Error sending error reply:", replyError);
                    }
                }
            }
            return;
        }

        if (interaction.isModalSubmit()) {
            try {
                const handled = await handleChatPlaySetupModal(client, interaction);
                if (handled) return;
            } catch (error) {
                console.error("[Musicify] Modal interaction error:", error);
                if (isInteractionExpired(error)) {
                    await replyExpiredInteraction(interaction);
                    return;
                }
                try {
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply(
                            ephemeralV2(
                                buildErrorContainer("**Something went wrong**\n-# That interaction failed. Try again.")
                            )
                        );
                    }
                } catch (replyError) {
                    if (isInteractionExpired(replyError)) {
                        await replyExpiredInteraction(interaction);
                    }
                }
            }
            return;
        }

        if (interaction.isButton() || interaction.isStringSelectMenu()) {
            try {
                await handleButtonInteraction(client, interaction);
            } catch (error) {
                console.error("[Musicify] Interaction error:", error);
                if (isInteractionExpired(error)) {
                    await replyExpiredInteraction(interaction);
                    return;
                }
                try {
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply(
                            ephemeralV2(
                                buildErrorContainer("**Something went wrong**\n-# That interaction failed. Try again.")
                            )
                        );
                    }
                } catch (replyError) {
                    if (isInteractionExpired(replyError)) {
                        await replyExpiredInteraction(interaction);
                    }
                }
            }
        }
    },
};
