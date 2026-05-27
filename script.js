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
const winnerStatus = document.getElementById('winnerStatus');
const winnerList = document.getElementById('winnerList');
const shareVoteWrap = document.getElementById('shareVoteWrap');
const shareVoteLink = document.getElementById('shareVoteLink');
const copyVoteLinkBtn = document.getElementById('copyVoteLinkBtn');
const copyVoteStatus = document.getElementById('copyVoteStatus');

let latestCoords = null;
let supabaseClient = null;
let googleMapsApiKey = '';
let activeVoter = null;

const VOTE_POINTS = 10;

const ENTRY_DEADLINE = new Date('2026-05-30T23:59:59Z');

const DEVICE_KEY = 'giveaway_device_id';
const DEVICE_VOTED_KEY = 'giveaway_device_voted';
const DEVICE_ENTRY_LOCK_KEY = 'giveaway_entry_submitted';

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
    deadlineText.textContent = 'Ang pagsumite kutob sa May 30, 2026 (UTC).';
  }

  const updateTimer = () => {
    const now = new Date();
    const remaining = ENTRY_DEADLINE.getTime() - now.getTime();

    if (remaining <= 0) {
      countdownTimer.textContent = 'Sirado na ang pagsumite sa porma.';
      countdownTimer.classList.add('error');
      return true;
    }

    countdownTimer.textContent = `Nahibiling oras para mosumite: ${formatTimeLeft(remaining)}`;
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
  setStatus(formStatus || voterStatus, 'Gi-andam ang secure nga configuration...');
  const response = await fetch('/api/config');
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Unable to load deployment configuration.');
  }

  supabaseClient = window.supabase.createClient(data.supabaseUrl, data.supabaseAnonKey);
  googleMapsApiKey = data.googleMapsApiKey;
  setStatus(formStatus || voterStatus, 'Naload na ang configuration. Pwede ka na mopadayon.', 'success');
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
    setStatus(locationStatus, 'Dili suportado sa imong browser ang geolocation.', 'error');
    return;
  }

  setStatus(locationStatus, 'Nangayo og access sa lokasyon...');

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      latestCoords = { lat, lon };
      setStatus(locationStatus, 'Nakuha na ang lokasyon. Gikuha ang kompleto nga address...');
      try {
        const address = await reverseGeocode(lat, lon);
        form.elements.address.value = address;
        setStatus(locationStatus, 'Nakuha na ang lokasyon ug napuno na ang kompleto nga address.', 'success');
      } catch (error) {
        latestCoords = null;
        form.elements.address.value = '';
        setStatus(locationStatus, `${error.message} Palihog sulayi pag-usab ang lokasyon.`, 'error');
      }
    },
    (error) => {
      setStatus(locationStatus, `Gidili o dili available ang lokasyon (${error.message}).`, 'error');
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
  );
}



function markDeviceEntrySubmitted() {
  window.localStorage.setItem(DEVICE_ENTRY_LOCK_KEY, 'true');
}

function hasDeviceEntrySubmitted() {
  return window.localStorage.getItem(DEVICE_ENTRY_LOCK_KEY) === 'true';
}

function setEntryFormLocked() {
  if (!form) return;

  Array.from(form.elements).forEach((element) => {
    element.disabled = true;
  });

  if (locateBtn) locateBtn.disabled = true;
  setStatus(formStatus, 'Malampuson ang pagsumite. Nalock na ang form para malikayan ang duplicate submit sa same browser.', 'success');
}

function buildVotingLink() {
  return `${window.location.origin}/voting.html`;
}

function showVotingShareLink() {
  if (!shareVoteWrap || !shareVoteLink) return;

  shareVoteLink.value = buildVotingLink();
  shareVoteWrap.classList.remove('hidden');
  setStatus(copyVoteStatus, '');
}

async function copyVotingLink() {
  if (!shareVoteLink?.value) return;

  try {
    await navigator.clipboard.writeText(shareVoteLink.value);
    setStatus(copyVoteStatus, 'Malampusong nakopya ang link sa botohan.', 'success');
  } catch (error) {
    setStatus(copyVoteStatus, 'Dili makopya awtomatiko. Palihog kopyaha lang manual ang link.', 'error');
  }
}

function isWinnersAvailable() {
  return new Date().getTime() > ENTRY_DEADLINE.getTime();
}

function renderWinnerList(winners) {
  if (!winnerList) return;
  winnerList.innerHTML = '';

  if (!winners.length) {
    winnerList.innerHTML = '<li class="status-text">Wala pay modaog karon.</li>';
    return;
  }

  winners.forEach((winner, index) => {
    const item = document.createElement('li');
    item.className = 'candidate-item';
    item.innerHTML = `
      <div>
        <strong>#${index + 1} ${winner.full_name}</strong>
        <p>${winner.address}</p>
        <small>Votes: ${winner.vote_count || 0} | Points: ${winner.vote_points || 0}</small>
      </div>
    `;
    winnerList.appendChild(item);
  });
}

