// AURA MUSIC — user-side features: history, follows, notifications, premium
import { json, errorJson, id, getAuth, readJsonBody, corsHeaders, SONG_SELECT, nowIso } from './utils.js';

// -------- GET /api/history — recently played --------
export async function getHistory({ request, env, query }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'user') return errorJson('Not authenticated.', 401);
  const limit = Math.min(parseInt(query.get('limit') || '50', 10) || 50, 100);
  const { results } = await env.DB
    .prepare(`${SONG_SELECT} JOIN (
        SELECT song_id, MAX(played_at) AS last_played FROM listening_history
        WHERE user_id = ? GROUP BY song_id ORDER BY last_played DESC LIMIT ?
      ) rh ON rh.song_id = s.id
      WHERE s.status = 'published'`)
    .bind(auth.account.id, limit).all();
  return json({ songs: results }, 200, corsHeaders(request, env));
}

// -------- DELETE /api/history — clear listening history --------
export async function clearHistory({ request, env }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'user') return errorJson('Not authenticated.', 401);
  await env.DB.prepare('DELETE FROM listening_history WHERE user_id = ?').bind(auth.account.id).run();
  return json({ ok: true }, 200, corsHeaders(request, env));
}

// -------- GET /api/me/follows --------
export async function followedArtists({ request, env }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'user') return errorJson('Not authenticated.', 401);
  const { results } = await env.DB
    .prepare(`SELECT a.id, a.name, a.image_key, f.created_at AS followed_at
              FROM follows f JOIN artists a ON a.id = f.artist_id
              WHERE f.user_id = ? ORDER BY f.created_at DESC`)
    .bind(auth.account.id).all();
  return json({ artists: results }, 200, corsHeaders(request, env));
}

// -------- GET /api/notifications --------
export async function listNotifications({ request, env, query }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'user') return errorJson('Not authenticated.', 401);
  const limit = Math.min(parseInt(query.get('limit') || '50', 10) || 50, 100);
  const { results } = await env.DB
    .prepare(`SELECT id, title, body, type, is_read, user_id, created_at FROM notifications
              WHERE user_id = ? OR user_id IS NULL ORDER BY created_at DESC LIMIT ?`)
    .bind(auth.account.id, limit).all();
  const readIds = new Set((await env.DB
    .prepare('SELECT notification_id FROM notification_reads WHERE user_id = ?')
    .bind(auth.account.id).all()).results.map((r) => r.notification_id));
  const notifications = results.map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    type: n.type,
    created_at: n.created_at,
    // broadcast notifications are "read" per user via notification_reads
    is_read: n.user_id === null ? (readIds.has(n.id) ? 1 : 0) : n.is_read,
  }));
  return json({ notifications }, 200, corsHeaders(request, env));
}

// -------- PUT /api/notifications/:id/read --------
export async function markNotificationRead({ request, env, params }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'user') return errorJson('Not authenticated.', 401);
  const notif = await env.DB
    .prepare('SELECT id, user_id FROM notifications WHERE id = ? AND (user_id = ? OR user_id IS NULL)')
    .bind(params.id, auth.account.id).first();
  if (!notif) return errorJson('Notification not found.', 404);
  if (notif.user_id === null) {
    await env.DB
      .prepare('INSERT OR IGNORE INTO notification_reads (user_id, notification_id) VALUES (?,?)')
      .bind(auth.account.id, params.id).run();
  } else {
    await env.DB.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').bind(params.id).run();
  }
  return json({ ok: true }, 200, corsHeaders(request, env));
}

// -------- PUT /api/notifications/read-all --------
export async function markAllRead({ request, env }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'user') return errorJson('Not authenticated.', 401);
  const { results: unreadBroadcast } = await env.DB
    .prepare('SELECT id FROM notifications WHERE user_id IS NULL AND is_read = 0').all();
  const stmts = [
    env.DB.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').bind(auth.account.id),
  ];
  for (const n of unreadBroadcast) {
    stmts.push(env.DB
      .prepare('INSERT OR IGNORE INTO notification_reads (user_id, notification_id) VALUES (?,?)')
      .bind(auth.account.id, n.id));
  }
  await env.DB.batch(stmts);
  return json({ ok: true }, 200, corsHeaders(request, env));
}

// -------- Premium / subscriptions --------
// No payment provider is bundled (that would require fake credentials).
// A user can REQUEST premium; the admin approves it in the admin panel,
// which is a real, server-side state change.
export async function requestPremium({ request, env }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'user') return errorJson('Not authenticated.', 401);
  if (auth.account.is_premium) return errorJson('You are already a premium member.', 409);
  const body = await readJsonBody(request);
  const plan = ['monthly', 'yearly'].includes(body && body.plan) ? body.plan : 'monthly';
  const subId = id('sub');
  await env.DB
    .prepare("INSERT INTO subscriptions (id, user_id, plan, status) VALUES (?,?,?,'pending')")
    .bind(subId, auth.account.id, plan).run();
  return json({
    ok: true,
    subscription: { id: subId, plan, status: 'pending' },
    message: 'Your premium request has been submitted and is pending approval.',
  }, 201, corsHeaders(request, env));
}

export async function mySubscription({ request, env }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'user') return errorJson('Not authenticated.', 401);
  const rows = await env.DB
    .prepare('SELECT id, plan, status, started_at, expires_at, created_at FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10')
    .bind(auth.account.id).all();
  return json({
    subscriptions: rows.results,
    is_premium: !!auth.account.is_premium,
    premium_until: auth.account.premium_until,
  }, 200, corsHeaders(request, env));
}
