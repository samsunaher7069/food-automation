# Nourish Studio

A self-hosted AI content studio for a healthy-food blog. It writes a recipe, creates a food photograph, calculates nutrition from real ingredient quantities, builds a Blogger article, and schedules Pinterest Pins that link back to the live article.

The dashboard is a premium dark single-page app with no build step. The backend is Express, PostgreSQL (with a local SQLite fallback), Gemini, Blogger API v3, Pinterest API v5, and Cloudinary.

---

## What is real

- **Gemini** generates topics, the recipe JSON, SEO/Pinterest metadata, and the food photograph. Vision analysis checks the photo against the topic.
- **Nutrition** is calculated deterministically on the server from ingredient quantities and a food-composition dataset. Images are never used to guess calories.
- **Blogger** publishes through OAuth 2.0 and the official Blogger API v3, including Recipe JSON-LD.
- **Pinterest** creates Pins through OAuth and the official Pinterest API v5, using the live Blogger URL as the destination.
- **Scheduling** is stored in PostgreSQL and executed by an external Render cron worker, not by a browser timer.
- **Analytics** are real database counts plus Pinterest API metrics when the connected account has permission. Blogger v3 has no public analytics endpoint, so the UI labels that absence instead of inventing numbers.
- **API keys never reach the browser.** They are encrypted at rest with AES-256-GCM and only masked summaries are returned.

When a provider is missing, over quota, or lacks permission, the UI reports the exact error. It does not fake success.

---

## Requirements

- Node.js **24** (the project pins `24.11.0` on Render; newer local versions generally work)
- PostgreSQL 15+ in production, or nothing for local SQLite
- A Gemini API key with access to a text model and an image model
- Optional but required for full publishing:
  - Google OAuth client with **Blogger API v3** enabled
  - Pinterest app with boards/pins scopes
  - Cloudinary account (Pinterest requires a public `https` image URL)

---

## Quick start (local)

```bash
cd food-automation
cp .env.example .env
# edit .env: at minimum set SESSION_SECRET and GEMINI_API_KEY
npm install
npm start
```

Open `http://localhost:3000`. The first visit shows the setup wizard: create the owner account, add Gemini, connect accounts, choose a rhythm.

Without `DATABASE_URL`, the app stores data in `data/app.db` (SQLite). Generated images are written to `data/media` and served from `/media`.

Generate a session secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Run the scheduler once locally:

```bash
node server.js worker
```

Run the tests:

```bash
npm test
```

The test suite uses a temporary SQLite database and mocks Gemini, Cloudinary, Blogger, and Pinterest, so it needs no credentials. It covers the full pipeline, deterministic nutrition, publish ordering, idempotent republishing, scheduled-slot deduplication, automation limits, HTML escaping, and failure paths.

---

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `SESSION_SECRET` | Yes | Signs sessions and derives the AES-256-GCM key for stored secrets. Must be identical on the web and cron services. |
| `APP_URL` | Yes in production | Public base URL. Used for OAuth callbacks, canonical links, and absolute image URLs. |
| `DATABASE_URL` | Production | PostgreSQL connection string. If omitted, SQLite is used. |
| `CRON_SECRET` | Recommended | Shared secret for `POST /api/cron/run`. |
| `GEMINI_API_KEY` | Yes | Google AI Studio key. Can also be saved in the UI. |
| `GEMINI_TEXT_MODEL` | No | Defaults to `gemini-3.8-flash`. |
| `GEMINI_IMAGE_MODEL` | No | Defaults to `gemini-3.1-flash-image`. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | For Blogger | Google OAuth web client. Can also be saved in the UI. |
| `GOOGLE_REDIRECT_URI` | No | Defaults to `${APP_URL}/auth/google/callback`. |
| `PINTEREST_CLIENT_ID` / `PINTEREST_CLIENT_SECRET` | For Pinterest | Pinterest app credentials. Can also be saved in the UI. |
| `PINTEREST_REDIRECT_URI` | No | Defaults to `${APP_URL}/auth/pinterest/callback`. |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | For Pinterest | Public image hosting. Can also be saved in the UI. |
| `NUTRITION_PROVIDER` | No | `builtin` (default), `usda`, or `gemini` mapping. |
| `NUTRITION_API_KEY` | For USDA | USDA FoodData Central key. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | No | Optional bootstrap owner when no user exists yet. |
| `ENABLE_INTERNAL_SCHEDULER` | No | `true` locally, `false` on Render. |
| `INTERNAL_SCHEDULER_INTERVAL_SECONDS` | No | Internal ticker interval, default `60`. |
| `MEDIA_DIR` | No | Local image directory, default `data/media`. |
| `DB_PATH` | No | SQLite file path, default `data/app.db`. |

