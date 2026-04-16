
export const PRESSURE_LEVELS = [1000, 975, 950, 925, 900, 875, 850, 800] as const;
export type PressureLevel = (typeof PRESSURE_LEVELS)[number];

export const FT_PER_METER = 3.28084;
export const MAX_HEIGHT_M = 3000;

// ─── model config ──────────────────────────────────────────────────────────────

export const MODELS = {
  "ncep_hgefs025_ensemble_mean": { label: "GEFS Ensemble Mean", shortLabel: "Ensemble" },
  "best_match": { label: "Best Match", shortLabel: "Best Match" },
  "gfs_hrrr": { label: "GFS HRRR", shortLabel: "HRRR" },
} as const;

export type ModelKey = keyof typeof MODELS;

export const MODEL_COLORS: Record<ModelKey, string> = {
  "ncep_hgefs025_ensemble_mean": "#38bdf8",
  "best_match": "#34d399",
  "gfs_hrrr": "#fbbf24",
};

export const DEFAULT_MODEL: ModelKey = "best_match";

// ─── types ─────────────────────────────────────────────────────────────────────

export interface PressureLevelData {
  level: PressureLevel;
  temperature: number; // °C
  geopotentialHeight: number; // meters
  windSpeed: number; // km/h
  windDirection: number; // degrees
}

export interface LapseRateResult {
  time: string;
  surfaceTemp: number;
  layers: PressureLevelData[];
  lapseRates: {
    fromLevel: PressureLevel | "surface";
    toLevel: PressureLevel;
    lapseRateCperKm: number;
    lapseRateCper1000ft: number;
    midHeightFt: number;
  }[];
  meanLapseRateCperKm: number;
  meanLapseRateCper1000ft: number;
}

export interface ForecastResult {
  hourlyData: LapseRateResult[];
  latitude: number;
  longitude: number;
  elevation: number;
  timezone: string;
  model: ModelKey;
}

// ─── API ────────────────────────────────────────────────────────────────────────

