const form = document.getElementById('giveawayForm');
const formStatus = document.getElementById('formStatus');
const locationStatus = document.getElementById('locationStatus');
const locateBtn = document.getElementById('locateBtn');

let latestCoords = null;
let supabaseClient = null;
let googleMapsApiKey = '';

function setStatus(target, message, type = '') {
  target.textContent = message;
  target.className = 'status-text';
  if (type) target.classList.add(type);
}

async function loadSupabaseClient() {
  setStatus(formStatus, 'Loading secure configuration...');

  const response = await fetch('/api/config');
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Unable to load deployment configuration.');
  }

  supabaseClient = window.supabase.createClient(data.supabaseUrl, data.supabaseAnonKey);
  googleMapsApiKey = data.googleMapsApiKey;
  setStatus(formStatus, 'Configuration loaded. You can now submit your entry.', 'success');
}

function hasAddressType(result, type) {
  return Array.isArray(result?.types) && result.types.includes(type);
}

function getComponentByType(components, wantedType) {
  return components.find((component) => component.types?.includes(wantedType));
}

function buildReadableAddress(result) {
  const components = Array.isArray(result?.address_components) ? result.address_components : [];

  const streetNumber = getComponentByType(components, 'street_number')?.long_name || '';
  const route = getComponentByType(components, 'route')?.long_name || '';
  const neighborhood =
    getComponentByType(components, 'sublocality_level_1')?.long_name ||
    getComponentByType(components, 'sublocality')?.long_name ||
    getComponentByType(components, 'neighborhood')?.long_name ||
    getComponentByType(components, 'political')?.long_name ||
    '';
  const barangay =
    getComponentByType(components, 'administrative_area_level_3')?.long_name ||
    getComponentByType(components, 'administrative_area_level_4')?.long_name ||
    '';
  const locality = getComponentByType(components, 'locality')?.long_name || '';
  const province = getComponentByType(components, 'administrative_area_level_1')?.long_name || '';
  const country = getComponentByType(components, 'country')?.long_name || '';

  const firstLine = [streetNumber, route].filter(Boolean).join(' ').trim();
  const secondLine = neighborhood || barangay;

  return [firstLine, secondLine, locality, province, country].filter(Boolean).join(', ');
}

async function reverseGeocode(lat, lon) {
  if (!googleMapsApiKey) {
    throw new Error('Google Maps API key is missing from runtime configuration.');
  }

  const endpoint = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  endpoint.searchParams.set('latlng', `${lat},${lon}`);
  endpoint.searchParams.set('key', googleMapsApiKey);

  const response = await fetch(endpoint.toString());

  if (!response.ok) {
    throw new Error('Unable to fetch address from location coordinates.');
  }

  const data = await response.json();

  if (data.status !== 'OK' || !Array.isArray(data.results) || data.results.length === 0) {
    throw new Error('Google could not resolve a valid address for this location.');
  }

  const preferredResult =
    data.results.find((result) => hasAddressType(result, 'street_address')) ||
    data.results.find((result) => hasAddressType(result, 'premise')) ||
    data.results.find((result) => hasAddressType(result, 'subpremise')) ||
    data.results.find((result) => hasAddressType(result, 'plus_code') === false) ||
    data.results[0];

  const readableAddress = buildReadableAddress(preferredResult);
  return readableAddress || preferredResult?.formatted_address || '';
}

async function requestLocation() {
  if (!navigator.geolocation) {
    setStatus(locationStatus, 'Geolocation is not supported in your browser.', 'error');
    return;
  }

  setStatus(locationStatus, 'Requesting location access...');

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      latestCoords = { lat, lon };

      setStatus(locationStatus, 'Location captured. Resolving full address...');

      try {
        const address = await reverseGeocode(lat, lon);
        if (!address) {
          throw new Error('Unable to resolve a complete address from your location.');
        }

        form.elements.address.value = address;
        setStatus(locationStatus, 'Location captured and complete address auto-filled.', 'success');
      } catch (error) {
        latestCoords = null;
        form.elements.address.value = '';
        setStatus(locationStatus, `${error.message} Please try location again.`, 'error');
      }
    },
    (error) => {
      setStatus(
        locationStatus,
        `Location permission denied or unavailable (${error.message}). Location access is required to submit.`,
        'error'
      );
    },
    {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 0
    }
  );
}


function launchCongratsAnimation() {
  const container = document.createElement('div');
  container.className = 'congrats-overlay';
  container.setAttribute('aria-hidden', 'true');

  const banner = document.createElement('div');
  banner.className = 'congrats-banner';
  banner.textContent = '🎉 Congrats! Entry Submitted! 🎉';
  container.appendChild(banner);

  const colors = ['#2e6cf6', '#00b894', '#ff7675', '#fdcb6e', '#6c5ce7', '#00cec9'];
  for (let i = 0; i < 42; i += 1) {
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = `${Math.random() * 0.45}s`;
    piece.style.animationDuration = `${2.6 + Math.random() * 1.2}s`;
    container.appendChild(piece);
  }

  document.body.appendChild(container);

  window.setTimeout(() => {
    container.classList.add('fade-out');
  }, 1900);

  window.setTimeout(() => {
    container.remove();
  }, 2600);
}

async function submitEntry(event) {
  event.preventDefault();

  if (!supabaseClient) {
    setStatus(formStatus, 'Configuration is still loading. Please wait and try again.', 'error');
    return;
  }

  if (!latestCoords || !form.elements.address.value.trim()) {
    setStatus(
      formStatus,
      'Please click Use My Current Location first so we can fetch your complete address.',
      'error'
    );
    return;
  }

  setStatus(formStatus, 'Submitting your entry...');

  const formData = new FormData(form);
  const payload = {
    full_name: formData.get('full_name')?.toString().trim(),
    mobile_number: formData.get('mobile_number')?.toString().trim(),
    age: Number(formData.get('age')),
    address: formData.get('address')?.toString().trim(),
    latitude: latestCoords?.lat ?? null,
    longitude: latestCoords?.lon ?? null,
    purpose: 'school-supply',
    submitted_at: new Date().toISOString()
  };

  const { error } = await supabaseClient.from('giveaway_entries').insert(payload);

  if (error) {
    setStatus(formStatus, `Submission failed: ${error.message}`, 'error');
    return;
  }

  form.reset();
  latestCoords = null;
  setStatus(locationStatus, 'Location is required. Click Use My Current Location to continue.');
  setStatus(formStatus, 'Entry submitted successfully. Good luck! 🎉', 'success');
  launchCongratsAnimation();
}

locateBtn.addEventListener('click', requestLocation);
form.addEventListener('submit', submitEntry);

loadSupabaseClient().catch((error) => {
  setStatus(formStatus, `${error.message} Check Vercel environment variables.`, 'error');
});
