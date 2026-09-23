# AURA MUSIC

A complete, real-world music streaming application: vanilla HTML/CSS/JS user panel + admin panel, a Cloudflare Worker backend with D1 (SQLite) and R2 (object storage), and an Android WebView wrapper. The database starts **empty** — all content is created by you through the admin panel.

> Only upload and distribute audio you legally own or are licensed to distribute.

## Project structure

```
AURA-MUSIC/
├── user/            User panel (Cloudflare Pages)
│   ├── index.html
│   ├── css/style.css
│   └── js/ (config, api, auth, ui, player, search, library, app)
├── admin/           Admin panel (Cloudflare Pages)
│   ├── index.html
│   ├── css/admin.css
│   └── js/ (config, api, auth, songs, artists, albums, playlists, users, settings, admin)
├── worker/          Cloudflare Worker backend
│   ├── src/ (index, auth, songs, artists, albums, playlists, users, search, player, admin, utils)
│   ├── schema.sql   D1 database schema
│   ├── wrangler.toml
│   └── package.json
├── android/         Android WebView wrapper (complete native code)
└── README.md
```

---

# PART A — CLOUDFLARE SETUP (from zero)

## STEP 1 — Create a Cloudflare account

1. Go to https://dash.cloudflare.com/sign-up
2. Sign up with your email (free plan is enough).
3. Verify your email.

## STEP 2 — Create the R2 bucket

1. In the Cloudflare dashboard, left sidebar → **R2 Object Storage**.
2. If asked to enable R2, click **Purchase R2** — the free tier includes 10 GB storage and no egress fees; you only need a payment method on file, you are not charged for this small usage.
3. Click **Create bucket**.
4. Bucket name: `aura-music-media`
5. Location: Automatic.
6. Click **Create bucket**.
7. **Do NOT enable public access / public buckets / custom domains with public serving.** All media must be served through the Worker so access is controlled server-side. R2 credentials are never exposed to the browser.

## STEP 3 — Create the D1 database

1. Dashboard → left sidebar → **Workers & Pages** → **D1 SQL Database** (under "Storage" on some dashboard versions).
2. Click **Create database**.
3. Name: `aura-db` → click **Create**.
4. Open the database → **Settings** → copy the **Database ID** (a long hex string). You need it in STEP 5.

## STEP 4 — Create the Worker project (install Wrangler)

