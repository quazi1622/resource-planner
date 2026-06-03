'use client';

import React, { useState } from 'react';
import rseData from './rseData.json';
import aseData from './aseData.json';
import terrData from './terrData.json';
import { supabase } from '@/utils/supabase';
import DragDropper, { DoctorRecord, ScheduledDoctor } from './DragDropper';
import Sidebar from './Sidebar-UI';
// Import the Route Optimizer component
import RoutePlan from './RoutePlan';

export interface SelectionState {
  rse: string;
  ase: string;
  territory: string;
  team: string;
}

export default function SelectionDashboard() {
  const [activeTab, setActiveTab] = useState<'resource' | 'route'>('resource');
  const [selections, setSelections] = useState<SelectionState>({ rse: '', ase: '', territory: '', team: '' });
  const [availableDoctors, setAvailableDoctors] = useState<DoctorRecord[]>([]);
  const [scheduledDoctors, setScheduledDoctors] = useState<ScheduledDoctor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isReadyToFetch = !!(selections.rse && selections.ase && selections.territory && selections.team);

  const handleFetch = async () => {
    setLoading(true);
    setError(null);
    try {
      const selectedRseLabel = rseData.find(item => item.sl.toString() === selections.rse)?.rse;
      if (!selectedRseLabel) throw new Error("RSE selection invalid.");

      const { data, error: supabaseError } = await supabase
        .from(selections.team)
        .select('Doc_ID, Doctor, Designation, "Brand-1", "Brand-2", "Brand-3", "Brand-4"')
        .eq('RSE', selectedRseLabel)
        .eq('ASE', selections.ase)
        .eq('Territory', selections.territory);

      if (supabaseError) throw supabaseError;

      const fetchedData = (data || []) as DoctorRecord[];
      const filtered = fetchedData.filter(d => !scheduledDoctors.some(s => s.Doc_ID === d.Doc_ID));

      setAvailableDoctors(filtered);
      if (fetchedData.length === 0) setError("No records found for this selection.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not fetch records.');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field: keyof SelectionState, value: string) => {
    setSelections((prev) => {
      const next = { ...prev, [field]: value };
      if (field === 'rse') { next.ase = ''; next.territory = ''; }
      if (field === 'ase') { next.territory = ''; }
      return next;
    });
  };

  const filteredAse = selections.rse ? aseData.filter(item => item['rse-key'] === Number(selections.rse)) : [];
  const selectedAseMarker = selections.ase ? aseData.find(item => item.ase === selections.ase)?.['ase-marker'] : null;
  const filteredTerr = selectedAseMarker ? terrData.filter(item => item['terr-ase-linker'] === selectedAseMarker) : [];

  return (
    <div className="glass-shell flex h-screen bg-gray-50 overflow-hidden text-black font-sans" suppressHydrationWarning>
      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 20px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
        .custom-scrollbar { scroll-behavior: smooth; }
      `}</style>

      {/* Sidebar stays fully fixed — no scroll, no flex shrink */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        selections={selections}
        handleChange={handleChange}
        handleFetch={handleFetch}
        isReadyToFetch={isReadyToFetch}
        loading={loading}
        rseData={rseData}
        filteredAse={filteredAse}
        filteredTerr={filteredTerr}
        selectedDoctors={scheduledDoctors}
      />

      {/* Right column: flex column, height locked to screen */}
      <main className="flex-1 flex flex-col min-w-0 bg-gray-50 overflow-hidden">

        {/* Fixed topbar — never scrolls */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-8 shrink-0 z-10 shadow-sm">
          <div className="flex flex-col">
            <h1 className="text-sm font-black text-gray-800 uppercase tracking-tighter">
              {activeTab === 'resource' ? 'Resource Planner' : 'Route Optimizer'}
            </h1>
            <p className="text-[9px] text-blue-600 font-black uppercase italic">Bangladesh Ops v3.0</p>
          </div>
          {error && <span className="text-red-500 text-[9px] font-black uppercase animate-pulse">{error}</span>}
          <div className="bg-emerald-50 text-emerald-600 text-[9px] font-black px-3 py-1.5 rounded-full border border-emerald-100 shadow-sm">
            LIVE: {scheduledDoctors.length} SCHEDULED
          </div>
        </header>

        {/* Content area: flex-1 + overflow-hidden so it fills remaining height exactly */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'resource' ? (
            <div className="p-6 h-full">
              <DragDropper
                available={availableDoctors}
                setAvailable={setAvailableDoctors}
                scheduled={scheduledDoctors}
                setScheduled={setScheduledDoctors}
              />
            </div>
          ) : (
            /* 
               The RoutePlan component is rendered here. 
               We remove the p-6 wrapper to allow the map and sidebar 
               to fill the viewport edge-to-edge.
            */
            <div className="h-full">
              <RoutePlan selectedDoctors={scheduledDoctors} />
            </div>
          )}
        </div>

      </main>
    </div>
  );
}
