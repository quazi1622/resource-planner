'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Database, Loader2, MapPinned, Play, RefreshCw, Rows3 } from 'lucide-react';
import rseData from '../rseData.json';
import aseData from '../aseData.json';
import terrData from '../terrData.json';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '/api/backend';

type LocationType = 'both' | 'hospital' | 'chamber';

type DoctorPendingRecord = {
  id: number;
  doc_id: string;
  doctor_name: string | null;
  designation: string | null;
  team: string | null;
  rse: string | null;
  ase: string | null;
  territory: string | null;
  location_type: 'hospital' | 'chamber';
  place_name: string | null;
  descriptive_address: string | null;
  raw_address: string | null;
  latitude: number | null;
  longitude: number | null;
  confidence: string;
  source: string | null;
  status: string;
  retry_count: number;
  last_attempted_at: string | null;
  error_message: string | null;
};

type DoctorStatus = {
  total: number;
  pending: number;
  processing: number;
  resolved: number;
  low_confidence: number;
  failed: number;
  missing_coordinates: number;
  ready_to_process: number;
};

type ProcessedDoctorRow = {
  id: number;
  docId?: string;
  doctorName?: string | null;
  locationType?: string;
  status?: string;
  confidence?: string;
  source?: string;
  lat?: number | null;
  lng?: number | null;
  matchedAddress?: string | null;
  retryCount?: number;
  verified: boolean;
  error?: string;
};

type ProcessResult = {
  success: boolean;
  fetched: number;
  processedCount: number;
  halted: boolean;
  haltReason: string | null;
  processed: ProcessedDoctorRow[];
};

type SyncResult = {
  success: boolean;
  sourceDoctors: number;
  matchedAddressRows: number;
  upserted: number;
  preview: Array<{
    doc_id: string;
    doctor_name: string;
    location_type: string;
    place_name: string | null;
    descriptive_address: string | null;
  }>;
};

