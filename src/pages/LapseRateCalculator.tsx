
import { useState, useCallback, useRef } from "react";
import { ChevronDown, LocateFixed } from "lucide-react";

import {
  LineChart, Line, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend, Customized,
} from "recharts";
import {
  fetchForecast, geocodeLocation, categorizeLapseRate, formatLocalTime,
  ForecastResult, LapseRateResult, FT_PER_METER,
  MODELS, MODEL_COLORS, ModelKey, DEFAULT_MODEL,
} from "@/lib/openmeteo";
import { AreaForecastDiscussion, fetchAreaForecastDiscussion } from "@/lib/nws";

// ─── unit helpers ──────────────────────────────────────────────────────────────

function cToF(c: number) { return c * 9 / 5 + 32; }
function lrToF(lrCperKm: number) { return lrCperKm * 1.8 / FT_PER_METER; }
function kmhToMph(kmh: number) { return kmh * 0.621371; }
function kmhToKnots(kmh: number) { return kmh * 0.539957; }
function roundToNearest500(value: number) { return Math.round(value / 500) * 500; }
function cardinalFromDegrees(deg: number) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

function WindBarb({
  x,
  y,
  speedKmh,
  directionDeg,
  color,
}: {
  x: number;
  y: number;
  speedKmh: number;
  directionDeg: number;
  color: string;
}) {
  const speedKt = Math.max(0, kmhToKnots(speedKmh));
  let remaining = Math.round(speedKt / 5) * 5;
  const shaftLength = 22;
  const step = 4;
  const barbLength = 10;
  const children: JSX.Element[] = [
    <line key="shaft" x1="0" y1="0" x2="0" y2={-shaftLength} stroke={color} strokeWidth="1.5" strokeLinecap="round" />,
  ];

  let cursor = -shaftLength;
  let key = 0;

  while (remaining >= 50) {
    children.push(
      <polygon
        key={`flag-${key++}`}
        points={`0,${cursor} 10,${cursor + 3} 0,${cursor + 6}`}
        fill={color}
      />,
    );
    remaining -= 50;
    cursor += 6;
  }

  while (remaining >= 10) {
    children.push(
      <line
        key={`full-${key++}`}
        x1="0"
        y1={cursor}
        x2={barbLength}
        y2={cursor - 4}
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
      />,
    );
    remaining -= 10;
    cursor += step;
  }

  if (remaining >= 5) {
    children.push(
      <line
        key={`half-${key++}`}
        x1="0"
        y1={cursor}
        x2={barbLength * 0.6}
        y2={cursor - 2.5}
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
      />,
    );
  }

  return (
    <g transform={`translate(${x}, ${y}) rotate(${directionDeg})`}>
      {children}
    </g>
  );
}

interface WindBarbLayerProps {
  offset?: { left: number; top: number; width: number; height: number };
  yAxisMap?: Record<string | number, { scale: (value: number) => number }>;
  points: ProfilePoint[];
  color: string;
  xOffset?: number;
}

function WindBarbLayer({ offset, yAxisMap, points, color, xOffset = 0 }: WindBarbLayerProps) {
  if (!offset || !yAxisMap) return null;
  const firstYAxis = Object.values(yAxisMap)[0];
  if (!firstYAxis) return null;
  const x = offset.left + offset.width - 14 + xOffset;
  const yLift = 15

  return (
    <g>
      {points
        .filter((point) => point.windSpeed != null && point.windDirection != null)
        .map((point) => (
          <WindBarb
            key={`${point.label}-${point.heightFt}`}
            x={x}
            y={firstYAxis.scale(point.heightFt) - yLift}
            speedKmh={point.windSpeed!}
            directionDeg={point.windDirection!}
            color={color}
          />
        ))}
    </g>
  );
}

// ─── GPS helper ────────────────────────────────────────────────────────────────

