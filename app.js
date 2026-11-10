// Render interchangeable Audio Narrative catalogs with story browsing and deterministic musical search.
let activeAudio = null;
let activeRow = null;
let playbackSession = null;
let catalogData = null;
let catalogURL = null;
const catalogElement = document.querySelector('#catalog');
const searchElement = document.querySelector('#search-results');
const summary = document.querySelector('#summary');

function element(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function stopPlayback() {
  const session = playbackSession;
  playbackSession = null;
  if (session?.button) {
    session.button.textContent = '▶ Play story';
    session.button.setAttribute('aria-pressed', 'false');
  }
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.onended = null;
    activeAudio.onerror = null;
  }
  activeRow?.classList.remove('active');
  activeAudio = null;
  activeRow = null;
}

function playNext(session) {
  if (playbackSession !== session) return;
  if (session.index >= session.rows.length) {
    stopPlayback();
    return;
  }
  const row = session.rows[session.index++];
  const audio = row.querySelector('audio');
  if (!audio) {
    playNext(session);
    return;
  }
  if (activeAudio && activeAudio !== audio) activeAudio.pause();
  activeRow?.classList.remove('active');
  activeRow = row;
  activeAudio = audio;
  row.classList.add('active');
  for (const section of [row.closest('.theme-section'), row.closest('.prompt')]) {
    section?.classList.add('open');
    section?.querySelector('.theme-toggle, .prompt-toggle')?.setAttribute('aria-expanded', 'true');
  }
  let advanced = false;
  const advance = () => {
    if (advanced || playbackSession !== session) return;
    advanced = true;
    playNext(session);
  };
  audio.onended = advance;
  audio.onerror = advance;
  try {
    audio.currentTime = 0;
    const result = audio.play();
    if (result?.catch) result.catch(advance);
  } catch (_) {
    advance();
  }
}

function startPlayback(rows, button = null) {
  stopPlayback();
  if (!rows.length) return;
  const session = {rows, index: 0, button};
  playbackSession = session;
  if (button) {
    button.textContent = '■ Stop story';
    button.setAttribute('aria-pressed', 'true');
  }
  playNext(session);
}

function resolveURL(url, base) {
  if (typeof url !== 'string' || !url.trim()) throw Error('Missing audio URL');
  const resolved = new URL(url, base);
  if (!['https:', 'http:'].includes(resolved.protocol)) throw Error('Unsupported audio URL');
  return resolved.href;
}

function validateCatalog(data) {
  if (!data || data.schema !== 'mushroom.audio-narrative.catalog' ||
      data.schema_version !== 1 || !Array.isArray(data.stories))
    throw Error('Unsupported catalog schema or version');
  const storyIDs = new Set(), sceneIDs = new Set(), recordingIDs = new Set();
  for (const story of data.stories) {
    if (!story.id || !story.title || !Array.isArray(story.scenes) || storyIDs.has(story.id))
      throw Error('Invalid or duplicate story');
    storyIDs.add(story.id);
    for (const scene of story.scenes) {
      if (!scene.id || !scene.title || typeof scene.prompt !== 'string' ||
          !Array.isArray(scene.recordings) || sceneIDs.has(scene.id))
        throw Error('Invalid or duplicate scene');
      sceneIDs.add(scene.id);
      for (const recording of scene.recordings) {
        if (!recording.id || recordingIDs.has(recording.id) ||
            !recording.audio || !recording.audio.url || !recording.audio.format)
          throw Error('Invalid or duplicate recording');
        recordingIDs.add(recording.id);
      }
    }
  }
  return data;
}

function makeRecording(recording, index) {
  const row = element('div', 'recording');
  const line = element('div', 'track-line');
  const play = element('button', 'play', '▶');
  play.type = 'button';
  play.setAttribute('aria-label', 'Play recording ' + index);
  line.append(play, element('span', 'track-index', String(index).padStart(2, '0')),
              element('span', 'track-label', recording.model || recording.audio.format.toUpperCase()),
              element('span', 'track-state'));
  const detail = element('div', 'track-detail');
  const audio = element('audio');
  audio.controls = true;
  audio.preload = 'none';
  audio.src = resolveURL(recording.audio.url, catalogURL);
  const track = {...recording, src: audio.src, _catalogURL: catalogURL};
  const metadata = element('p', 'meta', 'ID: ' + recording.id);
  detail.append(audio, makeDownloadControls(track), metadata);
  row.append(line, detail);
  play.onclick = () => {
    if (activeRow === row) stopPlayback();
    else {
      const visible = row.closest('#search-results') ? searchElement : catalogElement;
      const rows = [...visible.querySelectorAll('.recording')];
      startPlayback(rows.slice(rows.indexOf(row)));
    }
  };
  audio.addEventListener('play', () => {
    play.textContent = 'Ⅱ';
    if (activeAudio !== audio) {
      const visible = row.closest('#search-results') ? searchElement : catalogElement;
      const rows = [...visible.querySelectorAll('.recording')];
      startPlayback(rows.slice(rows.indexOf(row)));
    }
  });
  audio.addEventListener('pause', () => { play.textContent = '▶'; });
  audio.addEventListener('ended', () => { play.textContent = '▶'; });
  return row;
}

