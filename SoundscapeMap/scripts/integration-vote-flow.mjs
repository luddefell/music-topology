import assert from 'node:assert/strict';
import pg from 'pg';
import WebSocket from 'ws';

const apiBase = process.env.API_BASE ?? 'http://localhost:18080';
const wsUrl = process.env.WS_URL ?? 'ws://localhost:18080/ws';
const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://soundscape:soundscape@localhost:55432/soundscape';

const { Pool } = pg;
const pool = new Pool({ connectionString: databaseUrl });

function waitForOpen(socket) {
  return new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
}

function waitForRegionUpdate(socket, cell, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for region_update')), timeoutMs);
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'region_update' && message.h3_cell === cell) {
        clearTimeout(timeout);
        resolve(message);
      }
    });
  });
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => undefined);
  return { response, body };
}

const randomHex = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
const h3Cell = `872664c1e${randomHex}`;
const trackId = 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh';

try {
  const health = await jsonFetch(`${apiBase}/health`);
  assert.equal(health.response.status, 200);
  assert.equal(health.body.ok, true);

  const dbHealth = await jsonFetch(`${apiBase}/health/db`);
  assert.equal(dbHealth.response.status, 200);
  assert.equal(dbHealth.body.ok, true);

  const redisHealth = await jsonFetch(`${apiBase}/health/redis`);
  assert.equal(redisHealth.response.status, 200);
  assert.equal(redisHealth.body.ok, true);

  const auth = await jsonFetch(`${apiBase}/api/auth/anonymous`, { method: 'POST' });
  assert.equal(auth.response.status, 200);
  assert.ok(auth.body.jwt);

  const socket = new WebSocket(wsUrl);
  await waitForOpen(socket);
  const updatePromise = waitForRegionUpdate(socket, h3Cell);
  socket.send(JSON.stringify({ type: 'subscribe', cells: [h3Cell] }));

  const vote = await jsonFetch(`${apiBase}/api/votes`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${auth.body.jwt}`
    },
    body: JSON.stringify({ h3_cell: h3Cell, track_id: trackId, genre: 'hiphop' })
  });

  assert.equal(vote.response.status, 200);
  assert.equal(vote.body.ok, true);
  assert.equal(vote.body.region_snapshot.h3_cell, h3Cell);
  assert.equal(vote.body.region_snapshot.dominant_genre, 'hiphop');
  assert.equal(vote.body.region_snapshot.vote_count, 1);

  const update = await updatePromise;
  assert.equal(update.snapshot.dominant_genre, 'hiphop');
  assert.equal(update.snapshot.vote_count, 1);

  const voteRows = await pool.query('SELECT h3_cell, track_id, genre, source FROM votes WHERE h3_cell = $1', [h3Cell]);
  assert.equal(voteRows.rowCount, 1);
  assert.deepEqual(voteRows.rows[0], {
    h3_cell: h3Cell,
    track_id: trackId,
    genre: 'hiphop',
    source: 'vote'
  });

  const snapshotRows = await pool.query('SELECT h3_cell, dominant_genre, vote_count FROM region_snapshots WHERE h3_cell = $1', [h3Cell]);
  assert.equal(snapshotRows.rowCount, 1);
  assert.equal(snapshotRows.rows[0].dominant_genre, 'hiphop');
  assert.equal(snapshotRows.rows[0].vote_count, 1);

  socket.close();
  console.log(JSON.stringify({ ok: true, h3_cell: h3Cell, websocket_update: update.type, vote_rows: voteRows.rowCount, snapshot_rows: snapshotRows.rowCount }));
} finally {
  await pool.end();
}