Prerequisites: Node.js 18+ installed (https://nodejs.org).

```bash
cd worker
npm install          # installs wrangler
npx wrangler login   # opens a browser to authorize the CLI
```

## STEP 5 — Configure the R2 binding

Already present in `worker/wrangler.toml`:

```toml
[[r2_buckets]]
binding = "MEDIA"
bucket_name = "aura-music-media"
```

No account ID needed — Wrangler infers it from your login.

## STEP 6 — Configure the D1 binding

Open `worker/wrangler.toml` and replace `<DATABASE_ID>` with the ID from STEP 3:

```toml
[[d1_databases]]
binding = "DB"
database_name = "aura-db"
database_id = "PASTE-YOUR-DATABASE-ID-HERE"
```

## STEP 7 — Configure secrets

Two secrets are required. Set them from the `worker/` folder:

```bash
# A long random string used only to create the FIRST admin account.
# Generate one, e.g.:  npx wrangler secret put ADMIN_SETUP_KEY
npx wrangler secret put ADMIN_SETUP_KEY

# (Optional, recommended) an extra server-side pepper value.
npx wrangler secret put SESSION_SECRET
```

When prompted, paste a long random string (30+ characters). Store it somewhere safe — you need `ADMIN_SETUP_KEY` once during setup.

Optional secret (only while you need password-reset links without an email service):

```bash
npx wrangler secret put ALLOW_RESET_DISPLAY   # value: true
```

See the "Password resets" section below before enabling it — disable it again afterwards.

**What belongs where:**

| Value | Where it lives |
|---|---|
| `ADMIN_SETUP_KEY`, `SESSION_SECRET`, `ALLOW_RESET_DISPLAY` | Worker secrets ONLY (`wrangler secret put`) — never in code, never in the frontend |
| `ALLOWED_ORIGINS`, `MAX_AUDIO_SIZE`, `MAX_IMAGE_SIZE` | `wrangler.toml` `[vars]` (non-secret settings) |
| `API_BASE_URL`, `APP_NAME` | Frontend `config.js` files (public values only) |

## STEP 8 — Run the database schema

```bash
cd worker
npx wrangler d1 execute aura-db --file=./schema.sql --remote
```

(The database is now created **empty** — zero rows in every table. For local development use `--local` instead.)

## STEP 9 — Deploy the Worker

```bash
cd worker
npx wrangler deploy
```

Note the output URL, e.g. `https://aura-music-api.<your-subdomain>.workers.dev`. Test it in a browser — you should see `{"error":"Not found."}` (that means the router is alive).

## STEP 10 — Deploy the User Panel

1. Open `user/js/config.js` and set `API_BASE_URL` to your Worker URL from STEP 9.
2. Dashboard → **Workers & Pages** → **Create** → **Pages** tab → **Upload assets**.
3. Project name: `aura-user` → **Create project**.
4. Drag the **contents of the `user/` folder** (index.html at the root) into the upload area → **Deploy site**.
5. Note your URL, e.g. `https://aura-user.pages.dev`.

## STEP 11 — Deploy the Admin Panel

Same procedure with the `admin/` folder:

1. Open `admin/js/config.js` and set `API_BASE_URL` to the same Worker URL.
2. Pages → Create → Upload assets → project name `aura-admin`.
3. Upload the contents of the `admin/` folder → Deploy.

## STEP 12 — Connect frontend to Worker (CORS)

Go back to `worker/wrangler.toml` and set `ALLOWED_ORIGINS` to your two Pages domains:

```toml
[vars]
ALLOWED_ORIGINS = "https://aura-user.pages.dev,https://aura-admin.pages.dev,http://localhost:8080"
```

Then redeploy:

```bash
cd worker && npx wrangler deploy
```

## STEP 13 — Create the first admin account

1. Open your admin panel URL (`https://aura-admin.pages.dev`).
2. Click **"Create the first admin"** (or go to `#/setup`).
3. Fill in:
   - **Setup key** — the exact value you stored as the `ADMIN_SETUP_KEY` secret.
   - Your name, your email, and a strong password (10+ characters — choose your own; no default credentials exist anywhere in this project).
4. Click **Create admin account**.
5. Log in with your email + password.

The setup endpoint is permanently disabled once an admin exists — it is impossible to create a second admin this way. If you ever need to start over, you would have to delete the `admin_users` rows in D1.

---

# PART B — FIRST SONG UPLOAD (from an empty database)

Use an audio file **you own or are licensed to distribute** (e.g. your own recording, or a Creative-Commons track where you follow the license terms).

1. Log in to the admin panel.
2. **Genres / Moods pages** — optionally create e.g. genre "Indie" and mood "Chill".
3. **Artists** → **+ Add artist** → enter name (and optionally biography + image) → **Create artist**.
4. **Albums** → **+ Add album** → pick the artist, enter a title (e.g. "First EP") → **Create album** (optional — songs can be singles).
5. **Songs** → **+ Add song**:
   - Title: your song title
   - Artist: select the artist you created
   - Album: select the album (or leave "Single")
   - Genre / Mood: optional
   - **Audio file**: click the upload box, choose your MP3/M4A/WAV/OGG/FLAC (max 60 MB), wait for "Uploaded successfully" — the file is now in R2; only its key is stored in D1.
   - **Cover image**: optional JPG/PNG/WebP (max 10 MB).
   - Duration: seconds, e.g. `215` for 3:35 (shown in the UI).
   - Release date: optional.
   - Status: **Published**.
   - Trending / Featured: optional flags used by the home screen.
6. **Create song**.
7. Open the user panel, log in (or register a user account), Home → your song appears under New Releases. Press play — audio streams from R2 through the Worker with range-request seeking.

Upload flow (all server-authorized):

```
Admin → authenticated Worker → validates file type & size → writes to R2
      → stores object key + size in D1 (media_objects) → you publish the song
      → users stream it via /media/audio/:songId
```

---

# PART C — ANDROID STUDIO SETUP (WebView wrapper)

The `android/` folder contains the complete native project files. To assemble the project:

1. Install Android Studio (https://developer.android.com/studio).
2. **New Project → Empty Views Activity** → Name: `AURA MUSIC`, package `com.auramusic.app`, language **Java**, minimum SDK **API 24**.
3. Replace/add files so the project matches:

```
android/
├── build.gradle                        (project — provided)
├── settings.gradle                     (provided)
├── gradle/wrapper/gradle-wrapper.properties (provided)
└── app/
    ├── build.gradle                    (provided)
    └── src/main/
        ├── AndroidManifest.xml         (provided — INTERNET + WAKE_LOCK)
        ├── java/com/auramusic/app/
        │   └── MainActivity.java      (provided)
        └── res/
            ├── layout/activity_main.xml      (provided)
            ├── values/themes.xml             (provided — splash theme)
            └── drawable/launch_background.xml (provided)
```

4. In `MainActivity.java`, change `APP_URL` to your user panel URL:
   ```java
   private static final String APP_URL = "https://aura-user.pages.dev";
   ```
5. Set the launcher icon: right-click `res` → New → Image Asset → choose any icon you own.
6. The provided code already includes everything the web app needs:
   - Internet permission (manifest)
   - JavaScript + DOM storage enabled
   - `setMediaPlaybackRequiresUserGesture(false)` — autoplay/audio works from JS
   - Hardware acceleration (manifest)
   - Third-party cookies enabled — the login session (HttpOnly cookie) survives
   - File chooser support (`onShowFileChooser`)
   - Back button navigates web history
   - Launch theme acts as the splash screen; `FLAG_KEEP_SCREEN_ON` keeps the screen awake during playback

### Build the APK

```bash
cd android
./gradlew assembleDebug        # debug APK:  app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease      # release APK: app/build/outputs/apk/release/app-release-unsigned.apk
```

### Release APK (signed)

```bash
keytool -genkey -v -keystore aura-release.keystore -alias aura -keyalg RSA -keysize 2048 -validity 10000
```

Add to `android/app/build.gradle` inside `android { }`:

```gradle
signingConfigs {
    release {
        storeFile file("../aura-release.keystore")
        storePassword System.console() ? System.console().readLine("\nKeystore password: ") : ""
        keyAlias "aura"
        keyPassword System.console() ? System.console().readLine("\nKey password: ") : ""
    }
}
```

and in `buildTypes { release { signingConfig signingConfigs.release } }`, then:

```bash
./gradlew assembleRelease
```

Or use **Build → Generate Signed Bundle / APK** in Android Studio.

> Note: as a WebView app, audio plays while the app is in the foreground (including with the screen off, thanks to WAKE_LOCK). Like all WebView apps, long-term background playback with lock-screen controls would require an additional native foreground service — the player already integrates the browser MediaSession API, which surfaces lock-screen controls on Android when available.

---

# PART D — LOCAL DEVELOPMENT

```bash
cd worker
npm install
npx wrangler d1 execute aura-db --file=./schema.sql --local
npx wrangler dev            # API on http://localhost:8787
```

Serve the frontends (both config.js files default to `http://localhost:8787`):

```bash
cd user  && python3 -m http.server 8080    # user panel: http://localhost:8080
cd admin && python3 -m http.server 8081    # admin panel: http://localhost:8081
```

The default `ALLOWED_ORIGINS = "*"` works for local testing because cookies are not strictly required cross-origin in dev mode on the same machine; for production set your real origins (STEP 12).

---

# PART E — SECURITY MODEL

- **Passwords**: PBKDF2-SHA256, 100,000 iterations, per-user random salt — never plain text, never in the frontend.
- **Sessions**: random 256-bit tokens; only their SHA-256 hash is stored in D1. The cookie is `HttpOnly + Secure + SameSite=None` — JavaScript can never read it.
- **Authorization**: every admin route verifies the session server-side and checks `user_type = 'admin'`. The frontend never decides who is an admin.
- **User IDs** are never accepted from the client — always derived from the session cookie server-side.
- **SQL**: 100% parameterized queries (`.bind(...)`), no string interpolation of user input.
- **Uploads**: type + size validated in the Worker before touching R2.
- **Rate limiting**: best-effort per-isolate limits on register/login/forgot/upload (pair with a Cloudflare WAF rate-limiting rule for strict limits: dashboard → your worker → Settings → Rate limiting).
- **R2 credentials** exist only as the Worker binding — impossible to leak to the browser.
- **Enumeration-safe** login and forgot-password responses.
- **First admin** requires a secret setup key and self-disables.

## Password resets (no email provider bundled)

This project ships without a payment or email provider (both would require your private credentials). `POST /api/auth/forgot-password` creates a real, hashed, 1-hour reset token in D1. To use it:

1. `npx wrangler secret put ALLOW_RESET_DISPLAY` with value `true`
2. Redeploy, use "Forgot password" in the app — the token is shown once so you (the owner) can complete the reset at `#/reset`.
3. **Remove it again immediately**: `npx wrangler secret delete ALLOW_RESET_DISPLAY`, then redeploy.

For production, wire the token into an email service (e.g. a Cloudflare Email Worker or a provider like Resend) — the `console.log` in `forgotPassword` marks the integration point.

---

# PART F — API REFERENCE (summary)

Auth: `POST /api/auth/register|login|logout|forgot-password|reset-password|change-password`, `GET /api/me`, `PUT /api/me/profile`
Content: `GET /api/home`, `GET /api/search?q=`, `GET|POST /api/songs`, `GET|PUT|DELETE /api/songs/:id`, `POST /api/songs/:id/play`, `GET|POST|PUT|DELETE` artists, albums (`/api/albums/:id/save`), playlists (+`/songs`, `/reorder`), `GET|POST|DELETE /api/likes(/:songId)`, `GET|POST|DELETE /api/history`, `POST /api/artists/:id/follow|unfollow`, `GET /api/me/albums`, `GET /api/me/follows`
Notifications: `GET /api/notifications`, `PUT /api/notifications/:id/read`, `PUT /api/notifications/read-all`
Premium: `POST /api/premium/request`, `GET /api/premium/me`
Media: `GET /media/audio/:songId` (range requests), `GET /media/cover/:type/:id`, `GET /media/avatar/:key`
Admin: `POST /api/admin/setup`, `POST /api/admin/auth/login|logout|change-password`, `GET /api/admin/auth/me`, `GET /api/admin/dashboard`, `GET|PUT /api/admin/users(/:id)`, CRUD genres/moods/home-sections, `GET|POST /api/admin/notifications`, `GET /api/admin/subscriptions`, `PUT /api/admin/subscriptions/:id`, `POST /api/admin/upload`, `GET /api/admin/storage`, `GET /api/admin/playlists`

---

# PART F2 — AUTOMATED BACKEND SMOKE TEST

The project ships with an automated end-to-end backend test (`worker/smoke-test.mjs` + `worker/db_bridge.py`) that runs the real Worker code against an in-memory SQLite database and a mocked R2 bucket. It covers registration, login, sessions, first-admin setup, uploads, publishing, streaming with range requests, likes, playlists, history, notifications, premium approval, user suspension and more (20 test groups, ~60 assertions).

```bash
cd worker
node smoke-test.mjs        # requires Node 18+ and Python 3 (stdlib only, no packages)
# expected output: ALL 20 SMOKE TEST GROUPS PASSED
```

---

# PART G — TESTING CHECKLIST

**Authentication**
- [ ] Register a user → lands on Home (empty state)
- [ ] Logout → login with same credentials
- [ ] Wrong password → "Invalid email or password."
- [ ] Refresh page → still logged in (session cookie)
- [ ] Forgot password → reset flow (with ALLOW_RESET_DISPLAY if enabled)
- [ ] Change password from Settings → old password stops working

**User Panel**
- [ ] Empty database → Home shows "No songs available yet." (no fake data anywhere)
- [ ] Search returns nothing → "No search results." empty state
- [ ] Song/Artist/Album/Playlist detail pages load real data
- [ ] Like a song → appears in Liked Songs; heart toggles
- [ ] Create playlist → add song → remove song → rename → delete
- [ ] Recently Played fills after listening ≥10s
- [ ] Notifications appear after admin sends one; mark-as-read works
- [ ] Premium request → shows "pending" → admin approves → user is premium
- [ ] Profile name change persists

**Player**
- [ ] Play/pause/next/previous work; seek by dragging the bar
- [ ] Playback continues while navigating between views
- [ ] Shuffle and repeat (off/all/one) cycle correctly
- [ ] Queue panel lists the current queue and jumps to a song on tap
- [ ] Volume slider works
- [ ] Mini player ↔ full player transitions

**Admin Panel**
- [ ] First-admin setup rejects a wrong setup key
- [ ] Dashboard numbers match D1 (start at 0 / 1 admin user)
- [ ] Genre/Mood create + delete
- [ ] Artist create → edit → delete (with songs removed)
- [ ] Album create → assign song via song edit
- [ ] Song: upload audio (progress bar), upload cover, publish, unpublish, edit, delete
- [ ] Users: search, suspend (user session is revoked), activate, grant/remove premium
- [ ] Home sections: add "trending" section with custom title → shows on user Home
- [ ] Notifications: broadcast + per-user
- [ ] Storage page shows real byte totals after uploads

**Database / R2 / Streaming**
- [ ] `wrangler d1 execute aura-db --remote --command "SELECT COUNT(*) FROM songs"` matches admin
- [ ] R2 bucket in dashboard shows the uploaded files (audio/, cover/)
- [ ] Direct R2 object URLs are NOT public (must 404/unauthorized)
- [ ] Audio streams via `https://<worker>/media/audio/<songId>`; seeking works (range requests — check the Network tab for `206 Partial Content`)
- [ ] Deleting a song removes the object from R2 and the media_objects row

**Security**
- [ ] Calling `/api/admin/dashboard` without an admin session returns 401
- [ ] `curl https://<worker>/api/songs` shows only published songs even when drafts exist
- [ ] Creating a second admin via `/api/admin/setup` returns 409
- [ ] No secret values anywhere in `user/` or `admin/` files

**Mobile / Android**
- [ ] User panel on a phone browser: bottom nav, mini player above it, no horizontal scroll
- [ ] Android APK loads the app, login works, audio plays
- [ ] Back button goes back in the web UI instead of closing the app

---

# PART H — TROUBLESHOOTING

**"Network error" in the panels** — `API_BASE_URL` in the frontend config.js doesn't match the deployed Worker URL (check for typos, http vs https).

**Login works but refresh logs me out** — `ALLOWED_ORIGINS` doesn't include your exact Pages origin (scheme + host, no trailing slash). Cross-origin cookies require the exact origin AND HTTPS. Set it and run `npx wrangler deploy`.

**CORS error in the browser console** — same fix: the Worker only allows origins listed in `ALLOWED_ORIGINS`. `*` cannot be used with credentials in production, so list your domains.

**"D1_ERROR: no such table"** — you ran the schema locally but tested the remote worker (or vice versa). Run: `npx wrangler d1 execute aura-db --file=./schema.sql --remote` (add `--local` for dev).

**Upload fails with 413** — file exceeds `MAX_AUDIO_SIZE`/`MAX_IMAGE_SIZE` in wrangler.toml `[vars]`. Raise the value and redeploy. (Cloudflare's request-body cap is 100 MB on the free plan.)

**Upload fails with 415** — the file's MIME type isn't in the allowed list (see `admin.js` → `AUDIO_TYPES`/`IMAGE_TYPES`).

**Audio doesn't play** — confirm the song is Published and that the R2 binding name is `MEDIA` with bucket `aura-music-media`. Check Worker logs: `npx wrangler tail`.

**"An admin account already exists"** — correct behaviour after setup. To reset during testing: `npx wrangler d1 execute aura-db --remote --command "DELETE FROM admin_users"` (this removes admin access entirely).

**Admin panel shows login again after refresh** — your browser is blocking third-party cookies. Use the deployed Pages + Worker URLs (not different localhost ports) and ensure `ALLOWED_ORIGINS` matches exactly.

**Seeking doesn't work in the Android app** — make sure you're playing via the Worker URL (`/media/audio/...`), which supports range requests; direct file URLs do not.

**I forgot the ADMIN_SETUP_KEY** — it's only needed before the first admin exists. Reset the value with `npx wrangler secret put ADMIN_SETUP_KEY` if you ever need to re-run setup on a fresh database.

**wrangler says the database ID is invalid** — the `<DATABASE_ID>` placeholder is still in wrangler.toml; paste the real ID from D1 → Settings.