function makeScene(scene) {
  const section = element('section', 'prompt');
  const toggle = element('button', 'prompt-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.append(element('span', 'chevron', '›'),
                element('span', 'prompt-name', scene.title),
                element('span', 'prompt-count', scene.recordings.length + ' recordings'));
  const body = element('div', 'prompt-body');
  body.append(element('p', 'prompt-text', scene.prompt));
  const list = element('div', 'track-list');
  scene.recordings.forEach((recording, i) => list.append(makeRecording(recording, i + 1)));
  body.append(list);
  toggle.onclick = () => {
    const open = section.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  };
  section.append(toggle, body);
  return section;
}

function renderStories() {
  stopPlayback();
  catalogElement.replaceChildren();
  for (const story of catalogData.stories) {
    const section = element('section', 'theme-section');
    const header = element('div', 'theme-header');
    const toggle = element('button', 'theme-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    const count = story.scenes.reduce((n, scene) => n + scene.recordings.length, 0);
    toggle.append(element('span', 'chevron', '›'),
                  element('span', 'theme-name', story.title),
                  element('span', 'theme-count', story.scenes.length + ' scenes · ' + count + ' recordings'));
    const play = element('button', 'theme-play', '▶ Play story');
    play.type = 'button';
    play.setAttribute('aria-pressed', 'false');
    const body = element('div', 'theme-body');
    if (story.description) body.append(element('p', 'story-description', story.description));
    [...story.scenes].sort((a, b) => a.order - b.order).forEach(scene => body.append(makeScene(scene)));
    toggle.onclick = () => {
      const open = section.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    };
    play.onclick = () => {
      if (playbackSession?.button === play) stopPlayback();
      else {
        section.classList.add('open');
        toggle.setAttribute('aria-expanded', 'true');
        startPlayback([...body.querySelectorAll('.recording')], play);
      }
    };
    header.append(toggle, play);
    section.append(header, body);
    catalogElement.append(section);
  }
}

const vocabulary = {
  style: {
    jazz: ['jazz', 'swing'], classical: ['classical', 'orchestral'],
    chamber: ['chamber'], ambient: ['ambient', 'atmospheric']
  },
  instrument: {
    saxophone: ['saxophone', 'sax'], piano: ['piano'],
    cello: ['cello', 'cellos'], violin: ['violin', 'violins'],
    guitar: ['guitar'], bass: ['bass'], drums: ['drums', 'percussion']
  },
  mood: {
    gentle: ['gentle', 'delicate'], playful: ['playful'],
    warm: ['warm'], tense: ['tense', 'tension'],
    romantic: ['romantic']
  }
};

function containsWord(text, word) {
  return new RegExp('(?:^|[^a-z])' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:$|[^a-z])', 'i').test(text);
}

function matchesFilter(prompt, category, selected) {
  if (!selected) return true;
  return (vocabulary[category][selected] || []).some(word => containsWord(prompt, word));
}

function sceneBPM(prompt) {
  const match = prompt.match(/\b(\d{2,3})\s*BPM\b/i);
  return match ? Number(match[1]) : null;
}

function searchScenes() {
  if (!catalogData) return;
  const query = document.querySelector('#search-text').value.trim().toLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);
  const style = document.querySelector('#filter-style').value;
  const instrument = document.querySelector('#filter-instrument').value;
  const mood = document.querySelector('#filter-mood').value;
  const minimum = document.querySelector('#bpm-min').value;
  const maximum = document.querySelector('#bpm-max').value;
  const results = [];
  for (const story of catalogData.stories) {
    for (const scene of story.scenes) {
      const prompt = scene.prompt.toLowerCase();
      const bpm = sceneBPM(scene.prompt);
      if (!matchesFilter(prompt, 'style', style) ||
          !matchesFilter(prompt, 'instrument', instrument) ||
          !matchesFilter(prompt, 'mood', mood) ||
          (minimum !== '' && (bpm === null || bpm < Number(minimum))) ||
          (maximum !== '' && (bpm === null || bpm > Number(maximum)))) continue;
      const haystack = [story.title, scene.title, scene.prompt].join(' ').toLowerCase();
      if (!terms.every(term => haystack.includes(term))) continue;
      const score = terms.reduce((n, term) => n + (prompt.includes(term) ? 2 : 1), 0) +
                    (query && haystack.includes(query) ? 5 : 0);
      results.push({story, scene, bpm, score});
    }
  }
  results.sort((a, b) => b.score - a.score || a.story.title.localeCompare(b.story.title) ||
               a.scene.order - b.scene.order);
  searchElement.replaceChildren();
  document.querySelector('#search-count').textContent = results.length + ' matching scenes';
  for (const result of results) {
    const section = element('section', 'search-result');
    section.append(element('p', 'search-story', result.story.title +
      (result.bpm === null ? '' : ' · ' + result.bpm + ' BPM')));
    const scene = makeScene(result.scene);
    scene.classList.add('open');
    scene.querySelector('.prompt-toggle').setAttribute('aria-expanded', 'true');
    section.append(scene);
    searchElement.append(section);
  }
  if (!results.length) searchElement.append(element('p', 'empty-results', 'No matching scenes.'));
}

