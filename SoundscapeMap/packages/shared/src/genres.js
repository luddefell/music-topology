export const MACRO_GENRES = [
  { id: 'electronic', label: 'Electronic', color: '#8B5CF6', colorblindColor: '#0072B2', icon: 'E' },
  { id: 'hiphop', label: 'Hip-Hop', color: '#F59E0B', colorblindColor: '#E69F00', icon: 'H' },
  { id: 'rock', label: 'Rock', color: '#EF4444', colorblindColor: '#D55E00', icon: 'R' },
  { id: 'pop', label: 'Pop', color: '#EC4899', colorblindColor: '#CC79A7', icon: 'P' },
  { id: 'jazz', label: 'Jazz', color: '#3B82F6', colorblindColor: '#56B4E9', icon: 'J' },
  { id: 'classical', label: 'Classical', color: '#6B7280', colorblindColor: '#999999', icon: 'C' },
  { id: 'latin', label: 'Latin', color: '#F97316', colorblindColor: '#F0E442', icon: 'L' },
  { id: 'country', label: 'Country', color: '#84CC16', colorblindColor: '#009E73', icon: 'Y' },
  { id: 'rnb', label: 'R&B / Soul', color: '#A855F7', colorblindColor: '#CC79A7', icon: 'S' },
  { id: 'folk', label: 'Folk / Indie', color: '#78716C', colorblindColor: '#999999', icon: 'F' },
  { id: 'metal', label: 'Metal', color: '#1F2937', colorblindColor: '#000000', icon: 'M' },
  { id: 'world', label: 'World', color: '#10B981', colorblindColor: '#009E73', icon: 'W' }
];

export const GENRE_IDS = MACRO_GENRES.map((genre) => genre.id);
export const GENRE_BY_ID = Object.fromEntries(MACRO_GENRES.map((genre) => [genre.id, genre]));

const RULES = [
  ['hiphop', /hip.?hop|rap|trap|drill|grime/],
  ['electronic', /electr|house|techno|edm|dance|dubstep|ambient|trance/],
  ['rock', /rock|punk|grunge|shoegaze|garage/],
  ['jazz', /jazz|bebop|swing|fusion/],
  ['classical', /classical|orchestra|baroque|opera|symphony|chamber/],
  ['latin', /latin|reggaeton|salsa|bachata|bossa|cumbia|mambo/],
  ['country', /country|bluegrass|americana|honky|western/],
  ['rnb', /r.?b|soul|funk|neo soul|quiet storm/],
  ['folk', /folk|indie|singer.songwriter|acoustic/],
  ['metal', /metal|hardcore|doom|black metal|death metal/],
  ['world', /afro|world|k.?pop|j.?pop|bollywood|bhangra|highlife|samba/],
  ['pop', /pop|chart|boy band|girl group/]
];

export function isMacroGenre(value) {
  return GENRE_IDS.includes(value);
}

export function classifyGenre(spotifyGenres = []) {
  const joined = spotifyGenres.join(' ').toLowerCase();
  for (const [genre, pattern] of RULES) {
    if (pattern.test(joined)) return genre;
  }
  return 'pop';
}

export function getGenreColor(genre, colorblind = false) {
  const item = GENRE_BY_ID[genre] ?? GENRE_BY_ID.pop;
  return colorblind ? item.colorblindColor : item.color;
}

export function sortedGenreScores(scores) {
  return Object.entries(scores)
    .filter(([, score]) => Number.isFinite(score) && score > 0)
    .sort((a, b) => b[1] - a[1]);
}
