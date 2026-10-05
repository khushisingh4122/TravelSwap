# TravelSwap

A full-stack student prototype for connecting travelers who need opposite currencies.

**Educational simulation only.** TravelSwap does not process payments, hold funds, connect to banks, collect banking details, or facilitate real financial transactions.

## Features

- Real local signup, login, logout and persistent server-side sessions.
- Existing ChatGPT authentication retained for the Sites-hosted Worker.
- Editable traveller profiles; private email and public travel preferences.
- Persistent exchange listings: create, edit, close and soft-delete.
- Deterministic matching with percentages and explainable component scores.
- Requests with pending, accepted, declined, cancelled and completed states.
- Participant-only stored conversations; completed threads are read-only.
- Database-backed notifications and unread counts.
- Owner-scoped data export and profile deletion/redaction.
- Block/report controls, moderation, audit events and rate limiting.
- Explicitly labelled Ananya/Wei demo accounts using the same backend and database.
- Responsive landing page, dashboard, discovery, listing management, requests, profiles and conversation pages.

## Running locally

Requires **Node.js 22.13 or newer**. No external runtime packages or npm install are required.

From this existing repository:

```powershell
npm run build
npm test
npm start
```

Open **http://127.0.0.1:4174/**. Use this exact host; localhost is deliberately not accepted by the local server's Host check.

Both frontend assets and backend APIs are served by the same Node process. There is no second frontend server to start. Stop with Ctrl+C. After changing source, rebuild and restart the server. The existing persistent database is **work/preview.sqlite**, ignored by Git and excluded from the source ZIP. Do not delete it if you want to retain your records.

Equivalent commands without npm:

```powershell
node scripts/build.mjs
node tests/run.mjs
node scripts/preview.mjs
```

The local server binds only to 127.0.0.1. It is not a public deployment server. Local accounts have no email verification, email delivery or password-recovery service. Use fictional addresses and unique test passwords.

## Demo

1. Open the landing page and choose **Try Demo**.
2. Choose **Continue as Ananya** (India, INR → TWD).
3. Open **Discover**, inspect Wei's match score and reasons, and choose **Request exchange**, then Confirm.
4. Choose **Switch demo user**, then **Continue as Wei**.
5. Open **Requests**, accept Ananya's incoming request, and enter the conversation.
6. Send a message. Switch to Ananya, open Requests → Open conversation, and reply.
7. Refresh the page: the conversation and messages remain.
8. Choose **Mark demo exchange complete**, then Confirm.
9. Both accounts see COMPLETED, a read-only conversation and updated dashboard totals.

Demo accounts are shared only within this local installation and are clearly labelled. Do not put personal information in them. The server seeds sample listings when neither an open nor a matched current sample listing exists; it does not erase earlier exchanges. The landing-page example cards are illustrations labelled sample data. All discovery cards, dashboard figures, requests, messages and notifications come from database queries.

For the full account-creation flow, use **Create account**, then complete the profile and create a listing. Log out and register a second account with reciprocal currencies and travel route. You can also use separate browser profiles for two simultaneous sessions.

## Matching Algorithm

Implemented in **src/matching.mjs**, evaluated by the backend:

| Component | Points | Rule |
|---|---:|---|
| Currency | 40 | A.have = B.need and A.need = B.have |
| Destination | 20 | A.origin = B.destination and A.destination = B.origin |
| Date | 0–20 | Round(20 × max(0, 1 − absolute day difference / 90)) |
| Amount | 0–20 | Round(20 × min(normalised amounts) / max(normalised amounts)) |

Travel months are represented by their first day for proximity scoring.
Amounts are integer minor units. Illustrative rates are fixed at **1 INR = 0.38 TWD = 0.018 AUD**. Convert each offered amount to illustrative INR units before comparing them.
These are fictional scoring constants, not live rates, financial quotes or a savings promise.

The score is the sum of the four components, from 0 to 100. Opposite currency directions are mandatory for sending requests. Matching is deterministic, not AI. A high score is not identity verification or a trust rating.

Discovery can select which active listing to match against and filter currency, destination and compatible-only results. The dashboard uses the most recent active listing for its potential-match count. Results are currently bounded to the most recent 100 candidate listings.

## Architecture

### Frontend
**public/index.html**, **public/app.js**, **public/style.css**: plain HTML, CSS and JavaScript. Same-origin fetch calls, escaped user content, semantic forms, confirmation dialogs, loading/error/empty/success states, responsive layouts.

Routes: /, /signup, /login, /demo, /dashboard, /discover, /listings, /requests, /conversation/:id, /profile, /notifications.

### Backend
**src/worker.mjs** exports a Cloudflare Worker-compatible fetch handler. The local Node server forwards requests to the exact built Worker. **src/security.mjs** centralises input and request protections. **scripts/build.mjs** bundles local assets and modules into **dist/server/index.js**.

### Database
Existing SQLite/D1 concepts are reused: profiles, listings, requests, messages, blocks, reports, rate_limits, audit_events, interests.
The additive **drizzle/0002_student_prototype.sql** migration adds profile/travel metadata, soft deletion, a request source listing and completion timestamp, and the notifications table.
Prior migrations and data remain intact. COMPLETED is exposed when completed_at is set; the original request status constraint is retained to avoid destructive table reconstruction.
The local adapter additionally creates local_accounts and local_sessions. These local-only tables are not required by hosted ChatGPT sign-in.

