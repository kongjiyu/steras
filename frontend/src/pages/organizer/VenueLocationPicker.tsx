import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import { MapPinned } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { VenueLocation } from '@shared/types';
import { inferMalaysiaStateFromAddress, normalizeMalaysiaState } from './organizerApplication';

const MALAYSIA_CENTER = { lat: 4.2105, lng: 101.9758 };
let mapsLoaderKey = '';
let mapsLibraries: Promise<{
  maps: google.maps.MapsLibrary;
  marker: google.maps.MarkerLibrary;
  places: google.maps.PlacesLibrary;
  geocoding: google.maps.GeocodingLibrary;
}> | undefined;

function loadMaps(apiKey: string) {
  if (!mapsLibraries) {
    mapsLoaderKey = apiKey;
    setOptions({ key: apiKey, v: 'weekly', language: 'en', region: 'MY', authReferrerPolicy: 'origin' });
    mapsLibraries = Promise.all([
      importLibrary('maps'),
      importLibrary('marker'),
      importLibrary('places'),
      importLibrary('geocoding'),
    ]).then(([maps, marker, places, geocoding]) => ({ maps, marker, places, geocoding }));
  } else if (mapsLoaderKey !== apiKey) {
    return Promise.reject(new Error('Google Maps was already configured with another API key.'));
  }
  return mapsLibraries;
}

function literalPosition(position: google.maps.LatLng | google.maps.LatLngLiteral | google.maps.LatLngAltitude | google.maps.LatLngAltitudeLiteral | null | undefined): VenueLocation | undefined {
  if (!position) return undefined;
  const lat = typeof position.lat === 'function' ? position.lat() : position.lat;
  const lng = typeof position.lng === 'function' ? position.lng() : position.lng;
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined;
}

function stateFromPlaceComponents(components: google.maps.places.AddressComponent[] | undefined, address: string): string {
  const administrativeArea = components?.find((component) => component.types.includes('administrative_area_level_1'))?.longText;
  return normalizeMalaysiaState(administrativeArea ?? '') ?? inferMalaysiaStateFromAddress(address) ?? '';
}

function stateFromGeocoderComponents(components: google.maps.GeocoderAddressComponent[], address: string): string {
  const administrativeArea = components.find((component) => component.types.includes('administrative_area_level_1'))?.long_name;
  return normalizeMalaysiaState(administrativeArea ?? '') ?? inferMalaysiaStateFromAddress(address) ?? '';
}

export interface VenueMapSelection {
  venueName?: string;
  venueAddress: string;
  venueState: string;
  venueLocation: VenueLocation;
}