Secrets entered in **API Connections** are stored encrypted in the database. Environment variables take precedence where both exist.

### Why the web and cron services must share `SESSION_SECRET`

Stored provider secrets are encrypted with a key derived from `SESSION_SECRET`. The cron worker reads the same database rows, so it needs the same secret to decrypt them. `render.yaml` inherits the value from the web service with `fromService`.

---

## Google / Blogger OAuth setup

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create (or select) a project.
2. **APIs & Services → Library →** enable **Blogger API v3**.
3. **APIs & Services → OAuth consent screen:** configure the app. While in testing, add your Google account as a test user. Publishing to other accounts requires verification.
4. **Credentials → Create credentials → OAuth client ID → Web application.**
5. Add the redirect URI exactly:
   - Local: `http://localhost:3000/auth/google/callback`
   - Production: `https://YOUR-APP.onrender.com/auth/google/callback`
6. Copy the client ID and secret into **API Connections → Blogger** (or the env vars).
7. Click **Connect Google**, approve access, then choose the destination blog from the dropdown.

Scopes requested: `https://www.googleapis.com/auth/blogger`.

Re-publishing an article updates the existing Blogger post when its ID is already stored. A new article is created only when no Blogger ID exists or when the owner explicitly forces a new copy.

---

## Pinterest OAuth setup

