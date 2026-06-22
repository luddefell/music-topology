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
  ['hiphop', /\b(hip.?hop|rap|trap|drill|grime|phonk|jersey club|plugg|rage|mumble rap|melodic rap|conscious rap|southern hip hop|atl hip hop|dirty south|boom bap|gangster rap|cloud rap|emo rap|uk drill|brooklyn drill|detroit trap|miami hip hop)\b/],
  ['electronic', /\b(electr|house|techno|edm|dance|dubstep|ambient|trance|garage|dnb|drum and bass|jungle|breakbeat|breaks|idm|glitch|downtempo|trip hop|future bass|bass music|electro|synthwave|chillwave|vaporwave|lo-fi beats|lofi beats|escape room|hyperpop|nightcore|electropop)\b/],
  ['rock', /\b(rock|punk|grunge|shoegaze|garage rock|permanent wave|modern rock|alternative rock|alt rock|indie rock|post-punk|new wave|emo|screamo|hard rock|psych rock|psychedelic rock|surf rock|classic rock|progressive rock|prog rock)\b/],
  ['jazz', /\b(jazz|bebop|swing|fusion|cool jazz|free jazz|vocal jazz|jazz funk|jazz fusion|bossa nova jazz|hard bop|big band|ragtime)\b/],
  ['classical', /\b(classical|orchestra|orchestral|baroque|opera|symphony|chamber|choral|choir|concerto|sonata|romantic era|early music|minimalism|modern classical|classical piano)\b/],
  ['latin', /\b(latin|reggaeton|salsa|bachata|bossa|cumbia|mambo|merengue|corridos|mariachi|regional mexican|latin trap|latin hip hop|latin pop|urbano latino|sertanejo|mpb|tango|ranchera|norteno)\b/],
  ['country', /\b(country|bluegrass|americana|honky|western|red dirt|outlaw country|country road|country pop|country rock|nashville|roots americana|banjo)\b/],
  ['rnb', /\b(r.?b|r and b|soul|funk|neo soul|quiet storm|trap soul|alternative r.?b|alt r.?b|urban contemporary|new jack swing|motown|doo-wop|gospel r.?b|soul jazz)\b/],
  ['folk', /\b(folk|indie folk|singer.songwriter|singer-songwriter|acoustic|roots|stomp and holler|chamber folk|folk rock|indie pop|bedroom pop|art pop|dream pop|lo-fi indie|lofi indie|anti-folk)\b/],
  ['metal', /\b(metal|hardcore|doom|black metal|death metal|metalcore|deathcore|thrash|sludge|grindcore|nu metal|power metal|symphonic metal|progressive metal|post-metal)\b/],
  ['world', /\b(afro|afrobeats|afropop|world|k.?pop|j.?pop|c.?pop|mandopop|cantopop|bollywood|bhangra|highlife|samba|dancehall|reggae|dub|ska|soca|calypso|gqom|amapiano|arab pop|turkish pop|french chanson|flamenco|qawwali)\b/],
  ['pop', /\b(pop|chart|boy band|girl group|dance pop|pop rap|pop rock|synthpop|teen pop|viral pop|post-teen pop|soft pop|power pop|brill building pop|bubblegum pop)\b/]
];

const FALLBACK_GENRE = 'pop';
const POP_PENALTY = 0.72;

export function isMacroGenre(value) {
  return GENRE_IDS.includes(value);
}

export function classifyGenre(spotifyGenres = []) {
  const scores = Object.fromEntries(GENRE_IDS.map((genre) => [genre, 0]));
  for (const rawGenre of spotifyGenres) {
    const genreText = String(rawGenre).toLowerCase();
    for (const [genre, pattern] of RULES) {
      if (pattern.test(genreText)) {
        scores[genre] += genre === 'pop' ? POP_PENALTY : 1;
      }
    }
  }
  const [winner, score] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return score > 0 ? winner : FALLBACK_GENRE;
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
