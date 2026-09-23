// Smoke test: run the worker's fetch handler against an in-memory SQLite D1 mock
// (bridged to Python sqlite3 because wasm/native modules are unavailable here).
import { readFileSync } from 'fs';
import { spawn } from 'child_process';
import assert from 'assert';
process.on('uncaughtException', (e) => { console.error('UNCAUGHT STACK:', e.stack); process.exit(2); });
process.on('unhandledRejection', (e) => { console.error('REJECTION STACK:', e && e.stack ? e.stack : e); process.exit(3); });

const proc = spawn('python3', ['db_bridge.py'], { cwd: process.cwd() });
let buf = '';
const pending = new Map();
let nextId = 1;
proc.stdout.on('data', (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    const res = JSON.parse(line);
    const p = pending.get(res.id);
    pending.delete(res.id);
    if (res.error) p.reject(new Error(`SQL error: ${res.error} :: ${p.sql}`));
    else p.resolve(res.rows);
  }
});
proc.stderr.on('data', (d) => console.error('[bridge]', d.toString()));
function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const p = { resolve, reject, sql };
    pending.set(id, p);
    proc.stdin.write(JSON.stringify({ id, sql, params }) + '\n');
  });
}

// ---- D1-compatible mock ----
class D1Stmt {
  constructor(sql, params = []) { this.sql = sql; this.params = params; }
  bind(...args) { return new D1Stmt(this.sql, args); }
  async _rows() { return query(this.sql, this.params); }
  async first() { return (await this._rows())[0] ?? null; }
  async all() { return { results: await this._rows() }; }
  async run() { return query(this.sql, this.params); }
}
const DB = {
  prepare: (sql) => new D1Stmt(sql),
  batch: async (stmts) => { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
};

// ---- R2 mock ----
const r2 = new Map();
const MEDIA = {
  async put(key, body, opts) { r2.set(key, { size: 1234, httpMetadata: opts?.httpMetadata }); },
  async get(key) { const o = r2.get(key); return o ? { body: 'x', ...o } : null; },
  async head(key) { return r2.get(key) || null; },
  async delete(key) { r2.delete(key); },
};

// ---- Response mock (the sandbox cannot instantiate undici Response) ----
class MockHeaders {
  constructor(h = {}) {
    const map = new Map();
    for (const [k, v] of Object.entries(h)) map.set(k.toLowerCase(), v);
    this.map = map;
  }
  get(k) { return this.map.get(k.toLowerCase()) ?? null; }
  set(k, v) { this.map.set(k.toLowerCase(), v); }
}
globalThis.Response = class MockResponse {
  constructor(body, init = {}) {
    this._body = body;
    this._text = typeof body === 'string' ? body : '';
    this.status = init.status ?? 200;
    this.headers = new MockHeaders(init.headers || {});
  }
  async json() { return this._text ? JSON.parse(this._text) : null; }
  async text() { return this._text; }
  clone() { const c = new MockResponse(this._body, { status: this.status, headers: Object.fromEntries(this.headers.map) }); return c; }
};

const env = { DB, MEDIA, ADMIN_SETUP_KEY: 'testsetupkey123', ALLOWED_ORIGINS: '*', MAX_AUDIO_SIZE: '10000', MAX_IMAGE_SIZE: '10000' };
const worker = (await import('./src/index.js')).default;

function makeRequest(method, path, body, headers = {}) {
  const h = {};
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = v;
  if (body !== undefined && !h['content-type']) h['content-type'] = 'application/json';
  return {
    method,
    url: 'https://api.test' + path,
    headers: { get: (k) => h[k.toLowerCase()] ?? null },
    async json() { return typeof body === 'string' ? JSON.parse(body) : body; },
    async formData() {
      // minimal multipart support: body is a prebuilt FormData-like map
      return body; // { file: File, kind: string }
    },
  };
}

async function call(method, path, body, headers = {}) {
  const req = makeRequest(method, path, body && typeof body !== 'string' && typeof body.append !== 'function' ? JSON.stringify(body) : body, headers);
  let res;
  try { res = await worker.fetch(req, env, {}); }
  catch (e) { console.error('FETCH ERROR on', method, path, ':', e.stack || e.message); throw e; }
  const setCookie = res.headers.get('Set-Cookie');
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data, setCookie };
}
const cookieOf = (r) => r.setCookie?.split(';')[0];

// 1. health
assert.equal((await call('GET', '/api/home')).status, 200);

// 2. register user
let r = await call('POST', '/api/auth/register', { email: 'user@test.com', password: 'password123', display_name: 'Test User' });
assert.equal(r.status, 201, 'register failed: ' + JSON.stringify(r.data));
const userCookie = cookieOf(r);

// 3. duplicate register rejected
r = await call('POST', '/api/auth/register', { email: 'user@test.com', password: 'password123', display_name: 'Dup' });
assert.equal(r.status, 409);