Queries use bound SQL parameters. Related state changes run in transactional batches. Existing pilot interests are retained and included in data exports.
Migration SQL is manually authored/reviewed and tested against SQLite. It is not claimed to be generated by Drizzle. Hosted D1 application is unverified while deployment is blocked.

### Authentication
Local: **scripts/preview.mjs** performs signup/login using asynchronous scrypt (N=32768, r=8, p=1), random 16-byte salts and timing-safe comparison. Session cookies contain 32-byte random tokens; only SHA-256 token hashes are stored. Sessions expire after 24 hours, rotate on login, and are revoked on logout. Cookies are HttpOnly and SameSite=Strict. Secure cookies require HTTPS; this adapter is restricted to loopback HTTP.

The adapter strips caller-supplied identity headers and the old mock login cookie cannot authenticate. It resolves valid sessions and supplies the existing trusted identity headers to the Worker. No frontend-only authentication or localStorage identity is used.

Hosted: Sites dispatch supplies trusted ChatGPT identity headers. Hosted auth routes remain platform-owned. Never expose this Worker directly on an origin that trusts arbitrary caller identity headers. Local password auth and demo-account switching are not shipped in the hosted Worker.

### API
All data endpoints require backend authentication. /api/session supports anonymous session discovery.

- GET/POST /api/profile; GET /api/profiles/:publicId
- GET/POST /api/listings; GET /api/mine
- POST /api/listings/:id/edit, /close, /delete
- GET /api/dashboard
- GET/POST /api/requests
- POST /api/requests/:id/accept, /decline, /cancel, /complete
- GET/POST /api/requests/:id/messages
- GET /api/notifications; POST /api/notifications/read
- GET/POST /api/blocks; POST /api/reports
- GET/POST /api/admin (administrator only)
- GET /api/export; POST /api/profile/delete
- GET /api/interest; POST /api/interest/delete (retained pilot data)
- Local only: POST /api/auth/signup, /login, /logout, /demo

No request accepts a client-provided user ID as authentication. Listings and profile writes use the authenticated owner; requests and conversations require participation. Only the receiving listing owner can accept or decline.

### Moderation configuration
Hosted **ADMIN_EMAIL** must be configured through Sites using a platform-authenticated owner email.
Local **ADMIN_USER_ID** is an explicit trusted account ID set in the server environment. Unverified local email addresses never grant administrator access. Leave it unset to keep local admin access disabled. An operator can find the intended account's ID in local_accounts in the local database and set ADMIN_USER_ID before starting the server. Never put credentials in public files.

## Security controls

- Parameterised SQL, strict input validation, bounded request bodies and currency/route allowlists.
- Authentication, owner/participant authorization and server-enforced status transitions.
- Same-origin, JSON and custom-header mutation protection.
- Per-account API/write/message/listing/request/report limits; local sign-in throttling.
- Security headers including CSP, no-store and nosniff.
- Atomic request acceptance/completion, messages with notifications, and profile deletion.
- Block enforcement on discovery, profile access, requests and messages.
- Audit metadata without message bodies/passwords; generic storage errors.
- Soft-deleted listings preserve history. Profile deletion redacts content; local credentials and sessions are removed.
- No bank, payment, identity-document, tracking or analytics integrations.

Data is stored locally without application-level encryption at rest. Administrators can access the database. This is not an independently audited production financial service.

## Testing

```powershell
npm run build
npm test
```

**18 tests passed** in the final implementation check:
- Authentication boundaries and local spoofed-header rejection.
- CSRF, media type, body limits and security headers.
- Listing CRUD, ownership and invalid inputs.
- Deterministic weighted matching.
- Duplicate/self/unauthorized requests and invalid transitions.
- Full request → accept → message → complete flow.
- Competing/simultaneous acceptance and notification deduplication.
- Participant privacy and notification ownership.
- Block/report/moderation, suspension and rate limits.
- Export, deletion/redaction and transactional failure rollback.
- Non-destructive migration and foreign-key integrity.
- Real HTTP signup, logout, login, session revocation/expiry and end-to-end flow.
- Database close/reopen persistence for accounts, sessions, listings and messages.

Browser checks additionally completed the Ananya/Wei flow, message refresh persistence, creation of a listing, desktop landing layout and 390px mobile discovery.
The legacy interest-only API-denial assertions were replaced with authenticated prototype-workflow tests because the requested product now intentionally enables those endpoints.

## Screenshots

Suggested screenshots to add for a presentation or GitHub README:
- Landing page: headline and labelled sample exchange.
- Dashboard and discovery: database totals, score and reasons.
- Requests and conversation: accepted state and two-way messages.
- Completion: COMPLETED banner and read-only history.
- Mobile discovery.

## Deployment status

The original Sites project is retained. No public URL or saved hosted version exists as of the last verified status. Windows denies .git/index.lock writes despite prior permission grants, so source commit/push and publishing are blocked. The project runs locally regardless of that hosting limitation.

No GitHub repository was created or pushed. The source ZIP and this README are ready for handoff. Hosted D1, real platform authentication, HTTPS, production operational monitoring and backup restoration remain unverified. Do not deploy the loopback server directly to the public internet.

## Future Improvements

- Hosted identity verification appropriate to a future product, with data minimisation.
- Real-time messaging and notification delivery.
- More currencies, pagination and richer deterministic recommendations.
- Multilingual support and mobile application.
- Email verification and password recovery for a separately reviewed public local-auth deployment.
- Automated retention, backup/restore drills and independent security review.

## Disclaimer

TravelSwap is a student prototype created for educational and demonstration purposes. It does not process payments, hold funds, or facilitate real financial transactions.

