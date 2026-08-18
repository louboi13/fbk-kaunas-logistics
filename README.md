# FBK Kaunas Logistics

Map-first USA shipping and receiving facility directory.

## Current version
- USA map opens as the main workspace.
- Facilities are stored in Supabase and update in realtime.
- Anyone can add a shipping, receiving, or combined facility.
- Facility addresses are geocoded automatically.
- Search matches saved facilities by name, address, city, state, or ZIP.
- If a saved facility is not found, the search can geocode a US address and center the map there.
- Clicking a search result or map marker zooms to the facility.
- Driver notes can be edited from the facility panel.
- Google Maps directions can be opened from a facility.

## Stack
Vite + React + Leaflet + Supabase + OpenStreetMap/Nominatim.