1. Create an app at [Pinterest Developers](https://developers.pinterest.com/apps/).
2. Add the redirect URI:
   - Local: `http://localhost:3000/auth/pinterest/callback`
   - Production: `https://YOUR-APP.onrender.com/auth/pinterest/callback`
3. Request the scopes used by the app: `boards:read`, `pins:read`, `pins:write`, `user_accounts:read`.
4. Copy the app ID and secret into **API Connections → Pinterest**.
5. Click **Connect Pinterest**, approve access, then choose the destination board.

**Important:** Pinterest restricts Pin creation and analytics for apps that have not been granted standard/production access. In trial mode some endpoints return `401`/`403`. The UI surfaces the provider message instead of pretending the Pin or metrics exist. Apply for access in the Pinterest developer dashboard if you need production publishing.

Pinterest publishing is blocked until a live Blogger article URL exists. The owner can explicitly allow the fallback in **Settings → Publishing rules**, but the default is Blogger-first.

---

## Cloudinary

Pinterest needs a publicly reachable image. Local `/media/...` URLs are not public. Cloudinary is used only to host the generated photograph and return an `https` URL.

1. Create a Cloudinary account.
2. Copy **Cloud name**, **API key**, and **API secret** into **API Connections → Cloudinary**.
3. Use **Test** to verify credentials.

Generated images are always stored locally first so the dashboard can preview them even when Cloudinary is not configured. Without Cloudinary, Pinterest publishing fails with a clear message; Blogger publishing still works.

---

## Nutrition

`lib/nutrition.js` contains a reference dataset of roughly 100 common ingredients with per-100 g values (calories, protein, carbohydrate, fat, saturated fat, fiber, sugar, sodium). It parses quantities and units (`g`, `kg`, `ml`, `l`, `tsp`, `tbsp`, `cup`, `piece`, `slice`, `oz`, `lb`, etc.), converts to grams, and sums the totals.

- Values are divided by servings to produce per-serving figures.
- Unmatched ingredients are reported by name; the app never silently guesses a calorie value.
- `confidence` reflects how much of the ingredient list was matched.
- The optional USDA provider looks up foods through FoodData Central when a key is configured.
- The nutrition result includes an explicit estimate disclaimer.

This is a planning tool, not medical advice. Brand, preparation, and portion differences change real values.

---

## Scheduling and Render deployment

### Blueprint

`render.yaml` defines:

- `nourish-db` — PostgreSQL 17
- `nourish-studio` — web service (`npm start`), health check at `/health`
- `nourish-automation` — cron service, every 15 minutes, running `node server.js worker`

Deploy:

1. Push the project to a Git repository.
2. In Render: **New → Blueprint**, select the repository.
3. Set `APP_URL` to the public web URL.
4. Optionally set `ADMIN_USERNAME`/`ADMIN_PASSWORD`; otherwise use the first-run wizard.
5. Add provider credentials either through the dashboard or as Render environment variables. If you set Gemini/Cloudinary env vars only on the web service, add the same values to the cron service too (or save them in the dashboard, where both services read them from the database).
6. After the first deploy, open the app, complete setup, and connect the accounts.
7. In **API Connections**, register the production OAuth redirect URIs in Google and Pinterest.

### Why a cron service

Render web services can sleep on free plans and in-memory timers die with the process. The scheduler therefore lives in PostgreSQL:

- Every run uses a database lock, so two workers cannot publish the same slot.
- Each automation run stores a `scheduled_for` slot key (for example `2026-11-20T09:00` in the configured timezone).
- Before running, the worker checks for an existing run with that slot key and for the daily post limit.
- Scheduled posts are claimed with status transitions (`Scheduled` → `Running` → `Published`/`Failed`), so a second worker sees no due work.

The internal ticker is disabled on Render (`ENABLE_INTERNAL_SCHEDULER=false`). Locally it can stay enabled for convenience. The cron endpoint is also callable manually:

```bash
curl -X POST https://YOUR-APP.onrender.com/api/cron/run \
  -H "X-Cron-Secret: $CRON_SECRET"
```

An authenticated owner session can also trigger it from the Settings page. Unauthenticated requests require the secret.

### Defaults

- Timezone: `Asia/Dhaka`
- One post per day at `09:00`
- Automation paused until enabled
- Blogger first, then Pinterest only with a live Blogger URL
- Manual approval off

All are configurable in **Automation** and **Settings**.

---

## Security

- Passwords are hashed with scrypt (per-user salt, timing-safe comparison).
- Sessions are HttpOnly, SameSite=Lax cookies stored in the database; session tokens are hashed at rest.
- CSRF tokens are required for every mutating API request.
- Rate limits protect login, setup, prompt tests, and cron calls.
- API keys are encrypted with AES-256-GCM using a key derived from `SESSION_SECRET`; the browser only receives masked values.
- Responses set Content-Security-Policy, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, a strict referrer policy, and `Cache-Control: no-store` for API data.
- Logs scrub likely secrets before storage.
- Generated article HTML escapes user/recipe text; JSON-LD escapes `<` and `>` to prevent script breakout.
- One owner account by design. The setup endpoint refuses to create a second user.

Rotating `SESSION_SECRET` invalidates sessions and makes previously encrypted provider secrets unreadable. Re-enter provider keys after rotation.

---

## Project layout

```
food-automation/
├── server.js              Express app, auth, REST routes, OAuth callbacks, cron
├── package.json
├── render.yaml            Render blueprint (web + cron + PostgreSQL)
├── .env.example
├── lib/
│   ├── ai.js              Gemini Interactions API + legacy fallback
│   ├── db.js              PostgreSQL/SQLite adapter, schema, encryption, locks
│   ├── nutrition.js       Deterministic nutrition engine + ingredient dataset
│   ├── pipeline.js        Generation, publishing, scheduling, article HTML
│   ├── providers.js       Cloudinary, Blogger, Pinterest, nutrition providers
│   └── util.js            Env loading, timezone math, crypto, helpers
├── public/
│   ├── index.html         App shell
│   ├── styles.css         Dark design system
│   └── app.js             Vanilla SPA
├── test/
│   └── pipeline.test.js   Mocked end-to-end pipeline tests
└── data/                  Local SQLite + media fallback (not for production durability)
```

---

## API overview

All routes are JSON. Mutating routes require the `X-CSRF-Token` header returned by `/api/session` or the login/setup response.

| Area | Routes |
| --- | --- |
| Auth | `POST /api/setup`, `POST /api/login`, `POST /api/logout`, `GET /api/session`, `GET /api/bootstrap` |
| Dashboard | `GET /api/dashboard` |
| Posts | `GET/POST /api/posts`, `GET/PUT/DELETE /api/posts/:id`, `POST /api/posts/:id/duplicate` |
| Generation | `POST /api/posts/generate`, `POST /api/posts/:id/generate-{image,recipe,nutrition,seo}`, `POST /api/posts/:id/regenerate-{image,recipe,seo}`, `POST /api/posts/:id/analyze-image`, `POST /api/posts/:id/build-article`, `POST /api/posts/:id/image/upload` |
| Publishing | `POST /api/posts/:id/publish`, `POST /api/posts/:id/publish-{blogger,pinterest,both}`, `POST /api/posts/:id/retry` |
| Scheduling | `GET/POST /api/scheduled`, `PUT/DELETE /api/scheduled/:id`, `POST /api/scheduled/:id/publish-now` |
| Analytics | `GET /api/analytics?range=7|30|90|all` |
| Prompts | `GET/POST /api/prompts`, `PUT/DELETE /api/prompts/:id`, `POST /api/prompts/:id/{duplicate,default,reset}`, `POST /api/prompts/{preview,test}` |
| Connections | `GET /api/connections`, `PUT/DELETE /api/connections/{gemini,cloudinary,nutrition}`, `PUT /api/connections/oauth/:provider`, `GET/POST /api/connections/{blogger,pinterest}/...` |
| Automation | `GET/PUT /api/automation`, `POST /api/automation/{toggle,run,generate-test}`, `GET /api/automation/runs` |
| Logs | `GET/DELETE /api/logs` |
| Cron | `POST /api/cron/run` (secret or owner session) |
| Health | `GET /health` |

---

## Gemini implementation notes

The primary call path is the current Interactions endpoint (`POST /v1beta/interactions`) with the documented API revision header, `input`, and `response_format`. If that endpoint is unavailable for a key, the client falls back to the classic `:generateContent` shape for text, vision, and image generation. Both model names are configurable, so a future model rename does not require a code change.

Image generation uses a headerless image request. The returned bytes are stored locally, then uploaded to Cloudinary when configured. Text and recipe prompts request JSON; the client strips markdown fences and performs one repair attempt on malformed JSON.

---

## Limitations and honest failure modes

- **No credentials are included.** Real OAuth, publishing, and image generation require your own keys. The app reports missing keys clearly.
- **Gemini quotas** differ by model and region. If image generation is unavailable, the exact provider error is shown and the post is marked failed. You can retry the stage or upload your own image.
- **Blogger has no analytics API in v3.** The UI says so rather than estimating traffic.
- **Pinterest metrics** depend on account permissions and may lag 24–48 hours. Trial apps may be denied.
- **Pinterest requires Cloudinary** (or another public image host). Local images alone cannot be pinned.
- **Render's filesystem is ephemeral.** PostgreSQL is the durable store; Cloudinary is the durable image store. Local `data/media` survives only for the life of the instance.
- **Free Render services sleep.** The cron worker is independent, but the dashboard may take a few seconds to wake.
- **Free Render PostgreSQL expires after 30 days.** Upgrade the database plan for production.
- **SQLite is a convenience fallback**, not a concurrent production database.

---

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `No default Blogger blog selected` | Connect Google, then choose a blog in API Connections. |
| `Pinterest needs a live Blogger article URL` | Publish to Blogger first, or enable the override in Settings. |
| `Pinterest requires a public image URL` | Configure Cloudinary, then regenerate or upload the image. |
| `Gemini API key is not configured` | Add the key in API Connections or set `GEMINI_API_KEY`. |
| `Invalid or missing CSRF token` | Reload the page and sign in again. |
| OAuth redirect mismatch | The redirect URI in Google/Pinterest must exactly match `APP_URL` plus the callback path. |
| Cron skipped: `Automation is disabled` | Enable automation in the dashboard. |
| Cron skipped: `No posting slot is due` | The worker runs every 15 minutes; check the configured times and timezone. |
| Cron skipped: `Daily limit reached` | `postsPerDay` has already been produced today. |
| Secrets unreadable after redeploy | `SESSION_SECRET` changed or differs between web and cron. Re-enter provider keys. |

---

## License

Private project. Add a license before distributing.
