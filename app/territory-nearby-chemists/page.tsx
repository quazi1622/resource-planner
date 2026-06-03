'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Building2, Hospital, Loader2, MapPin, Search, Stethoscope, Store } from 'lucide-react';
import maplibregl, { LngLatBounds, type GeoJSONSource, type Map as MapLibreMap, type Marker } from 'maplibre-gl';
import type { Feature, FeatureCollection, Point, Polygon } from 'geojson';
import rseData from '../rseData.json';
import aseData from '../aseData.json';
import terrData from '../terrData.json';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '/api/backend';
const OPENFREEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

type LocationType = 'hospital' | 'chamber';

type DoctorLocation = {
  id: number;
  docId: string;
  doctorName: string | null;
  designation: string | null;
  locationType: LocationType;
  placeName: string | null;
  descriptiveAddress: string | null;
  lat: number | null;
  lng: number | null;
  confidence: string;
  status: string;
};

type DoctorOption = {
  docId: string;
  doctorName: string;
  designation: string;
  rse: string;
  ase: string;
  territory: string;
  locations: DoctorLocation[];
};

type ChemistPin = {
  id: number;
  shopName: string;
  descriptiveAddress: string;
  lat: number;
  lng: number;
  distanceKm: number;
  confidence: string;
  status: string;
  rse: string;
  ase: string;
  territory: string;
};

type NearbyResult = {
  doctorPin: DoctorLocation;
  chemistPins: ChemistPin[];
  radiusKm: number;
  embedUrl?: string;
  note: string;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(text.slice(0, 220) || `Request failed with HTTP ${response.status}`);
  }
}

function confidenceClass(confidence: string) {
  if (confidence === 'high') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (confidence === 'medium') return 'bg-sky-50 text-sky-700 border-sky-200';
  if (confidence === 'low') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-slate-50 text-slate-700 border-slate-200';
}

function hasCoordinate(location: DoctorLocation | undefined) {
  return typeof location?.lat === 'number' && typeof location.lng === 'number';
}

function findFirstDoctorWithCoordinate(doctors: DoctorOption[], locationType: LocationType) {
  return doctors.find(doctor => hasCoordinate(doctor.locations.find(location => location.locationType === locationType)))
    || doctors.find(doctor => doctor.locations.some(location => hasCoordinate(location)))
    || doctors[0]
    || null;
}

function findPreferredLocation(doctor: DoctorOption | null, locationType: LocationType) {
  return doctor?.locations.find(location => location.locationType === locationType && hasCoordinate(location))
    || doctor?.locations.find(location => hasCoordinate(location))
    || null;
}

