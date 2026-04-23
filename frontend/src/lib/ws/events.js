// Typed WebSocket events per channel.
// Channels are identified by a prefix + resource id, e.g. "arena/{matchId}".
export function channelPrefix(channel) {
    const p = channel.split('/')[0];
    if (p === 'arena' || p === 'spectator' || p === 'mock' || p === 'warroom')
        return p;
    return null;
}
