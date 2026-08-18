import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { createClient } from '@supabase/supabase-js';
import './styles.css';

const supabase = createClient('https://ynjfvtezearvynmvmmvo.supabase.co', 'sb_publishable_QW_rJUJ_8XrTytm4aUbbaw_397_7H0t');
const CENTER = [39.8283, -98.5795];
const GEO = 'https://nominatim.openstreetmap.org/search';
const ORG_ID = '0831a41e-d34a-4bed-8d7b-31791b06db40';
const norm = (s = '') => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/ +/g, ' ').trim();
const typeLabel = t => t === 'shipper' ? 'Shipping' : t === 'receiver' ? 'Receiving' : 'Shipping + Receiving';
const roleLabel = r => r === 'admin' ? 'Admin' : r === 'dispatcher' ? 'Dispatcher' : 'Driver';
const emptyForm = { name: '', facility_type: 'shipper', address: '', phone: '', hours: '', parking: 'Unknown', lumper: 'Unknown', appointment: 'Unknown', average_wait_minutes: '', notes: '' };
const waitLabel = v => Number.isFinite(Number(v)) && Number(v) > 0 ? `${v} min` : 'Not reported';

function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('driver');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function submit(e) {
    e.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      if (mode === 'signup') {
        if (!name.trim()) throw Error('Please enter your full name.');
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { full_name: name.trim(), role } } });
        if (error) throw error;
        if (!data.session) setMessage('Account created. Check your email to confirm the account, then log in.');
        else onAuth(data.session.user);
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        onAuth(data.user);
      }
    } catch (e) { setError(e.message || 'Authentication failed.'); }
    finally { setBusy(false); }
  }

  return <div className="auth-screen"><div className="auth-card"><div className="auth-brand"><div className="logo">FBK</div><div><b>FBK KAUNAS LOGISTICS</b><small>USA Shipping & Receiving Facility Map</small></div></div><h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1><p className="auth-sub">{mode === 'login' ? 'Sign in to access the facility map.' : 'Create a colleague account to use the logistics map.'}</p><form onSubmit={submit}>{mode === 'signup' && <><label>Full name<input required value={name} onChange={e => setName(e.target.value)} placeholder="John Smith"/></label><label>Role<select value={role} onChange={e => setRole(e.target.value)}><option value="driver">Driver</option><option value="dispatcher">Dispatcher</option></select></label></>}<label>Email<input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email"/></label><label>Password<input required minLength="6" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 characters" autoComplete={mode === 'login' ? 'current-password' : 'new-password'}/></label>{error && <div className="form-error">{error}</div>}{message && <div className="form-success">{message}</div>}<button className="primary auth-submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button></form><button className="auth-switch" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setMessage(''); }}>{mode === 'login' ? 'Need an account? Create one' : 'Already have an account? Sign in'}</button></div></div>;
}

