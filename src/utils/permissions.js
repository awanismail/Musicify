const VOICE_CHANNEL_DENIAL_KEY = "errors.permissions.voiceChannelDenial";

function canControlMusic(member, player) {
    const memberChannel = member?.voice?.channel;
    if (!memberChannel || !player?.voiceChannel) return false;
    return memberChannel.id === player.voiceChannel;
}

module.exports = { canControlMusic, VOICE_CHANNEL_DENIAL_KEY };
