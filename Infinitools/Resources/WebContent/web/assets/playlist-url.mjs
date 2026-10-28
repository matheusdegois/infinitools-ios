const youtubeHosts = new Set(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtu.be','www.youtu.be']);

export function looksLikePlaylist(url) {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    if (['vt.tiktok.com','vm.tiktok.com'].includes(parsed.hostname.toLowerCase())) return true;
    if (youtubeHosts.has(parsed.hostname.toLowerCase())) {
        return path === '/playlist' || parsed.searchParams.has('list');
    }
    return /\/(?:playlist|playlists|collection|collections)(?:\/|$)/i.test(path) || parsed.searchParams.has('playlist');
}
