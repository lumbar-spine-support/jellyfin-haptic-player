import { displayTitle } from '../../../shared/episodes';
import type { TrackInfo } from '../../../shared/types';

/** Per-browser setting (Settings → Library); cards, rows and the player all follow it. */
let appendSeriesName = true;

export function setAppendSeriesName(append: boolean): void {
    appendSeriesName = append;
}

/** The title a track is shown under: episodes as `S03E09 Name`, followed by `– Series` when the setting is on. */
export function trackTitle(track: Pick<TrackInfo, 'title' | 'episode'>): string {
    return displayTitle(track, appendSeriesName);
}