export default function VenueLocationPicker({ apiKey, location, onSelect }: {
  apiKey: string;
  location?: VenueLocation;
  onSelect: (selection: VenueMapSelection) => void;
}) {
  const autocompleteHost = useRef<HTMLDivElement>(null);
  const mapHost = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map>();
  const markerRef = useRef<google.maps.marker.AdvancedMarkerElement>();
  const onSelectRef = useRef(onSelect);
  const initialLocation = useRef(location).current;
  const [status, setStatus] = useState('Loading Google Maps…');
  const [error, setError] = useState('');
  onSelectRef.current = onSelect;

  useEffect(() => {
    let active = true;
    let mapClickListener: google.maps.MapsEventListener | undefined;
    let markerDragHandler: EventListener | undefined;
    let autocomplete: google.maps.places.PlaceAutocompleteElement | undefined;

    const start = async () => {
      try {
        const { maps, marker, places, geocoding } = await loadMaps(apiKey);
        if (!active || !mapHost.current || !autocompleteHost.current) return;
        const initialPosition = initialLocation ?? MALAYSIA_CENTER;
        const map = new maps.Map(mapHost.current, {
          center: initialPosition,
          zoom: initialLocation ? 16 : 6,
          mapId: 'DEMO_MAP_ID',
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          gestureHandling: 'cooperative',
        });
        const pin = new marker.PinElement({ background: '#5f7f1c', borderColor: '#314713', glyphColor: '#fffdf8' });
        const venueMarker = new marker.AdvancedMarkerElement({
          map,
          position: initialLocation,
          title: 'Selected venue location',
          gmpDraggable: true,
          content: pin,
        });
        const geocoder = new geocoding.Geocoder();
        mapRef.current = map;
        markerRef.current = venueMarker;

        const selectPoint = async (venueLocation: VenueLocation) => {
          venueMarker.position = venueLocation;
          map.panTo(venueLocation);
          setStatus('Finding the address for this pin…');
          setError('');
          try {
            const response = await geocoder.geocode({ location: venueLocation, region: 'MY' });
            if (!active) return;
            const result = response.results[0];
            if (!result) {
              setStatus('Pin selected. Enter the nearest address and state manually.');
              onSelectRef.current({ venueAddress: '', venueState: '', venueLocation });
              return;
            }
            onSelectRef.current({
              venueAddress: result.formatted_address,
              venueState: stateFromGeocoderComponents(result.address_components, result.formatted_address),
              venueLocation,
            });
            setStatus('Location selected. You can drag the pin to adjust it.');
          } catch {
            if (!active) return;
            setStatus('Pin selected. Enter the nearest address and state manually.');
            onSelectRef.current({ venueAddress: '', venueState: '', venueLocation });
          }
        };

        mapClickListener = map.addListener('click', (event: google.maps.MapMouseEvent) => {
          if (event.latLng) void selectPoint({ lat: event.latLng.lat(), lng: event.latLng.lng() });
        });
        markerDragHandler = () => {
          const position = literalPosition(venueMarker.position);
          if (position) void selectPoint(position);
        };
        venueMarker.addEventListener('gmp-dragend', markerDragHandler);

        autocomplete = new places.PlaceAutocompleteElement({
          includedRegionCodes: ['my'],
          requestedLanguage: 'en',
          requestedRegion: 'my',
          placeholder: 'Search for a venue or address in Malaysia',
          description: 'Search Google Maps for the event venue',
        });
        autocomplete.style.width = '100%';
        autocomplete.addEventListener('gmp-select', async (event: google.maps.places.PlacePredictionSelectEvent) => {
          setStatus('Loading the selected place…');
          setError('');
          try {
            const place = event.placePrediction.toPlace();
            await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location', 'addressComponents', 'viewport'] });
            if (!active || !place.location) return;
            const venueLocation = { lat: place.location.lat(), lng: place.location.lng() };
            venueMarker.position = venueLocation;
            if (place.viewport) map.fitBounds(place.viewport);
            else { map.panTo(venueLocation); map.setZoom(17); }
            const address = place.formattedAddress ?? '';
            onSelectRef.current({
              venueName: place.displayName ?? undefined,
              venueAddress: address,
              venueState: stateFromPlaceComponents(place.addressComponents, address),
              venueLocation,
            });
            setStatus('Venue selected. You can drag the pin to adjust it.');
          } catch {
            if (active) {
              setError('Google Maps could not load this place. Try another search result or click the map.');
              setStatus('');
            }
          }
        });
        autocomplete.addEventListener('gmp-error', () => {
          if (active) setError('Google Maps could not return place suggestions. Check your connection and try again.');
        });
        autocompleteHost.current.replaceChildren(autocomplete);
        setStatus(initialLocation ? 'Current venue location shown. Search, click, or drag the pin to change it.' : 'Search for the venue or click the map to place a pin.');
      } catch {
        if (active) {
          setError('Google Maps could not load. Check your connection and try again later.');
          setStatus('');
        }
      }
    };

    void start();
    return () => {
      active = false;
      mapClickListener?.remove();
      if (markerDragHandler) markerRef.current?.removeEventListener('gmp-dragend', markerDragHandler);
      autocomplete?.remove();
      mapRef.current = undefined;
      markerRef.current = undefined;
    };
  }, [apiKey, initialLocation]);

  useEffect(() => {
    if (!location || !mapRef.current || !markerRef.current) return;
    markerRef.current.position = location;
  }, [location]);

  return <section className="overflow-hidden rounded-lg border border-brand-200 bg-brand-50" aria-labelledby="venue-map-heading">
    <div className="p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-700 text-white"><MapPinned size={17} aria-hidden="true" /></span>
        <div><h3 id="venue-map-heading" className="font-semibold text-ink-900">Choose the venue on Google Maps</h3><p className="mt-1 text-sm leading-6 text-ink-600">Search for a place, or click and drag the pin. Address, state and coordinates update automatically.</p></div>
      </div>
      <label className="field-label mt-4 block">Search venue or address</label>
      <div ref={autocompleteHost} className="mt-1 min-h-12 rounded-md border border-ink-200 bg-white p-1" />
      {error && <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {status && <p role="status" className="mt-3 text-sm text-brand-800">{status}</p>}
    </div>
    <div ref={mapHost} className="h-72 w-full border-t border-brand-200 sm:h-96" aria-label="Interactive Google Map for selecting the venue" />
    {location && <div className="grid gap-2 border-t border-brand-200 bg-[#fffdf8] px-4 py-3 text-xs text-ink-600 sm:grid-cols-2 sm:px-5">
      <span><strong className="text-ink-800">Latitude:</strong> {location.lat.toFixed(6)}</span>
      <span><strong className="text-ink-800">Longitude:</strong> {location.lng.toFixed(6)}</span>
    </div>}
  </section>;
}