function messageFrom(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function DoctorCoordinatePilotPage() {
  const [team] = useState('centina');
  const [rse, setRse] = useState('A1');
  const [ase, setAse] = useState('');
  const [territory, setTerritory] = useState('');
  const [locationType, setLocationType] = useState<LocationType>('hospital');
  const [syncLimit, setSyncLimit] = useState(200);
  const [batchSize, setBatchSize] = useState(5);
  const [pendingLimit, setPendingLimit] = useState(25);
  const [status, setStatus] = useState<DoctorStatus | null>(null);
  const [pendingRecords, setPendingRecords] = useState<DoctorPendingRecord[]>([]);
  const [processResult, setProcessResult] = useState<ProcessResult | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

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

  const queryString = useMemo(() => {
    const params = new URLSearchParams({
      team,
      rse,
      locationType,
    });
    if (ase) params.set('ase', ase);
    if (territory) params.set('territory', territory);
    return params.toString();
  }, [team, rse, ase, territory, locationType]);

  useEffect(() => {
    setAse('');
    setTerritory('');
  }, [rse]);

  useEffect(() => {
    setTerritory('');
  }, [ase]);

  const runAction = async (actionName: string, action: () => Promise<void>) => {
    setLoadingAction(actionName);
    setError(null);
    try {
      await action();
    } catch (err: unknown) {
      setError(messageFrom(err, 'Request failed'));
    } finally {
      setLoadingAction(null);
    }
  };

  const refreshStatus = async () => {
    const response = await fetch(`${API_BASE_URL}/doctor-location-points/enrichment-status?${queryString}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Status failed with HTTP ${response.status}`);
    setStatus(data.status);
  };

  const fetchPending = async () => {
    const response = await fetch(`${API_BASE_URL}/doctor-location-points/pending?${queryString}&limit=${pendingLimit}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Pending fetch failed with HTTP ${response.status}`);
    setPendingRecords(data.records || []);
  };

  const syncFromSource = async () => {
    const response = await fetch(`${API_BASE_URL}/doctor-location-points/sync-from-source`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team, rse, ase, territory, locationType, limit: syncLimit }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Sync failed with HTTP ${response.status}`);
    setSyncResult(data);
    await refreshStatus();
    await fetchPending();
  };

  const processNext = async () => {
    const response = await fetch(`${API_BASE_URL}/doctor-location-points/process-next`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team, rse, ase, territory, locationType, batchSize, maxRetries: 3 }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Processing failed with HTTP ${response.status}`);
    setProcessResult(data);
    await refreshStatus();
    await fetchPending();
  };

  return (
    <main className="glass-shell min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-6">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-sky-600">Doctor Coordinates</p>
            <h1 className="mt-2 text-2xl font-black tracking-tight">Hospital And Chamber Processor</h1>
          </div>
          <a
            href="/coordinate-pilot"
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-xs font-black uppercase tracking-widest text-slate-700 transition hover:border-sky-300 hover:text-sky-700"
          >
            Chemist Processor
          </a>
        </header>

        {error && (
          <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            {error}
          </div>
        )}

        <section className="grid gap-4 py-5 lg:grid-cols-[340px_1fr]">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="space-y-4">
              <SelectField label="Region / RSE" value={rse} onChange={setRse} options={regionOptions.map(item => item.value)} />
              <SelectField label="ASE / MPE" value={ase} onChange={setAse} options={aseOptions.map(item => item.ase)} placeholder="All ASEs" />
              <SelectField label="Territory" value={territory} onChange={setTerritory} options={territoryOptions.map(item => item.territory.trim())} placeholder="All territories" />
              <SelectField label="Location Type" value={locationType} onChange={(value) => setLocationType(value as LocationType)} options={['hospital', 'chamber', 'both']} />

              <NumberField label="Sync source limit" value={syncLimit} min={1} max={5000} onChange={setSyncLimit} />
              <NumberField label="Pending preview limit" value={pendingLimit} min={1} max={500} onChange={setPendingLimit} />
              <NumberField label="Process batch size" value={batchSize} min={1} max={100} onChange={setBatchSize} />

              <div className="grid grid-cols-2 gap-2 pt-2">
                <ActionButton label="Status" icon={<RefreshCw className="h-4 w-4" />} loading={loadingAction === 'status'} onClick={() => runAction('status', refreshStatus)} />
                <ActionButton label="Pending" icon={<Rows3 className="h-4 w-4" />} loading={loadingAction === 'pending'} onClick={() => runAction('pending', fetchPending)} />
                <ActionButton label="Sync" icon={<Database className="h-4 w-4" />} loading={loadingAction === 'sync'} onClick={() => runAction('sync', syncFromSource)} />
                <ActionButton label="Process" icon={<Play className="h-4 w-4" />} loading={loadingAction === 'process'} onClick={() => runAction('process', processNext)} primary />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="Total" value={status?.total} />
              <Stat label="Ready" value={status?.ready_to_process} />
              <Stat label="Resolved" value={status?.resolved} />
              <Stat label="Low Conf." value={status?.low_confidence} />
              <Stat label="Pending" value={status?.pending} />
              <Stat label="Failed" value={status?.failed} />
              <Stat label="Missing" value={status?.missing_coordinates} />
              <Stat label="Processing" value={status?.processing} />
            </div>

            {syncResult && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
                Synced {syncResult.upserted.toLocaleString()} location rows from {syncResult.sourceDoctors.toLocaleString()} source doctors.
              </div>
            )}

            {processResult && (
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Latest Process Run</p>
                    <h2 className="mt-1 text-lg font-black">{processResult.processedCount} processed</h2>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest ${processResult.success ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
                    {processResult.halted ? 'halted' : 'verified'}
                  </span>
                </div>
                {processResult.haltReason && <p className="mt-3 text-sm font-semibold text-rose-700">{processResult.haltReason}</p>}
                <ResultTable rows={processResult.processed} />
              </div>
            )}

            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Pending Records</p>
                  <h2 className="mt-1 text-lg font-black">Unprocessed hospital/chamber addresses</h2>
                </div>
                <MapPinned className="h-5 w-5 text-sky-600" />
              </div>
              <PendingTable rows={pendingRecords} />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function SelectField({ label, value, onChange, options, placeholder = 'Select...' }: { label: string; value: string; onChange: (value: string) => void; options: string[]; placeholder?: string }) {
  return (
    <div>
      <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</label>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100">
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    </div>
  );
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <div>
      <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</label>
      <input type="number" min={min} max={max} value={value} onChange={(event) => onChange(Math.min(Math.max(Number(event.target.value || min), min), max))} className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
    </div>
  );
}

function ActionButton({ label, icon, loading, onClick, primary = false }: { label: string; icon: React.ReactNode; loading: boolean; onClick: () => void; primary?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={loading} className={`inline-flex h-10 items-center justify-center gap-2 rounded-md px-3 text-[10px] font-black uppercase tracking-widest transition disabled:opacity-60 ${primary ? 'bg-sky-600 text-white hover:bg-sky-700' : 'border border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:text-sky-700'}`}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {label}
    </button>
  );
}

function Stat({ label, value }: { label: string; value?: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-black text-slate-950">{typeof value === 'number' ? value.toLocaleString() : '-'}</p>
    </div>
  );
}

function PendingTable({ rows }: { rows: DoctorPendingRecord[] }) {
  if (!rows.length) {
    return <div className="flex min-h-[220px] items-center justify-center text-sm font-bold text-slate-400">No pending records loaded.</div>;
  }

  return (
    <div className="mt-4 max-h-[440px] overflow-auto">
      <table className="w-full min-w-[900px] text-left text-sm">
        <thead className="border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-400">
          <tr>
            <th className="py-2 pr-3">ID</th>
            <th className="py-2 pr-3">Doc</th>
            <th className="py-2 pr-3">Type</th>
            <th className="py-2 pr-3">Place</th>
            <th className="py-2 pr-3">Address</th>
            <th className="py-2 pr-3">Territory</th>
            <th className="py-2 pr-3">Retry</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id} className="border-b border-slate-50">
              <td className="py-2 pr-3 font-bold">{row.id}</td>
              <td className="py-2 pr-3 font-semibold">{row.doc_id} - {row.doctor_name || 'N/A'}</td>
              <td className="py-2 pr-3 font-semibold">{row.location_type}</td>
              <td className="py-2 pr-3 font-semibold">{row.place_name || 'N/A'}</td>
              <td className="py-2 pr-3 font-semibold">{row.descriptive_address || row.raw_address || 'N/A'}</td>
              <td className="py-2 pr-3 font-semibold">{row.rse}/{row.ase}/{row.territory}</td>
              <td className="py-2 pr-3 font-semibold">{row.retry_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultTable({ rows }: { rows: ProcessedDoctorRow[] }) {
  if (!rows.length) return null;

  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-400">
          <tr>
            <th className="py-2 pr-3">ID</th>
            <th className="py-2 pr-3">Doctor</th>
            <th className="py-2 pr-3">Type</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 pr-3">Confidence</th>
            <th className="py-2 pr-3">Coordinate</th>
            <th className="py-2 pr-3">Verified</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id} className="border-b border-slate-50">
              <td className="py-2 pr-3 font-bold">{row.id}</td>
              <td className="py-2 pr-3 font-semibold">{row.docId} - {row.doctorName || 'N/A'}</td>
              <td className="py-2 pr-3 font-semibold">{row.locationType || 'N/A'}</td>
              <td className="py-2 pr-3 font-semibold">{row.status || 'N/A'}</td>
              <td className="py-2 pr-3 font-semibold">{row.confidence || 'N/A'}</td>
              <td className="py-2 pr-3 font-semibold">{row.lat && row.lng ? `${row.lat}, ${row.lng}` : 'N/A'}</td>
              <td className="py-2 pr-3 font-semibold">{row.verified ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : 'No'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