function App() {
  const mapEl = useRef(null), map = useRef(null), markers = useRef(new Map());
  const [sessionUser, setSessionUser] = useState(null), [profile, setProfile] = useState(null), [authLoading, setAuthLoading] = useState(true);
  const [facilities, setFacilities] = useState([]), [selected, setSelected] = useState(null), [query, setQuery] = useState('');
  const [showAdd, setShowAdd] = useState(false), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [message, setMessage] = useState('');
  const [form, setForm] = useState(emptyForm), [sidebarOpen, setSidebarOpen] = useState(true), [accountOpen, setAccountOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSessionUser(data.session?.user || null); setAuthLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => { setSessionUser(session?.user || null); if (!session) setProfile(null); });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!sessionUser) return;
    let alive = true;
    (async () => { const { data } = await supabase.from('profiles').select('*').eq('id', sessionUser.id).maybeSingle(); if (alive) setProfile(data || null); })();
    return () => { alive = false; };
  }, [sessionUser]);

  useEffect(() => {
    if (!sessionUser) return;
    if (map.current || !mapEl.current) return;
    map.current = L.map(mapEl.current, { zoomControl: false, minZoom: 3, maxZoom: 19 }).setView(CENTER, 4);
    L.control.zoom({ position: 'bottomright' }).addTo(map.current);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map.current);
    setTimeout(() => map.current?.invalidateSize(), 100);
    return () => { map.current?.remove(); map.current = null; };
  }, [sessionUser]);

  useEffect(() => {
    if (!sessionUser) return;
    load();
    const ch = supabase.channel('facility-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'facilities' }, load).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [sessionUser]);

  useEffect(() => {
    markers.current.forEach(m => m.remove()); markers.current.clear();
    if (!map.current) return;
    facilities.filter(f => Number.isFinite(Number(f.latitude)) && Number.isFinite(Number(f.longitude))).forEach(f => {
      const c = f.facility_type === 'receiver' ? '#7c3aed' : f.facility_type === 'both' ? '#059669' : '#2563eb';
      const icon = L.divIcon({ className: 'facility-marker-wrap', html: `<div class="facility-marker" style="--marker-color:${c}"></div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
      const m = L.marker([Number(f.latitude), Number(f.longitude)], { icon }).addTo(map.current); m.bindTooltip(f.name, { direction: 'top', offset: [0, -12] }); m.on('click', () => focus(f)); markers.current.set(f.id, m);
    });
  }, [facilities]);

  async function load() {
    const first = facilities.length === 0; if (first) setLoading(true);
    const { data, error } = await supabase.from('facilities').select('*').order('name');
    if (error) setMessage(`Could not load facilities: ${error.message}`); else setFacilities(data || []); setLoading(false);
  }
  function focus(f) { setSelected(f); setQuery(f.name || ''); setSidebarOpen(false); if (Number.isFinite(Number(f.latitude)) && Number.isFinite(Number(f.longitude))) { map.current?.flyTo([Number(f.latitude), Number(f.longitude)], 15, { duration: .8 }); setTimeout(() => map.current?.invalidateSize(), 250); } }
  function resetMap() { setQuery(''); setSelected(null); setSidebarOpen(true); map.current?.flyTo(CENTER, 4, { duration: .7 }); }
  function fitAll() { const points = facilities.filter(f => Number.isFinite(Number(f.latitude)) && Number.isFinite(Number(f.longitude))).map(f => [Number(f.latitude), Number(f.longitude)]); if (points.length === 1) map.current?.flyTo(points[0], 10, { duration: .7 }); else if (points.length > 1) map.current?.fitBounds(points, { padding: [40, 40], maxZoom: 9, duration: .7 }); else setMessage('There are no mapped facilities yet.'); }

  const results = useMemo(() => { const q = norm(query); if (!q) return []; const tokens = q.split(' ').filter(Boolean); return facilities.map(f => { const name=norm(f.name), address=norm(f.address||''), city=norm(f.city||''), state=norm(f.state_code||''), zip=norm(f.zip||''); const hay=`${name} ${address} ${city} ${state} ${zip}`; const all=tokens.every(t=>hay.includes(t)); let score=0; if(all) score=name===q?100:name.startsWith(q)?80:address.startsWith(q)?65:hay.startsWith(q)?55:35; return {f,score}; }).filter(x=>x.score).sort((a,b)=>b.score-a.score||a.f.name.localeCompare(b.f.name)).slice(0,8).map(x=>x.f); }, [query,facilities]);
  async function search(e) { e?.preventDefault(); const q=query.trim(); if(!q)return; if(results[0])return focus(results[0]); setMessage('Searching the US address database…'); try { const r=await fetch(`${GEO}?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`,{headers:{Accept:'application/json'}}); if(!r.ok)throw Error('Address search is temporarily unavailable.'); const d=await r.json(); if(!d[0])throw Error('No saved facility or US address found.'); map.current?.flyTo([+d[0].lat,+d[0].lon],14,{duration:.8}); setMessage(`Map centered on ${d[0].display_name}`); } catch(err){setMessage(err.message||'Search failed.');} }
  async function geocode(address) { const r=await fetch(`${GEO}?format=jsonv2&limit=1&countrycodes=us&addressdetails=1&q=${encodeURIComponent(address)}`,{headers:{Accept:'application/json'}}); if(!r.ok)throw Error('Address lookup is temporarily unavailable. Please try again.'); const d=await r.json(); if(!d[0])throw Error('Address not found. Enter a complete US street address, city, state, or ZIP.'); const a=d[0].address||{},iso=(a['ISO3166-2-lvl4']||'').split('-')[1]||''; return {address:address.trim(),city:a.city||a.town||a.village||a.municipality||'',state_code:(a.state_code||iso||'').toUpperCase().slice(0,2),zip:a.postcode||'',latitude:+d[0].lat,longitude:+d[0].lon}; }
  function duplicateFor(name,location,id){return facilities.find(f=>f.id!==id&&(norm(f.name)===norm(name)||(Number.isFinite(Number(f.latitude))&&Math.abs(Number(f.latitude)-location.latitude)<.0005&&Math.abs(Number(f.longitude)-location.longitude)<.0005)));}
  function payloadFrom(values,location){return {name:values.name.trim(),facility_type:values.facility_type,...location,phone:values.phone.trim()||null,hours:values.hours.trim()||null,parking:values.parking||'Unknown',lumper:values.lumper||'Unknown',appointment:values.appointment||'Unknown',average_wait_minutes:values.average_wait_minutes===''?null:Math.max(0,Math.round(Number(values.average_wait_minutes))),driver_instructions:values.notes.trim()||null,public_visible:true,organization_id:ORG_ID,created_by:sessionUser?.id||null};}
  async function add(e){e.preventDefault();setSaving(true);setMessage('');try{const values={...form,name:form.name.trim(),address:form.address.trim()};if(!values.name)throw Error('Facility name is required.');if(!values.address)throw Error('Street address is required.');const location=await geocode(values.address);const duplicate=duplicateFor(values.name,location);if(duplicate)throw Error(`A facility already exists here: ${duplicate.name}`);const {data,error}=await supabase.from('facilities').insert(payloadFrom(values,location)).select().single();if(error)throw error;setFacilities(x=>[...x,data].sort((a,b)=>a.name.localeCompare(b.name)));setShowAdd(false);setForm(emptyForm);setMessage('Facility added successfully.');focus(data);}catch(err){setMessage(err.message||'Could not save facility.');}finally{setSaving(false);}}
  async function updateFacility(id,values){const name=values.name.trim();if(!name)throw Error('Facility name is required.');const location=await geocode(values.address.trim());const duplicate=duplicateFor(name,location,id);if(duplicate)throw Error(`Another facility already exists here: ${duplicate.name}`);const {data,error}=await supabase.from('facilities').update({...payloadFrom({...values,name,address:location.address},location)}).eq('id',id).select().single();if(error)throw error;setFacilities(x=>x.map(v=>v.id===id?data:v).sort((a,b)=>a.name.localeCompare(b.name)));setSelected(data);setMessage('Facility updated successfully.');}
  async function saveNotes(f,notes){const {data,error}=await supabase.from('facilities').update({driver_instructions:notes.trim()||null}).eq('id',f.id).select().single();if(error){setMessage(error.message);return false;}setFacilities(x=>x.map(v=>v.id===f.id?data:v));setSelected(data);setMessage('Driver notes saved.');return true;}
  async function signOut(){await supabase.auth.signOut();setAccountOpen(false);}

  if(authLoading)return <div className="auth-screen"><div className="auth-card"><div className="loading">Loading…</div></div></div>;
  if(!sessionUser)return <AuthScreen onAuth={setSessionUser}/>;

  return <div className="app"><header><div className="brand"><button className="mobile-menu" onClick={()=>setSidebarOpen(v=>!v)} aria-label="Toggle facility list">☰</button><div className="logo">FBK</div><div><b>FBK KAUNAS LOGISTICS</b><small>USA Shipping & Receiving Facility Map</small></div></div><div className="head-right"><span className="facility-count"><b>{facilities.length}</b> facilities</span><button className="secondary header-secondary" onClick={fitAll}>Fit all</button><button className="primary" onClick={()=>setShowAdd(true)}>+ Add Facility</button><div className="account-wrap"><button className="account-button" onClick={()=>setAccountOpen(v=>!v)}><span className="avatar">{(profile?.full_name||sessionUser.email||'U').slice(0,1).toUpperCase()}</span><span className="account-text"><b>{profile?.full_name||sessionUser.email}</b><small>{roleLabel(profile?.role)}</small></span>⌄</button>{accountOpen&&<div className="account-menu"><div><b>{profile?.full_name||sessionUser.email}</b><small>{sessionUser.email}</small><em>{roleLabel(profile?.role)}</em></div><button onClick={signOut}>Sign out</button></div>}</div></div></header><main><aside className={sidebarOpen?'open':''}><form className="search" onSubmit={search}><label>Find a facility</label><div className="search-row"><input aria-label="Search facilities" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Name, street, city or ZIP…"/><button type="submit" aria-label="Search">⌕</button></div>{results.length>0&&<div className="results">{results.map(f=><button type="button" key={f.id} onClick={()=>focus(f)}><i className={f.facility_type}/><span><b>{f.name}</b><small>{f.address}{f.city?` · ${f.city}, ${f.state_code||''}`:''}</small></span></button>)}</div>}</form><div className="list-head"><b>Facilities</b><button onClick={resetMap}>Reset map</button></div><div className="legend"><span><i className="shipping"/>Shipping</span><span><i className="receiving"/>Receiving</span><span><i className="both"/>Both</span></div><section className="list">{loading?<p className="loading">Loading facilities…</p>:facilities.length===0?<div className="empty"><strong>No facilities yet</strong><span>Add the first location to the map.</span><button className="secondary" onClick={()=>setShowAdd(true)}>Add first facility</button></div>:facilities.map(f=><button className={`card ${selected?.id===f.id?'active':''}`} key={f.id} onClick={()=>focus(f)}><em className={f.facility_type}>{typeLabel(f.facility_type)}</em><b>{f.name}</b><span>{f.address}</span><small>{f.city}{f.state_code?`, ${f.state_code}`:''}{f.zip?` ${f.zip}`:''}</small></button>)}</section></aside><div className="map-wrap"><div ref={mapEl} className="map"/><div className="badge">● Live facility map</div>{message&&<div className="toast" role="status">{message}<button onClick={()=>setMessage('')} aria-label="Close message">×</button></div>}{selected&&<Panel f={selected} close={()=>setSelected(null)} save={saveNotes} update={updateFacility}/>}</div></main>{showAdd&&<FacilityModal title="Add a facility" form={form} setForm={setForm} saving={saving} onClose={()=>setShowAdd(false)} onSubmit={add}/>}</div>;
}

function FacilityFields({form,setForm}){const set=(key,value)=>setForm({...form,[key]:value});return <><label>Facility name<input required value={form.name} onChange={e=>set('name',e.target.value)} placeholder="Distribution Center" autoFocus/></label><label>Facility type<select value={form.facility_type} onChange={e=>set('facility_type',e.target.value)}><option value="shipper">Shipping</option><option value="receiver">Receiving</option><option value="both">Shipping + Receiving</option></select></label><label>Street address<input required value={form.address} onChange={e=>set('address',e.target.value)} placeholder="123 Main St, Dallas, TX 75201"/></label><div className="two-col"><label>Phone<input value={form.phone} onChange={e=>set('phone',e.target.value)} placeholder="(555) 123-4567"/></label><label>Hours<input value={form.hours} onChange={e=>set('hours',e.target.value)} placeholder="Mon-Fri 06:00-22:00"/></label></div><div className="three-col"><label>Parking<select value={form.parking} onChange={e=>set('parking',e.target.value)}><option>Yes</option><option>No</option><option>Limited</option><option>Unknown</option></select></label><label>Lumper<select value={form.lumper} onChange={e=>set('lumper',e.target.value)}><option>Yes</option><option>No</option><option>Unknown</option></select></label><label>Appointment<select value={form.appointment} onChange={e=>set('appointment',e.target.value)}><option>Required</option><option>Recommended</option><option>Not required</option><option>Unknown</option></select></label></div><label>Average wait time (minutes)<input type="number" min="0" step="1" value={form.average_wait_minutes} onChange={e=>set('average_wait_minutes',e.target.value)} placeholder="e.g. 120"/></label><label>Driver notes<textarea rows="5" value={form.notes} onChange={e=>set('notes',e.target.value)} placeholder="Gate, check-in, parking, lumper, appointment, arrival instructions…"/></label></>}
function FacilityModal({title,form,setForm,saving,onClose,onSubmit}){return <div className="overlay"><form className="modal" onSubmit={onSubmit}><button type="button" className="close" onClick={onClose} aria-label="Close">×</button><h2>{title}</h2><p>Enter the facility details. The street address will be located automatically on the US map.</p><FacilityFields form={form} setForm={setForm}/><div className="actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={saving}>{saving?'Locating & saving…':'Save facility'}</button></div></form></div>}
function Panel({f,close,save,update}){const [notes,setNotes]=useState(f.driver_instructions||''),[editNotes,setEditNotes]=useState(false),[editDetails,setEditDetails]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');const makeDetails=()=>({name:f.name||'',facility_type:f.facility_type||'shipper',address:f.address||'',phone:f.phone||'',hours:f.hours||'',parking:f.parking||'Unknown',lumper:f.lumper||'Unknown',appointment:f.appointment||'Unknown',average_wait_minutes:f.average_wait_minutes??'',notes:f.driver_instructions||''});const [details,setDetails]=useState(makeDetails);useEffect(()=>{setNotes(f.driver_instructions||'');setDetails(makeDetails());setError('');setEditNotes(false);setEditDetails(false)},[f.id,f.name,f.address,f.phone,f.hours,f.parking,f.lumper,f.appointment,f.average_wait_minutes,f.driver_instructions]);const set=(key,value)=>setDetails(v=>({...v,[key]:value}));async function doUpdate(){try{setSaving(true);setError('');await update(f.id,details);setEditDetails(false)}catch(e){setError(e.message||'Could not update facility.')}finally{setSaving(false)}}async function doNotes(){setSaving(true);setError('');const ok=await save(f,notes);setSaving(false);if(ok)setEditNotes(false);else setError('Could not save notes.')}return <div className="panel"><div className="panel-top"><em className={f.facility_type}>{typeLabel(f.facility_type)}</em><button className="close" onClick={close} aria-label="Close facility">×</button></div>{editDetails?<><h2>Edit facility</h2><p className="edit-hint">Your account is identified on changes.</p><div className="panel-form"><label>Facility name<input value={details.name} onChange={e=>set('name',e.target.value)}/></label><label>Facility type<select value={details.facility_type} onChange={e=>set('facility_type',e.target.value)}><option value="shipper">Shipping</option><option value="receiver">Receiving</option><option value="both">Shipping + Receiving</option></select></label><label>Address<input value={details.address} onChange={e=>set('address',e.target.value)}/></label><div className="two-col"><label>Phone<input value={details.phone} onChange={e=>set('phone',e.target.value)}/></label><label>Hours<input value={details.hours} onChange={e=>set('hours',e.target.value)}/></label></div><div className="three-col"><label>Parking<select value={details.parking} onChange={e=>set('parking',e.target.value)}><option>Yes</option><option>No</option><option>Limited</option><option>Unknown</option></select></label><label>Lumper<select value={details.lumper} onChange={e=>set('lumper',e.target.value)}><option>Yes</option><option>No</option><option>Unknown</option></select></label><label>Appointment<select value={details.appointment} onChange={e=>set('appointment',e.target.value)}><option>Required</option><option>Recommended</option><option>Not required</option><option>Unknown</option></select></label></div><label>Average wait time (minutes)<input type="number" min="0" value={details.average_wait_minutes} onChange={e=>set('average_wait_minutes',e.target.value)}/></label><label>Driver notes<textarea rows="6" value={details.notes} onChange={e=>set('notes',e.target.value)}/></label></div>{error&&<div className="form-error">{error}</div>}<div className="actions"><button className="secondary" onClick={()=>setEditDetails(false)}>Cancel</button><button className="primary" disabled={saving} onClick={doUpdate}>{saving?'Locating & saving…':'Save facility'}</button></div></>:<><h2>{f.name}</h2><p className="address">{f.address}</p><small>{f.city}{f.state_code?`, ${f.state_code}`:''}{f.zip?` ${f.zip}`:''}</small><div className="quick-actions"><button onClick={()=>setEditDetails(true)}>Edit details</button><button onClick={()=>navigator.clipboard?.writeText(`${f.name}\n${f.address}, ${f.city||''}, ${f.state_code||''} ${f.zip||''}`)}>Copy address</button></div><div className="info-grid"><Info label="Phone" value={f.phone} link={f.phone?`tel:${f.phone.replace(/[^\d+]/g,'')}`:null}/><Info label="Hours" value={f.hours}/><Info label="Parking" value={f.parking}/><Info label="Lumper" value={f.lumper}/><Info label="Appointment" value={f.appointment}/><Info label="Avg. wait" value={waitLabel(f.average_wait_minutes)}/></div><hr/><div className="notes-title"><b>Driver notes</b>{!editNotes&&<button onClick={()=>setEditNotes(true)}>Edit</button>}</div>{editNotes?<><textarea value={notes} onChange={e=>setNotes(e.target.value)} rows="7"/><div className="actions"><button className="secondary" onClick={()=>{setNotes(f.driver_instructions||'');setEditNotes(false)}}>Cancel</button><button className="primary" disabled={saving} onClick={doNotes}>{saving?'Saving…':'Save notes'}</button></div></>:<p className={!f.driver_instructions?'muted':''}>{f.driver_instructions||'No notes yet. Add gate, parking, check-in, appointment, lumper, or other driver instructions.'}</p>}<button className="directions" onClick={()=>window.open(`https://www.google.com/maps/dir/?api=1&destination=${f.latitude},${f.longitude}`,'_blank','noopener,noreferrer')}>Open directions ↗</button></>}</div>}
function Info({label,value,link}){return <div className="info-item"><span>{label}</span>{link?<a href={link}>{value}</a>:<b className={!value?'unknown':''}>{value||'Not reported'}</b>}</div>}
createRoot(document.getElementById('root')).render(<App/>);
