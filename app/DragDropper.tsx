'use client';

import React, { useState } from 'react';
import { supabase } from '@/utils/supabase';

// --- TYPES ---
export interface DoctorRecord {
  Doc_ID: string;
  Doctor: string;
  Designation: string;
  "Brand-1": string | null;
  "Brand-2": string | null;
  "Brand-3": string | null;
  "Brand-4": string | null;
}

export interface ScheduledDoctor extends DoctorRecord {
  selectedOptions: {
    literature: boolean;
    sample: boolean;
    gift: boolean;
  };
}

interface AddressData {
  "hospital-address": string;
  "chamber-address": string;
}

interface DragDropperProps {
  available: DoctorRecord[];
  setAvailable: React.Dispatch<React.SetStateAction<DoctorRecord[]>>;
  scheduled: ScheduledDoctor[];
  setScheduled: React.Dispatch<React.SetStateAction<ScheduledDoctor[]>>;
}

export default function DragDropper({ available, setAvailable, scheduled, setScheduled }: DragDropperProps) {

  // Modal & Address States
  const [activeModalDoc, setActiveModalDoc] = useState<DoctorRecord | null>(null);
  const [addressInfo, setAddressInfo] = useState<AddressData | null>(null);
  const [modalLoading, setModalLoading] = useState(false);

  // --- ADDRESS LOOKUP LOGIC ---
  const openModal = async (doc: DoctorRecord) => {
    setActiveModalDoc(doc);
    setModalLoading(true);
    setAddressInfo(null);
    try {
      const { data, error } = await supabase
        .from('address')
        .select('"hospital-address", "chamber-address"')
        .eq('doc-id', doc.Doc_ID)
        .single();

      if (error) throw error;
      setAddressInfo(data);
    } catch (err) {
      console.error("Address lookup failed:", err);
    } finally {
      setModalLoading(false);
    }
  };

  // --- DRAG HANDLERS ---
  const onDragStart = (e: React.DragEvent, index: number, source: 'available' | 'scheduled') => {
    e.dataTransfer.setData('index', index.toString());
    e.dataTransfer.setData('source', source);
  };

  const handleDropToScheduled = (e: React.DragEvent) => {
    e.preventDefault();
    const index = parseInt(e.dataTransfer.getData('index'));
    const source = e.dataTransfer.getData('source');

    if (source === 'available') {
      if (scheduled.length >= 25) return;
      const doc = available[index];
      setScheduled(prev => [...prev, { ...doc, selectedOptions: { literature: false, sample: false, gift: false } }]);
      setAvailable(prev => prev.filter((_, i) => i !== index));
    }
  };

  const handleDropToAvailable = (e: React.DragEvent) => {
    e.preventDefault();
    const index = parseInt(e.dataTransfer.getData('index'));
    const source = e.dataTransfer.getData('source');

    if (source === 'scheduled') {
      const { selectedOptions, ...originalDoc } = scheduled[index];
      setAvailable(prev => [originalDoc, ...prev]);
      setScheduled(prev => prev.filter((_, i) => i !== index));
    }
  };

  const toggleOption = (index: number, option: 'literature' | 'sample' | 'gift') => {
    setScheduled(prev => {
      const next = [...prev];
      next[index].selectedOptions[option] = !next[index].selectedOptions[option];
      return next;
    });
  };

  return (
    // h-full ensures the grid fills the parent, giving each column a bounded height to scroll within
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full relative">

      {/* LEFT: SCHEDULED */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDropToScheduled}
        className="bg-white border-2 border-dashed border-blue-100 rounded-2xl flex flex-col min-h-0 overflow-hidden"
      >
        <div className="p-4 border-b bg-blue-50/50 flex justify-between items-center shrink-0">
          <h3 className="font-black text-blue-700 text-xs uppercase">Active Planner</h3>
          <span className="text-[10px] px-2 py-0.5 rounded-full font-black text-white bg-blue-600">{scheduled.length}/25</span>
        </div>
        {/* This div is the independent scroll container for the left panel */}
        <div className="p-4 overflow-y-auto space-y-4 custom-scrollbar flex-1 min-h-0">
          {scheduled.map((doc, i) => (
            <Card key={`sch-${i}`} doc={doc} type="scheduled" i={i} onDragStart={onDragStart} onOptionToggle={toggleOption} onClick={() => openModal(doc)} />
          ))}
        </div>
      </div>

      {/* RIGHT: AVAILABLE */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDropToAvailable}
        className="bg-white border border-gray-200 rounded-2xl flex flex-col min-h-0 overflow-hidden"
      >
        <div className="p-4 border-b bg-gray-50 flex justify-between items-center shrink-0">
          <h3 className="font-black text-gray-500 text-xs uppercase">Available List</h3>
          <span className="bg-gray-400 text-white text-[10px] px-2 py-0.5 rounded-full font-black">{available.length}</span>
        </div>
        {/* This div is the independent scroll container for the right panel */}
        <div className="p-4 overflow-y-auto space-y-4 custom-scrollbar flex-1 min-h-0">
          {available.map((doc, i) => (
            <Card key={`avl-${i}`} doc={doc} type="available" i={i} onDragStart={onDragStart} onClick={() => openModal(doc)} />
          ))}
        </div>
      </div>

      {/* --- ADDRESS LOOKUP MODAL --- */}
      {activeModalDoc && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[99] flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] w-full max-w-lg shadow-2xl overflow-hidden border border-gray-100 transition-all scale-100">
            <div className="p-8 bg-blue-700 text-white relative">
              <p className="text-[10px] font-black opacity-70 uppercase tracking-widest mb-1">Doc ID: {activeModalDoc.Doc_ID}</p>
              <h2 className="text-2xl font-black uppercase leading-tight">{activeModalDoc.Doctor}</h2>
              <p className="text-xs font-bold opacity-80 uppercase mt-1">{activeModalDoc.Designation}</p>
              <button onClick={() => setActiveModalDoc(null)} className="absolute top-6 right-6 bg-white/10 hover:bg-white/20 p-2.5 rounded-full transition-all text-sm font-bold">✕</button>
            </div>

            <div className="p-8 space-y-8">
              {modalLoading ? (
                <div className="py-12 flex flex-col items-center justify-center gap-4">
                  <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Searching Address Table...</p>
                </div>
              ) : (
                <>
                  <AddressBlock title="Hospital Address" content={addressInfo?.["hospital-address"]} color="text-blue-600" bg="bg-blue-50" />
                  <AddressBlock title="Chamber Address" content={addressInfo?.["chamber-address"]} color="text-emerald-600" bg="bg-emerald-50" />
                </>
              )}
            </div>
            <div className="p-6 bg-gray-50 border-t text-center">
              <button onClick={() => setActiveModalDoc(null)} className="px-8 py-2.5 bg-gray-800 text-white rounded-full text-[10px] font-black uppercase tracking-widest hover:bg-gray-900 transition-all">Close Details</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- REUSABLE MODAL BLOCK ---
function AddressBlock({ title, content, color, bg }: { title: string; content?: string; color: string; bg: string }) {
  return (
    <div className="flex gap-5">
      <div className={`w-12 h-12 rounded-2xl ${bg} flex items-center justify-center font-black ${color} text-lg shadow-sm shrink-0`}>
        {title.charAt(0)}
      </div>
      <div>
        <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">{title}</h4>
        <p className="text-sm text-gray-800 font-bold leading-relaxed">
          {content || <span className="text-gray-300 italic font-medium">Record not found in address table.</span>}
        </p>
      </div>
    </div>
  );
}

// --- SHARED CARD COMPONENT ---
function Card({ doc, type, i, onDragStart, onOptionToggle, onClick }: any) {
  const brands = ["Brand-1", "Brand-2", "Brand-3", "Brand-4"] as const;

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, i, type)}
      onClick={onClick}
      className={`p-4 rounded-xl border bg-white transition-all hover:scale-[1.01] cursor-grab active:cursor-grabbing shadow-sm border-l-4 
        ${type === 'scheduled' ? 'border-blue-100 border-l-blue-600' : 'border-gray-100 border-l-gray-300 hover:border-blue-200'}`}
    >
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-[8px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md uppercase tracking-tighter shadow-sm border border-blue-100">ID: {doc.Doc_ID}</span>
      </div>
      <h4 className="font-black text-gray-800 text-sm uppercase leading-tight">{doc.Doctor}</h4>
      <p className="text-[9px] text-gray-400 font-bold uppercase mb-4">{doc.Designation}</p>

      <div className="flex items-end justify-between border-t border-gray-50 pt-3 gap-2">
        <div className="flex gap-2.5 flex-wrap">
          {brands.map(k => doc[k] && (
            <div key={k} className="flex flex-col items-center">
              <svg className="w-3.5 h-3.5 text-blue-500 mb-0.5" viewBox="0 0 24 24" fill="currentColor"><path d="M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z" /></svg>
              <span className="text-[7px] font-black text-gray-500 uppercase">{doc[k]}</span>
            </div>
          ))}
        </div>

        {type === 'scheduled' && (
          <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
            {(['literature', 'sample', 'gift'] as const).map(opt => (
              <button key={opt} onClick={() => onOptionToggle(i, opt)}
                className={`px-2 py-1.5 rounded text-[7px] font-black uppercase transition-all border shadow-sm
                  ${doc.selectedOptions[opt] ? 'bg-emerald-500 text-white border-emerald-500 scale-105' : 'bg-gray-50 text-gray-400 border-gray-100 hover:bg-gray-100'}`}
              >
                {opt}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}