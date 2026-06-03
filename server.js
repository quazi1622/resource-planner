require('dotenv').config();
const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");
const genericPool = require("generic-pool");
const pLimit = require("p-limit").default;
const NodeCache = require("node-cache");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = Number(process.env.PORT || 5000);
const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVER_KEY = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;

const supabaseAdmin = SUPABASE_URL && SUPABASE_SERVER_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVER_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    success: true,
    service: "Resource Planner coordinate pilot API",
    health: "http://localhost:5000/health",
    endpoints: {
      resolveOne: "POST /resolve-pharmacy-coordinate",
      pilotBatch: "POST /pilot-pharmacy-coordinates",
      chemistShopMapPins: "GET /chemist-shops/map-pins",
      chemistShopStatus: "GET /chemist-shops/enrichment-status",
      processNextChemistShops: "POST /chemist-shops/process-next",
      doctorLocationFilters: "GET /doctor-location-points/filters",
      syncDoctorLocationPoints: "POST /doctor-location-points/sync-from-source",
      pendingDoctorLocationPoints: "GET /doctor-location-points/pending",
      processNextDoctorLocationPoints: "POST /doctor-location-points/process-next",
      territoryNearbyDoctors: "GET /territory-nearby/doctors",
      territoryNearbyChemists: "GET /territory-nearby/chemist-shops",
      territoryNearbyEmbed: "GET /territory-nearby/embed-url",
      legacyBrowserCoordinate: "GET /fetch-coordinates?place=...",
      routeEmbed: "POST /generate-embed-url",
    },
  });
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "ok",
    hasGoogleMapsApiKey: Boolean(GOOGLE_MAPS_API_KEY),
    hasSupabaseUrl: Boolean(SUPABASE_URL),
    hasSupabaseServerKey: Boolean(SUPABASE_SERVER_KEY),
    usingServiceRoleKey: Boolean(SUPABASE_SERVICE_ROLE_KEY),
  });
});

// ─── CACHE: 24hr TTL ─────────────────────────────────────────────────────────
const coordCache = new NodeCache({ stdTTL: 86400 });
const pharmacyCoordCache = new NodeCache({ stdTTL: 86400 });

// ─── BROWSER POOL: max 5 instances ───────────────────────────────────────────
const browserPool = genericPool.createPool(
  {
    create: async () => {
      console.log("Spawning new browser instance...");
      return await chromium.launch({ headless: true });
    },
    destroy: async (browser) => {
      console.log("Destroying browser instance...");
      await browser.close();
    },
  },
  {
    max: 5,                  // max 5 concurrent browsers
    min: 0,                  // launch only when /fetch-coordinates needs a browser
    acquireTimeoutMillis: 30000,  // wait max 30s for a free browser
    idleTimeoutMillis: 60000,     // destroy idle browsers after 60s
  }
);

// ─── CONCURRENCY LIMITER: max 5 parallel geocode jobs ────────────────────────
const limit = pLimit(5);
const pharmacyLimit = pLimit(3);

function normalizeAddress(address = "") {
  return String(address)
    .replace(/^BD,?/i, "")
    .replace(/\s+/g, " ")
    .replace(/,+/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/,\s*$/g, "")
    .trim();
}

function normalizeName(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(med|medicine|medical|pharmacy|pharma|hall|store|corner|centre|center)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value = "") {
  return new Set(normalizeName(value).split(" ").filter(Boolean));
}

function tokenOverlap(left = "", right = "") {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (!leftTokens.size || !rightTokens.size) return 0;

  let matches = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) matches += 1;
  }

  return matches / leftTokens.size;
}

function parseAddressParts(address = "") {
  return normalizeAddress(address)
    .split(",")
    .map(part => part.trim())
    .filter(Boolean);
}

function addressCoverage(inputAddress = "", resultAddress = "") {
  const parts = parseAddressParts(inputAddress)
    .filter(part => part.length > 2 && !/^\d+[/-]?\d*$/.test(part));

  if (!parts.length || !resultAddress) return 0;

  const haystack = resultAddress.toLowerCase();
  const matches = parts.filter(part => haystack.includes(part.toLowerCase())).length;
  return matches / Math.min(parts.length, 4);
}

function includesUsefulType(types = []) {
  return types.some(type => ["pharmacy", "drugstore", "hospital", "doctor", "health", "store", "point_of_interest", "establishment"].includes(type));
}

function scorePlacesCandidate(shop, address, place) {
  const nameScore = tokenOverlap(shop, place.name || "");
  const addressScore = addressCoverage(address, place.formatted_address || "");
  const typeScore = includesUsefulType(place.types || []) ? 1 : 0;
  const hasAddressContext = parseAddressParts(address).length >= 2;
  const reasons = [];

  if (nameScore >= 0.8) reasons.push("Place name strongly matches the input shop name");
  else if (nameScore >= 0.45) reasons.push("Place name partially matches the input shop name");
  else reasons.push("Place name did not closely match the input shop name");

  if (addressScore >= 0.5) reasons.push("Matched address includes several input location parts");
  else if (addressScore > 0) reasons.push("Matched address includes at least one input location part");
  else reasons.push("Matched address does not include clear input location parts");

  if (typeScore) reasons.push("Google classified the result as a relevant place type");

  const score = (nameScore * 0.55) + (addressScore * 0.3) + (typeScore * 0.15);
  let confidence = "reject";

  if (score >= 0.72 && nameScore >= 0.45) confidence = "high";
  else if (score >= 0.45 && (nameScore >= 0.35 || addressScore >= 0.5)) confidence = "medium";
  else if (score >= 0.25 || addressScore > 0) confidence = "low";

  if (hasAddressContext && addressScore === 0) {
    confidence = "low";
    reasons.push("Place name may match, but the result location could not be verified against the input address");
  }

  return {
    score: Number(score.toFixed(3)),
    confidence,
    reasons,
    nameScore: Number(nameScore.toFixed(3)),
    addressScore: Number(addressScore.toFixed(3)),
    typeScore,
  };
}

