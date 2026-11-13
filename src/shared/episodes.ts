import type { EpisodeInfo, TrackInfo } from './types';

const pad = (n: number): string => String(n).padStart(2, '0');

/** `S03E09`; only the known part when Jellyfin lacks the season or episode number, empty when it lacks both. */
export function episodeCode(episode: Pick<EpisodeInfo, 'season' | 'episode'>): string {
    return `${episode.season !== null ? `S${pad(episode.season)}` : ''}${episode.episode !== null ? `E${pad(episode.episode)}` : ''}`;
}

/**
 * The title an item is listed under: an episode gets its code in front (`S03E09 Name`) and, with
 * `appendSeriesName`, its series after a dash (`S03E09 Name – Series`). Everything else keeps its title.
 */
export function displayTitle(track: Pick<TrackInfo, 'title' | 'episode'>, appendSeriesName: boolean): string {
    const episode = track.episode;
    if (!episode) return track.title;
    const title = [episodeCode(episode), track.title].filter(Boolean).join(' ');
    return appendSeriesName && episode.seriesName ? `${title} – ${episode.seriesName}` : title;
}
