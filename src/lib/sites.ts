export interface SavedSite {
  label: string;
  lat: number;
  lon: number;
}

export const SAVED_SITES: Record<string, SavedSite> = {
  santaBarbara: {
    label: "Santa Barbara",
    lat: 34.4477,
    lon: -119.6822,
  },
  ojai: {
    label: "Ojai",
    lat: 34.4635,
    lon: -119.2349,
  },
  pine: {
    label: "Pine",
    lat: 34.6007,
    lon: -119.3377,
  },
  blackhawk: {
    label: "Blackhawk",
    lat: 34.3592,
    lon: -116.8523,
  },
  griswold: {
    label: "Griswold",
    lat: 36.5624,
    lon: -120.8350,
  },
};
