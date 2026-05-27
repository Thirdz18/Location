const form = document.getElementById('giveawayForm');
const formStatus = document.getElementById('formStatus');
const locationStatus = document.getElementById('locationStatus');
const locateBtn = document.getElementById('locateBtn');

let latestCoords = null;
let supabaseClient = null;

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
  setStatus(formStatus, 'Configuration loaded. You can now submit your entry.', 'success');
}

async function reverseGeocode(lat, lon) {
  const endpoint = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`;
  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error('Unable to fetch address from location coordinates.');
  }

  const data = await response.json();
  return data.display_name || '';
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
}

locateBtn.addEventListener('click', requestLocation);
form.addEventListener('submit', submitEntry);

loadSupabaseClient().catch((error) => {
  setStatus(formStatus, `${error.message} Check Vercel environment variables.`, 'error');
});