export default function TerritoryNearbyChemistsPage() {
  const [team] = useState('centina');
  const [rse, setRse] = useState('A1');
  const [ase, setAse] = useState('A10');
  const [territory, setTerritory] = useState('A11');
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [selectedDocId, setSelectedDocId] = useState('');
  const [locationType, setLocationType] = useState<LocationType>('hospital');
  const [radiusKm, setRadiusKm] = useState(2);
  const [nearbyResult, setNearbyResult] = useState<NearbyResult | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const didMountRseRef = React.useRef(false);
  const didMountAseRef = React.useRef(false);

  const selectedRegionKey = useMemo(() => rseData.find(item => item.rse === rse)?.sl, [rse]);
  const aseOptions = useMemo(() => selectedRegionKey ? aseData.filter(item => item['rse-key'] === selectedRegionKey) : [], [selectedRegionKey]);
  const selectedAseMarker = useMemo(() => aseData.find(item => item.ase === ase)?.['ase-marker'], [ase]);
  const territoryOptions = useMemo(() => selectedAseMarker ? terrData.filter(item => item['terr-ase-linker'] === selectedAseMarker) : [], [selectedAseMarker]);

  const selectedDoctor = useMemo(() => doctors.find(doctor => doctor.docId === selectedDocId) || null, [doctors, selectedDocId]);
  const selectedLocation = useMemo(() => {
    return selectedDoctor?.locations.find(location => location.locationType === locationType) || null;
  }, [selectedDoctor, locationType]);

  useEffect(() => {
    if (!didMountRseRef.current) {
      didMountRseRef.current = true;
      return;
    }
    setAse('');
    setTerritory('');
    setSelectedDocId('');
    setNearbyResult(null);
  }, [rse]);

  useEffect(() => {
    if (!didMountAseRef.current) {
      didMountAseRef.current = true;
      return;
    }
    setTerritory('');
    setSelectedDocId('');
    setNearbyResult(null);
  }, [ase]);

  const run = async (name: string, action: () => Promise<void>) => {
    setLoading(name);
    setError(null);
    try {
      await action();
    } catch (err: unknown) {
      setError(errorMessage(err, 'Request failed'));
    } finally {
      setLoading(null);
    }
  };

  const fetchDoctors = async () => {
    const params = new URLSearchParams({ team, rse, ase, territory });
    const response = await fetch(`${API_BASE_URL}/territory-nearby/doctors?${params}`);
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data?.error || `Doctor fetch failed with HTTP ${response.status}`);
    const nextDoctors = data.doctors || [];
    const nextDoctor = findFirstDoctorWithCoordinate(nextDoctors, locationType);
    const nextLocation = findPreferredLocation(nextDoctor, locationType);
    setDoctors(nextDoctors);
    setSelectedDocId(nextDoctor?.docId || '');
    if (nextLocation && nextLocation.locationType !== locationType) setLocationType(nextLocation.locationType);
    setNearbyResult(null);
  };

  const fetchNearbyChemists = async () => {
    if (!selectedLocation) throw new Error('Select a doctor location with coordinates first');
    const params = new URLSearchParams({
      team,
      doctorLocationPointId: String(selectedLocation.id),
      radiusKm: String(radiusKm),
      limit: '20',
    });
    const response = await fetch(`${API_BASE_URL}/territory-nearby/chemist-shops?${params}`);
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data?.error || `Nearby chemist fetch failed with HTTP ${response.status}`);
    setNearbyResult(data);
  };

  return (
    <main className="glass-shell min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-6">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-sky-600">Territory Nearby Chemists</p>
            <h1 className="mt-2 text-2xl font-black tracking-tight">Doctor Radius Map Prototype</h1>
          </div>
          <a href="/doctor-coordinate-pilot" className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-xs font-black uppercase tracking-widest text-slate-700 transition hover:border-sky-300 hover:text-sky-700">
            Doctor Coordinates
          </a>
        </header>

        {error && (
          <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            {error}
          </div>
        )}

        <section className="grid gap-5 py-5 lg:grid-cols-[360px_1fr]">
          <aside className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="space-y-4">
              <SelectField label="Region / RSE" value={rse} onChange={setRse} options={rseData.map(item => item.rse)} />
              <SelectField label="ASE" value={ase} onChange={setAse} options={aseOptions.map(item => item.ase)} />
              <SelectField label="MPE / Territory" value={territory} onChange={setTerritory} options={territoryOptions.map(item => item.territory.trim())} />

              <button type="button" onClick={() => run('doctors', fetchDoctors)} disabled={loading === 'doctors' || !rse || !ase || !territory} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-xs font-black uppercase tracking-widest text-white transition hover:bg-sky-700 disabled:bg-slate-300">
                {loading === 'doctors' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Load Doctors
              </button>

              <SelectField label="Doctor" value={selectedDocId} onChange={(value) => { setSelectedDocId(value); setNearbyResult(null); }} options={doctors.map(doctor => doctor.docId)} labels={Object.fromEntries(doctors.map(doctor => [doctor.docId, `${doctor.docId} - ${doctor.doctorName}`]))} placeholder="Load doctors first" />

              <div>
                <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">Pin Location</p>
                <div className="grid grid-cols-2 gap-2">
                  <ToggleButton active={locationType === 'hospital'} label="Hospital" icon={<Hospital className="h-4 w-4" />} onClick={() => { setLocationType('hospital'); setNearbyResult(null); }} />
                  <ToggleButton active={locationType === 'chamber'} label="Chamber" icon={<Building2 className="h-4 w-4" />} onClick={() => { setLocationType('chamber'); setNearbyResult(null); }} />
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Radius</label>
                  <span className="text-sm font-black text-sky-700">{radiusKm} km</span>
                </div>
                <input type="range" min={1} max={5} step={1} value={radiusKm} onChange={(event) => { setRadiusKm(Number(event.target.value)); setNearbyResult(null); }} className="w-full accent-sky-600" />
              </div>

              <button type="button" onClick={() => run('nearby', fetchNearbyChemists)} disabled={loading === 'nearby' || !selectedLocation} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-sky-600 px-4 text-xs font-black uppercase tracking-widest text-white transition hover:bg-sky-700 disabled:bg-slate-300">
                {loading === 'nearby' ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                Find Nearby Chemists
              </button>

              {selectedDoctor && (
                <div className="rounded-md border border-slate-100 bg-slate-50 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Selected Doctor</p>
                  <p className="mt-1 text-sm font-black">{selectedDoctor.doctorName}</p>
                  <p className="text-xs font-semibold text-slate-500">{selectedDoctor.designation}</p>
                  <p className="mt-2 text-xs font-bold text-slate-600">{rse} / {ase} / {territory}</p>
                </div>
              )}
            </div>
          </aside>

          <div className="space-y-5">
            <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              <NearbyChemistMap result={nearbyResult} selectedLocation={selectedLocation} radiusKm={radiusKm} />
            </section>

            <section className="grid gap-5 lg:grid-cols-[340px_1fr]">
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-sky-50 text-sky-700">
                    <Stethoscope className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Doctor Pin</p>
                    <h2 className="text-sm font-black">{nearbyResult?.doctorPin.doctorName || selectedDoctor?.doctorName || 'No doctor selected'}</h2>
                  </div>
                </div>
                {nearbyResult?.doctorPin && (
                  <div className="mt-4 space-y-2 text-sm font-semibold text-slate-700">
                    <p>{nearbyResult.doctorPin.locationType}</p>
                    <p>{nearbyResult.doctorPin.placeName || nearbyResult.doctorPin.descriptiveAddress}</p>
                    <p>{nearbyResult.doctorPin.lat}, {nearbyResult.doctorPin.lng}</p>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Nearby Chemists</p>
                    <h2 className="text-lg font-black">Top {nearbyResult?.chemistPins.length || 0} within {radiusKm}km</h2>
                  </div>
                  <Store className="h-5 w-5 text-sky-600" />
                </div>
                <ChemistList chemists={nearbyResult?.chemistPins || []} />
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}

function SelectField({ label, value, onChange, options, labels = {}, placeholder = 'Select...' }: { label: string; value: string; onChange: (value: string) => void; options: string[]; labels?: Record<string, string>; placeholder?: string }) {
  return (
    <div>
      <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</label>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100">
        <option value="">{placeholder}</option>
        {options.map(option => <option key={option} value={option}>{labels[option] || option}</option>)}
      </select>
    </div>
  );
}

function ToggleButton({ active, label, icon, onClick }: { active: boolean; label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`inline-flex h-10 items-center justify-center gap-2 rounded-md border px-3 text-xs font-black uppercase tracking-widest transition ${active ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white text-slate-500 hover:border-sky-300'}`}>
      {icon}
      {label}
    </button>
  );
}

function NearbyChemistMap({
  result,
  selectedLocation,
  radiusKm,
}: {
  result: NearbyResult | null;
  selectedLocation: DoctorLocation | null;
  radiusKm: number;
}) {
  const mapContainerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<MapLibreMap | null>(null);
  const markersRef = React.useRef<Marker[]>([]);
  const [mapError, setMapError] = useState<string | null>(null);

  const doctorPin = result?.doctorPin || selectedLocation;
  const chemistPins = useMemo(() => result?.chemistPins || [], [result]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    try {
      mapRef.current = new maplibregl.Map({
        container: mapContainerRef.current,
        style: OPENFREEMAP_STYLE_URL,
        center: [88.6473, 25.6198],
        zoom: 12,
        attributionControl: {},
      });
      mapRef.current.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
      mapRef.current.on('error', () => setMapError('Map tiles could not be loaded. Please check your internet connection.'));
    } catch (error) {
      window.setTimeout(() => setMapError(errorMessage(error, 'Map could not be initialized')), 0);
    }

    return () => {
      markersRef.current.forEach(marker => marker.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const renderPins = () => {
      markersRef.current.forEach(marker => marker.remove());
      markersRef.current = [];

      updateRadiusSource(map, doctorPin, radiusKm);

      if (!doctorPin?.lat || !doctorPin.lng) return;

      const bounds = new LngLatBounds([doctorPin.lng, doctorPin.lat], [doctorPin.lng, doctorPin.lat]);
      const doctorMarker = new maplibregl.Marker({
        element: createMarkerElement({ kind: 'doctor', label: doctorPin.locationType === 'hospital' ? 'H' : 'C' }),
        anchor: 'bottom',
      })
        .setLngLat([doctorPin.lng, doctorPin.lat])
        .setPopup(createDoctorPopup(doctorPin))
        .addTo(map);

      markersRef.current.push(doctorMarker);

      chemistPins.forEach((chemist, index) => {
        bounds.extend([chemist.lng, chemist.lat]);
        const marker = new maplibregl.Marker({
          element: createMarkerElement({ kind: 'chemist', label: String(index + 1) }),
          anchor: 'bottom',
        })
          .setLngLat([chemist.lng, chemist.lat])
          .setPopup(createChemistPopup(chemist, index))
          .addTo(map);
        markersRef.current.push(marker);
      });

      if (chemistPins.length) {
        map.fitBounds(bounds, { padding: 68, maxZoom: 15, duration: 600 });
      } else {
        map.easeTo({ center: [doctorPin.lng, doctorPin.lat], zoom: 13, duration: 600 });
      }
    };

    if (map.isStyleLoaded()) {
      renderPins();
      return;
    }

    map.once('load', renderPins);
  }, [chemistPins, doctorPin, radiusKm]);

  return (
    <div className="relative h-[460px] bg-slate-100">
      <div ref={mapContainerRef} className="h-full w-full" />
      {!doctorPin?.lat || !doctorPin.lng ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-slate-100 text-slate-400">
          <MapPin className="mb-3 h-10 w-10" />
          <p className="text-xs font-black uppercase tracking-[0.22em]">Map appears after nearby search</p>
        </div>
      ) : null}
      <div className="absolute left-3 top-3 rounded-md border border-slate-200 bg-white/95 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-600 shadow-sm">
        MapLibre + OpenFreeMap
      </div>
      {mapError && (
        <div className="absolute bottom-3 left-3 right-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 shadow-sm">
          {mapError}
        </div>
      )}
    </div>
  );
}

function createMarkerElement({ kind, label }: { kind: 'doctor' | 'chemist'; label: string }) {
  const marker = document.createElement('div');
  marker.className = kind === 'doctor' ? 'rp-map-marker rp-map-marker-doctor' : 'rp-map-marker rp-map-marker-chemist';
  const image = document.createElement('img');
  image.src = kind === 'doctor' ? '/map-icons/doctor-icon-rev.png' : '/map-icons/med-shop-icon.png';
  image.alt = kind === 'doctor' ? 'Doctor location' : `Chemist ${label}`;
  marker.appendChild(image);

  if (kind === 'chemist') {
    const labelElement = document.createElement('span');
    labelElement.textContent = label;
    marker.appendChild(labelElement);
  }

  return marker;
}

function createPopupContainer(title: string, lines: string[]) {
  const container = document.createElement('div');
  container.className = 'rp-map-popup';

  const heading = document.createElement('div');
  heading.className = 'rp-map-popup-title';
  heading.textContent = title;
  container.appendChild(heading);

  lines.filter(Boolean).forEach(line => {
    const paragraph = document.createElement('p');
    paragraph.textContent = line;
    container.appendChild(paragraph);
  });

  return container;
}

function createDoctorPopup(doctor: DoctorLocation) {
  return new maplibregl.Popup({ offset: 28 }).setDOMContent(createPopupContainer(
    doctor.doctorName || 'Doctor location',
    [
      `${doctor.locationType.toUpperCase()} pin`,
      doctor.placeName || doctor.descriptiveAddress || '',
      `${doctor.lat}, ${doctor.lng}`,
      `Confidence: ${doctor.confidence}`,
    ],
  ));
}

function createChemistPopup(chemist: ChemistPin, index: number) {
  return new maplibregl.Popup({ offset: 24 }).setDOMContent(createPopupContainer(
    `${index + 1}. ${chemist.shopName}`,
    [
      `${chemist.distanceKm} km away`,
      chemist.descriptiveAddress,
      `${chemist.rse}/${chemist.ase}/${chemist.territory}`,
      `Confidence: ${chemist.confidence}`,
    ],
  ));
}

function createRadiusFeature(center: DoctorLocation, radiusKm: number): Feature<Polygon> {
  const points: Array<[number, number]> = [];
  const steps = 96;
  const distanceX = radiusKm / (111.32 * Math.cos((center.lat || 0) * Math.PI / 180));
  const distanceY = radiusKm / 110.574;

  for (let index = 0; index <= steps; index += 1) {
    const theta = (index / steps) * (2 * Math.PI);
    points.push([
      (center.lng || 0) + distanceX * Math.cos(theta),
      (center.lat || 0) + distanceY * Math.sin(theta),
    ]);
  }

  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [points],
    },
  };
}

function updateRadiusSource(map: MapLibreMap, doctorPin: DoctorLocation | null, radiusKm: number) {
  if (!map.isStyleLoaded()) return;

  const emptyCollection: FeatureCollection<Polygon | Point> = {
    type: 'FeatureCollection',
    features: [],
  };
  const data: FeatureCollection<Polygon> = doctorPin?.lat && doctorPin.lng
    ? { type: 'FeatureCollection', features: [createRadiusFeature(doctorPin, radiusKm)] }
    : emptyCollection as FeatureCollection<Polygon>;

  const existingSource = map.getSource('doctor-radius') as GeoJSONSource | undefined;
  if (existingSource) {
    existingSource.setData(data);
    return;
  }

  map.addSource('doctor-radius', {
    type: 'geojson',
    data,
  });
  map.addLayer({
    id: 'doctor-radius-fill',
    type: 'fill',
    source: 'doctor-radius',
    paint: {
      'fill-color': '#0ea5e9',
      'fill-opacity': 0.12,
    },
  });
  map.addLayer({
    id: 'doctor-radius-line',
    type: 'line',
    source: 'doctor-radius',
    paint: {
      'line-color': '#0284c7',
      'line-width': 2,
      'line-dasharray': [2, 2],
    },
  });
}

function ChemistList({ chemists }: { chemists: ChemistPin[] }) {
  if (!chemists.length) {
    return <div className="flex min-h-[260px] items-center justify-center text-sm font-bold text-slate-400">No chemist shops found in this radius yet.</div>;
  }

  return (
    <div className="mt-4 max-h-[420px] space-y-3 overflow-y-auto pr-1">
      {chemists.map((chemist, index) => (
        <div key={chemist.id} className="rounded-md border border-slate-100 bg-slate-50 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-950 text-[10px] font-black text-white">{index + 1}</span>
                <h3 className="truncate text-sm font-black">{chemist.shopName}</h3>
              </div>
              <p className="mt-2 text-xs font-semibold leading-5 text-slate-600">{chemist.descriptiveAddress}</p>
            </div>
            <span className={`shrink-0 rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-widest ${confidenceClass(chemist.confidence)}`}>
              {chemist.confidence}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
            <span>{chemist.distanceKm} km</span>
            <span>{chemist.rse}/{chemist.ase}/{chemist.territory}</span>
            <span>{chemist.status}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