function buildApiUrl(latitude: number, longitude: number, model: ModelKey): string {
  const tempVars = PRESSURE_LEVELS.map((l) => `temperature_${l}hPa`).join(",");
  const heightVars = PRESSURE_LEVELS.map((l) => `geopotential_height_${l}hPa`).join(",");
  const windSpeedVars = PRESSURE_LEVELS.map((l) => `wind_speed_${l}hPa`).join(",");
  const windDirectionVars = PRESSURE_LEVELS.map((l) => `wind_direction_${l}hPa`).join(",");
  const params = new URLSearchParams({
    latitude: latitude.toString(),
    longitude: longitude.toString(),
    hourly: `temperature_2m,${tempVars},${heightVars},${windSpeedVars},${windDirectionVars}`,
    forecast_days: "3",
    timezone: "auto",
    temperature_unit: "celsius",
    models: model,
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

export async function fetchForecast(
  latitude: number,
  longitude: number,
  model: ModelKey = DEFAULT_MODEL
): Promise<ForecastResult> {
  const url = buildApiUrl(latitude, longitude, model);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Open-Meteo API error: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();

  const hourlyTime: string[] = data.hourly.time;
  const surfaceTemps: number[] = data.hourly.temperature_2m;

  const levelTemps: Record<PressureLevel, number[]> = {} as Record<PressureLevel, number[]>;
  const levelHeights: Record<PressureLevel, number[]> = {} as Record<PressureLevel, number[]>;
  const levelWindSpeeds: Record<PressureLevel, number[]> = {} as Record<PressureLevel, number[]>;
  const levelWindDirections: Record<PressureLevel, number[]> = {} as Record<PressureLevel, number[]>;

  for (const level of PRESSURE_LEVELS) {
    levelTemps[level] = data.hourly[`temperature_${level}hPa`];
    levelHeights[level] = data.hourly[`geopotential_height_${level}hPa`];
    levelWindSpeeds[level] = data.hourly[`wind_speed_${level}hPa`];
    levelWindDirections[level] = data.hourly[`wind_direction_${level}hPa`];
  }

  const hourlyData: LapseRateResult[] = hourlyTime.map((time, i) => {
    const layers: PressureLevelData[] = [];
    for (const level of PRESSURE_LEVELS) {
      const height = levelHeights[level][i];
      const temp = levelTemps[level][i];
      const windSpeed = levelWindSpeeds[level][i];
      const windDirection = levelWindDirections[level][i];
      if (height != null && temp != null && windSpeed != null && windDirection != null && height <= MAX_HEIGHT_M) {
        layers.push({ level, temperature: temp, geopotentialHeight: height, windSpeed, windDirection });
      }
    }
    layers.sort((a, b) => a.geopotentialHeight - b.geopotentialHeight);

    const lapseRates: LapseRateResult["lapseRates"] = [];
    const surfaceTemp = surfaceTemps[i];
    const surfaceHeightM = data.elevation ?? 0;

    if (layers.length >= 1 && surfaceTemp != null) {
      const firstLayer = layers[0];
      const dT = surfaceTemp - firstLayer.temperature;
      const dZ_m = firstLayer.geopotentialHeight - surfaceHeightM;
      if (dZ_m > 0) {
        const lapseRateCperKm = (dT / dZ_m) * 1000;
        lapseRates.push({
          fromLevel: "surface",
          toLevel: firstLayer.level,
          lapseRateCperKm,
          lapseRateCper1000ft: lapseRateCperKm / FT_PER_METER,
          midHeightFt: ((surfaceHeightM + firstLayer.geopotentialHeight) / 2) * FT_PER_METER,
        });
      }
    }

    for (let j = 0; j < layers.length - 1; j++) {
      const lower = layers[j];
      const upper = layers[j + 1];
      const dT = lower.temperature - upper.temperature;
      const dZ_m = upper.geopotentialHeight - lower.geopotentialHeight;
      if (dZ_m > 0) {
        const lapseRateCperKm = (dT / dZ_m) * 1000;
        lapseRates.push({
          fromLevel: lower.level,
          toLevel: upper.level,
          lapseRateCperKm,
          lapseRateCper1000ft: lapseRateCperKm / FT_PER_METER,
          midHeightFt: ((lower.geopotentialHeight + upper.geopotentialHeight) / 2) * FT_PER_METER,
        });
      }
    }

    const meanLapseRateCperKm =
      lapseRates.length > 0
        ? lapseRates.reduce((sum, lr) => sum + lr.lapseRateCperKm, 0) / lapseRates.length
        : 0;

    return {
      time,
      surfaceTemp: surfaceTemp ?? NaN,
      layers,
      lapseRates,
      meanLapseRateCperKm,
      meanLapseRateCper1000ft: meanLapseRateCperKm / FT_PER_METER,
    };
  });

  return {
    hourlyData,
    latitude: data.latitude,
    longitude: data.longitude,
    elevation: data.elevation ?? 0,
    timezone: data.timezone,
    model,
  };
}

// ─── helpers ───────────────────────────────────────────────────────────────────

export type LapseRateCategory =
  | "superadiabatic" | "dry_adiabatic" | "steep" | "normal" | "isothermal" | "inversion";

export function categorizeLapseRate(lrCperKm: number): {
  category: LapseRateCategory; label: string; description: string; color: string;
} {
  if (lrCperKm > 9.8) return { category: "superadiabatic", label: "Superadiabatic", description: "Extremely unstable — faster than dry adiabatic rate", color: "#ef4444" };
  if (lrCperKm >= 9.0) return { category: "dry_adiabatic", label: "Near Dry Adiabatic", description: "Dry adiabatic lapse rate — strongly unstable", color: "#f97316" };
  if (lrCperKm >= 6.5) return { category: "steep", label: "Steep / Unstable", description: "Above average lapse rate — conditionally unstable", color: "#eab308" };
  if (lrCperKm >= 3.0) return { category: "normal", label: "Normal", description: "Standard environmental lapse rate", color: "#22c55e" };
  if (lrCperKm >= 0)   return { category: "isothermal", label: "Weak / Isothermal", description: "Weak lapse rate approaching isothermal — stable", color: "#3b82f6" };
  return { category: "inversion", label: "Inversion", description: "Temperature increases with height — very stable", color: "#8b5cf6" };
}

export async function geocodeLocation(query: string): Promise<{
  name: string; latitude: number; longitude: number; country: string; admin1?: string;
}[]> {
  const params = new URLSearchParams({ name: query, count: "5", language: "en", format: "json" });
  const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
  if (!response.ok) throw new Error("Geocoding API error");
  const data = await response.json();
  return data.results ?? [];
}

export function formatLocalTime(isoTime: string): string {
  const date = new Date(isoTime);
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
}