// 4. login wrong password
r = await call('POST', '/api/auth/login', { email: 'user@test.com', password: 'wrong' });
assert.equal(r.status, 401);

// 5. me
r = await call('GET', '/api/me', undefined, { Cookie: userCookie });
assert.equal(r.status, 200);
assert.equal(r.data.user.email, 'user@test.com');

// 6. admin setup — bad key
r = await call('POST', '/api/admin/setup', { email: 'admin@test.com', name: 'Owner', password: 'longpassword1' }, { 'X-Setup-Key': 'wrong' });
assert.equal(r.status, 403);
// good key
r = await call('POST', '/api/admin/setup', { email: 'admin@test.com', name: 'Owner', password: 'longpassword1' }, { 'X-Setup-Key': 'testsetupkey123' });
assert.equal(r.status, 201, 'admin setup: ' + JSON.stringify(r.data));
// second admin blocked
r = await call('POST', '/api/admin/setup', { email: 'admin2@test.com', name: 'X', password: 'longpassword1' }, { 'X-Setup-Key': 'testsetupkey123' });
assert.equal(r.status, 409);

// 7. admin login + dashboard
r = await call('POST', '/api/admin/auth/login', { email: 'admin@test.com', password: 'longpassword1' });
assert.equal(r.status, 200, 'admin login: ' + JSON.stringify(r.data));
const adminCookie = cookieOf(r);
r = await call('GET', '/api/admin/dashboard', undefined, { Cookie: adminCookie });
assert.equal(r.status, 200);
assert.equal(r.data.stats.total_users, 1);
// dashboard blocked for normal user
r = await call('GET', '/api/admin/dashboard', undefined, { Cookie: userCookie });
assert.equal(r.status, 401);

// 8. admin creates genre/mood/artist/album
r = await call('POST', '/api/admin/genres', { name: 'Indie' }, { Cookie: adminCookie });
assert.equal(r.status, 201); const genreId = r.data.genre.id;
r = await call('POST', '/api/admin/moods', { name: 'Chill' }, { Cookie: adminCookie });
assert.equal(r.status, 201); const moodId = r.data.mood.id;
r = await call('POST', '/api/artists', { name: 'Test Artist', bio: 'bio' }, { Cookie: adminCookie });
assert.equal(r.status, 201, 'artist: ' + JSON.stringify(r.data)); const artistId = r.data.artist.id;
r = await call('POST', '/api/albums', { title: 'First EP', artist_id: artistId }, { Cookie: adminCookie });
assert.equal(r.status, 201); const albumId = r.data.album.id;

// 9. admin uploads audio (multipart) + creates + publishes song
const uploadFile = new File([new Uint8Array(2000)], 'song.mp3', { type: 'audio/mpeg' });
const uploadForm = { get: (n) => (n === 'file' ? uploadFile : n === 'kind' ? 'audio' : null) };
let res = await worker.fetch(makeRequest('POST', '/api/admin/upload', uploadForm, { Cookie: adminCookie }), env, {});
assert.equal(res.status, 201, 'upload: ' + JSON.stringify(await res.json()));
const audioKey = (await res.clone().json()).key;

// oversize upload rejected
const bigFile = new File([new Uint8Array(20000)], 'big.mp3', { type: 'audio/mpeg' });
const bigForm = { get: (n) => (n === 'file' ? bigFile : n === 'kind' ? 'audio' : null) };
assert.equal((await worker.fetch(makeRequest('POST', '/api/admin/upload', bigForm, { Cookie: adminCookie }), env, {})).status, 413);
// unauthenticated upload rejected
assert.equal((await worker.fetch(makeRequest('POST', '/api/admin/upload', uploadForm, {}), env, {})).status, 401);

r = await call('POST', '/api/songs', { title: 'My Song', artist_id: artistId, album_id: albumId, genre_id: genreId, mood_id: moodId, audio_key: audioKey, duration: 200, status: 'published' }, { Cookie: adminCookie });
assert.equal(r.status, 201, 'create song: ' + JSON.stringify(r.data));
const songId = r.data.song.id;

// 10. unauthenticated song create blocked
r = await call('POST', '/api/songs', { title: 'x', artist_id: artistId, audio_key: audioKey }, {});
assert.equal(r.status, 401);

// 11. user sees published song on home & search
r = await call('GET', '/api/home');
assert.ok(r.data.sections.some((s) => s.items && s.items.some((it) => it.id === songId)), 'song not on home');
r = await call('GET', '/api/search?q=My');
assert.ok(r.data.songs.length === 1, 'search failed');

// 12. user likes, plays, follows
r = await call('POST', '/api/likes', { song_id: songId }, { Cookie: userCookie });
assert.equal(r.status, 201);
r = await call('POST', `/api/songs/${songId}/play`, {}, { Cookie: userCookie });
assert.equal(r.status, 200);
r = await call('POST', `/api/artists/${artistId}/follow`, {}, { Cookie: userCookie });
assert.equal(r.status, 201);

