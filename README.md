# Resource Planner Pro

Next.js resource planning and route prototype for Bangladesh field operations.

## Local Development

Install dependencies, then run the Next.js app:

```powershell
npm.cmd install
npm.cmd run dev
```

Open:

```txt
http://localhost:4000
```

Useful pages:

```txt
http://localhost:4000/coordinate-pilot
http://localhost:4000/doctor-coordinate-pilot
http://localhost:4000/territory-nearby-chemists
```

The Express backend is exposed through Next.js at:

```txt
http://localhost:4000/api/backend
http://localhost:4000/api/backend/health
```

The standalone Express server is still available for local debugging:

```powershell
npm.cmd run server
```

That starts:

```txt
http://localhost:5000
```

## Environment Variables

Create a local `.env` file and configure the same variables in Vercel:

```txt
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=
```

Optional:

```txt
NEXT_PUBLIC_API_BASE_URL=
```

Leave `NEXT_PUBLIC_API_BASE_URL` empty on Vercel to use the built-in `/api/backend` route. Set it only if you later move the backend to a separate public API host.

## Vercel Deployment

Set the Vercel project root to the folder that contains this `package.json`.

Build command:

```txt
npm run build
```

Output directory:

```txt
.next
```

The backend endpoints are served by:

```txt
/api/backend/[...path]
```

For example:

```txt
/api/backend/health
/api/backend/resolve-pharmacy-coordinate
/api/backend/doctor-location-points/process-next
/api/backend/territory-nearby/chemist-shops
```

## Verification

Before deploying, run:

```powershell
npm.cmd run build
```

Then run locally:

```powershell
npm.cmd run dev
```

Check:

```txt
http://localhost:4000
http://localhost:4000/api/backend/health
```
