# Pharmacy Coordinate Endpoint Walkthrough

This walkthrough helps you test the pilot coordinate endpoint for pharmacy/chamber/hospital-style address rows.

## 1. Start The App

The easiest path is to start both the Next.js frontend and Express backend together:

```powershell
cd D:\system-design-interview\resource-planner-main\resource-planner-main
npm.cmd run dev
```

Then open the frontend form:

```txt
http://localhost:4000/coordinate-pilot
```

In the Vercel-ready Next.js app, backend endpoints are also available through:

```txt
http://localhost:4000/api/backend
http://localhost:4000/api/backend/health
```

The standalone `http://localhost:5000` server remains useful for direct local backend debugging.

Use the form to enter a shop/chamber/hospital name and address, then click `Fetch Geocoordinates`.

Doctor hospital/chamber coordinate processor:

```txt
http://localhost:4000/doctor-coordinate-pilot
```

Use this page to:

- select Region/RSE, ASE/MPE, and Territory
- sync raw doctor addresses from `address` + `centina`
- preview only unprocessed hospital/chamber location records
- process the next batch into `doctor_location_points`
- verify row updates after each coordinate lookup

The same page also has a `Process Missing Coordinates` panel. Use:

- `Refresh` to load Supabase counts.
- `Batch size` to choose how many rows to process.
- `Process` to process the next rows by ascending `id`.

The backend updates and verifies each row before moving to the next one.

## 2. Start Only The Backend

From the project folder:

```powershell
cd D:\system-design-interview\resource-planner-main\resource-planner-main
npm.cmd run server
```

You should see:

```txt
Server running at http://localhost:5000
```

Keep this terminal open while testing.

If `npm run server` fails with a PowerShell script/execution-policy error, use `npm.cmd run server` as shown above.

You can verify the server is visible in a browser by opening:

```txt
http://localhost:5000
```

or:

```txt
http://localhost:5000/health
```

The coordinate resolver itself is a `POST` endpoint, so opening `/resolve-pharmacy-coordinate` directly in a browser is not the right test.

## Supabase Admin Access

Do not paste your Supabase dashboard password or service key into chat.

To let the backend read/write Supabase, add this to the local `.env` file:

```txt
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

Keep the existing values:

```txt
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=...
```

The service role key must stay server-side. Do not put it in frontend code and do not prefix it with `NEXT_PUBLIC_`.

If port `5000` is already occupied by an older server process, start this API on another port:

```powershell
$env:PORT = "5001"
node server.js
```

Then replace `http://localhost:5000` with `http://localhost:5001` in the test commands below.

## 3. Test One Pharmacy Row With PowerShell

Open a second PowerShell terminal and run:

```powershell
$body = @{
  shop = "SUMON MEDICAL HALL"
  address = "BD,TORNIHAT,GABTOLI,GABTOLI,BOGURA,"
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri "http://localhost:5000/resolve-pharmacy-coordinate" `
  -Method Post `
  -ContentType "application/json" `
  -Body $body |
  ConvertTo-Json -Depth 8
```

## 4. Test A Small Pilot Batch

```powershell
$body = @{
  rows = @(
    @{
      shop = "SUMON MEDICAL HALL"
      address = "BD,TORNIHAT,GABTOLI,GABTOLI,BOGURA,"
    },
    @{
      shop = "MATA MEDICINE CENTER"
      address = "BD,42/7, MAIN ROAD,MAIN ROAD,MIRPUR MODEL,DHAKA,"
    },
    @{
      shop = "SADDAM MED.CORNER"
      address = "BD,GAJARIA,FARIDPUR,NAGARKANDA,FARIDPUR,"
    }
  )
} | ConvertTo-Json -Depth 5

Invoke-RestMethod `
  -Uri "http://localhost:5000/pilot-pharmacy-coordinates" `
  -Method Post `
  -ContentType "application/json" `
  -Body $body |
  ConvertTo-Json -Depth 8
```

The batch endpoint processes at most 100 rows per request for pilot safety.

## 5. Fetch Map Pins From Supabase

After importing rows into `chemist_shops` and enriching some coordinates, call:

```powershell
Invoke-RestMethod `
  -Uri "http://localhost:5000/chemist-shops/map-pins?status=resolved,low_confidence&limit=1000" `
  -Method Get |
  ConvertTo-Json -Depth 8
```

Useful query parameters:

```txt
status=resolved,low_confidence
confidence=high,medium,low
limit=1000
offset=0
includeMissing=false
```

The response returns `pins`, each shaped for mapping:

```json
{
  "id": 1,
  "shopName": "SUMON MEDICAL HALL",
  "descriptiveAddress": "BD,TORNIHAT,GABTOLI,GABTOLI,BOGURA,",
  "lat": 24.8819241,
  "lng": 89.4491359,
  "confidence": "low",
  "status": "low_confidence"
}
```

## 6. Process The Next Missing Coordinate Rows

The frontend button calls this endpoint:

```txt
POST http://localhost:5000/chemist-shops/process-next
```

PowerShell test:

```powershell
$body = @{
  batchSize = 5
  maxRetries = 3
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri "http://localhost:5000/chemist-shops/process-next" `
  -Method Post `
  -ContentType "application/json" `
  -Body $body |
  ConvertTo-Json -Depth 8
```

The processor:

1. Selects rows where coordinates are missing.
2. Orders them by `id`.
3. Marks one row as `processing`.
4. Fetches coordinates.
5. Writes the coordinate result back to Supabase.
6. Reads the row again to verify the update.
7. Moves to the next row only after verification passes.

Check progress:

```powershell
Invoke-RestMethod `
  -Uri "http://localhost:5000/chemist-shops/enrichment-status" `
  -Method Get |
  ConvertTo-Json -Depth 5
```

## 7. Read The Response

Important fields:

```json
{
  "success": true,
  "lat": 24.5615257,
  "lng": 89.2868737,
  "source": "places_text_search",
  "confidence": "medium",
  "matchedName": "Sumon medical hall",
  "matchedAddress": "H76P+JP9 Sumon medical hall",
  "placeId": "ChIJ...",
  "locationType": null,
  "reasons": [
    "Place name strongly matches the input shop name",
    "Google classified the result as a relevant place type"
  ]
}
```

Confidence meanings:

- `high`: likely exact or near-exact place match.
- `medium`: usable for pins/routes, but not guaranteed shop-exact.
- `low`: landmark, road, bazar, upazila, or district-level fallback.
- `reject`: no reliable coordinate found.

Source meanings:

- `places_text_search`: Google found a named place/business candidate.
- `geocoding`: Google resolved the address/location text instead.
- `none`: no Google result.
- `error`: request failed.

## 8. Troubleshooting

If PowerShell says it cannot connect:

```txt
Unable to connect to the remote server
```

Make sure `npm run server` is still running and listening on port `5000`.

If the response says:

```txt
GOOGLE_MAPS_API_KEY not set on server
```

Check that `.env` contains:

```txt
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_maps_key
```

If a result looks geographically wrong, check:

- `confidence`
- `matchedAddress`
- `reasons`
- `source`

For this pilot, `low` results are expected for vague addresses and should be treated as approximate pins.
