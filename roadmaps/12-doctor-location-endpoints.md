# Doctor Location Endpoint Plan

```mermaid
flowchart TD
  A["Frontend doctor location page"] --> B["User enters doc_id or selects doctor"]
  B --> C["Fetch existing doctor location row"]
  C --> D{"Which location type?"}

  D -->|Hospital| E["Use hospital_address"]
  D -->|Chamber| F["Use chamber_address"]

  E --> G["POST /doctor-locations/resolve-hospital"]
  F --> H["POST /doctor-locations/resolve-chamber"]

  G --> I["Coordinate resolver"]
  H --> I

  I --> J["Places Text Search"]
  J --> K{"Good address-aware match?"}
  K -->|Yes| L["Save place result"]
  K -->|No| M["Geocoding fallback"]
  M --> N["Save geocode result"]
  L --> O["Verify Supabase update"]
  N --> O
  O --> P["Return updated doctor location row"]
```

Proposed endpoints:

```txt
GET  /doctor-locations/:docId
POST /doctor-locations/upsert
POST /doctor-locations/resolve-hospital
POST /doctor-locations/resolve-chamber
GET  /doctor-locations/enrichment-status
POST /doctor-locations/process-next
```

The resolver can reuse the existing pharmacy coordinate logic, but pass the hospital/chamber address and a stronger query label such as:

```txt
{hospital_name}, {hospital_address}, Bangladesh
{chamber_name}, {chamber_address}, Bangladesh
Dr. {doctor_name}, {chamber_address}, Bangladesh
```

