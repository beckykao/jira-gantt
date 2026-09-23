// Shared work-track (分工) helpers for the frontend. The board's preset list
// is user-editable; anything not in the list still gets a stable colour.

export const DEFAULT_TRACKS = [
  { name: '前端', color: '#3355EE' },
  { name: '中台', color: '#12B886' },
  { name: 'PM測試', color: '#F59F00' },
];

export const TRACK_COLOR_CHOICES = [
  '#3355EE',
  '#12B886',
  '#F59F00',
  '#E64980',
  '#7048E8',
  '#15AABF',
  '#FA5252',
  '#2F9E44',
  '#1971C2',
  '#495057',
];

const FALLBACK_COLORS = ['#7048E8', '#E64980', '#15AABF', '#FA5252', '#2F9E44', '#495057'];

export function trackColor(presets, track) {
  if (!track) return '#4C6EF5';
  const preset = (presets || []).find((p) => p.name === track);
  if (preset) return preset.color;
  let hash = 0;
  for (let i = 0; i < track.length; i++) hash = (hash * 31 + track.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

/** Order used for track sub-rows: preset order first, then anything else. */
export function trackSortIndex(presets, track) {
  const idx = (presets || []).findIndex((p) => p.name === track);
  return idx === -1 ? 999 : idx;
}