// 13. playlists
r = await call('POST', '/api/playlists', { name: 'My Mix', is_public: true }, { Cookie: userCookie });
assert.equal(r.status, 201, 'playlist: ' + JSON.stringify(r.data));
const plId = r.data.playlist.id;
r = await call('POST', `/api/playlists/${plId}/songs`, { song_id: songId }, { Cookie: userCookie });
assert.equal(r.status, 201);
r = await call('GET', `/api/playlists/${plId}`);
assert.equal(r.data.songs.length, 1);

// 14. history / notifications / premium
r = await call('GET', '/api/history', undefined, { Cookie: userCookie });
assert.equal(r.data.songs.length, 1);
r = await call('POST', '/api/admin/notifications', { title: 'New release!', body: 'hi' }, { Cookie: adminCookie });
assert.equal(r.status, 201);
r = await call('GET', '/api/notifications', undefined, { Cookie: userCookie });
assert.equal(r.data.notifications.length, 1);
r = await call('POST', '/api/premium/request', { plan: 'monthly' }, { Cookie: userCookie });
assert.equal(r.status, 201);

// 15. admin approves premium
r = await call('GET', '/api/admin/subscriptions', undefined, { Cookie: adminCookie });
const subId = r.data.subscriptions[0].id;
r = await call('PUT', `/api/admin/subscriptions/${subId}`, { action: 'approve' }, { Cookie: adminCookie });
assert.equal(r.status, 200);
r = await call('GET', '/api/me', undefined, { Cookie: userCookie });
assert.equal(r.data.user.is_premium, 1);

// 16. media routes
r = await call('GET', `/media/audio/${songId}`);
assert.equal(r.status, 200);
let rangeReq = makeRequest('GET', '/media/audio/' + songId, undefined, { Range: 'bytes=0-99' });
res = await worker.fetch(rangeReq, env, {});
assert.equal(res.status, 206, 'range request: ' + res.status);
assert.equal(res.headers.get('Content-Range'), 'bytes 0-99/1234');
// draft song hidden from users
r = await call('PUT', `/api/songs/${songId}`, { status: 'draft' }, { Cookie: adminCookie });
assert.equal(r.status, 200);
r = await call('GET', `/api/songs/${songId}`);
assert.equal(r.status, 404, 'draft song should be hidden');
r = await call('PUT', `/api/songs/${songId}`, { status: 'published' }, { Cookie: adminCookie });
assert.equal(r.status, 200);

// 17. forgot/reset password
r = await call('POST', '/api/auth/forgot-password', { email: 'user@test.com' });
assert.equal(r.status, 200);
// wrong-token reset fails
r = await call('POST', '/api/auth/reset-password', { token: 'badtoken', password: 'newpassword1' });
assert.equal(r.status, 400);

// 18. logout kills session
r = await call('POST', '/api/auth/logout', {}, { Cookie: userCookie });
assert.equal(r.status, 200);
r = await call('GET', '/api/me', undefined, { Cookie: userCookie });
assert.equal(r.status, 401);

// 19. login again + change password + profile update
r = await call('POST', '/api/auth/login', { email: 'user@test.com', password: 'password123' });
assert.equal(r.status, 200);
const uc2 = cookieOf(r);
r = await call('POST', '/api/auth/change-password', { current_password: 'password123', new_password: 'newpassword99' }, { Cookie: uc2 });
assert.equal(r.status, 200);
r = await call('PUT', '/api/me/profile', { display_name: 'Renamed User' }, { Cookie: uc2 });
assert.equal(r.status, 200);
assert.equal(r.data.user.display_name, 'Renamed User');

// 20. admin home-sections + users
r = await call('POST', '/api/admin/home-sections', { title: 'Hot This Week', type: 'trending' }, { Cookie: adminCookie });
assert.equal(r.status, 201);
r = await call('PUT', `/api/songs/${songId}`, { is_trending: true }, { Cookie: adminCookie });
assert.equal(r.status, 200);
r = await call('GET', '/api/home');
assert.ok(r.data.sections.some((s) => s.title === 'Hot This Week' && s.items.some((it) => it.id === songId)), 'custom home section missing or empty');
r = await call('GET', '/api/admin/users?search=user@test', undefined, { Cookie: adminCookie });
assert.equal(r.data.users.length, 1);
r = await call('PUT', `/api/admin/users/${r.data.users[0].id}`, { status: 'suspended' }, { Cookie: adminCookie });
assert.equal(r.status, 200);
// suspended user session is dead
r = await call('GET', '/api/me', undefined, { Cookie: uc2 });
assert.equal(r.status, 401);

console.log('ALL 20 SMOKE TEST GROUPS PASSED');

proc.kill();
process.exit(0);
