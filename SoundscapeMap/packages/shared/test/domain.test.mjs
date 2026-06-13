import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyGenre,
  computeRegionScores,
  computeWeight,
  dominantGenre,
  isValidH3Cell,
  isValidTrackId,
  validateVotePayload
} from '../src/index.js';

test('classifyGenre maps Spotify genre strings to macro genres', () => {
  assert.equal(classifyGenre(['southern hip hop', 'trap']), 'hiphop');
  assert.equal(classifyGenre(['detroit techno']), 'electronic');
  assert.equal(classifyGenre(['bebop', 'vocal jazz']), 'jazz');
  assert.equal(classifyGenre(['unknown shimmer music']), 'pop');
});

test('computeWeight applies a 45 minute half-life', () => {
  const now = new Date('2026-06-13T12:00:00Z');
  const votedAt = new Date('2026-06-13T11:15:00Z');
  assert.equal(Number(computeWeight(votedAt, now).toFixed(3)), 0.5);
});

test('computeRegionScores decays votes and preserves dominant genre', () => {
  const now = new Date('2026-06-13T12:00:00Z');
  const scores = computeRegionScores([
    { genre: 'jazz', voted_at: '2026-06-13T11:55:00Z', weight: 1, source: 'vote' },
    { genre: 'hiphop', voted_at: '2026-06-13T10:30:00Z', weight: 1, source: 'vote' },
    { genre: 'jazz', voted_at: '2026-06-13T11:50:00Z', weight: 1, source: 'listening' }
  ], now);
  assert.equal(dominantGenre(scores), 'jazz');
  assert.ok(scores.jazz > scores.hiphop);
});

test('validation rejects malformed votes', () => {
  assert.equal(isValidH3Cell('872664c1effffff'), true);
  assert.equal(isValidH3Cell('not-a-cell'), false);
  assert.equal(isValidTrackId('spotify:track:4iV5W9uYEdYUVa79Axb7Rh'), true);
  assert.equal(isValidTrackId('4iV5W9uYEdYUVa79Axb7Rh'), false);
  assert.deepEqual(validateVotePayload({
    h3_cell: '872664c1effffff',
    track_id: 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh',
    genre: 'hiphop'
  }), { ok: true, errors: [] });
});
