# FBK Kaunas Logistics

Map-first USA shipping and receiving facility directory.

## Current version
- USA map opens as the main workspace.
- Facilities are stored in Supabase and update in realtime.
- Anyone can add a shipping, receiving, or combined facility.
- Facility addresses are geocoded automatically.
- Search matches saved facilities by name, address, city, state, or ZIP.
- Search also falls back to US address geocoding when no saved facility matches.
- Selecting a facility flies directly to its coordinates.
- Map markers use clustered, chunked rendering so the map stays responsive as the dataset grows.
- The sidebar renders a bounded result set instead of thousands of DOM rows.
- Facility details include phone, hours, parking, lumper, appointment, wait time and driver instructions.
- Facilities can be edited and duplicate locations are rejected.
- Google Maps directions can be opened from a facility.
- Account login/signup is optional for browsing; Vercel collaborators are not required.

## Stack
Vite + React + Leaflet + Supabase + OpenStreetMap/Nominatim.
