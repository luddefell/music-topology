import { Activity, AudioLines, Eye, LocateFixed, Music2, Palette, Radio, Search, ShieldCheck } from 'lucide-react';
import { GENRE_BY_ID, MACRO_GENRES, sortedGenreScores } from '@soundscapemap/shared';
import type { RegionSnapshot } from '../state/useAppStore';

interface Props {
  snapshot: RegionSnapshot;
  autoVote: boolean;
  spotifyConnected: boolean;
  spotifyStatus?: string;
  colorblindPalette: boolean;
  onVote: (genre: string, trackId: string) => void;
  onSpotify: () => void;
  onAutoVote: (enabled: boolean) => void;
  onColorblind: (enabled: boolean) => void;
}

export function RegionPanel({
  snapshot,
  autoVote,
  spotifyConnected,
  spotifyStatus,
  colorblindPalette,
  onVote,
  onSpotify,
  onAutoVote,
  onColorblind
}: Props) {
  const dominant = GENRE_BY_ID[snapshot.dominant_genre] ?? GENRE_BY_ID.unknown;
  const topScores = sortedGenreScores(snapshot.genre_scores).slice(0, 3);

  return (
    <aside className="region-panel" aria-label={`${dominant.label} zone, ${snapshot.vote_count} votes`}>
      <header className="panel-head">
        <div className="genre-chip" style={{ borderColor: dominant.color }}>
          <AudioLines size={18} aria-hidden="true" />
          <span>{dominant.label}</span>
        </div>
        <div className="cell-code">{snapshot.h3_cell}</div>
      </header>

      <section className="stat-row">
        <div>
          <span className="stat-value">{snapshot.vote_count}</span>
          <span className="stat-label">song votes here</span>
          <span className="stat-label">from {snapshot.unique_user_count ?? 0} {(snapshot.unique_user_count ?? 0) === 1 ? 'listener/device' : 'listeners/devices'}</span>
        </div>
        <Activity size={22} aria-hidden="true" />
      </section>

      <section className="score-bars" aria-label="Genre distribution">
        {topScores.length ? topScores.map(([genre, score]) => {
          const item = GENRE_BY_ID[genre] ?? GENRE_BY_ID.unknown;
          const width = `${Math.max(8, Math.min(100, score * 100))}%`;
          return (
            <div className="score-line" key={genre}>
              <span>{item.label}</span>
              <div><i style={{ width, background: item.color }} /></div>
            </div>
          );
        }) : <p className="empty-copy">Be the first to define the sound of this area</p>}
      </section>

      <section className="track-list" aria-label="Top songs">
        {(snapshot.top_tracks ?? []).slice(0, 5).map((track) => (
          <div className="track-row" key={track.track_id}>
            <Music2 size={16} aria-hidden="true" />
            <span>{track.track_id.replace('spotify:track:', '')}</span>
            <b>{track.count}</b>
          </div>
        ))}
      </section>

      <VoteForm onVote={onVote} />

      <div className="panel-actions">
        <button type="button" className="icon-button text-button" onClick={onSpotify}>
          <Radio size={18} aria-hidden="true" />
          <span>{spotifyConnected ? 'Spotify connected' : 'Connect Spotify'}</span>
        </button>
        <label className={`toggle ${autoVote ? 'active' : ''}`}>
          <ShieldCheck size={18} aria-hidden="true" />
          <span>Auto-vote</span>
          <input type="checkbox" checked={autoVote} disabled={!spotifyConnected} onChange={(event) => onAutoVote(event.target.checked)} />
        </label>
        <label className={`toggle ${colorblindPalette ? 'active' : ''}`}>
          <Palette size={18} aria-hidden="true" />
          <span>Palette</span>
          <input type="checkbox" checked={colorblindPalette} onChange={(event) => onColorblind(event.target.checked)} />
        </label>
      </div>
      {spotifyStatus && <p className="status-copy">{spotifyStatus}</p>}
    </aside>
  );
}

function VoteForm({ onVote }: { onVote: (genre: string, trackId: string) => void }) {
  return (
    <form
      className="vote-form"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        onVote(String(form.get('genre')), String(form.get('track')));
      }}
    >
      <label>
        <Search size={16} aria-hidden="true" />
        <input name="track" defaultValue="spotify:track:4iV5W9uYEdYUVa79Axb7Rh" aria-label="Track URI" />
      </label>
      <select name="genre" aria-label="Genre">
        {MACRO_GENRES.map((genre) => <option key={genre.id} value={genre.id}>{genre.label}</option>)}
      </select>
      <button type="submit" className="primary-action">
        <LocateFixed size={18} aria-hidden="true" />
        <span>Vote</span>
      </button>
    </form>
  );
}
