# Stories and projects in the main backend

The main NestJS application now serves the stories and projects API. It reuses
the existing MongoDB connection, Cloudinary service, JWT authentication and admin
role checks. The Express stories backend is no longer needed by either UI.

## Endpoints

- `/api/v1/real-shipment-stories`: public list, admin create.
- `/api/v1/real-shipment-stories/slug/:slug` and `/:idOrSlug`: public published detail; admins can read drafts.
- `/api/v1/real-shipment-stories/:id`: admin update (PUT) and delete.
- `/api/v1/real-shipment-stories/:id/publish`: admin PATCH.
- `/api/v1/real-shipment-stories/upload-image`: admin multipart POST (`image`, maximum 10 MiB).
- `/api/v1/projects`: list and admin create; `/:id`: detail, admin PUT and DELETE.

These endpoints retain the old `{ success, data, pagination }` response format.
Existing main-backend endpoints retain their existing response format.
Public story reads exclude drafts and records without a valid service line.
The old stories login/signup/profile/password endpoints are not duplicated.
Use the existing `/auth/*` and `/user/me` endpoints and a main-backend admin account.

## Deployment and existing data

1. Configure the main backend's existing `DATABASE_URL`, JWT, Redis and Cloudinary
   variables. Cloudinary uses `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and
   `CLOUDINARY_API_SECRET` (see `src/common/config/app.config.ts`).
2. Point both UIs' `NEXT_PUBLIC_API_URL` to the main backend origin, e.g.
   `http://localhost:5000`. Keep the API path out of this value.
3. Set the website's `NEXT_PUBLIC_DASHBOARD_URL` to the separate dashboard origin
   (local default: `http://localhost:3001`). Run the website on port 3000 and the
   dashboard on port 3001. Set the dashboard's `NEXTAUTH_URL` to its own origin.
4. Collections retain their original names: `realshipmentstories` and `projects`.
   If the old backend uses another database, back up and copy only these collections
   into the main database before switching traffic. Preserve `_id`, slugs and dates;
   check duplicate slugs before merging. No database records were copied by this code change.
5. Legacy users/password hashes are not copied. Sign in with a main-backend admin.
   Assign a service line to legacy stories before publishing them.

## Smoke check

Sign in to the dashboard, create a draft with an image and FAQ, edit it, clear the
image/FAQ, publish it, and confirm it appears on the website. Unpublish it and
confirm its public detail returns 404. Check project search, pagination, CRUD,
profile name changes, password changes and old website dashboard redirects.
Password changes require signing in again. Email remains read-only because the
main backend protects that field.

## Story cover positioning and readership

Story writes accept optional `coverPosition: { x, y }` percentages between 0 and
100 (a JSON string in multipart forms). Existing stories default to 50/50.
Omitting the field preserves an existing position; replacing/removing an image
without an explicit new position resets it to center. Original images are kept.

The website forwards best-effort visit events to public
`POST /api/v1/real-shipment-stories/:id/events`:
`{ viewId: "UUID-v4", event: "open" | "engaged" | "complete", activeSeconds: number, progress: number }`.
An engaged event requires 30 active seconds; a completion also requires 90%
article progress. Accepted responses are `{ success: true, data: { accepted: true } }`.
Out-of-order events use a monotonic stage and count one open per page-visit ID.
These metrics describe observed browser activity, not verified people or unique
readers; blocked telemetry and network failures reduce observed counts. No
historical readership can be recovered.

Reporting requires an admin or story-manager token:

- `GET /api/v1/real-shipment-stories/analytics?storyIds=<comma-separated-ids>&days=30`
- `GET /api/v1/real-shipment-stories/:id/analytics?days=30`

Both return `{ success: true, data: { days, from, to, trackingStartedAt, stories } }`.
Each story has `storyId`, `opens`, `engaged`, `completed`, and zero-filled `daily`
rows with `date` (YYYY-MM-DD) and the same counts. Reports use UTC first-open
dates, support 7/30/90 calendar days including today, and accept up to 50 story
IDs per batch. Counts cover the selected range. `trackingStartedAt` is null
before tracking begins; afterward its persisted earliest timestamp survives
visit retention. Responses are private and never cached.

Deploy the additive backend before either UI. In staging, confirm `storyvisits`
has the unique `{ storyId: 1, viewId: 1 }` index, reporting index
`{ storyId: 1, openedAt: 1 }`, and TTL `{ expiresAt: 1 }` with
`expireAfterSeconds: 0` before enabling collection. Mongo TTL cleanup is
asynchronous. Visits expire 90 days after the first accepted event, while the
non-identifying `storytracking` singleton preserves the start timestamp.
No existing story migration is needed. If automatic index creation is disabled
by deployment policy, provision these indexes before traffic.

Redis must be ready for collection. An atomic fixed window allows 12 events
per visit and 6000 events globally each minute, including server-side proxies;
the backend does not read or store forwarded client IPs. Redis failure returns
503 before a database lookup; exhausted limits return 429. Limits bound direct
endpoint abuse but do not authenticate readers or prevent forged activity.
No names, emails, raw IPs, or full user-agent strings are stored in visit records.
Verify duplicate events, reversed event order, draft rejection, manager access,
and expiry/index behavior in staging. No production data or indexes are changed
by local tests.
