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
