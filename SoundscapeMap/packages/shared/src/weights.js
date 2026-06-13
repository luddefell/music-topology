export const HALF_LIFE_MINUTES = 45;
export const LIVE_WINDOW_MINUTES = 120;

export function computeWeight(votedAt, now = new Date()) {
  const voted = votedAt instanceof Date ? votedAt : new Date(votedAt);
  const ageMinutes = Math.max(0, (now.getTime() - voted.getTime()) / 60000);
  return Math.pow(0.5, ageMinutes / HALF_LIFE_MINUTES);
}

export function computeRegionScores(votes, now = new Date()) {
  const scores = {};
  for (const vote of votes) {
    const baseWeight = Number.isFinite(vote.weight) ? vote.weight : 1;
    const sourceWeight = vote.source === 'listening' ? 0.6 : 1;
    const decayed = baseWeight * sourceWeight * computeWeight(vote.voted_at ?? vote.votedAt, now);
    scores[vote.genre] = (scores[vote.genre] ?? 0) + decayed;
  }
  return scores;
}

export function dominantGenre(scores, fallback = 'pop') {
  let bestGenre = fallback;
  let bestScore = -Infinity;
  for (const [genre, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestGenre = genre;
      bestScore = score;
    }
  }
  return bestGenre;
}

export function voteIsLive(votedAt, now = new Date()) {
  const voted = votedAt instanceof Date ? votedAt : new Date(votedAt);
  return now.getTime() - voted.getTime() <= LIVE_WINDOW_MINUTES * 60000;
}