function showTab(tab) {
  stopPlayback();
  const searching = tab === 'search';
  document.querySelector('#stories-panel').hidden = searching;
  document.querySelector('#search-panel').hidden = !searching;
  document.querySelector('#tab-stories').setAttribute('aria-selected', String(!searching));
  document.querySelector('#tab-search').setAttribute('aria-selected', String(searching));
  if (searching) searchScenes();
}

async function loadCatalog(url) {
  stopPlayback();
  const target = new URL(url, window.location.href);
  if (!['https:', 'http:'].includes(target.protocol)) throw Error('Catalog must use HTTP or HTTPS');
  summary.textContent = 'Loading catalog…';
  const response = await fetch(target.href);
  if (!response.ok) throw Error('Catalog HTTP ' + response.status);
  const data = validateCatalog(await response.json());
  // Commit URL and data only after validation succeeds.
  catalogURL = target.href;
  catalogData = data;
  renderStories();
  const scenes = data.stories.reduce((n, story) => n + story.scenes.length, 0);
  const recordings = data.stories.reduce((n, story) =>
    n + story.scenes.reduce((m, scene) => m + scene.recordings.length, 0), 0);
  summary.textContent = data.stories.length + ' stories · ' + scenes +
                        ' scenes · ' + recordings + ' recordings';
  document.querySelector('#catalog-url').value = catalogURL;
  const selectedLibrary = document.querySelector('#library-select');
  const relativeCatalog = new URL(catalogURL).pathname.split('/').pop();
  const isLocalCatalog = new URL(catalogURL).origin === window.location.origin &&
    new URL(catalogURL).pathname === new URL(relativeCatalog, window.location.href).pathname;
  selectedLibrary.value = isLocalCatalog &&
    ['catalog.json', 'catalog-legacy.json'].includes(relativeCatalog) ? relativeCatalog : '';
  searchScenes();
}

document.querySelector('#tab-stories').onclick = () => showTab('stories');
document.querySelector('#tab-search').onclick = () => showTab('search');
document.querySelector('#collapse-all').onclick = () => {
  stopPlayback();
  catalogElement.querySelectorAll('.theme-section.open, .prompt.open').forEach(section => {
    section.classList.remove('open');
    section.querySelector('.theme-toggle, .prompt-toggle')?.setAttribute('aria-expanded', 'false');
  });
};
for (const selector of ['#search-text', '#filter-style', '#filter-instrument',
                         '#filter-mood', '#bpm-min', '#bpm-max']) {
  document.querySelector(selector).addEventListener('input', searchScenes);
}
document.querySelector('#library-select').addEventListener('change', async event => {
  const choice = event.target.value;
  if (!choice) {
    document.querySelector('#catalog-url').focus();
    return;
  }
  try {
    await loadCatalog(choice);
    const next = new URL(window.location.href);
    next.searchParams.set('catalog', choice);
    history.replaceState(null, '', next);
    document.querySelector('#catalog-error').textContent = '';
  } catch (error) {
    document.querySelector('#catalog-error').textContent = error.message;
  }
});
document.querySelector('#catalog-form').onsubmit = async event => {
  event.preventDefault();
  const url = document.querySelector('#catalog-url').value.trim();
  try {
    await loadCatalog(url);
    const next = new URL(window.location.href);
    next.searchParams.set('catalog', catalogURL);
    history.replaceState(null, '', next);
    document.querySelector('#catalog-error').textContent = '';
  } catch (error) {
    document.querySelector('#catalog-error').textContent = error.message;
  }
};
const initial = new URLSearchParams(window.location.search).get('catalog') || 'catalog.json';
loadCatalog(initial).catch(error => {
  summary.textContent = 'Catalog unavailable';
  document.querySelector('#catalog-error').textContent =
    error.message + ' · Enter a reachable catalog URL above.';
});