function scoreGeocodeCandidate(address, geocodeResult) {
  const locationType = geocodeResult.geometry?.location_type || "UNKNOWN";
  const resultTypes = geocodeResult.types || [];
  const addressScore = addressCoverage(address, geocodeResult.formatted_address || "");
  const reasons = [];

  if (locationType === "ROOFTOP") reasons.push("Geocoding returned a rooftop-level coordinate");
  else if (locationType === "RANGE_INTERPOLATED") reasons.push("Geocoding returned an interpolated street coordinate");
  else if (locationType === "GEOMETRIC_CENTER") reasons.push("Geocoding returned a road/area center coordinate");
  else reasons.push("Geocoding returned an approximate coordinate");

  if (geocodeResult.partial_match) reasons.push("Google marked the geocode as a partial match");
  if (addressScore >= 0.5) reasons.push("Geocoded address includes several input location parts");
  else if (addressScore > 0) reasons.push("Geocoded address includes at least one input location part");

  let confidence = "low";
  if (!geocodeResult.partial_match && ["ROOFTOP", "RANGE_INTERPOLATED"].includes(locationType)) confidence = "medium";
  if (geocodeResult.partial_match && ["APPROXIMATE"].includes(locationType) && addressScore === 0) confidence = "reject";
  if (resultTypes.includes("locality") || resultTypes.includes("administrative_area_level_2")) confidence = "low";

  return {
    confidence,
    reasons,
    addressScore: Number(addressScore.toFixed(3)),
    locationType,
  };
}

async function fetchGoogleJson(url, params) {
  if (!GOOGLE_MAPS_API_KEY) {
    throw new Error("GOOGLE_MAPS_API_KEY not set on server");
  }

  const response = await fetch(`${url}?${new URLSearchParams({ ...params, key: GOOGLE_MAPS_API_KEY })}`);
  if (!response.ok) {
    throw new Error(`Google request failed with HTTP ${response.status}`);
  }

  const data = await response.json();
  if (data.status && !["OK", "ZERO_RESULTS"].includes(data.status)) {
    throw new Error(`Google API returned ${data.status}${data.error_message ? `: ${data.error_message}` : ""}`);
  }

  return data;
}

function toResolvedResult({ shop, address, query, source, confidence, reasons, place, geocode, score }) {
  const geometry = place?.geometry || geocode?.geometry;
  const location = geometry?.location;

  return {
    success: Boolean(location && confidence !== "reject"),
    input: {
      shop,
      address,
      normalizedAddress: normalizeAddress(address),
      query,
    },
    lat: location?.lat ?? null,
    lng: location?.lng ?? null,
    source,
    confidence,
    score: score ?? null,
    matchedName: place?.name ?? null,
    matchedAddress: place?.formatted_address || geocode?.formatted_address || null,
    placeId: place?.place_id || geocode?.place_id || null,
    googleTypes: place?.types || geocode?.types || [],
    locationType: geocode?.geometry?.location_type || null,
    partialMatch: Boolean(geocode?.partial_match),
    reasons,
  };
}

function requireSupabase(res) {
  if (!supabaseAdmin) {
    res.status(500).json({
      success: false,
      error: "Supabase server client is not configured. Add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.",
    });
    return null;
  }

  return supabaseAdmin;
}

function statusFromCoordinateResult(result) {
  if (!result.success || result.confidence === "reject") return "failed";
  if (result.confidence === "low") return "low_confidence";
  return "resolved";
}

function updatePayloadFromCoordinateResult(result, retryCount, errorMessage = null) {
  const nextStatus = errorMessage ? "failed" : statusFromCoordinateResult(result);
  const now = new Date().toISOString();

  return {
    latitude: result.lat,
    longitude: result.lng,
    confidence: result.confidence || "reject",
    source: result.source || (errorMessage ? "error" : "none"),
    matched_name: result.matchedName || null,
    matched_address: result.matchedAddress || null,
    place_id: result.placeId || null,
    google_types: result.googleTypes || [],
    location_type: result.locationType || null,
    partial_match: Boolean(result.partialMatch),
    status: nextStatus,
    retry_count: retryCount,
    last_attempted_at: now,
    resolved_at: nextStatus === "resolved" || nextStatus === "low_confidence" ? now : null,
    error_message: errorMessage,
    reasons: errorMessage ? [errorMessage] : (result.reasons || []),
  };
}

function doctorLocationPayloadFromCoordinateResult(result, retryCount, errorMessage = null) {
  const base = updatePayloadFromCoordinateResult(result, retryCount, errorMessage);

  return {
    latitude: base.latitude,
    longitude: base.longitude,
    confidence: base.confidence,
    source: base.source,
    matched_name: base.matched_name,
    matched_address: base.matched_address,
    place_id: base.place_id,
    google_types: base.google_types,
    location_type_google: base.location_type,
    partial_match: base.partial_match,
    status: base.status,
    retry_count: base.retry_count,
    last_attempted_at: base.last_attempted_at,
    resolved_at: base.resolved_at,
    error_message: base.error_message,
    reasons: base.reasons,
  };
}