async function loadWinners() {
  if (!winnerStatus) return;

  if (!isWinnersAvailable()) {
    setStatus(winnerStatus, 'Makita ang listahan sa modaog human sa May 30, 2026 (UTC).');
    if (winnerList) winnerList.innerHTML = '';
    return;
  }

  const { data, error } = await supabaseClient
    .from('giveaway_entries')
    .select('full_name, address, vote_count, vote_points')
    .eq('purpose', 'school-supply')
    .order('vote_points', { ascending: false })
    .order('vote_count', { ascending: false })
    .limit(2);

  if (error) {
    setStatus(winnerStatus, `Unable to load winners: ${error.message}`, 'error');
    return;
  }

  renderWinnerList(data || []);
  setStatus(winnerStatus, 'Anaa na karon ang listahan sa modaog.', 'success');
}
async function submitEntry(event) {
  event.preventDefault();

  if (!supabaseClient) return;
  if (hasDeviceEntrySubmitted()) {
    setStatus(formStatus, 'Nadetect nga nakasubmit na ni nga browser kaniadto. Kung sayop ni, pwede gihapon ka mosulay og submit karon.', '');
  }
  if (!latestCoords || !form.elements.address.value.trim()) {
    setStatus(formStatus, 'Palihog i-klik una ang Gamita ang Akong Karon nga Lokasyon.', 'error');
    return;
  }

  if (new Date().getTime() > ENTRY_DEADLINE.getTime()) {
    setStatus(formStatus, 'Sirado na ang entry period (deadline: May 30, 2026).', 'error');
    return;
  }

  const age = Number(form.elements.age.value);
  if (Number.isNaN(age) || age < 5 || age > 10) {
    setStatus(formStatus, 'Ang edad para sa estudyante ra (5 hangtod 10 anyos).', 'error');
    return;
  }

  setStatus(formStatus, 'Gisumite ang imong entry...');

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

  markDeviceEntrySubmitted();
  showVotingShareLink();
  form.reset();
  latestCoords = null;
  setStatus(locationStatus, 'Kinahanglan ang lokasyon. I-klik ang Gamita ang Akong Karon nga Lokasyon aron makapadayon.');
  setStatus(formStatus, 'Malampuson ang pagsumite sa entry. I-share ang imong voting link sa ubos. 🎉', 'success');
  setEntryFormLocked();
}

function renderCandidateList(candidates) {
  candidateList.innerHTML = '';

  if (!candidates.length) {
    candidateList.innerHTML = '<li class="status-text">Wala pay kandidato karon.</li>';
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
    setStatus(voterStatus, 'Kumpletoha una ang detalye sa botante.', 'error');
    return;
  }

  if (hasDeviceVotedLocal()) {
    setStatus(voterStatus, 'Nakabotar na kining device. 1 ka device = 1 ka boto ra.', 'error');
    voteListWrap.classList.add('hidden');
    return;
  }

  setStatus(voterStatus, 'Dawat na ang detalye sa botante. Pwede na ka mobotar.', 'success');
  voteListWrap.classList.remove('hidden');
  await loadCandidates();
}

async function voteForCandidate(candidateId) {
  if (!activeVoter) {
    setStatus(voteStatus, 'Palihog butangi una og detalye sa botante sa dili pa mobotar.', 'error');
    return;
  }

  if (hasDeviceVotedLocal()) {
    setStatus(voteStatus, 'Nakabotar na kining device. 1 ka device = 1 ka boto ra.', 'error');
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
    setStatus(voteStatus, 'Nakabotar na kining device. 1 ka device = 1 ka boto ra.', 'error');
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
  setStatus(voteStatus, 'Malampuson ang boto! (+10 puntos). Dili na pwede mubotar pag-usab kining device.', 'success');
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
if (copyVoteLinkBtn) copyVoteLinkBtn.addEventListener('click', copyVotingLink);
if (countdownTimer) startCountdown();

if (hasDeviceEntrySubmitted()) {
  showVotingShareLink();
  setStatus(formStatus, 'Nadetect nga nakasubmit na ni nga browser kaniadto. Pwede gihapon ka mo-fillout ug mo-submit kung kinahanglan.', '');
}

loadSupabaseClient()
  .then(() => loadWinners())
  .catch((error) => {
  if (formStatus) setStatus(formStatus, `${error.message} Check Vercel environment variables.`, 'error');
  if (voterStatus) setStatus(voterStatus, `${error.message} Check Vercel environment variables.`, 'error');
});
