import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 500,
  duration: '5m',
  thresholds: {
    http_req_failed: ['rate<0.001'],
    http_req_duration: ['p(99)<200']
  }
};

const genres = ['electronic', 'hiphop', 'rock', 'pop', 'jazz', 'classical', 'latin', 'country', 'rnb', 'folk', 'metal', 'world'];
const cells = ['872664c1effffff', '872664c1cffffff', '872664c18ffffff', '872664c19ffffff'];

export default function () {
  const body = JSON.stringify({
    h3_cell: cells[Math.floor(Math.random() * cells.length)],
    track_id: 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh',
    genre: genres[Math.floor(Math.random() * genres.length)]
  });

  const response = http.post(`${__ENV.API_BASE_URL || 'http://localhost:8080'}/api/votes`, body, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${__ENV.TOKEN || ''}`
    }
  });

  check(response, {
    'vote accepted or rate limited': (res) => res.status === 200 || res.status === 429
  });
  sleep(1);
}