function parseCoords(value: string): { lat: number; lon: number } | null {
  const m = value.trim().match(/^([-+]?\d+(?:\.\d+)?)[,\s]+([-+]?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lon = parseFloat(m[2]);
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

// ─── sub-components ────────────────────────────────────────────────────────────

const DRY_ADIABATIC_C_PER_KM = 9.8;

function UnitToggle({ fahrenheit, onChange }: { fahrenheit: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center rounded-lg border border-border bg-background overflow-hidden text-xs font-semibold">
      <button onClick={() => onChange(true)} className={`px-3 py-1.5 transition-colors ${fahrenheit ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>°F</button>
      <button onClick={() => onChange(false)} className={`px-3 py-1.5 transition-colors ${!fahrenheit ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>°C</button>
    </div>
  );
}

function LapseRateGauge({ lrKm, fahrenheit }: { lrKm: number; fahrenheit: boolean }) {
  const cat = categorizeLapseRate(lrKm);
  const min = -3; const max = 12;
  const pct = Math.min(Math.max(((lrKm - min) / (max - min)) * 100, 0), 100);
  const displayVal = fahrenheit ? lrToF(lrKm) : lrKm;
  const displayUnit = fahrenheit ? "°F/1000ft" : "°C/km";
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold px-2 py-0.5 rounded-full" style={{ background: cat.color + "22", color: cat.color }}>{cat.label}</span>
        <span className="text-2xl font-bold tabular-nums" style={{ color: cat.color }}>
          {displayVal.toFixed(2)}<span className="text-sm font-normal text-muted-foreground ml-1">{displayUnit}</span>
        </span>
      </div>
      <div className="relative h-3 rounded-full overflow-hidden bg-muted">
        <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: cat.color }} />
        <div className="absolute inset-y-0 w-0.5 bg-white/70" style={{ left: `${(((DRY_ADIABATIC_C_PER_KM - min) / (max - min)) * 100).toFixed(1)}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">{cat.description}</p>
    </div>
  );
}

interface ProfilePoint {
  heightFt: number;
  temp: number;
  label: string;
  windSpeed?: number;
  windDirection?: number;
}

function TemperatureProfileChart({
  forecasts, selectedModels, selectedHourIndex, elevationM, fahrenheit,
}: {
  forecasts: Partial<Record<ModelKey, ForecastResult>>;
  selectedModels: ModelKey[];
  selectedHourIndex: number;
  elevationM: number;
  fahrenheit: boolean;
}) {
  const unit = fahrenheit ? "°F" : "°C";
  const convert = (c: number) => fahrenheit ? +cToF(c).toFixed(1) : +c.toFixed(1);

  const modelPoints: { model: ModelKey; points: ProfilePoint[] }[] = selectedModels
    .map((model) => {
      const entry = forecasts[model]?.hourlyData[selectedHourIndex];
      if (!entry) return null;
      const pts: ProfilePoint[] = [
        { heightFt: Math.round(elevationM * FT_PER_METER), temp: convert(entry.surfaceTemp), label: "Surface (2m)" },
        ...entry.layers.map((l) => ({
          heightFt: Math.round(l.geopotentialHeight * FT_PER_METER),
          temp: convert(l.temperature),
          label: `${l.level} hPa`,
          windSpeed: l.windSpeed,
          windDirection: l.windDirection,
        })),
      ].sort((a, b) => a.heightFt - b.heightFt);
      return { model, points: pts };
    })
    .filter((x): x is { model: ModelKey; points: ProfilePoint[] } => x !== null);

  const allTemps = modelPoints.flatMap(({ points }) => points.map((point) => point.temp));
  const warmEdge = allTemps.length > 0 ? Math.max(...allTemps) : undefined;
  const xDomain: [number | "auto", number | "auto"] = ["auto", warmEdge != null ? warmEdge + 6 : "auto"];

  const freezingX = fahrenheit ? 32 : 0;

  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: { payload: ProfilePoint; fill: string }[] }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-lg border border-border bg-card p-2 text-xs shadow-lg space-y-1">
        <p className="font-semibold text-foreground mb-1">{payload[0].payload.heightFt.toLocaleString()} ft MSL</p>
        {payload.map((p, i) => (
          <p key={i} style={{ color: p.fill }}>
            {p.payload.label}: {p.payload.temp}{unit}
            {p.payload.windSpeed != null && p.payload.windDirection != null ? ` · ${Math.round(kmhToMph(p.payload.windSpeed))} mph ${cardinalFromDegrees(p.payload.windDirection)}` : ""}
          </p>
        ))}
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ScatterChart margin={{ left: 0, right: 16, top: 8, bottom: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          type="number"
          dataKey="temp"
          name="Temperature"
          domain={xDomain}
          tickFormatter={(v) => `${v}${unit}`}
          tick={{ fontSize: 11 }}
          stroke="hsl(var(--muted-foreground))"
          label={{ value: `Temperature (${unit})`, position: "insideBottom", offset: -12, fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
        />
        <YAxis
          type="number"
          dataKey="heightFt"
          name="Altitude"
          domain={[0, 5200]}
          tickFormatter={(v) => `${v.toLocaleString()}ft`}
          tick={{ fontSize: 11 }}
          stroke="hsl(var(--muted-foreground))"
          width={72}
          label={{ value: "Altitude (ft MSL)", angle: -90, position: "insideLeft", offset: 16, fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
        />
        <Tooltip content={<CustomTooltip />} />
        {selectedModels.length > 1 && (
          <Legend
            formatter={(value) => MODELS[value as ModelKey]?.shortLabel ?? value}
            wrapperStyle={{ fontSize: 11 }}
          />
        )}
        <ReferenceLine x={freezingX} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 2" label={{ value: `${freezingX}${unit}`, position: "insideTopRight", fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
        {modelPoints.map(({ model, points }) => (
          <Scatter
            key={model}
            name={model}
            data={points}
            fill={MODEL_COLORS[model]}
            line={{ stroke: MODEL_COLORS[model], strokeWidth: 2.5 }}
            lineType="joint"
          />
        ))}
        {modelPoints.map(({ model, points }, index) => (
          <Customized
            key={`${model}-wind-barbs`}
            component={<WindBarbLayer points={points} color={MODEL_COLORS[model]} xOffset={-index * 14} />}
          />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function LapseRateTimelineChart({
  forecasts, selectedModels, fahrenheit,
}: {
  forecasts: Partial<Record<ModelKey, ForecastResult>>;
  selectedModels: ModelKey[];
  fahrenheit: boolean;
}) {
  const dalr = fahrenheit ? lrToF(DRY_ADIABATIC_C_PER_KM) : DRY_ADIABATIC_C_PER_KM;
  const unit = fahrenheit ? "°F/1000ft" : "°C/km";

  // Build merged time series — use first available model as time index
  const primary = selectedModels.find((m) => forecasts[m]);
  if (!primary) return null;

  const chartData = forecasts[primary]!.hourlyData.map((d, i) => {
    const row: Record<string, number | string> = { time: formatLocalTime(d.time) };
    for (const model of selectedModels) {
      const entry = forecasts[model]?.hourlyData[i];
      if (entry) {
        const lr = fahrenheit ? lrToF(entry.meanLapseRateCperKm) : entry.meanLapseRateCperKm;
        row[model] = +lr.toFixed(2);
      }
    }
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={chartData} margin={{ left: 0, right: 16, top: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" stroke="hsl(var(--muted-foreground))" />
        <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `${v}`} width={52} />
        <Tooltip
          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
          formatter={(val: number, name: string) => [`${val} ${unit}`, MODELS[name as ModelKey]?.shortLabel ?? name]}
        />
        <ReferenceLine y={dalr} stroke="#f97316" strokeDasharray="4 2" label={{ value: `DALR ${dalr.toFixed(2)}`, position: "insideTopRight", fontSize: 10, fill: "#f97316" }} />
        <ReferenceLine y={fahrenheit ? lrToF(6.5) : 6.5} stroke="#eab308" strokeDasharray="4 2" label={{ value: (fahrenheit ? lrToF(6.5) : 6.5).toFixed(2), position: "insideTopRight", fontSize: 10, fill: "#eab308" }} />
        <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 2" />
        {selectedModels.map((model) =>
          forecasts[model] ? (
            <Line key={model} type="monotone" dataKey={model} stroke={MODEL_COLORS[model]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} name={model} />
          ) : null
        )}
        {selectedModels.length > 1 && (
          <Legend formatter={(v) => MODELS[v as ModelKey]?.shortLabel ?? v} wrapperStyle={{ fontSize: 11 }} />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── main component ────────────────────────────────────────────────────────────

type GeoResult = { name: string; latitude: number; longitude: number; country: string; admin1?: string };

export default function LapseRateCalculator() {
  const [query, setQuery] = useState("");
  const [geoResults, setGeoResults] = useState<GeoResult[]>([]);
  const [coordsFromQuery, setCoordsFromQuery] = useState<{ lat: number; lon: number } | null>(null);
  const [currentLocation, setCurrentLocation] = useState<{ name: string; lat: number; lon: number } | null>(null);
  const [isLocationSearchOpen, setIsLocationSearchOpen] = useState(true);
  const [selectedModels, setSelectedModels] = useState<Set<ModelKey>>(new Set([DEFAULT_MODEL]));
  const [forecasts, setForecasts] = useState<Partial<Record<ModelKey, ForecastResult>>>({});
  const [loadingModels, setLoadingModels] = useState<Set<ModelKey>>(new Set());
  const [modelErrors, setModelErrors] = useState<Partial<Record<ModelKey, string>>>({});
  const [sliderPos, setSliderPos] = useState(0);
  const [geocoding, setGeocoding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [fahrenheit, setFahrenheit] = useState(true);
  const [afd, setAfd] = useState<AreaForecastDiscussion | null>(null);
  const [afdError, setAfdError] = useState<string | null>(null);
  const [afdLoading, setAfdLoading] = useState(false);
  const [isAfdOpen, setIsAfdOpen] = useState(false);
  const geocodeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const afdRequestId = useRef(0);

  const fetchModel = useCallback(async (lat: number, lon: number, model: ModelKey) => {
    setLoadingModels((prev) => new Set([...prev, model]));
    setModelErrors((prev) => { const n = { ...prev }; delete n[model]; return n; });
    try {
      const result = await fetchForecast(lat, lon, model);
      setForecasts((prev) => ({ ...prev, [model]: result }));
    } catch (e: unknown) {
      setModelErrors((prev) => ({ ...prev, [model]: e instanceof Error ? e.message : "Failed" }));
    } finally {
      setLoadingModels((prev) => { const n = new Set(prev); n.delete(model); return n; });
    }
  }, []);

  const loadLocation = useCallback(async (lat: number, lon: number, name: string, displayQuery: string) => {
    setShowDropdown(false);
    setGeoResults([]);
    setCoordsFromQuery(null);
    setError(null);
    setForecasts({});
    setModelErrors({});
    setCurrentLocation({ name, lat, lon });
    setQuery(displayQuery);
    setIsLocationSearchOpen(false);
    setSliderPos(4);
    setAfd(null);
    setAfdError(null);
    setAfdLoading(true);
    setIsAfdOpen(false);
    afdRequestId.current += 1;
    const requestId = afdRequestId.current;
    // Fetch all currently selected models in parallel
    const models = Array.from(selectedModels);
    models.forEach((m) => fetchModel(lat, lon, m));
    fetchAreaForecastDiscussion(lat, lon)
      .then((discussion) => {
        if (requestId === afdRequestId.current) setAfd(discussion);
      })
      .catch((e: unknown) => {
        if (requestId === afdRequestId.current) {
          console.log('error', e)
          setAfdError(e instanceof Error ? e.message : "Failed to load Area Forecast Discussion");
        }
      })
      .finally(() => {
        if (requestId === afdRequestId.current) setAfdLoading(false);
      });
  }, [selectedModels, fetchModel]);

  const toggleModel = useCallback((model: ModelKey, checked: boolean) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (checked) { next.add(model); } else { next.delete(model); }
      return next;
    });
    // If adding and we have a location but no data yet, fetch it
    if (checked && currentLocation && !forecasts[model]) {
      fetchModel(currentLocation.lat, currentLocation.lon, model);
    }
  }, [currentLocation, forecasts, fetchModel]);

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    if (geocodeTimeout.current) clearTimeout(geocodeTimeout.current);
    const coords = parseCoords(value);
    if (coords) {
      setCoordsFromQuery(coords); setGeoResults([]); setShowDropdown(true); return;
    }
    setCoordsFromQuery(null);
    if (value.trim().length < 2) { setGeoResults([]); setShowDropdown(false); return; }
    geocodeTimeout.current = setTimeout(async () => {
      setGeocoding(true);
      try {
        const results = await geocodeLocation(value);
        setGeoResults(results); setShowDropdown(results.length > 0);
      } catch { /* ignore */ } finally { setGeocoding(false); }
    }, 400);
  }, []);

  const handleUseMyLocation = useCallback(async () => {
    if (!navigator.geolocation) { setError("Geolocation not supported"); return; }
    setError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        await loadLocation(latitude, longitude, "Your Location", `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
      },
      () => { setError("Could not get your location. Please search for a place."); }
    );
  }, [loadLocation]);

  const handleUseSB = useCallback(async () => {
    const latitude = 34.4811;
    const longitude = -119.6845;
    await loadLocation(latitude, longitude, "Santa Barbara", `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
  }, [loadLocation]);

  const isLoading = loadingModels.size > 0;
  const selectedModelsArr = Array.from(selectedModels);

  // Primary model for single-model displays (first selected that has data)
  const primaryModel = selectedModelsArr.find((m) => forecasts[m]) ?? selectedModelsArr[0];
  const primaryForecast = forecasts[primaryModel];

  // Restrict slider to daylight hours (8 am – 7 pm local time in the forecast data)
  const daylightIndices: number[] = primaryForecast
    ? primaryForecast.hourlyData.reduce<number[]>((acc, d, i) => {
        const h = parseInt(d.time.substring(11, 13), 10);
        if (h >= 8 && h <= 17) acc.push(i);
        return acc;
      }, [])
    : [];
  const selectedHourIndex = daylightIndices[sliderPos] ?? 0;
  const currentEntry = primaryForecast?.hourlyData[selectedHourIndex];

  // Build day-group headers and clickable time marks from daylightIndices
const KEY_HOURS = [8, 10, 12, 14, 16];
const todayStr = new Date().toLocaleDateString().substring(0, 10);
const dayGroups: { date: string; label: string; startPos: number; count: number }[] = [];
const timeMarks: { sliderPos: number; label: string }[] = [];
if (primaryForecast) {
  let curDay = "";
  daylightIndices.forEach((actualIdx, sp) => {
    const t = primaryForecast.hourlyData[actualIdx].time;
    const date = t.substring(0, 10);
    const h = parseInt(t.substring(11, 13), 10);
    if (date !== curDay) {
      curDay = date;
      const diff = Math.round((new Date(date).getTime() - new Date(todayStr).getTime()) / 86400000);

      const label = diff === 0 ? "Today" : diff === 1 ? "Tomorrow"
        : new Date(date + "T12:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
      dayGroups.push({ date, label, startPos: sp, count: 0 });
    }
    dayGroups[dayGroups.length - 1].count++;
    if (KEY_HOURS.includes(h)) {
      const label = h === 12 ? "12p" : h < 12 ? `${h}a` : `${h - 12}p`;
      timeMarks.push({ sliderPos: sp, label });
    }
  });
}

  const tempUnit = fahrenheit ? "°F" : "°C";
  const lrUnit = fahrenheit ? "°F/1000ft" : "°C/km";
  const displayTemp = (c: number) => fahrenheit ? cToF(c).toFixed(1) : c.toFixed(1);
  const displayLr = (lrKm: number) => (fahrenheit ? lrToF(lrKm) : lrKm).toFixed(2);
  const displayWind = (speed: number, direction: number) => `${Math.round(kmhToMph(speed))} mph ${cardinalFromDegrees(direction)} (${Math.round(direction)}°)`;

  const hasAnyForecast = Object.keys(forecasts).length > 0;
  const elevation = primaryForecast?.elevation ?? 0;
  const afdSections = afd
    ? [
        { title: "Synopsis", body: afd.synopsis },
        { title: "Short Term", body: afd.shortTerm },
        { title: "Long Term", body: afd.longTerm },
        { title: "Discussion", body: afd.discussion },
      ].filter((section): section is { title: string; body: string } => !!section.body)
    : [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border/60 bg-card/60 backdrop-blur sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground text-sm font-bold">Lr</div>
            <div>
              <h1 className="text-base font-bold leading-tight">Lapse Rate Calculator</h1>
              <p className="text-xs text-muted-foreground leading-tight hidden sm:block">Surface to 5,000 ft MSL · Open-Meteo Forecast</p>
            </div>
          </div>
          <UnitToggle fahrenheit={fahrenheit} onChange={setFahrenheit} />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Location + Model Selection */}
        <div className="rounded-xl border border-border bg-card px-5 py-3 shadow-sm">
          <button
            type="button"
            onClick={() => setIsLocationSearchOpen((prev) => !prev)}
            className={`-mx-4 flex w-[calc(100%+2rem)] items-center justify-between px-4 pb-3 text-left transition-colors hover:bg-muted/30 ${
              (!currentLocation || isLocationSearchOpen) ? "border-b border-border/60" : "pb-0"
            }`}
            title={isLocationSearchOpen ? "Collapse location controls" : "Expand location controls"}
            aria-label={isLocationSearchOpen ? "Collapse location controls" : "Expand location controls"}
          >
            <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Location + Models</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background transition-colors hover:bg-accent">
              <ChevronDown className={`h-4 w-4 transition-transform ${isLocationSearchOpen ? "rotate-180" : ""}`} />
            </span>
          </button>

          <div
            className={`grid overflow-hidden transition-all duration-300 ease-in-out ${
              currentLocation && !isLocationSearchOpen
                ? "grid-rows-[0fr] opacity-0 mt-0"
                : "grid-rows-[1fr] opacity-100 mt-4"
            }`}
            aria-hidden={currentLocation && !isLocationSearchOpen}
          >
            <div className="min-h-0">
              <div className="space-y-3">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={query}
                      onChange={(e) => handleQueryChange(e.target.value)}
                      onFocus={() => (geoResults.length > 0 || coordsFromQuery) && setShowDropdown(true)}
                      onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                      placeholder="City name or lat, lon (e.g. 34.448, -119.293)…"
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    {geocoding && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">…</span>}
                    {showDropdown && (coordsFromQuery || geoResults.length > 0) && (
                      <ul className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-card shadow-lg overflow-hidden">
                        {coordsFromQuery && (
                          <li
                            onMouseDown={() => loadLocation(coordsFromQuery.lat, coordsFromQuery.lon, `${coordsFromQuery.lat.toFixed(4)}, ${coordsFromQuery.lon.toFixed(4)}`, `${coordsFromQuery.lat.toFixed(4)}, ${coordsFromQuery.lon.toFixed(4)}`)}
                            className="px-3 py-2.5 text-sm cursor-pointer hover:bg-accent transition-colors flex items-center gap-2"
                          >
                            <span className="text-primary font-mono text-xs bg-primary/10 px-1.5 py-0.5 rounded">GPS</span>
                            <span><span className="font-medium">{coordsFromQuery.lat.toFixed(4)}</span><span className="text-muted-foreground">, </span><span className="font-medium">{coordsFromQuery.lon.toFixed(4)}</span></span>
                          </li>
                        )}
                        {geoResults.map((r, i) => (
                          <li key={i} onMouseDown={() => loadLocation(r.latitude, r.longitude, r.name, `${r.name}${r.admin1 ? `, ${r.admin1}` : ""}, ${r.country}`)} className="px-3 py-2 text-sm cursor-pointer hover:bg-accent transition-colors">
                            <span className="font-medium">{r.name}</span>
                            {r.admin1 && <span className="text-muted-foreground">, {r.admin1}</span>}
                            <span className="text-muted-foreground">, {r.country}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <button
                    onClick={handleUseMyLocation}
                    className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-background hover:bg-accent transition-colors"
                    title="Use my location"
                    aria-label="Use my location"
                  >
                    <LocateFixed className="h-4 w-4" />
                  </button>
                </div>
                <div>
                  <button onClick={handleUseSB} className="flex-shrink-0 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent transition-colors" title="Santa Barbara">🪂 Santa Barbara</button>
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
              </div>

              <div className="mt-4">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Forecast Models</h2>
                <div className="flex flex-wrap gap-3">
                  {(Object.entries(MODELS) as [ModelKey, { label: string; shortLabel: string }][]).map(([key, cfg]) => {
                    const checked = selectedModels.has(key);
                    const loading = loadingModels.has(key);
                    const hasError = !!modelErrors[key];
                    return (
                      <label
                        key={key}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors select-none ${checked ? "border-transparent" : "border-border bg-background hover:bg-accent"}`}
                        style={checked ? { background: MODEL_COLORS[key] + "18", borderColor: MODEL_COLORS[key] + "66" } : {}}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => toggleModel(key, e.target.checked)}
                          className="sr-only"
                        />
                        <span
                          className="w-3 h-3 rounded-sm border-2 flex items-center justify-center flex-shrink-0"
                          style={{ borderColor: MODEL_COLORS[key], background: checked ? MODEL_COLORS[key] : "transparent" }}
                        >
                          {checked && <svg className="w-2 h-2 text-white" viewBox="0 0 8 8" fill="none"><path d="M1 4l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                        </span>
                        <span className="text-sm font-medium" style={checked ? { color: MODEL_COLORS[key] } : {}}>{cfg.label}</span>
                        {loading && <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin opacity-60" style={{ color: MODEL_COLORS[key] }} />}
                        {hasError && <span className="text-destructive text-xs">!</span>}
                      </label>
                    );
                  })}
                </div>
                {Object.entries(modelErrors).map(([m, err]) => (
                  <p key={m} className="mt-1 text-xs text-destructive">{MODELS[m as ModelKey]?.label}: {err}</p>
                ))}
              </div>
            </div>
          </div>
        </div>

        {isLoading && !hasAnyForecast && (
          <div className="flex items-center justify-center py-16">
            <div className="text-center space-y-2">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm text-muted-foreground">Fetching forecast data…</p>
            </div>
          </div>
        )}

        {hasAnyForecast && currentEntry && (
          <>

            {/* AFD */}
            {(currentLocation && (afdLoading || afdError || afdSections.length > 0)) && (
              <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                <button
                  type="button"
                  onClick={() => setIsAfdOpen((prev) => !prev)}
                  className="flex w-full items-center justify-between px-5 py-3 text-left hover:bg-muted/30 transition-colors"
                >
                  <div>
                    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Area Forecast Discussion</h2>
                    <p className="text-sm text-foreground">
                      {afd ? `${afd.officeName} (${afd.officeId})` : "Nearest NWS office"}
                    </p>
                    {afd?.issuedAt && (
                      <p className="text-xs text-muted-foreground">
                        Issued {new Date(afd.issuedAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                    )}
                  </div>
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background hover:bg-accent transition-colors">
                    <ChevronDown className={`h-4 w-4 transition-transform ${isAfdOpen ? "rotate-180" : ""}`} />
                  </span>
                </button>
                <div
                  className={`grid overflow-hidden transition-all duration-400 ease-in-out ${isAfdOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
                  aria-hidden={!isAfdOpen}
                >
                  <div className="min-h-0">
                    <div className="border-t border-border/60 px-5 py-4 space-y-4">
                      {afdLoading && <p className="text-sm text-muted-foreground">Loading latest discussion from the nearest NWS office…</p>}
                      {afdError && <p className="text-sm text-destructive">{afdError}</p>}
                      {!afdLoading && !afdError && afdSections.length === 0 && (
                        <p className="text-sm text-muted-foreground">The latest AFD did not include synopsis, short term, or long term sections.</p>
                      )}
                      {afdSections.map((section) => (
                        <section key={section.title} className="space-y-1.5">
                          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{section.title}</h3>
                          <div className="text-sm leading-6 whitespace-pre-line text-foreground">
                            {section.body}
                          </div>
                        </section>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Time selector */}
            <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
              {/* Header row */}
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Forecast Hour</h2>
                <div className="flex items-center gap-2">
                  {isLoading && <span className="w-3.5 h-3.5 border border-primary border-t-transparent rounded-full animate-spin" />}
                  <span className="text-sm font-semibold">{formatLocalTime(currentEntry.time)}</span>
                </div>
              </div>
{/* Day group labels with vertical dividers */}
              <div className="flex w-full">
                {dayGroups.map((day, i) => {
                  const widthPct = (day.count / daylightIndices.length) * 100;
                  return (
                    <div
                      key={day.date}
                      className="relative text-center py-1"
                      style={{ width: `${widthPct}%` }}
                    >
                      {i > 0 && (
                        <div className="absolute left-0 top-0 bottom-0 w-px bg-border/60" />
                      )}
                      <span className="text-xs font-semibold tracking-wide" style={{ color: i === 0 ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))" }}>
                        {day.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Slider */}
              <input
                type="range"
                min={0}
                max={daylightIndices.length - 1}
                value={sliderPos}
                onChange={(e) => setSliderPos(+e.target.value)}
                className="w-full accent-primary"
              />

              {/* Clickable time marks */}
              <div className="relative h-5 select-none">
                {timeMarks.map((mark) => {
                  const pct = daylightIndices.length > 1 ? (mark.sliderPos / (daylightIndices.length - 1)) * 100 : 0;
                  const active = sliderPos === mark.sliderPos;
                  return (
                    <button
                      key={mark.sliderPos}
                      onClick={() => setSliderPos(mark.sliderPos)}
                      className={`absolute -translate-x-1/2 text-[11px] leading-none transition-colors hover:text-primary cursor-pointer ${active ? "text-primary font-bold" : "text-muted-foreground"}`}
                      style={{ left: `${pct}%` }}
                    >
                      {mark.label}
                    </button>
                  );
                })}
              </div>

              <p className="text-xs text-muted-foreground text-center">
                {currentLocation?.name} · {elevation.toFixed(0)} m elev · 8 AM – 7 PM local time
              </p>
            </div>

            {/* Lapse rate cards — one per active model with data */}
            <div className={`grid gap-4 ${selectedModelsArr.filter(m => forecasts[m]).length > 1 ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" : "grid-cols-1 md:grid-cols-2"}`}>
              {selectedModelsArr.filter((m) => forecasts[m]).map((model) => {
                const entry = forecasts[model]!.hourlyData[selectedHourIndex];
                return (
                  <div key={model} className="rounded-xl border bg-card p-4 shadow-sm space-y-3" style={{ borderColor: MODEL_COLORS[model] + "55" }}>
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: MODEL_COLORS[model] }} />
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{MODELS[model].label}</h3>
                    </div>
                    <LapseRateGauge lrKm={entry.meanLapseRateCperKm} fahrenheit={fahrenheit} />
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg bg-muted/50 p-2.5 text-center">
                        <p className="text-xs text-muted-foreground mb-0.5">{fahrenheit ? "°F/1000ft" : "°C/km"}</p>
                        <p className="text-lg font-bold tabular-nums">{displayLr(entry.meanLapseRateCperKm)}</p>
                      </div>
                      <div className="rounded-lg bg-muted/50 p-2.5 text-center">
                        <p className="text-xs text-muted-foreground mb-0.5">{fahrenheit ? "°C/km" : "°C/1000ft"}</p>
                        <p className="text-lg font-bold tabular-nums">{fahrenheit ? entry.meanLapseRateCperKm.toFixed(2) : entry.meanLapseRateCper1000ft.toFixed(2)}</p>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5 pt-1 border-t border-border/40">
                      <div className="flex justify-between">
                        <span>Surface temp</span>
                        <span className="font-medium">{displayTemp(entry.surfaceTemp)} {tempUnit}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Levels used</span>
                        <span className="font-medium">{entry.layers.length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>DALR</span>
                        <span className="font-medium text-orange-400">{fahrenheit ? `${lrToF(9.8).toFixed(2)} °F/1000ft` : "9.8 °C/km"}</span>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Temperature profile spans full width when only 1 model active */}
              {selectedModelsArr.filter(m => forecasts[m]).length <= 1 && (
                <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Temperature Profile</h2>
                  <TemperatureProfileChart forecasts={forecasts} selectedModels={selectedModelsArr.filter(m => !!forecasts[m])} selectedHourIndex={selectedHourIndex} elevationM={elevation} fahrenheit={fahrenheit} />
                </div>
              )}
            </div>

            {/* Temperature profile — full width when multiple models */}
            {selectedModelsArr.filter(m => forecasts[m]).length > 1 && (
              <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Temperature Profile — All Models</h2>
                <TemperatureProfileChart forecasts={forecasts} selectedModels={selectedModelsArr.filter(m => !!forecasts[m])} selectedHourIndex={selectedHourIndex} elevationM={elevation} fahrenheit={fahrenheit} />
              </div>
            )}

            {/* Layer-by-layer table (primary model) */}
            {currentEntry.lapseRates.length > 0 && (
              <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-border/60 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: MODEL_COLORS[primaryModel] }} />
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Layer Lapse Rates · {MODELS[primaryModel].label}</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/40 text-xs text-muted-foreground">
                        <th className="text-left px-5 py-2 font-medium">Layer</th>
                        <th className="text-left px-4 py-2 font-medium">Wind</th>
                        <th className="text-right px-4 py-2 font-medium">{lrUnit}</th>
                        <th className="text-right px-5 py-2 font-medium hidden sm:table-cell">{fahrenheit ? "°C/km" : "°C/1000ft"}</th>
                        <th className="text-right px-5 py-2 font-medium">Category</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        currentEntry.lapseRates[0]
                          ? {
                              layer: "Surface",
                              wind: currentEntry.layers[0] ? displayWind(currentEntry.layers[0].windSpeed, currentEntry.layers[0].windDirection) : "—",
                              lrKm: currentEntry.lapseRates[0].lapseRateCperKm,
                            }
                          : null,
                        ...currentEntry.lapseRates.slice(1).map((lr, idx) => {
                          const upperLayer = currentEntry.layers[idx + 1];
                          return {
                            layer: `${roundToNearest500(lr.midHeightFt).toLocaleString()} ft`,
                            wind: upperLayer ? displayWind(upperLayer.windSpeed, upperLayer.windDirection) : "—",
                            lrKm: lr.lapseRateCperKm,
                          };
                        }),
                      ].filter(Boolean).reverse().map((row, i) => {
                        const cat = categorizeLapseRate(row!.lrKm);
                        return (
                          <tr key={i} className="border-b border-border/20 last:border-0 hover:bg-muted/30 transition-colors">
                            <td className="px-5 py-2.5 text-muted-foreground">{row!.layer}</td>
                            <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{row!.wind}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums font-medium">{displayLr(row!.lrKm)}</td>
                            <td className="px-5 py-2.5 text-right tabular-nums text-muted-foreground hidden sm:table-cell">{fahrenheit ? row!.lrKm.toFixed(2) : (row!.lrKm / FT_PER_METER).toFixed(2)}</td>
                            <td className="px-5 py-2.5 text-right">
                              <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: cat.color + "22", color: cat.color }}>{cat.label}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Timeline */}
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">Lapse Rate Forecast · 72-Hour Timeline</h2>
              <LapseRateTimelineChart forecasts={forecasts} selectedModels={selectedModelsArr.filter(m => !!forecasts[m])} fahrenheit={fahrenheit} />
              <div className="flex flex-wrap gap-4 mt-2 text-xs text-muted-foreground">
                {selectedModelsArr.filter(m => forecasts[m]).map(m => (
                  <span key={m} className="flex items-center gap-1.5">
                    <span className="w-4 h-0.5 inline-block" style={{ background: MODEL_COLORS[m] }} />
                    {MODELS[m].shortLabel}
                  </span>
                ))}
              </div>
            </div>

            {/* Reference */}
            <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-border/60">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Lapse Rate Reference</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/40 text-xs text-muted-foreground">
                      <th className="text-left px-5 py-2 font-medium">Category</th>
                      <th className="text-right px-4 py-2 font-medium">{lrUnit}</th>
                      <th className="text-left px-5 py-2 font-medium hidden sm:table-cell">Stability</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: "Inversion", thresholds: [null, 0], stability: "Very stable — temperature increases with height", color: "#8b5cf6" },
                      { label: "Isothermal / Weak", thresholds: [0, 3], stability: "Stable — little temperature change with height", color: "#3b82f6" },
                      { label: "Normal", thresholds: [3, 6.5], stability: "Standard environmental lapse rate", color: "#22c55e" },
                      { label: "Conditionally Unstable", thresholds: [6.5, 9.8], stability: "Unstable if air is saturated", color: "#eab308" },
                      { label: "Dry Adiabatic", thresholds: [9.8, null], stability: "Neutrally stable for unsaturated air", color: "#f97316" },
                      { label: "Superadiabatic", thresholds: [9.8, null], stability: "Absolutely unstable — severe convection", color: "#ef4444" },
                    ].map((row) => {
                      const [lo, hi] = row.thresholds;
                      const fmt = (v: number) => (fahrenheit ? lrToF(v) : v).toFixed(2);
                      const range = lo == null ? `< ${fmt(hi!)}` : hi == null ? `> ${fmt(lo)}` : `${fmt(lo)} – ${fmt(hi)}`;
                      return (
                        <tr key={row.label} className="border-b border-border/20 last:border-0">
                          <td className="px-5 py-2.5">
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: row.color + "22", color: row.color }}>{row.label}</span>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground text-xs">{range}</td>
                          <td className="px-5 py-2.5 text-muted-foreground text-xs hidden sm:table-cell">{row.stability}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {!isLoading && !hasAnyForecast && (
          <div className="rounded-xl border border-border/50 bg-card/40 p-10 text-center space-y-3">
            <div className="text-4xl">🌡️</div>
            <h2 className="font-semibold">Search for a location to get started</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Enter a city name or GPS coordinates (e.g. <code className="text-xs bg-muted px-1 py-0.5 rounded">34.448, -119.293</code>).
              Select one or more forecast models to compare lapse rates from the surface to 5,000 ft MSL.
            </p>
          </div>
        )}
      </main>

      <footer className="border-t border-border/40 mt-8 py-4">
        <p className="text-center text-xs text-muted-foreground">
          Weather data from{" "}
          <a href="https://open-meteo.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground transition-colors">Open-Meteo</a>
          {" "}· Pressure levels 1000–850 hPa · Lapse rate = −ΔT/Δz
        </p>
      </footer>
    </div>
  );
}
