'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Navigation, Loader2, Search, X, AlertCircle } from 'lucide-react';

const LOCAL_AGENT_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '/api/backend';

interface Coords { lat: number; lng: number; }
interface LocationData { address: string; coords: Coords | null; }
interface RouteSpot {
  Doc_ID: string;
  Doctor: string;
  Designation: string;
  selectedType: 'hospital' | 'chamber';
  hospitalData: LocationData;
  chamberData: LocationData;
}

const LocationSearchInput = ({ placeholder, defaultValue = '', onSelect }: { placeholder: string; defaultValue?: string; onSelect: (data: LocationData) => void; }) => {
  const [query, setQuery] = useState(defaultValue);
  const [loading, setLoading] = useState(false);

  useEffect(() => { setQuery(defaultValue); }, [defaultValue]);

  const handleVerify = async () => {
    if (!query.trim() || query.length <= 2) return;
    setLoading(true);
    try {
      const res = await fetch(`${LOCAL_AGENT_URL}/fetch-coordinates?place=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.success) onSelect({ address: query, coords: { lat: data.lat, lng: data.lng } });
    } catch (err) { console.error("Verification failed", err); }
    setLoading(false);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 bg-white px-2.5 py-1.5 rounded border border-gray-200 focus-within:border-blue-400 transition-colors">
        {loading ? <Loader2 size={14} className="text-blue-500 animate-spin" /> : <Search size={14} className="text-gray-400" />}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-xs font-medium text-gray-700 outline-none placeholder:text-gray-300"
        />
        {query && <button onClick={() => { setQuery(''); onSelect({ address: '', coords: null }); }}><X size={12} className="text-gray-300 hover:text-gray-500" /></button>}
      </div>
      <button
        type="button"
        onClick={handleVerify}
        disabled={loading || !query.trim()}
        className={`text-[9px] font-bold uppercase tracking-tighter text-left px-1 transition-colors ${defaultValue ? 'text-green-600' : 'text-blue-600 hover:text-blue-700'}`}
      >
        {loading ? 'Verifying...' : defaultValue ? '✓ Verified' : 'Click to Verify Location'}
      </button>
    </div>
  );
};

export default function RoutePlan({ selectedDoctors }: { selectedDoctors: any[] }) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState<LocationData>({ address: '', coords: null });
  const [routeSpots, setRouteSpots] = useState<RouteSpot[]>([]);
  const [embedRouteUrl, setEmbedRouteUrl] = useState<string | null>(null);

  useEffect(() => {
    setRouteSpots(selectedDoctors.map(doc => ({
      Doc_ID: doc.Doc_ID, Doctor: doc.Doctor, Designation: doc.Designation,
      selectedType: 'hospital', hospitalData: { address: '', coords: null }, chamberData: { address: '', coords: null },
    })));
  }, [selectedDoctors]);

  const handleGenerateRoute = async () => {
    setError(null);
    if (!origin.coords) return setError("Verify Start Point first.");
    
    const stops = routeSpots
      .map(s => s.selectedType === 'hospital' ? s.hospitalData.coords : s.chamberData.coords)
      .filter(Boolean);

    if (stops.length === 0) return setError("Verify at least one Destination.");

    setGenerating(true);
    try {
      const response = await fetch(`${LOCAL_AGENT_URL}/generate-embed-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin: origin.coords, stops })
      });
      const data = await response.json();
      if (data.success) setEmbedRouteUrl(data.embedUrl);
      else setError(data.error);
    } catch { setError("Backend Connection Failed"); }
    setGenerating(false);
  };

  return (
    <div className="flex h-full w-full bg-slate-50 overflow-hidden">
      {/* SIDEBAR - Compact & Normal Sized */}
      <div className="w-[320px] flex flex-col border-r bg-white shrink-0">
        <div className="p-3 border-b flex items-center justify-between">
          <h2 className="text-xs font-black uppercase tracking-widest text-slate-800">Route Optimizer</h2>
          <span className="text-[10px] font-bold bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{routeSpots.length} Spots</span>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          <div className="bg-blue-50/50 border border-blue-100 rounded-lg p-3">
            <label className="text-[9px] font-bold text-blue-600 uppercase mb-2 block">1. Start Point</label>
            <LocationSearchInput placeholder="Enter start..." defaultValue={origin.coords ? origin.address : ''} onSelect={setOrigin} />
          </div>

          <div className="space-y-3">
            <label className="text-[9px] font-bold text-slate-400 uppercase block px-1">2. Destinations</label>
            {routeSpots.map((spot, i) => (
              <div key={spot.Doc_ID} className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-5 h-5 bg-slate-800 text-white rounded-full flex items-center justify-center text-[9px] font-bold">{i + 2}</span>
                  <div className="min-w-0">
                    <h3 className="text-[11px] font-bold text-slate-800 truncate">{spot.Doctor}</h3>
                    <p className="text-[9px] text-slate-400 truncate uppercase tracking-tight">{spot.Designation}</p>
                  </div>
                </div>
                <LocationSearchInput 
                  placeholder="Enter address..." 
                  defaultValue={spot.hospitalData.coords ? spot.hospitalData.address : ''}
                  onSelect={(data) => setRouteSpots(prev => prev.map(item => item.Doc_ID === spot.Doc_ID ? { ...item, hospitalData: data } : item))}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="p-3 border-t bg-slate-50 space-y-3">
          {error && <div className="flex items-center gap-2 text-red-500 bg-red-50 p-2 rounded text-[10px] font-bold"><AlertCircle size={14} /> {error}</div>}
          <button onClick={handleGenerateRoute} disabled={generating} className="w-full bg-slate-900 text-white py-2.5 rounded font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-blue-600 transition-colors">
            {generating ? <Loader2 size={14} className="animate-spin" /> : <Navigation size={14} />}
            Generate Official Route
          </button>
        </div>
      </div>

      {/* MAP AREA */}
      <div className="flex-1 bg-slate-100">
        {embedRouteUrl ? (
          <iframe width="100%" height="100%" src={embedRouteUrl} style={{ border: 0 }} allowFullScreen loading="lazy" title="Map" />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-2 uppercase tracking-[0.2em] font-bold text-xs">
            Mission Map Offline
          </div>
        )}
      </div>
    </div>
  );
}
