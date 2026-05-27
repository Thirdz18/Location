const form = document.getElementById('giveawayForm');
const formStatus = document.getElementById('formStatus');
const locationStatus = document.getElementById('locationStatus');
const locateBtn = document.getElementById('locateBtn');
const voterForm = document.getElementById('voterForm');
const voterStatus = document.getElementById('voterStatus');
const voteListWrap = document.getElementById('voteListWrap');
const candidateList = document.getElementById('candidateList');
const voteStatus = document.getElementById('voteStatus');
const countdownTimer = document.getElementById('countdownTimer');
const deadlineText = document.getElementById('deadlineText');

let latestCoords = null;
let supabaseClient = null;
let googleMapsApiKey = '';
let activeVoter = null;

const VOTE_POINTS = 10;

const ENTRY_DEADLINE = new Date('2026-05-30T23:59:59Z');

const DEVICE_KEY = 'giveaway_device_id';
const DEVICE_VOTED_KEY = 'giveaway_device_voted';

function getDeviceId() {
  let deviceId = window.localStorage.getItem(DEVICE_KEY);
  if (!deviceId) {
    if (window.crypto?.randomUUID) {
      deviceId = window.crypto.randomUUID();
    } else {
      deviceId = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
    window.localStorage.setItem(DEVICE_KEY, deviceId);
  }
  return deviceId;
}

function markDeviceVoted() {
  window.localStorage.setItem(DEVICE_VOTED_KEY, 'true');
}

function hasDeviceVotedLocal() {
  return window.localStorage.getItem(DEVICE_VOTED_KEY) === 'true';
}

function formatTimeLeft(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

function startCountdown() {
  if (deadlineText) {
    deadlineText.textContent = 'Entries close on May 30, 2026 (UTC).';
  }

  const updateTimer = () => {
    const now = new Date();
    const remaining = ENTRY_DEADLINE.getTime() - now.getTime();

    if (remaining <= 0) {
      countdownTimer.textContent = 'Form entry is now closed.';
      countdownTimer.classList.add('error');
      return true;
    }

    countdownTimer.textContent = `Time left to fill out: ${formatTimeLeft(remaining)}`;
    return false;
  };

  const ended = updateTimer();
  if (ended) return;

  const intervalId = window.setInterval(() => {
    const done = updateTimer();
    if (done) window.clearInterval(intervalId);
  }, 1000);
}

function setStatus(target, message, type = '') {
  if (!target) return;
  target.textContent = message;
  target.className = 'status-text';
  if (type) target.classList.add(type);
}

async function loadSupabaseClient() {
  setStatus(formStatus || voterStatus, 'Loading secure configuration...');
  const response = await fetch('/api/config');
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Unable to load deployment configuration.');
  }

  supabaseClient = window.supabase.createClient(data.supabaseUrl, data.supabaseAnonKey);
  googleMapsApiKey = data.googleMapsApiKey;
  setStatus(formStatus || voterStatus, 'Configuration loaded. You can now continue.', 'success');
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
  const locality = getComponentByType(components, 'locality')?.long_name || '';
  const province = getComponentByType(components, 'administrative_area_level_1')?.long_name || '';
  const country = getComponentByType(components, 'country')?.long_name || '';
  return [streetNumber, route, locality, province, country].filter(Boolean).join(', ');
}

async function reverseGeocode(lat, lon) {
  const endpoint = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  endpoint.searchParams.set('latlng', `${lat},${lon}`);
  endpoint.searchParams.set('key', googleMapsApiKey);

  const response = await fetch(endpoint.toString());
  if (!response.ok) throw new Error('Unable to fetch address from location coordinates.');

  const data = await response.json();
  if (data.status !== 'OK' || !Array.isArray(data.results) || data.results.length === 0) {
    throw new Error('Google could not resolve a valid address for this location.');
  }

  const preferredResult =
    data.results.find((result) => hasAddressType(result, 'street_address')) ||
    data.results.find((result) => hasAddressType(result, 'premise')) ||
    data.results[0];

  return buildReadableAddress(preferredResult) || preferredResult?.formatted_address || '';
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
        form.elements.address.value = address;
        setStatus(locationStatus, 'Location captured and complete address auto-filled.', 'success');
      } catch (error) {
        latestCoords = null;
        form.elements.address.value = '';
        setStatus(locationStatus, `${error.message} Please try location again.`, 'error');
      }
    },
    (error) => {
      setStatus(locationStatus, `Location denied/unavailable (${error.message}).`, 'error');
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
  );
}

