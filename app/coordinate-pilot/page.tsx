'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Clipboard, Loader2, MapPin, Search } from 'lucide-react';
import rseData from '../rseData.json';
import aseData from '../aseData.json';
import terrData from '../terrData.json';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '/api/backend';

type CoordinateResult = {
  success: boolean;
  lat: number | null;
  lng: number | null;
  source: string;
  confidence: 'high' | 'medium' | 'low' | 'reject';
  score: number | null;
  matchedName: string | null;
  matchedAddress: string | null;
  placeId: string | null;
  googleTypes: string[];
  locationType: string | null;
  partialMatch: boolean;
  reasons: string[];
  input?: {
    shop: string;
    address: string;
    normalizedAddress: string;
    query: string;
  };
};

type HealthResult = {
  success: boolean;
  status: string;
  hasGoogleMapsApiKey: boolean;
  hasSupabaseUrl: boolean;
  hasSupabaseServerKey: boolean;
  usingServiceRoleKey: boolean;
};

type EnrichmentStatus = {
  total: number;
  pending: number;
  processing: number;
  resolved: number;
  low_confidence: number;
  failed: number;
  needs_review: number;
  missing_coordinates: number;
  ready_to_process: number;
};

type ProcessedRow = {
  id: number;
  shopName?: string;
  rse?: string | null;
  ase?: string | null;
  territory?: string | null;
  status?: string;
  confidence?: string;
  source?: string;
  lat?: number | null;
  lng?: number | null;
  retryCount?: number;
  verified: boolean;
  error?: string;
  reasons?: string[];
};

type ProcessNextResult = {
  success: boolean;
  batchSize: number;
  maxRetries: number;
  fetched: number;
  processedCount: number;
  halted: boolean;
  haltReason: string | null;
  processed: ProcessedRow[];
};