function normalizeText(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseDoctorRawAddress(rawAddress = "") {
  const parts = String(rawAddress ?? "").split("|").map(part => part.trim());
  const placeName = normalizeText(parts[0] || "");
  const descriptiveAddress = normalizeText(parts.slice(1).join(", ").replace(/^,+/, "").replace(/,+$/g, ""));

  return {
    placeName: placeName || null,
    descriptiveAddress: descriptiveAddress || null,
    rawAddress: rawAddress || null,
    hasUsableAddress: Boolean(placeName || descriptiveAddress),
  };
}

function normalizeDoctorId(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeTerritoryValue(value) {
  return String(value ?? "").trim();
}

function applyChemistTerritoryFilters(query, filters = {}) {
  const rse = normalizeTerritoryValue(filters.rse);
  const ase = normalizeTerritoryValue(filters.ase);
  const territory = normalizeTerritoryValue(filters.territory);

  let nextQuery = query;
  if (rse) nextQuery = nextQuery.eq("rse", rse);
  if (ase) nextQuery = nextQuery.eq("ase", ase);
  if (territory) nextQuery = nextQuery.eq("territory", territory);
  return nextQuery;
}

async function fetchSupabasePages({ client, table, select, buildQuery = query => query, pageSize = 1000, maxRows = 200000 }) {
  const rows = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const to = Math.min(from + pageSize - 1, maxRows - 1);
    const query = buildQuery(client.from(table).select(select).range(from, to));
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function fetchDoctorRowsForFilters(client, { team = "centina", rse = "A1", ase = "", territory = "", limit = 5000 }) {
  let query = client
    .from(team)
    .select("Doc_ID,Doctor,Designation,RSE,ASE,Territory")
    .order("Doc_ID", { ascending: true })
    .limit(limit);

  if (rse) query = query.eq("RSE", rse);
  if (ase) query = query.eq("ASE", ase);
  if (territory) query = query.ilike("Territory", `${territory}%`);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

function doctorMetaMap(rows = []) {
  return new Map(rows.map(row => [normalizeDoctorId(row.Doc_ID), {
    docId: normalizeDoctorId(row.Doc_ID),
    doctorName: normalizeText(row.Doctor),
    designation: normalizeText(row.Designation),
    rse: normalizeTerritoryValue(row.RSE),
    ase: normalizeTerritoryValue(row.ASE),
    territory: normalizeTerritoryValue(row.Territory),
  }]));
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function haversineKm(from, to) {
  const earthRadiusKm = 6371;
  const dLat = (to.lat - from.lat) * Math.PI / 180;
  const dLng = (to.lng - from.lng) * Math.PI / 180;
  const lat1 = from.lat * Math.PI / 180;
  const lat2 = to.lat * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function mapDoctorPoint(row, meta = {}) {
  return {
    id: row.id,
    docId: row.doc_id,
    doctorName: row.doctor_name || meta.doctorName || null,
    designation: meta.designation || null,
    rse: meta.rse || null,
    ase: meta.ase || null,
    territory: meta.territory || null,
    locationType: row.location_type,
    placeName: row.place_name,
    descriptiveAddress: row.descriptive_address,
    rawAddress: row.raw_address,
    lat: toNumberOrNull(row.latitude),
    lng: toNumberOrNull(row.longitude),
    confidence: row.confidence,
    source: row.source,
    matchedAddress: row.matched_address,
    status: row.status,
  };
}

async function countChemistRows(client, label, buildQuery) {
  const query = buildQuery(client
    .from("chemist_shops")
    .select("id", { count: "exact", head: true }));
  const { count, error } = await query;
  if (error) throw error;
  return [label, count || 0];
}

async function resolvePharmacyCoordinate({ shop, address }) {
  const cleanShop = String(shop || "").trim();
  const cleanAddress = normalizeAddress(address || "");
  if (!cleanShop && !cleanAddress) {
    throw new Error("Either shop or address is required");
  }

  const cacheKey = `${cleanShop}|${cleanAddress}`.toLowerCase();
  const cached = pharmacyCoordCache.get(cacheKey);
  if (cached) return { ...cached, cached: true };

  const query = [cleanShop, cleanAddress, "Bangladesh"].filter(Boolean).join(", ");

  const placesData = await fetchGoogleJson("https://maps.googleapis.com/maps/api/place/textsearch/json", {
    query,
    region: "bd",
  });

  if (placesData.results?.length) {
    const ranked = placesData.results
      .slice(0, 5)
      .map(place => ({ place, scoring: scorePlacesCandidate(cleanShop, cleanAddress, place) }))
      .sort((a, b) => b.scoring.score - a.scoring.score);

    const best = ranked[0];
    if (["high", "medium"].includes(best.scoring.confidence)) {
      const result = toResolvedResult({
        shop: cleanShop,
        address,
        query,
        source: "places_text_search",
        confidence: best.scoring.confidence,
        reasons: best.scoring.reasons,
        place: best.place,
        score: best.scoring.score,
      });
      result.candidateCount = placesData.results.length;
      result.scoring = {
        nameScore: best.scoring.nameScore,
        addressScore: best.scoring.addressScore,
        typeScore: best.scoring.typeScore,
      };
      pharmacyCoordCache.set(cacheKey, result);
      return result;
    }
  }

  const geocodeQuery = [cleanAddress || cleanShop, "Bangladesh"].filter(Boolean).join(", ");
  const geocodeData = await fetchGoogleJson("https://maps.googleapis.com/maps/api/geocode/json", {
    address: geocodeQuery,
    region: "bd",
  });

  if (geocodeData.results?.length) {
    const geocode = geocodeData.results[0];
    const scoring = scoreGeocodeCandidate(cleanAddress, geocode);
    const result = toResolvedResult({
      shop: cleanShop,
      address,
      query: geocodeQuery,
      source: "geocoding",
      confidence: scoring.confidence,
      reasons: scoring.reasons,
      geocode,
      score: scoring.addressScore,
    });
    result.locationType = scoring.locationType;
    pharmacyCoordCache.set(cacheKey, result);
    return result;
  }

  const result = {
    success: false,
    input: {
      shop: cleanShop,
      address,
      normalizedAddress: cleanAddress,
      query,
    },
    lat: null,
    lng: null,
    source: "none",
    confidence: "reject",
    score: null,
    matchedName: null,
    matchedAddress: null,
    placeId: null,
    googleTypes: [],
    locationType: null,
    partialMatch: false,
    reasons: ["No Places or Geocoding result found"],
  };
  pharmacyCoordCache.set(cacheKey, result);
  return result;
}

// ─── CORE GEOCODE FUNCTION ───────────────────────────────────────────────────
async function fetchCoordinates(placeName) {
  const cacheKey = placeName.toLowerCase().trim();

  // Return cached result if available
  const cached = coordCache.get(cacheKey);
  if (cached) {
    console.log(`Cache hit: "${placeName}"`);
    return cached;
  }

  const browser = await browserPool.acquire();
  const page = await browser.newPage();

  try {
    const searchUrl = "https://www.google.com/maps/search/" + encodeURIComponent(placeName);
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Wait for URL to resolve to coordinates instead of blind timeout
    await page.waitForURL(/\/@-?\d+\.\d+,-?\d+\.\d+/, { timeout: 15000 });

    const currentUrl = page.url();
    console.log("Resolved URL:", currentUrl);

    const match = currentUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (!match) throw new Error("Could not extract coordinates from URL");

    const result = {
      lat: parseFloat(match[1]),
      lng: parseFloat(match[2]),
      place: placeName,
    };

    // Store in cache
    coordCache.set(cacheKey, result);
    console.log(`Cached: "${placeName}" → ${result.lat}, ${result.lng}`);

    return result;
  } finally {
    await page.close();
    browserPool.release(browser);
  }
}

// ─── GET /fetch-coordinates?place=Dhaka Medical College ──────────────────────
app.get("/fetch-coordinates", async (req, res) => {
  try {
    const { place } = req.query;
    if (!place) return res.status(400).json({ success: false, error: "Place name is required" });

    // Queue the request through the concurrency limiter
    const coords = await limit(() => fetchCoordinates(place));
    res.json({ success: true, ...coords });
  } catch (err) {
    console.error("Geocode error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /resolve-pharmacy-coordinate
// Body: { shop: "SUMON MEDICAL HALL", address: "BD,TORNIHAT,GABTOLI,BOGURA," }
app.post("/resolve-pharmacy-coordinate", async (req, res) => {
  try {
    const { shop, address } = req.body || {};
    const result = await pharmacyLimit(() => resolvePharmacyCoordinate({ shop, address }));
    res.json(result);
  } catch (err) {
    console.error("Pharmacy coordinate error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /pilot-pharmacy-coordinates
// Body: { rows: [{ shop, address }, ...] }
app.post("/pilot-pharmacy-coordinates", async (req, res) => {
  try {
    const { rows } = req.body || {};
    if (!Array.isArray(rows)) {
      return res.status(400).json({ success: false, error: "Body must include rows: [{ shop, address }]" });
    }

    const maxRows = 100;
    const pilotRows = rows.slice(0, maxRows);
    const results = await Promise.all(
      pilotRows.map((row, index) =>
        pharmacyLimit(async () => {
          try {
            const result = await resolvePharmacyCoordinate({
              shop: row.shop || row["pharmacy-shops"] || row.pharmacy || row.name,
              address: row.address,
            });
            return { index, ...result };
          } catch (err) {
            return {
              index,
              success: false,
              source: "error",
              confidence: "reject",
              error: err.message,
              input: row,
            };
          }
        })
      )
    );

    const summary = results.reduce((acc, item) => {
      acc.total += 1;
      acc[item.confidence] = (acc[item.confidence] || 0) + 1;
      acc.sources[item.source] = (acc.sources[item.source] || 0) + 1;
      return acc;
    }, { total: 0, high: 0, medium: 0, low: 0, reject: 0, sources: {} });

    res.json({
      success: true,
      processed: results.length,
      cappedAt: maxRows,
      truncated: rows.length > maxRows,
      summary,
      results,
    });
  } catch (err) {
    console.error("Pharmacy pilot error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /chemist-shops/map-pins?status=resolved,low_confidence&limit=1000&offset=0
app.get("/chemist-shops/map-pins", async (req, res) => {
  try {
    const client = requireSupabase(res);
    if (!client) return;

    const limit = Math.min(Math.max(Number(req.query.limit || 1000), 1), 5000);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const statuses = String(req.query.status || "resolved,low_confidence")
      .split(",")
      .map(item => item.trim())
      .filter(Boolean);
    const confidence = String(req.query.confidence || "")
      .split(",")
      .map(item => item.trim())
      .filter(Boolean);
    const includeMissing = String(req.query.includeMissing || "false").toLowerCase() === "true";

    let query = client
      .from("chemist_shops")
      .select(`
        id,
        shop_name,
        descriptive_address,
        latitude,
        longitude,
        confidence,
        source,
        matched_name,
        matched_address,
        place_id,
        google_types,
        location_type,
        partial_match,
        status,
        retry_count,
        last_attempted_at,
        resolved_at,
        updated_at
      `, { count: "exact" })
      .order("id", { ascending: true })
      .range(offset, offset + limit - 1);

    if (statuses.length) query = query.in("status", statuses);
    if (confidence.length) query = query.in("confidence", confidence);
    if (!includeMissing) {
      query = query.not("latitude", "is", null).not("longitude", "is", null);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({
      success: true,
      count,
      limit,
      offset,
      filters: {
        status: statuses,
        confidence,
        includeMissing,
      },
      pins: (data || []).map(row => ({
        id: row.id,
        shopName: row.shop_name,
        descriptiveAddress: row.descriptive_address,
        lat: row.latitude === null ? null : Number(row.latitude),
        lng: row.longitude === null ? null : Number(row.longitude),
        confidence: row.confidence,
        source: row.source,
        matchedName: row.matched_name,
        matchedAddress: row.matched_address,
        placeId: row.place_id,
        googleTypes: row.google_types || [],
        locationType: row.location_type,
        partialMatch: row.partial_match,
        status: row.status,
        retryCount: row.retry_count,
        lastAttemptedAt: row.last_attempted_at,
        resolvedAt: row.resolved_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (err) {
    console.error("Chemist shop map pins error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /chemist-shops/enrichment-status
app.get("/chemist-shops/enrichment-status", async (req, res) => {
  try {
    const client = requireSupabase(res);
    if (!client) return;

    const filters = {
      rse: normalizeTerritoryValue(req.query.rse),
      ase: normalizeTerritoryValue(req.query.ase),
      territory: normalizeTerritoryValue(req.query.territory),
    };
    const scopedCount = (label, buildQuery) => countChemistRows(client, label, query => (
      buildQuery(applyChemistTerritoryFilters(query, filters))
    ));

    const entries = await Promise.all([
      scopedCount("total", query => query),
      scopedCount("pending", query => query.eq("status", "pending")),
      scopedCount("processing", query => query.eq("status", "processing")),
      scopedCount("resolved", query => query.eq("status", "resolved")),
      scopedCount("low_confidence", query => query.eq("status", "low_confidence")),
      scopedCount("failed", query => query.eq("status", "failed")),
      scopedCount("needs_review", query => query.eq("status", "needs_review")),
      scopedCount("missing_coordinates", query => query.or("latitude.is.null,longitude.is.null")),
      scopedCount("ready_to_process", query => query
        .in("status", ["pending", "failed"])
        .lt("retry_count", 3)
        .or("latitude.is.null,longitude.is.null")),
    ]);

    res.json({
      success: true,
      filters,
      status: Object.fromEntries(entries),
    });
  } catch (err) {
    console.error("Chemist shop enrichment status error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /chemist-shops/process-next
// Body: { batchSize?: 10, maxRetries?: 3, startAfterId?: 0, rse?: string, ase?: string, territory?: string }
app.post("/chemist-shops/process-next", async (req, res) => {
  try {
    const client = requireSupabase(res);
    if (!client) return;

    const batchSize = Math.min(Math.max(Number(req.body?.batchSize || 10), 1), 5000);
    const maxRetries = Math.min(Math.max(Number(req.body?.maxRetries || 3), 1), 10);
    const startAfterId = Math.max(Number(req.body?.startAfterId || 0), 0);
    const filters = {
      rse: normalizeTerritoryValue(req.body?.rse),
      ase: normalizeTerritoryValue(req.body?.ase),
      territory: normalizeTerritoryValue(req.body?.territory),
    };

    let rowsQuery = client
      .from("chemist_shops")
      .select(`
        id,
        shop_name,
        descriptive_address,
        latitude,
        longitude,
        status,
        retry_count,
        rse,
        ase,
        territory
      `);

    rowsQuery = applyChemistTerritoryFilters(rowsQuery, filters)
      .in("status", ["pending", "failed"])
      .lt("retry_count", maxRetries)
      .or("latitude.is.null,longitude.is.null")
      .gt("id", startAfterId)
      .order("id", { ascending: true })
      .limit(batchSize);

    const { data: rows, error: fetchError } = await rowsQuery;

    if (fetchError) throw fetchError;

    const processed = [];
    let halted = false;
    let haltReason = null;

    for (const row of rows || []) {
      const attemptedRetryCount = Number(row.retry_count || 0) + 1;
      const processingAt = new Date().toISOString();

      const { error: lockError } = await client
        .from("chemist_shops")
        .update({
          status: "processing",
          retry_count: attemptedRetryCount,
          last_attempted_at: processingAt,
          error_message: null,
        })
        .eq("id", row.id)
        .in("status", ["pending", "failed"]);

      if (lockError) {
        halted = true;
        haltReason = `Could not mark row ${row.id} as processing: ${lockError.message}`;
        processed.push({ id: row.id, success: false, verified: false, error: haltReason });
        break;
      }

      let payload;
      let coordinateResult = null;

      try {
        coordinateResult = await resolvePharmacyCoordinate({
          shop: row.shop_name,
          address: row.descriptive_address,
        });
        payload = updatePayloadFromCoordinateResult(coordinateResult, attemptedRetryCount);
      } catch (err) {
        payload = updatePayloadFromCoordinateResult({
          success: false,
          lat: null,
          lng: null,
          confidence: "reject",
          source: "error",
          reasons: [err.message],
        }, attemptedRetryCount, err.message);
      }

      const expectedStatus = payload.status;
      const { error: updateError } = await client
        .from("chemist_shops")
        .update(payload)
        .eq("id", row.id);

      if (updateError) {
        halted = true;
        haltReason = `Could not update row ${row.id}: ${updateError.message}`;
        processed.push({ id: row.id, success: false, verified: false, error: haltReason });
        break;
      }

      const { data: verifiedRow, error: verifyError } = await client
        .from("chemist_shops")
        .select("id, latitude, longitude, confidence, source, status, retry_count, updated_at")
        .eq("id", row.id)
        .single();

      if (verifyError) {
        halted = true;
        haltReason = `Could not verify row ${row.id}: ${verifyError.message}`;
        processed.push({ id: row.id, success: false, verified: false, error: haltReason });
        break;
      }

      const hasCoordinate = verifiedRow.latitude !== null && verifiedRow.longitude !== null;
      const verified = verifiedRow.status === expectedStatus
        && verifiedRow.retry_count === attemptedRetryCount
        && (expectedStatus === "failed" || hasCoordinate);

      processed.push({
        id: row.id,
        shopName: row.shop_name,
        rse: row.rse,
        ase: row.ase,
        territory: row.territory,
        status: verifiedRow.status,
        confidence: verifiedRow.confidence,
        source: verifiedRow.source,
        lat: verifiedRow.latitude === null ? null : Number(verifiedRow.latitude),
        lng: verifiedRow.longitude === null ? null : Number(verifiedRow.longitude),
        retryCount: verifiedRow.retry_count,
        verified,
        reasons: coordinateResult?.reasons || payload.reasons || [],
      });

      if (!verified) {
        halted = true;
        haltReason = `Row ${row.id} update did not verify cleanly`;
        break;
      }
    }

    res.json({
      success: !halted,
      batchSize,
      maxRetries,
      startAfterId,
      filters,
      fetched: rows?.length || 0,
      processedCount: processed.length,
      halted,
      haltReason,
      processed,
    });
  } catch (err) {
    console.error("Chemist shop process-next error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /doctor-location-points/filters?team=centina&rse=A1&ase=A10
app.get("/doctor-location-points/filters", async (req, res) => {
  try {
    const client = requireSupabase(res);
    if (!client) return;

    const team = String(req.query.team || "centina").trim();
    const rse = normalizeTerritoryValue(req.query.rse);
    const ase = normalizeTerritoryValue(req.query.ase);

    let rowsQuery = query => query;
    if (rse) rowsQuery = query => query.eq("RSE", rse);
    if (rse && ase) rowsQuery = query => query.eq("RSE", rse).eq("ASE", ase);

    const rows = await fetchSupabasePages({
      client,
      table: team,
      select: "RSE,ASE,Territory",
      buildQuery: rowsQuery,
      pageSize: 1000,
    });

    const regionSet = new Set();
    const aseByRegion = {};
    const territoryByAse = {};

    for (const row of rows) {
      const rowRse = normalizeTerritoryValue(row.RSE);
      const rowAse = normalizeTerritoryValue(row.ASE);
      const rowTerritory = normalizeTerritoryValue(row.Territory);
      if (!rowRse) continue;
      regionSet.add(rowRse);

      if (rowAse) {
        aseByRegion[rowRse] ||= new Set();
        aseByRegion[rowRse].add(rowAse);
      }

      if (rowAse && rowTerritory) {
        territoryByAse[rowAse] ||= new Set();
        territoryByAse[rowAse].add(rowTerritory);
      }
    }

    res.json({
      success: true,
      team,
      filters: {
        regions: Array.from(regionSet).sort(),
        aseByRegion: Object.fromEntries(Object.entries(aseByRegion).map(([key, set]) => [key, Array.from(set).sort()])),
        territoryByAse: Object.fromEntries(Object.entries(territoryByAse).map(([key, set]) => [key, Array.from(set).sort()])),
      },
    });
  } catch (err) {
    console.error("Doctor location filters error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /doctor-location-points/sync-from-source
// Body: { team: "centina", rse: "A1", ase?: "A10", territory?: "A11", limit?: 500, locationType?: "both" }
app.post("/doctor-location-points/sync-from-source", async (req, res) => {
  try {
    const client = requireSupabase(res);
    if (!client) return;

    const team = String(req.body?.team || "centina").trim();
    const rse = normalizeTerritoryValue(req.body?.rse || "A1");
    const ase = normalizeTerritoryValue(req.body?.ase);
    const territory = normalizeTerritoryValue(req.body?.territory);
    const locationType = String(req.body?.locationType || "both");
    const limit = Math.min(Math.max(Number(req.body?.limit || 500), 1), 5000);

    const doctors = await fetchDoctorRowsForFilters(client, { team, rse, ase, territory, limit });

    const docIds = [...new Set((doctors || []).map(row => normalizeDoctorId(row.Doc_ID)).filter(Boolean))];
    if (!docIds.length) {
      return res.json({ success: true, team, filters: { rse, ase, territory }, sourceDoctors: 0, upserted: 0, rows: [] });
    }

    const { data: addressRows, error: addressError } = await client
      .from("address")
      .select('"doc-id",Doctor,"hospital-address","chamber-address"')
      .in("doc-id", docIds);

    if (addressError) throw addressError;

    const addressByDocId = new Map((addressRows || []).map(row => [normalizeDoctorId(row["doc-id"]), row]));
    const upsertRows = [];

    for (const doctor of doctors || []) {
      const docId = normalizeDoctorId(doctor.Doc_ID);
      const addressRow = addressByDocId.get(docId);
      if (!addressRow) continue;

      const base = {
        doc_id: docId,
        doctor_name: normalizeText(doctor.Doctor || addressRow.Doctor),
      };

      if (locationType === "both" || locationType === "hospital") {
        const parsed = parseDoctorRawAddress(addressRow["hospital-address"]);
        if (parsed.hasUsableAddress) {
          upsertRows.push({
            ...base,
            location_type: "hospital",
            place_name: parsed.placeName,
            descriptive_address: parsed.descriptiveAddress,
            raw_address: parsed.rawAddress,
          });
        }
      }

      if (locationType === "both" || locationType === "chamber") {
        const parsed = parseDoctorRawAddress(addressRow["chamber-address"]);
        if (parsed.hasUsableAddress) {
          upsertRows.push({
            ...base,
            location_type: "chamber",
            place_name: parsed.placeName,
            descriptive_address: parsed.descriptiveAddress,
            raw_address: parsed.rawAddress,
          });
        }
      }
    }

    if (upsertRows.length) {
      const { error: upsertError } = await client
        .from("doctor_location_points")
        .upsert(upsertRows, { onConflict: "doc_id,location_type", ignoreDuplicates: false });
      if (upsertError) throw upsertError;
    }

    res.json({
      success: true,
      team,
      filters: { rse, ase, territory, locationType },
      sourceDoctors: doctors?.length || 0,
      matchedAddressRows: addressRows?.length || 0,
      upserted: upsertRows.length,
      preview: upsertRows.slice(0, 10),
    });
  } catch (err) {
    console.error("Doctor location sync error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

function applyDoctorPointFilters(query, { rse, ase, territory, locationType }) {
  let nextQuery = query;
  if (locationType && locationType !== "both") nextQuery = nextQuery.eq("location_type", locationType);
  return nextQuery;
}

// GET /doctor-location-points/pending?team=centina&rse=A1&ase=A10&territory=A11&locationType=hospital&limit=50
app.get("/doctor-location-points/pending", async (req, res) => {
  try {
    const client = requireSupabase(res);
    if (!client) return;

    const filters = {
      team: String(req.query.team || "centina").trim(),
      rse: normalizeTerritoryValue(req.query.rse || "A1"),
      ase: normalizeTerritoryValue(req.query.ase),
      territory: normalizeTerritoryValue(req.query.territory),
      locationType: String(req.query.locationType || "both"),
    };
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 500);
    const doctorRows = await fetchDoctorRowsForFilters(client, { ...filters, limit: 10000 });
    const metaByDocId = doctorMetaMap(doctorRows);
    const docIds = [...metaByDocId.keys()];

    if (!docIds.length) {
      return res.json({ success: true, filters, records: [] });
    }

    let query = client
      .from("doctor_location_points")
      .select("id,doc_id,doctor_name,location_type,place_name,descriptive_address,raw_address,latitude,longitude,confidence,source,status,retry_count,last_attempted_at,error_message")
      .in("doc_id", docIds)
      .in("status", ["pending", "failed"])
      .lt("retry_count", 3)
      .or("latitude.is.null,longitude.is.null")
      .order("id", { ascending: true })
      .limit(limit);

    query = applyDoctorPointFilters(query, filters);

    const { data, error } = await query;
    if (error) throw error;

    res.json({
      success: true,
      filters,
      records: (data || []).map(row => ({
        ...row,
        designation: metaByDocId.get(row.doc_id)?.designation || null,
        team: filters.team,
        rse: metaByDocId.get(row.doc_id)?.rse || null,
        ase: metaByDocId.get(row.doc_id)?.ase || null,
        territory: metaByDocId.get(row.doc_id)?.territory || null,
      })),
    });
  } catch (err) {
    console.error("Doctor location pending error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /doctor-location-points/enrichment-status?rse=A1&ase=A10&territory=A11&locationType=both
app.get("/doctor-location-points/enrichment-status", async (req, res) => {
  try {
    const client = requireSupabase(res);
    if (!client) return;

    const filters = {
      team: String(req.query.team || "centina").trim(),
      rse: normalizeTerritoryValue(req.query.rse || "A1"),
      ase: normalizeTerritoryValue(req.query.ase),
      territory: normalizeTerritoryValue(req.query.territory),
      locationType: String(req.query.locationType || "both"),
    };
    const doctorRows = await fetchDoctorRowsForFilters(client, { ...filters, limit: 10000 });
    const docIds = doctorRows.map(row => normalizeDoctorId(row.Doc_ID)).filter(Boolean);

    if (!docIds.length) {
      return res.json({
        success: true,
        filters,
        status: {
          total: 0,
          pending: 0,
          processing: 0,
          resolved: 0,
          low_confidence: 0,
          failed: 0,
          missing_coordinates: 0,
          ready_to_process: 0,
        },
      });
    }

    async function countDoctorPoints(label, buildQuery) {
      let query = client.from("doctor_location_points").select("id", { count: "exact", head: true });
      query = applyDoctorPointFilters(query, filters);
      query = query.in("doc_id", docIds);
      query = buildQuery(query);
      const { count, error } = await query;
      if (error) throw error;
      return [label, count || 0];
    }

    const entries = await Promise.all([
      countDoctorPoints("total", query => query),
      countDoctorPoints("pending", query => query.eq("status", "pending")),
      countDoctorPoints("processing", query => query.eq("status", "processing")),
      countDoctorPoints("resolved", query => query.eq("status", "resolved")),
      countDoctorPoints("low_confidence", query => query.eq("status", "low_confidence")),
      countDoctorPoints("failed", query => query.eq("status", "failed")),
      countDoctorPoints("missing_coordinates", query => query.or("latitude.is.null,longitude.is.null")),
      countDoctorPoints("ready_to_process", query => query.in("status", ["pending", "failed"]).lt("retry_count", 3).or("latitude.is.null,longitude.is.null")),
    ]);

    res.json({ success: true, filters, status: Object.fromEntries(entries) });
  } catch (err) {
    console.error("Doctor location status error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /doctor-location-points/process-next
// Body: { rse:"A1", ase?: "A10", territory?: "A11", locationType:"hospital", batchSize: 5 }
app.post("/doctor-location-points/process-next", async (req, res) => {
  try {
    const client = requireSupabase(res);
    if (!client) return;

    const filters = {
      team: String(req.body?.team || "centina").trim(),
      rse: normalizeTerritoryValue(req.body?.rse || "A1"),
      ase: normalizeTerritoryValue(req.body?.ase),
      territory: normalizeTerritoryValue(req.body?.territory),
      locationType: String(req.body?.locationType || "both"),
    };
    const batchSize = Math.min(Math.max(Number(req.body?.batchSize || 5), 1), 100);
    const maxRetries = Math.min(Math.max(Number(req.body?.maxRetries || 3), 1), 10);
    const doctorRows = await fetchDoctorRowsForFilters(client, { ...filters, limit: 10000 });
    const metaByDocId = doctorMetaMap(doctorRows);
    const docIds = [...metaByDocId.keys()];

    if (!docIds.length) {
      return res.json({
        success: true,
        filters,
        batchSize,
        maxRetries,
        fetched: 0,
        processedCount: 0,
        halted: false,
        haltReason: null,
        processed: [],
      });
    }

    let query = client
      .from("doctor_location_points")
      .select("id,doc_id,doctor_name,location_type,place_name,descriptive_address,raw_address,status,retry_count")
      .in("doc_id", docIds)
      .in("status", ["pending", "failed"])
      .lt("retry_count", maxRetries)
      .or("latitude.is.null,longitude.is.null")
      .order("id", { ascending: true })
      .limit(batchSize);

    query = applyDoctorPointFilters(query, filters);

    const { data: rows, error: fetchError } = await query;
    if (fetchError) throw fetchError;

    const processed = [];
    let halted = false;
    let haltReason = null;

    for (const row of rows || []) {
      const attemptedRetryCount = Number(row.retry_count || 0) + 1;
      const processingAt = new Date().toISOString();

      const { error: lockError } = await client
        .from("doctor_location_points")
        .update({
          status: "processing",
          retry_count: attemptedRetryCount,
          last_attempted_at: processingAt,
          error_message: null,
        })
        .eq("id", row.id)
        .in("status", ["pending", "failed"]);

      if (lockError) {
        halted = true;
        haltReason = `Could not mark doctor location row ${row.id} as processing: ${lockError.message}`;
        processed.push({ id: row.id, success: false, verified: false, error: haltReason });
        break;
      }

      let coordinateResult = null;
      let payload;

      try {
        const queryName = row.place_name || `${row.doctor_name || ""} ${row.location_type || ""}`.trim();
        coordinateResult = await resolvePharmacyCoordinate({
          shop: queryName,
          address: row.descriptive_address || row.raw_address,
        });
        payload = doctorLocationPayloadFromCoordinateResult(coordinateResult, attemptedRetryCount);
      } catch (err) {
        payload = doctorLocationPayloadFromCoordinateResult({
          success: false,
          lat: null,
          lng: null,
          confidence: "reject",
          source: "error",
          reasons: [err.message],
        }, attemptedRetryCount, err.message);
      }

      const expectedStatus = payload.status;
      const { error: updateError } = await client
        .from("doctor_location_points")
        .update(payload)
        .eq("id", row.id);

      if (updateError) {
        halted = true;
        haltReason = `Could not update doctor location row ${row.id}: ${updateError.message}`;
        processed.push({ id: row.id, success: false, verified: false, error: haltReason });
        break;
      }

      const { data: verifiedRow, error: verifyError } = await client
        .from("doctor_location_points")
        .select("id,doc_id,doctor_name,location_type,latitude,longitude,confidence,source,status,retry_count,matched_address")
        .eq("id", row.id)
        .single();

      if (verifyError) {
        halted = true;
        haltReason = `Could not verify doctor location row ${row.id}: ${verifyError.message}`;
        processed.push({ id: row.id, success: false, verified: false, error: haltReason });
        break;
      }

      const hasCoordinate = verifiedRow.latitude !== null && verifiedRow.longitude !== null;
      const verified = verifiedRow.status === expectedStatus
        && verifiedRow.retry_count === attemptedRetryCount
        && (expectedStatus === "failed" || hasCoordinate);

      processed.push({
        id: row.id,
        docId: verifiedRow.doc_id,
        doctorName: verifiedRow.doctor_name,
        locationType: verifiedRow.location_type,
        rse: metaByDocId.get(verifiedRow.doc_id)?.rse || null,
        ase: metaByDocId.get(verifiedRow.doc_id)?.ase || null,
        territory: metaByDocId.get(verifiedRow.doc_id)?.territory || null,
        status: verifiedRow.status,
        confidence: verifiedRow.confidence,
        source: verifiedRow.source,
        lat: verifiedRow.latitude === null ? null : Number(verifiedRow.latitude),
        lng: verifiedRow.longitude === null ? null : Number(verifiedRow.longitude),
        matchedAddress: verifiedRow.matched_address,
        retryCount: verifiedRow.retry_count,
        verified,
        reasons: coordinateResult?.reasons || payload.reasons || [],
      });

      if (!verified) {
        halted = true;
        haltReason = `Doctor location row ${row.id} update did not verify cleanly`;
        break;
      }
    }

    res.json({
      success: !halted,
      filters,
      batchSize,
      maxRetries,
      fetched: rows?.length || 0,
      processedCount: processed.length,
      halted,
      haltReason,
      processed,
    });
  } catch (err) {
    console.error("Doctor location process-next error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /territory-nearby/doctors?rse=A1&ase=A10&territory=A11
app.get("/territory-nearby/doctors", async (req, res) => {
  try {
    const client = requireSupabase(res);
    if (!client) return;

    const filters = {
      team: String(req.query.team || "centina").trim(),
      rse: normalizeTerritoryValue(req.query.rse || "A1"),
      ase: normalizeTerritoryValue(req.query.ase || "A10"),
      territory: normalizeTerritoryValue(req.query.territory || "A11"),
    };

    const doctorRows = await fetchDoctorRowsForFilters(client, { ...filters, limit: 5000 });
    const metaByDocId = doctorMetaMap(doctorRows);
    const docIds = [...metaByDocId.keys()];
    if (!docIds.length) return res.json({ success: true, filters, doctors: [] });

    const { data: points, error } = await client
      .from("doctor_location_points")
      .select("id,doc_id,doctor_name,location_type,place_name,descriptive_address,raw_address,latitude,longitude,confidence,source,matched_address,status")
      .in("doc_id", docIds)
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .in("status", ["resolved", "low_confidence"])
      .order("doc_id", { ascending: true });

    if (error) throw error;

    const doctors = new Map();
    for (const point of points || []) {
      const meta = metaByDocId.get(point.doc_id) || {};
      if (!doctors.has(point.doc_id)) {
        doctors.set(point.doc_id, {
          docId: point.doc_id,
          doctorName: point.doctor_name || meta.doctorName,
          designation: meta.designation,
          rse: meta.rse,
          ase: meta.ase,
          territory: meta.territory,
          locations: [],
        });
      }
      doctors.get(point.doc_id).locations.push(mapDoctorPoint(point, meta));
    }

    res.json({
      success: true,
      filters,
      doctors: Array.from(doctors.values()),
    });
  } catch (err) {
    console.error("Territory nearby doctors error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

async function loadDoctorLocationForNearby(client, doctorLocationPointId) {
  const { data: point, error } = await client
    .from("doctor_location_points")
    .select("id,doc_id,doctor_name,location_type,place_name,descriptive_address,raw_address,latitude,longitude,confidence,source,matched_address,status")
    .eq("id", doctorLocationPointId)
    .single();

  if (error) throw error;
  if (!point?.latitude || !point?.longitude) throw new Error("Selected doctor location does not have coordinates");

  return point;
}

async function findNearbyChemistsForDoctor({ client, doctorLocationPointId, radiusKm = 2, limit = 20, team = "centina" }) {
  const safeRadiusKm = Math.min(Math.max(Number(radiusKm || 2), 1), 5);
  const safeLimit = Math.min(Math.max(Number(limit || 20), 1), 20);
  const point = await loadDoctorLocationForNearby(client, doctorLocationPointId);
  const { data: doctorRows, error: doctorError } = await client
    .from(team)
    .select("Doc_ID,Doctor,Designation,RSE,ASE,Territory")
    .eq("Doc_ID", Number(point.doc_id))
    .limit(1);
  if (doctorError) throw doctorError;

  const meta = doctorMetaMap(doctorRows || []).get(point.doc_id);
  if (!meta) throw new Error(`No territory mapping found in ${team} for doctor ${point.doc_id}`);

  const { data: chemists, error: chemistError } = await client
    .from("chemist_shops")
    .select("id,shop_name,descriptive_address,latitude,longitude,confidence,source,matched_address,status,rse,ase,territory")
    .eq("rse", meta.rse)
    .eq("ase", meta.ase)
    .eq("territory", meta.territory)
    .not("latitude", "is", null)
    .not("longitude", "is", null)
    .limit(5000);

  if (chemistError) throw chemistError;

  const doctorPin = mapDoctorPoint(point, meta);
  const doctorCoordinate = { lat: doctorPin.lat, lng: doctorPin.lng };

  const chemistPins = (chemists || [])
    .map(chemist => {
      const lat = toNumberOrNull(chemist.latitude);
      const lng = toNumberOrNull(chemist.longitude);
      if (lat === null || lng === null) return null;
      const distanceKm = haversineKm(doctorCoordinate, { lat, lng });
      return {
        id: chemist.id,
        shopName: chemist.shop_name,
        descriptiveAddress: chemist.descriptive_address,
        lat,
        lng,
        distanceKm: Number(distanceKm.toFixed(3)),
        confidence: chemist.confidence,
        source: chemist.source,
        matchedAddress: chemist.matched_address,
        status: chemist.status,
        rse: chemist.rse,
        ase: chemist.ase,
        territory: chemist.territory,
      };
    })
    .filter(Boolean)
    .filter(chemist => chemist.distanceKm <= safeRadiusKm)
    .sort((left, right) => left.distanceKm - right.distanceKm)
    .slice(0, safeLimit);

  const embedUrl = `https://www.google.com/maps/embed/v1/view?key=${GOOGLE_MAPS_API_KEY}&center=${doctorPin.lat},${doctorPin.lng}&zoom=14&maptype=roadmap`;

  return {
    doctorPin,
    chemistPins,
    radiusKm: safeRadiusKm,
    limit: safeLimit,
    territory: {
      rse: meta.rse,
      ase: meta.ase,
      territory: meta.territory,
    },
    embedUrl,
    note: "Google Maps Embed view can center the map, but it cannot render custom React pins inside the iframe. Use the side list for prototype pin metadata.",
  };
}

// GET /territory-nearby/chemist-shops?doctorLocationPointId=1&radiusKm=2&limit=20
app.get("/territory-nearby/chemist-shops", async (req, res) => {
  try {
    const client = requireSupabase(res);
    if (!client) return;
    if (!GOOGLE_MAPS_API_KEY) return res.status(500).json({ success: false, error: "GOOGLE_MAPS_API_KEY not set on server" });

    const doctorLocationPointId = Number(req.query.doctorLocationPointId);
    if (!doctorLocationPointId) return res.status(400).json({ success: false, error: "doctorLocationPointId is required" });

    const result = await findNearbyChemistsForDoctor({
      client,
      doctorLocationPointId,
      radiusKm: req.query.radiusKm,
      limit: req.query.limit,
      team: String(req.query.team || "centina").trim(),
    });

    res.json({ success: true, ...result });
  } catch (err) {
    console.error("Territory nearby chemists error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /territory-nearby/embed-url?doctorLocationPointId=1&radiusKm=2
app.get("/territory-nearby/embed-url", async (req, res) => {
  try {
    const client = requireSupabase(res);
    if (!client) return;
    if (!GOOGLE_MAPS_API_KEY) return res.status(500).json({ success: false, error: "GOOGLE_MAPS_API_KEY not set on server" });

    const doctorLocationPointId = Number(req.query.doctorLocationPointId);
    if (!doctorLocationPointId) return res.status(400).json({ success: false, error: "doctorLocationPointId is required" });

    const result = await findNearbyChemistsForDoctor({
      client,
      doctorLocationPointId,
      radiusKm: req.query.radiusKm,
      limit: req.query.limit,
      team: String(req.query.team || "centina").trim(),
    });

    res.json({
      success: true,
      embedUrl: result.embedUrl,
      doctorPin: result.doctorPin,
      chemistCount: result.chemistPins.length,
      radiusKm: result.radiusKm,
    });
  } catch (err) {
    console.error("Territory nearby embed error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /generate-embed-url ─────────────────────────────────────────────────
// Body: { origin: { lat, lng }, stops: [{ lat, lng }, ...] }
app.post("/generate-embed-url", (req, res) => {
  try {
    const { origin, stops } = req.body;

    if (!origin?.lat || !origin?.lng)
      return res.status(400).json({ success: false, error: "Valid origin coords required" });
    if (!stops || stops.length === 0)
      return res.status(400).json({ success: false, error: "At least one stop required" });
    if (!GOOGLE_MAPS_API_KEY)
      return res.status(500).json({ success: false, error: "GOOGLE_MAPS_API_KEY not set on server" });

    // Last stop = destination, everything in between = waypoints
    const destination = stops[stops.length - 1];
    const waypoints = stops.slice(0, -1);

    let embedUrl = `https://www.google.com/maps/embed/v1/directions?key=${GOOGLE_MAPS_API_KEY}`;
    embedUrl += `&origin=${origin.lat},${origin.lng}`;
    embedUrl += `&destination=${destination.lat},${destination.lng}`;
    if (waypoints.length > 0) {
      const waypointStr = waypoints.map(w => `${w.lat},${w.lng}`).join("|");
      embedUrl += `&waypoints=${waypointStr}`;
    }

    console.log("Generated embed URL:", embedUrl);
    res.json({ success: true, embedUrl });
  } catch (err) {
    console.error("Embed URL error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GRACEFUL SHUTDOWN ────────────────────────────────────────────────────────
if (require.main === module) process.on("SIGINT", async () => {
  console.log("Shutting down — draining browser pool...");
  await browserPool.drain();
  await browserPool.clear();
  process.exit(0);
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