async function submitEntry(event) {
  event.preventDefault();

  if (!supabaseClient) return;
  if (!latestCoords || !form.elements.address.value.trim()) {
    setStatus(formStatus, 'Please click Use My Current Location first.', 'error');
    return;
  }

  if (new Date().getTime() > ENTRY_DEADLINE.getTime()) {
    setStatus(formStatus, 'Entry period is closed (deadline: May 30, 2026).', 'error');
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

function renderCandidateList(candidates) {
  candidateList.innerHTML = '';

  if (!candidates.length) {
    candidateList.innerHTML = '<li class="status-text">No candidates yet.</li>';
    return;
  }

  candidates.forEach((candidate) => {
    const item = document.createElement('li');
    item.className = 'candidate-item';
    item.innerHTML = `
      <div>
        <strong>${candidate.full_name}</strong>
        <p>${candidate.address}</p>
        <small>Votes: ${candidate.vote_count} | Points: ${candidate.vote_points}</small>
      </div>
      <button class="primary-btn" data-id="${candidate.id}">Vote +${VOTE_POINTS}</button>
    `;
    candidateList.appendChild(item);
  });
}

async function loadCandidates() {
  const { data, error } = await supabaseClient
    .from('giveaway_entries')
    .select('id, full_name, address, vote_count, vote_points')
    .eq('purpose', 'school-supply')
    .order('submitted_at', { ascending: true });

  if (error) {
    setStatus(voteStatus, error.message, 'error');
    return;
  }

  renderCandidateList(data || []);
}

async function saveVoter(event) {
  event.preventDefault();

  const formData = new FormData(voterForm);
  activeVoter = {
    voter_name: formData.get('voter_name')?.toString().trim(),
    voter_age: Number(formData.get('voter_age')),
    voter_location: formData.get('voter_location')?.toString().trim()
  };

  if (!activeVoter.voter_name || !activeVoter.voter_age || !activeVoter.voter_location) {
    setStatus(voterStatus, 'Complete voter details first.', 'error');
    return;
  }

  if (hasDeviceVotedLocal()) {
    setStatus(voterStatus, 'This device already voted. 1 device = 1 vote only.', 'error');
    voteListWrap.classList.add('hidden');
    return;
  }

  setStatus(voterStatus, 'Voter details accepted. You can now vote.', 'success');
  voteListWrap.classList.remove('hidden');
  await loadCandidates();
}

async function voteForCandidate(candidateId) {
  if (!activeVoter) {
    setStatus(voteStatus, 'Please provide voter details before voting.', 'error');
    return;
  }

  if (hasDeviceVotedLocal()) {
    setStatus(voteStatus, 'This device already voted. 1 device = 1 vote only.', 'error');
    return;
  }

  const deviceId = getDeviceId();

  const { count: existingVoteCount, error: existingVoteErr } = await supabaseClient
    .from('entry_votes')
    .select('*', { head: true, count: 'exact' })
    .eq('device_id', deviceId);

  if (existingVoteErr) {
    setStatus(voteStatus, `Unable to validate device vote history: ${existingVoteErr.message}`, 'error');
    return;
  }

  if ((existingVoteCount || 0) > 0) {
    markDeviceVoted();
    setStatus(voteStatus, 'This device already voted. 1 device = 1 vote only.', 'error');
    return;
  }

  const votePayload = {
    entry_id: Number(candidateId),
    voter_name: activeVoter.voter_name,
    voter_age: activeVoter.voter_age,
    voter_location: activeVoter.voter_location,
    device_id: deviceId,
    points: VOTE_POINTS,
    voted_at: new Date().toISOString()
  };

  const voteInsert = await supabaseClient.from('entry_votes').insert(votePayload);
  if (voteInsert.error) {
    setStatus(voteStatus, `Vote failed: ${voteInsert.error.message}`, 'error');
    return;
  }

  const { data: candidate, error: fetchErr } = await supabaseClient
    .from('giveaway_entries')
    .select('vote_count, vote_points')
    .eq('id', Number(candidateId))
    .single();

  if (fetchErr) {
    setStatus(voteStatus, `Vote saved, but refresh failed: ${fetchErr.message}`, 'error');
    return;
  }

  const updatePayload = {
    vote_count: (candidate?.vote_count || 0) + 1,
    vote_points: (candidate?.vote_points || 0) + VOTE_POINTS
  };

  const { error: updateErr } = await supabaseClient
    .from('giveaway_entries')
    .update(updatePayload)
    .eq('id', Number(candidateId));

  if (updateErr) {
    setStatus(voteStatus, `Vote saved but score update failed: ${updateErr.message}`, 'error');
    return;
  }

  markDeviceVoted();
  setStatus(voteStatus, 'Vote submitted successfully! (+10 points). This device cannot vote again.', 'success');
  await loadCandidates();
}

if (candidateList) {
  candidateList.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-id]');
    if (!button) return;
    await voteForCandidate(button.dataset.id);
  });
}

if (locateBtn) locateBtn.addEventListener('click', requestLocation);
if (form) form.addEventListener('submit', submitEntry);
if (voterForm) voterForm.addEventListener('submit', saveVoter);
if (countdownTimer) startCountdown();

loadSupabaseClient().catch((error) => {
  if (formStatus) setStatus(formStatus, `${error.message} Check Vercel environment variables.`, 'error');
  if (voterStatus) setStatus(voterStatus, `${error.message} Check Vercel environment variables.`, 'error');
});