const confidenceStyles: Record<string, string> = {
  high: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  medium: 'bg-sky-50 text-sky-700 border-sky-200',
  low: 'bg-amber-50 text-amber-700 border-amber-200',
  reject: 'bg-rose-50 text-rose-700 border-rose-200',
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function CoordinatePilotPage() {
  const [shop, setShop] = useState('SUMON MEDICAL HALL');
  const [address, setAddress] = useState('BD,TORNIHAT,GABTOLI,GABTOLI,BOGURA,');
  const [loading, setLoading] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [result, setResult] = useState<CoordinateResult | null>(null);
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [processLoading, setProcessLoading] = useState(false);
  const [batchSize, setBatchSize] = useState(5);
  const [rse, setRse] = useState('A1');
  const [ase, setAse] = useState('A10');
  const [territory, setTerritory] = useState('A11');
  const [enrichmentStatus, setEnrichmentStatus] = useState<EnrichmentStatus | null>(null);
  const [processResult, setProcessResult] = useState<ProcessNextResult | null>(null);

  const regionOptions = useMemo(() => rseData.map(item => ({ value: item.rse, key: item.sl })), []);
  const selectedRegionKey = useMemo(() => rseData.find(item => item.rse === rse)?.sl, [rse]);
  const aseOptions = useMemo(() => {
    if (!selectedRegionKey) return [];
    return aseData.filter(item => item['rse-key'] === selectedRegionKey);
  }, [selectedRegionKey]);
  const selectedAseMarker = useMemo(() => aseData.find(item => item.ase === ase)?.['ase-marker'], [ase]);
  const territoryOptions = useMemo(() => {
    if (!selectedAseMarker) return [];
    return terrData.filter(item => item['terr-ase-linker'] === selectedAseMarker);
  }, [selectedAseMarker]);

  const filterQueryString = useMemo(() => {
    const params = new URLSearchParams();
    if (rse) params.set('rse', rse);
    if (ase) params.set('ase', ase);
    if (territory) params.set('territory', territory);
    return params.toString();
  }, [rse, ase, territory]);

  const mapsLink = useMemo(() => {
    if (!result?.lat || !result?.lng) return null;
    return `https://www.google.com/maps/search/?api=1&query=${result.lat},${result.lng}`;
  }, [result]);

  useEffect(() => {
    const nextAseOptions = aseData.filter(item => item['rse-key'] === selectedRegionKey);
    if (!nextAseOptions.some(item => item.ase === ase)) {
      setAse('');
      setTerritory('');
    }
  }, [ase, selectedRegionKey]);

  useEffect(() => {
    const nextTerritoryOptions = terrData.filter(item => item['terr-ase-linker'] === selectedAseMarker);
    if (!nextTerritoryOptions.some(item => item.territory.trim() === territory)) {
      setTerritory('');
    }
  }, [selectedAseMarker, territory]);

  const handleHealthCheck = async () => {
    setHealthLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/health`);
      if (!response.ok) throw new Error(`Health check failed with HTTP ${response.status}`);
      const data = await response.json();
      setHealth(data);
    } catch (err: unknown) {
      setHealth(null);
      setError(getErrorMessage(err, 'Backend health check failed'));
    } finally {
      setHealthLoading(false);
    }
  };

  const handleRefreshStatus = async () => {
    setStatusLoading(true);
    setError(null);
    try {
      const suffix = filterQueryString ? `?${filterQueryString}` : '';
      const response = await fetch(`${API_BASE_URL}/chemist-shops/enrichment-status${suffix}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Status request failed with HTTP ${response.status}`);
      setEnrichmentStatus(data.status);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not load enrichment status'));
    } finally {
      setStatusLoading(false);
    }
  };

  const handleProcessNext = async () => {
    setProcessLoading(true);
    setError(null);
    setProcessResult(null);
    try {
      const response = await fetch(`${API_BASE_URL}/chemist-shops/process-next`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchSize, maxRetries: 3, rse, ase, territory }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Process request failed with HTTP ${response.status}`);
      setProcessResult(data);
      await handleRefreshStatus();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not process records'));
    } finally {
      setProcessLoading(false);
    }
  };

  const handleResolve = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch(`${API_BASE_URL}/resolve-pharmacy-coordinate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop, address }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Request failed with HTTP ${response.status}`);
      setResult(data);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Coordinate request failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCoordinates = async () => {
    if (!result?.lat || !result?.lng) return;
    await navigator.clipboard.writeText(`${result.lat},${result.lng}`);
  };

  return (
    <main className="glass-shell min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-6">
        <header className="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-sky-600">Coordinate Pilot</p>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Pharmacy Geopin Resolver</h1>
          </div>
          <button
            type="button"
            onClick={handleHealthCheck}
            disabled={healthLoading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-xs font-black uppercase tracking-widest text-slate-700 shadow-sm transition hover:border-sky-300 hover:text-sky-700 disabled:opacity-60"
          >
            {healthLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Check API
          </button>
        </header>

        {health && (
          <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
            Backend is {health.status}. Google Maps key: {health.hasGoogleMapsApiKey ? 'yes' : 'no'}.
            Supabase server key: {health.hasSupabaseServerKey ? 'yes' : 'no'}.
            Service role: {health.usingServiceRoleKey ? 'yes' : 'no'}.
          </div>
        )}

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid flex-1 gap-5 py-5 lg:grid-cols-[420px_1fr]">
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <form onSubmit={handleResolve} className="space-y-5 border-b border-slate-100 pb-5">
              <div>
                <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Shop / chamber / hospital name
                </label>
                <input
                  value={shop}
                  onChange={(event) => setShop(event.target.value)}
                  className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                  placeholder="SUMON MEDICAL HALL"
                />
              </div>

              <div>
                <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Address / landmark text
                </label>
                <textarea
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  rows={5}
                  className="w-full resize-none rounded-md border border-slate-200 bg-white px-3 py-3 text-sm font-semibold leading-6 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                  placeholder="BD,TORNIHAT,GABTOLI,GABTOLI,BOGURA,"
                />
              </div>

              <button
                type="submit"
                disabled={loading || (!shop.trim() && !address.trim())}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-xs font-black uppercase tracking-widest text-white shadow-sm transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Fetch Geocoordinates
              </button>
            </form>

            <div className="mt-5 space-y-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-sky-600">Supabase Processor</p>
                <h2 className="mt-1 text-lg font-black text-slate-950">Process Missing Coordinates</h2>
              </div>

              <div className="grid gap-3">
                <SelectField label="RSE / Region" value={rse} onChange={setRse} options={regionOptions.map(item => item.value)} placeholder="All RSEs" />
                <SelectField label="ASE" value={ase} onChange={setAse} options={aseOptions.map(item => item.ase)} placeholder="All ASEs" />
                <SelectField label="Territory / MPE" value={territory} onChange={setTerritory} options={territoryOptions.map(item => item.territory.trim())} placeholder="All territories" />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleRefreshStatus}
                  disabled={statusLoading}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-[10px] font-black uppercase tracking-widest text-slate-700 transition hover:border-sky-300 hover:text-sky-700 disabled:opacity-60"
                >
                  {statusLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Refresh
                </button>

                <button
                  type="button"
                  onClick={handleProcessNext}
                  disabled={processLoading}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-sky-600 px-3 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-sky-700 disabled:opacity-60"
                >
                  {processLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                  Process
                </button>
              </div>

              <div>
                <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Batch size
                </label>
                <input
                  type="number"
                  min={1}
                  max={5000}
                  value={batchSize}
                  onChange={(event) => setBatchSize(Math.min(Math.max(Number(event.target.value || 1), 1), 5000))}
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                />
              </div>

              {enrichmentStatus && (
                <div className="grid grid-cols-2 gap-2">
                  <StatBlock label="Total" value={enrichmentStatus.total} />
                  <StatBlock label="Ready" value={enrichmentStatus.ready_to_process} />
                  <StatBlock label="Pending" value={enrichmentStatus.pending} />
                  <StatBlock label="Resolved" value={enrichmentStatus.resolved} />
                  <StatBlock label="Low Conf." value={enrichmentStatus.low_confidence} />
                  <StatBlock label="Failed" value={enrichmentStatus.failed} />
                </div>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            {!result ? (
              <div className="flex h-full min-h-[360px] flex-col items-center justify-center text-center text-slate-400">
                <MapPin className="mb-3 h-10 w-10" />
                <p className="text-xs font-black uppercase tracking-[0.22em]">Result will appear here</p>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Resolved Coordinate</p>
                    <h2 className="mt-1 text-xl font-black text-slate-950">
                      {result.lat && result.lng ? `${result.lat}, ${result.lng}` : 'No coordinate'}
                    </h2>
                  </div>
                  <span className={`w-fit rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest ${confidenceStyles[result.confidence] || confidenceStyles.reject}`}>
                    {result.confidence}
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <InfoBlock label="Source" value={result.source} />
                  <InfoBlock label="Location Type" value={result.locationType || 'N/A'} />
                  <InfoBlock label="Matched Name" value={result.matchedName || 'N/A'} />
                  <InfoBlock label="Partial Match" value={result.partialMatch ? 'Yes' : 'No'} />
                </div>

                <InfoBlock label="Matched Address" value={result.matchedAddress || 'N/A'} />
                <InfoBlock label="Query Used" value={result.input?.query || 'N/A'} />

                <div>
                  <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Reasons</p>
                  <ul className="space-y-2">
                    {result.reasons.map((reason) => (
                      <li key={reason} className="rounded-md bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                        {reason}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={handleCopyCoordinates}
                    disabled={!result.lat || !result.lng}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-xs font-black uppercase tracking-widest text-slate-700 transition hover:border-sky-300 hover:text-sky-700 disabled:opacity-50"
                  >
                    <Clipboard className="h-4 w-4" />
                    Copy Coordinates
                  </button>
                  {mapsLink && (
                    <a
                      href={mapsLink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-sky-600 px-4 text-xs font-black uppercase tracking-widest text-white transition hover:bg-sky-700"
                    >
                      <MapPin className="h-4 w-4" />
                      Open Map
                    </a>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>

        {processResult && (
          <section className="mb-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-2 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Latest Processing Run</p>
                <h2 className="mt-1 text-lg font-black text-slate-950">
                  {processResult.processedCount} rows processed
                </h2>
              </div>
              <span className={`w-fit rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest ${processResult.success ? confidenceStyles.high : confidenceStyles.reject}`}>
                {processResult.halted ? 'halted' : 'verified'}
              </span>
            </div>
            {processResult.haltReason && (
              <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
                {processResult.haltReason}
              </p>
            )}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-400">
                  <tr>
                    <th className="py-2 pr-3">ID</th>
                    <th className="py-2 pr-3">Shop</th>
                    <th className="py-2 pr-3">RSE</th>
                    <th className="py-2 pr-3">ASE</th>
                    <th className="py-2 pr-3">Territory</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Confidence</th>
                    <th className="py-2 pr-3">Source</th>
                    <th className="py-2 pr-3">Verified</th>
                  </tr>
                </thead>
                <tbody>
                  {processResult.processed.map((row) => (
                    <tr key={row.id} className="border-b border-slate-50">
                      <td className="py-2 pr-3 font-bold text-slate-900">{row.id}</td>
                      <td className="py-2 pr-3 font-semibold text-slate-700">{row.shopName || 'N/A'}</td>
                      <td className="py-2 pr-3 font-semibold text-slate-700">{row.rse || 'N/A'}</td>
                      <td className="py-2 pr-3 font-semibold text-slate-700">{row.ase || 'N/A'}</td>
                      <td className="py-2 pr-3 font-semibold text-slate-700">{row.territory || 'N/A'}</td>
                      <td className="py-2 pr-3 font-semibold text-slate-700">{row.status || 'N/A'}</td>
                      <td className="py-2 pr-3 font-semibold text-slate-700">{row.confidence || 'N/A'}</td>
                      <td className="py-2 pr-3 font-semibold text-slate-700">{row.source || 'N/A'}</td>
                      <td className="py-2 pr-3 font-semibold text-slate-700">{row.verified ? 'Yes' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-3">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-1 break-words text-sm font-bold text-slate-800">{value}</p>
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder: string;
}) {
  const uniqueOptions = [...new Set(options.filter(Boolean))];

  return (
    <div>
      <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">
        {label}
      </label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
      >
        <option value="">{placeholder}</option>
        {uniqueOptions.map(option => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </div>
  );
}

function StatBlock({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-3">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-black text-slate-900">{value.toLocaleString()}</p>
    </div>
  );
}
