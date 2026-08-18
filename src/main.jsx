import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { createClient } from '@supabase/supabase-js';
import './styles.css';

const supabase = createClient('https://ynjfvtezearvynmvmmvo.supabase.co', 'sb_publishable_QW_rJUJ_8XrTytm4aUbbaw_397_7H0t');
const CENTER = [39.8283, -98.5795];
const GEO = 'https://nominatim.openstreetmap.org/search';
const norm = (s = '') => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/ +/g, ' ').trim();
const typeLabel = t => t === 'shipper' ? 'Shipping' : t === 'receiver' ? 'Receiving' : 'Shipping + Receiving';
const emptyForm = { name: '', facility_type: 'shipper', address: '', notes: '' };

function App() {
  const mapEl = useRef(null), map = useRef(null), markers = useRef(new Map());
  const [facilities, setFacilities] = useState([]), [selected, setSelected] = useState(null), [query, setQuery] = useState('');
  const [showAdd, setShowAdd] = useState(false), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [message, setMessage] = useState('');
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    if (map.current || !mapEl.current) return;
    map.current = L.map(mapEl.current, { zoomControl: false, minZoom: 3 }).setView(CENTER, 4);
    L.control.zoom({ position: 'bottomright' }).addTo(map.current);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map.current);
    return () => map.current?.remove();
  }, []);

  useEffect(() => {
    load();
    const ch = supabase.channel('facility-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'facilities' }, load).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  useEffect(() => {
    markers.current.forEach(m => m.remove());
    markers.current.clear();
    if (!map.current) return;
    facilities.filter(f => Number.isFinite(f.latitude) && Number.isFinite(f.longitude)).forEach(f => {
      const c = f.facility_type === 'receiver' ? '#7c3aed' : f.facility_type === 'both' ? '#059669' : '#2563eb';
      const icon = L.divIcon({ className: 'facility-marker-wrap', html: `<div class="facility-marker" style="--marker-color:${c}"></div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
      const m = L.marker([f.latitude, f.longitude], { icon }).addTo(map.current);
      m.bindTooltip(f.name, { direction: 'top', offset: [0, -12] });
      m.on('click', () => focus(f));
      markers.current.set(f.id, m);
    });
  }, [facilities]);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from('facilities').select('*').order('name');
    if (error) setMessage(error.message); else setFacilities(data || []);
    setLoading(false);
  }

  function focus(f) {
    setSelected(f);
    setQuery(f.name || '');
    if (Number.isFinite(f.latitude) && Number.isFinite(f.longitude)) map.current?.flyTo([f.latitude, f.longitude], 14, { duration: .8 });
  }

  const results = useMemo(() => {
    const q = norm(query);
    if (!q) return [];
    const tokens = q.split(' ').filter(Boolean);
    return facilities
      .map(f => {
        const hay = norm(`${f.name} ${f.address || ''} ${f.city || ''} ${f.state_code || ''} ${f.zip || ''}`);
        const score = tokens.every(t => hay.includes(t)) ? (norm(f.name).startsWith(q) ? 3 : hay.startsWith(q) ? 2 : 1) : 0;
        return { f, score };
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || a.f.name.localeCompare(b.f.name))
      .slice(0, 8)
      .map(x => x.f);
  }, [query, facilities]);

  async function search(e) {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;
    if (results[0]) return focus(results[0]);
    setMessage('Searching the US address database…');
    try {
      const r = await fetch(`${GEO}?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`);
      const d = await r.json();
      if (!d[0]) throw Error('No saved facility or US address found.');
      map.current?.flyTo([+d[0].lat, +d[0].lon], 14, { duration: .8 });
      setMessage(`Map centered on ${d[0].display_name}`);
    } catch (err) { setMessage(err.message); }
  }

  async function geocode(address) {
    const r = await fetch(`${GEO}?format=jsonv2&limit=1&countrycodes=us&addressdetails=1&q=${encodeURIComponent(address)}`);
    const d = await r.json();
    if (!d[0]) throw Error('Address not found. Enter a complete US street address, city, state, or ZIP.');
    const a = d[0].address || {};
    const iso = (a['ISO3166-2-lvl4'] || '').split('-')[1] || '';
    return {
      address: address.trim(),
      city: a.city || a.town || a.village || a.municipality || '',
      state_code: (a.state_code || iso || '').toUpperCase().slice(0, 2),
      zip: a.postcode || '',
      latitude: +d[0].lat,
      longitude: +d[0].lon
    };
  }

  async function add(e) {
    e.preventDefault();
    setSaving(true); setMessage('');
    try {
      const name = form.name.trim();
      if (!name) throw Error('Facility name is required.');
      const location = await geocode(form.address);
      const duplicate = facilities.find(f => norm(f.name) === norm(name) || (Number.isFinite(f.latitude) && Math.abs(f.latitude - location.latitude) < .0005 && Math.abs(f.longitude - location.longitude) < .0005));
      if (duplicate) throw Error(`A facility already exists here: ${duplicate.name}`);
      const payload = { name, facility_type: form.facility_type, ...location, driver_instructions: form.notes.trim(), public_visible: true };
      const { data, error } = await supabase.from('facilities').insert(payload).select().single();
      if (error) throw error;
      setFacilities(x => [...x, data].sort((a, b) => a.name.localeCompare(b.name)));
      setShowAdd(false); setForm(emptyForm); setMessage('Facility added successfully.'); focus(data);
    } catch (err) { setMessage(err.message || 'Could not save facility.'); }
    finally { setSaving(false); }
  }

  async function updateFacility(id, values) {
    const location = await geocode(values.address);
    const duplicate = facilities.find(f => f.id !== id && (norm(f.name) === norm(values.name) || (Number.isFinite(f.latitude) && Math.abs(f.latitude - location.latitude) < .0005 && Math.abs(f.longitude - location.longitude) < .0005)));
    if (duplicate) throw Error(`Another facility already exists here: ${duplicate.name}`);
    const { data, error } = await supabase.from('facilities').update({ name: values.name.trim(), facility_type: values.facility_type, ...location, driver_instructions: values.notes.trim() }).eq('id', id).select().single();
    if (error) throw error;
    setFacilities(x => x.map(v => v.id === id ? data : v).sort((a, b) => a.name.localeCompare(b.name)));
    setSelected(data); setMessage('Facility updated successfully.');
  }

  async function saveNotes(f, notes) {
    const { data, error } = await supabase.from('facilities').update({ driver_instructions: notes }).eq('id', f.id).select().single();
    if (error) { setMessage(error.message); return; }
    setFacilities(x => x.map(v => v.id === f.id ? data : v)); setSelected(data); setMessage('Notes saved.');
  }

  return <div className="app">
    <header><div className="brand"><div className="logo">FBK</div><div><b>FBK KAUNAS LOGISTICS</b><small>USA Shipping & Receiving Facility Map</small></div></div><div className="head-right"><span><b>{facilities.length}</b> facilities</span><button className="primary" onClick={() => setShowAdd(true)}>+ Add Facility</button></div></header>
    <main>
      <aside>
        <form className="search" onSubmit={search}><label>Find a facility</label><div className="search-row"><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Name, street, city or ZIP…"/><button type="submit">⌕</button></div>{results.length > 0 && <div className="results">{results.map(f => <button type="button" key={f.id} onClick={() => focus(f)}><i className={f.facility_type}/><span><b>{f.name}</b><small>{f.address}</small></span></button>)}</div>}</form>
        <div className="list-head"><b>Facilities</b><button onClick={() => { setQuery(''); setSelected(null); map.current?.flyTo(CENTER, 4); }}>Reset map</button></div>
        <div className="legend"><span><i className="shipping"/>Shipping</span><span><i className="receiving"/>Receiving</span><span><i className="both"/>Both</span></div>
        <section className="list">{loading ? <p>Loading facilities…</p> : facilities.length === 0 ? <div className="empty"><strong>No facilities yet</strong><span>Add the first location to the map.</span><button className="secondary" onClick={() => setShowAdd(true)}>Add first facility</button></div> : facilities.map(f => <button className={`card ${selected?.id === f.id ? 'active' : ''}`} key={f.id} onClick={() => focus(f)}><em className={f.facility_type}>{typeLabel(f.facility_type)}</em><b>{f.name}</b><span>{f.address}</span>{f.city && <small>{f.city}{f.state_code ? `, ${f.state_code}` : ''}{f.zip ? ` ${f.zip}` : ''}</small>}</button>)}</section>
      </aside>
      <div className="map-wrap"><div ref={mapEl} className="map"/><div className="badge">● Live facility map</div>{message && <div className="toast">{message}<button onClick={() => setMessage('')}>×</button></div>}{selected && <Panel f={selected} close={() => setSelected(null)} save={saveNotes} update={updateFacility}/>}</div>
    </main>
    {showAdd && <FacilityModal title="Add a facility" form={form} setForm={setForm} saving={saving} onClose={() => setShowAdd(false)} onSubmit={add}/>} 
  </div>;
}

function FacilityModal({ title, form, setForm, saving, onClose, onSubmit }) {
  return <div className="overlay"><form className="modal" onSubmit={onSubmit}><button type="button" className="close" onClick={onClose}>×</button><h2>{title}</h2><p>Enter the facility address. The app will locate it automatically.</p><label>Facility name<input required value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Distribution Center"/></label><label>Facility type<select value={form.facility_type} onChange={e => setForm({...form, facility_type: e.target.value})}><option value="shipper">Shipping</option><option value="receiver">Receiving</option><option value="both">Both</option></select></label><label>Street address<input required value={form.address} onChange={e => setForm({...form, address: e.target.value})} placeholder="123 Main St, Dallas, TX 75201"/></label><label>Driver notes<textarea rows="6" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} placeholder="Gate, parking, check-in, appointment, lumper, arrival instructions…"/></label><div className="actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={saving}>{saving ? 'Locating & saving…' : 'Save facility'}</button></div></form></div>;
}

function Panel({ f, close, save, update }) {
  const [notes, setNotes] = useState(f.driver_instructions || ''), [editNotes, setEditNotes] = useState(false), [editDetails, setEditDetails] = useState(false), [saving, setSaving] = useState(false);
  const [details, setDetails] = useState({ name: f.name, facility_type: f.facility_type, address: f.address, notes: f.driver_instructions || '' });
  useEffect(() => { setNotes(f.driver_instructions || ''); setDetails({ name: f.name, facility_type: f.facility_type, address: f.address, notes: f.driver_instructions || '' }); }, [f.id, f.name, f.address, f.facility_type, f.driver_instructions]);

  return <div className="panel">
    <div className="panel-top"><em className={f.facility_type}>{typeLabel(f.facility_type)}</em><button className="close" onClick={close}>×</button></div>
    {editDetails ? <><h2>Edit facility</h2><label className="panel-label">Facility name<input value={details.name} onChange={e => setDetails({...details, name: e.target.value})}/></label><label className="panel-label">Facility type<select value={details.facility_type} onChange={e => setDetails({...details, facility_type: e.target.value})}><option value="shipper">Shipping</option><option value="receiver">Receiving</option><option value="both">Both</option></select></label><label className="panel-label">Address<input value={details.address} onChange={e => setDetails({...details, address: e.target.value})}/></label><label className="panel-label">Driver notes<textarea rows="6" value={details.notes} onChange={e => setDetails({...details, notes: e.target.value})}/></label><div className="actions"><button className="secondary" onClick={() => setEditDetails(false)}>Cancel</button><button className="primary" disabled={saving} onClick={async () => { try { setSaving(true); await update(f.id, details); setEditDetails(false); } catch (e) { alert(e.message); } finally { setSaving(false); } }}>{saving ? 'Locating & saving…' : 'Save facility'}</button></div></> : <><h2>{f.name}</h2><p className="address">{f.address}</p><small>{f.city}{f.state_code ? `, ${f.state_code}` : ''}{f.zip ? ` ${f.zip}` : ''}</small><button className="edit-facility" onClick={() => setEditDetails(true)}>Edit facility details</button><hr/><div className="notes-title"><b>Driver notes</b>{!editNotes && <button onClick={() => setEditNotes(true)}>Edit</button>}</div>{editNotes ? <><textarea value={notes} onChange={e => setNotes(e.target.value)} rows="7"/><div className="actions"><button className="secondary" onClick={() => { setNotes(f.driver_instructions || ''); setEditNotes(false); }}>Cancel</button><button className="primary" disabled={saving} onClick={async () => { setSaving(true); await save(f, notes); setSaving(false); setEditNotes(false); }}>{saving ? 'Saving…' : 'Save notes'}</button></div></> : <p className={!f.driver_instructions ? 'muted' : ''}>{f.driver_instructions || 'No notes yet. Add gate, parking, check-in, appointment, lumper, or other driver instructions.'}</p>}<button className="directions" onClick={() => location.href = `https://www.google.com/maps/dir/?api=1&destination=${f.latitude},${f.longitude}`}>Open directions ↗</button></>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);
