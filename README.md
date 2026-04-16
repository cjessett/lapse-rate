# Lapse Rate Calculator

A weather tool for pilots, paragliders, hang gliders, and atmospheric enthusiasts that computes the **environmental lapse rate** from the surface up to 5,000 ft MSL using real-time forecast data from [Open-Meteo](https://open-meteo.com).

## What It Does

The environmental lapse rate describes how quickly temperature drops with increasing altitude. It's a direct indicator of atmospheric stability — a steep lapse rate means unstable, convective air; a shallow rate or inversion means stable, suppressed conditions.

This calculator fetches pressure-level forecast data (1000–850 hPa) for any location and computes:

- **Mean lapse rate** from the surface to 5,000 ft MSL
- **Layer-by-layer breakdown** showing the rate between each pressure level
- **Stability category** (Inversion → Isothermal → Normal → Conditionally Unstable → Dry Adiabatic → Superadiabatic)
- **Temperature profile** (sounding) from surface to 5,000 ft
- **72-hour timeline** of how lapse rates evolve through the forecast period

## Features

- **Multiple forecast models** — compare GEFS Ensemble Mean, Best Match, and GFS HRRR side by side with colored overlays
- **°F / °C toggle** — all temperatures and lapse rates convert instantly; lapse rates display in °F/1000ft or °C/km
- **City search or GPS coordinates** — type a city name for autocomplete, or paste coordinates directly (e.g. `34.448, -119.293`)
- **Use My Location** — one-click GPS detection via the browser
- **Daylight-only time slider** — restricted to 8 AM–7 PM local time with day separators and clickable hour marks (8a, 10a, 12p, 2p, 4p, 6p)
- **Reference table** — lapse rate categories with stability descriptions

## Lapse Rate Categories

| Category | °C/km | Stability |
|---|---|---|
| Inversion | < 0 | Very stable — temperature increases with height |
| Isothermal / Weak | 0 – 3 | Stable |
| Normal | 3 – 6.5 | Standard environmental lapse rate |
| Conditionally Unstable | 6.5 – 9.8 | Unstable if saturated |
| Dry Adiabatic (DALR) | ≈ 9.8 | Neutral for unsaturated air |
| Superadiabatic | > 9.8 | Absolutely unstable |

## Data Source

All forecast data is fetched client-side from the [Open-Meteo free public API](https://open-meteo.com) — no backend or API key required. Temperature and geopotential height are retrieved at pressure levels 1000, 975, 950, 925, 900, 875, and 850 hPa. Lapse rate is calculated as −ΔT/Δz for each layer within the 0–5,000 ft MSL column.

## Tech Stack

- **React + Vite** (TypeScript)
- **Recharts** — lapse rate timeline and temperature profile sounding
- **Tailwind CSS** — dark atmospheric theme
- **Open-Meteo API** — forecast data and geocoding
