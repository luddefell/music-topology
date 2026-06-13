import assert from 'node:assert/strict';
import { classifyGenre, computeRegionScores, dominantGenre, validateVotePayload } from '../packages/shared/src/index.js';

const payload = {
  h3_cell: '872664c1effffff',
  track_id: 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh',
  genre: classifyGenre(['chicago house'])
};

assert.equal(payload.genre, 'electronic');
assert.equal(validateVotePayload(payload).ok, true);

const scores = computeRegionScores([
  { genre: 'electronic', voted_at: new Date(), source: 'vote', weight: 1 },
  { genre: 'jazz', voted_at: new Date(Date.now() - 90 * 60000), source: 'vote', weight: 1 }
]);

assert.equal(dominantGenre(scores), 'electronic');
console.log('SoundscapeMap smoke test passed');
