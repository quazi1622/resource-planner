'use client';

import React from 'react';
import { SelectionState } from './page'; 
import RoutePlan from './RoutePlan'; // Add this line // Import the new Kanban artifact

interface SidebarProps {
  activeTab: 'resource' | 'route';
  setActiveTab: (tab: 'resource' | 'route') => void;
  selections: SelectionState;
  handleChange: (field: keyof SelectionState, value: string) => void;
  handleFetch: () => void;
  isReadyToFetch: boolean;
  loading: boolean;
  rseData: any[];
  filteredAse: any[];
  filteredTerr: any[];
  selectedDoctors: any[]; // New prop for the Kanban board
}

export default function Sidebar({
  activeTab,
  setActiveTab,
  selections,
  handleChange,
  handleFetch,
  isReadyToFetch,
  loading,
  rseData,
  filteredAse,
  filteredTerr,
  selectedDoctors // Destructure the new prop
}: SidebarProps) {
  return (
    <aside className="w-80 bg-white border-r border-gray-200 flex flex-col h-full shadow-lg">
      
      {/* TABS HEADER */}
      <div className="flex border-b">
        <button
          onClick={() => setActiveTab('resource')}
          className={`flex-1 py-4 text-[10px] font-black uppercase tracking-widest transition-all ${
            activeTab === 'resource' ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600' : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          Resource
        </button>
        <button
          onClick={() => setActiveTab('route')}
          className={`flex-1 py-4 text-[10px] font-black uppercase tracking-widest transition-all ${
            activeTab === 'route' ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600' : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          Route Plan
        </button>
      </div>

      <div className="p-6 flex-1 overflow-y-auto custom-scrollbar">
        {activeTab === 'resource' ? (
          /* --- RESOURCE CONFIGURATION TAB --- */
          <div className="space-y-6">
            <h2 className="text-xs font-black text-gray-800 uppercase tracking-widest mb-4">Configurations</h2>
            
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-black text-gray-400 uppercase">RSE Code</label>
              <select className="p-2.5 border rounded-lg bg-gray-50 text-sm" value={selections.rse} onChange={(e) => handleChange('rse', e.target.value)}>
                <option value="">Select RSE...</option>
                {rseData.map((item: any) => <option key={item.idx} value={item.sl}>{item.rse}</option>)}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-black text-gray-400 uppercase">ASE</label>
              <select className="p-2.5 border rounded-lg bg-gray-50 text-sm disabled:opacity-50" value={selections.ase} onChange={(e) => handleChange('ase', e.target.value)} disabled={!selections.rse}>
                <option value="">{selections.rse ? 'Select ASE...' : 'Select RSE first...'}</option>
                {filteredAse.map((item: any, i: number) => <option key={i} value={item.ase}>{item.ase}</option>)}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-black text-gray-400 uppercase">Territory</label>
              <select className="p-2.5 border rounded-lg bg-gray-50 text-sm disabled:opacity-50" value={selections.territory} onChange={(e) => handleChange('territory', e.target.value)} disabled={!selections.ase}>
                <option value="">{selections.ase ? 'Select Territory...' : 'Select ASE first...'}</option>
                {filteredTerr.map((item: any, i: number) => <option key={i} value={item.territory}>{item.territory}</option>)}
              </select>
            </div>

            <div className="flex flex-col gap-1 border-b pb-6">
              <label className="text-[10px] font-black text-gray-400 uppercase">Team</label>
              <select className="p-2.5 border rounded-lg bg-gray-50 text-sm" value={selections.team} onChange={(e) => handleChange('team', e.target.value)}>
                <option value="">Select Team...</option>
                <option value="origina">Origina</option>
                <option value="centina">Centina</option>
                <option value="optima">Optima</option>
                <option value="fortuna">Fortuna</option>
              </select>
            </div>

            <button
              onClick={handleFetch}
              disabled={!isReadyToFetch || loading}
              className={`w-full py-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all shadow-sm
                ${isReadyToFetch && !loading ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-100 text-gray-400'}`}
            >
              {loading ? 'Fetching...' : 'Fetch Records'}
            </button>
          </div>
        ) : (
          /* --- ROUTE PLAN KANBAN TAB --- */
          <div className="space-y-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-black text-gray-800 uppercase tracking-widest">Route Optimizer</h2>
              <span className="bg-blue-100 text-blue-700 text-[9px] font-black px-2 py-0.5 rounded-full uppercase">
                {selectedDoctors.length} Spots
              </span>
            </div>

            {selectedDoctors.length > 0 ? (
              <RoutePlan selectedDoctors={selectedDoctors} />
            ) : (
              <div className="space-y-4 text-center py-10">
                <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-gray-100">
                   <p className="text-xl">📍</p>
                </div>
                <p className="text-[11px] text-gray-400 leading-relaxed uppercase font-bold tracking-tighter">
                  No doctors selected.<br/>Return to 'Resource' to fetch and select spots.
                </p>
              </div>
            )}

            {/* Google Context Footer */}
            <div className="p-4 bg-gray-50 border border-gray-100 rounded-2xl mt-8">
               <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest block mb-1">Ecosystem Status</span>
               <div className="flex items-center gap-2">
                 <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
                 <p className="text-[10px] text-gray-600 font-bold">Google Maps Wrapper Active</p>
               </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}