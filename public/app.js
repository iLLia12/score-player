/* global alphaTab */
(() => {
  const $ = (id) => document.getElementById(id);
  const viewport = $('viewport');
  const overlay = $('overlay');
  const overlayText = $('overlay-text');

  const TEXT_EXT = ['atex', 'tex'];

  // ---------- alphaTab setup ----------
  const api = new alphaTab.AlphaTabApi($('score'), {
    core: {
      fontDirectory: new URL('/alphatab/font/', location.href).href,
      // Render on the main thread: reliable everywhere and fast for typical scores.
      useWorkers: false,
      // Needed to position fingering numbers above individual note heads.
      includeNoteBounds: true,
    },
    display: {
      layoutMode: alphaTab.LayoutMode.Page,
      staveProfile: alphaTab.StaveProfile.Default,
      scale: 1,
    },
    player: {
      playerMode: alphaTab.PlayerMode.EnabledSynthesizer,
      soundFont: new URL('/alphatab/soundfont/sonivox.sf2', location.href).href, // grand piano is appended later
      scrollElement: viewport,
      enableCursor: true,
      enableAnimatedBeatCursor: true,
      enableUserInteraction: true,
      scrollOffsetY: -80,
    },
  });

  api.masterVolume = 0.8;

  let currentFile = null; // { name, data (Uint8Array|string) } of a locally opened file
  let currentLibraryName = null;

  // ---------- fingering ----------
  const params = new URLSearchParams(location.search);
  let fingeringOn = params.has('fingering') ? params.get('fingering') === '1' : localStorage.getItem('fingering') === '1';
  let fingerMap = new Map(); // Note -> { finger: 1..5, hand: 'left' | 'right' }

  function computeFingering(score) {
    // Fingering stored in the file wins; the optimizer fills in everything else.
    const fromFile = new Map();
    for (const track of score.tracks)
      for (const staff of track.staves)
        for (const bar of staff.bars)
          for (const voice of bar.voices)
            for (const beat of voice.beats)
              for (const note of beat.notes) {
                const f = note.rightHandFinger >= 0 ? note.rightHandFinger : note.leftHandFinger;
                if (f >= 0) fromFile.set(note, f + 1);
                // Hide alphaTab's own fingering glyphs; we draw our own above the notes.
                note.leftHandFinger = note.rightHandFinger = -2;
              }
    fingerMap = PianoFingering.computeScoreFingering(score, (n) => fromFile.get(n) || null);
  }

  /**
   * Exact end of a beat's stem (or beam) in page coordinates, read from alphaTab's layout.
   * This is internal alphaTab API, so it returns null when unavailable and callers fall
   * back to an estimate.
   */
  function stemEnd(beat, staffBounds) {
    try {
      const layout = (api.renderer.instance || api.renderer).layout;
      const r = layout && layout.getRendererForBar('score', beat.voice.bar);
      if (!r || !r.hasStem(beat)) return null;
      const line0 = r.getLineY(0);
      const k = staffBounds.h / (r.getLineY(4) - line0); // renderer units -> page px
      const y = staffBounds.y + (r.getBeatStemEndY(beat) - line0) * k;
      return Number.isFinite(y) ? { y, beam: r.beamThickness * k } : null;
    } catch (_) {
      return null;
    }
  }

  /** Vertical extent of everything drawn for a beat: note heads, stem and beam. */
  function beatExtent(beat, bb) {
    const staff = bb.barBounds.visualBounds;
    const space = staff.h / 4;
    const heads = (bb.notes || []).map((nb) => nb.noteHeadBounds);
    let top = staff.y;
    let bottom = staff.y + staff.h;
    if (!heads.length) return { top, bottom };
    const headTop = Math.min(...heads.map((h) => h.y));
    const headBottom = Math.max(...heads.map((h) => h.y + h.h));
    top = Math.min(top, headTop);
    bottom = Math.max(bottom, headBottom);
    const stem = stemEnd(beat, staff);
    if (stem) {
      top = Math.min(top, stem.y - stem.beam);
      bottom = Math.max(bottom, stem.y + stem.beam);
    } else if (beat.duration > 1) {
      // Estimate: notes below the middle line get an upward stem (~3.5 spaces + beam).
      const center = heads.reduce((sum, h) => sum + h.y + h.h / 2, 0) / heads.length;
      if (center > staff.y + staff.h / 2) top = Math.min(top, headTop + heads[0].h / 2 - 4 * space);
      else bottom = Math.max(bottom, headBottom - heads[0].h / 2 + 4 * space);
    }
    return { top, bottom };
  }

  function drawFingering() {
    const host = $('score');
    host.querySelector('.fingering-layer')?.remove();
    const lookup = api.renderer.boundsLookup;
    if (!fingeringOn || !lookup || !fingerMap.size) return;

    // Group fingered notes per beat.
    const beats = new Map();
    for (const [note, info] of fingerMap) {
      if (note.isTieDestination) continue; // held notes keep their finger, no new number
      if (!beats.has(note.beat)) beats.set(note.beat, []);
      beats.get(note.beat).push({ note, ...info });
    }

    const scale = api.settings.display.scale;
    const fontSize = Math.round(13 * scale);
    const lineH = fontSize * 0.95;
    const gap = 3 * scale;
    const layer = document.createElement('div');
    layer.className = 'fingering-layer';
    layer.style.fontSize = fontSize + 'px';

    // Pass 1: collect placements and, per bar, the extent of everything drawn in it, so the
    // numbers of a bar share one row that clears all notes, stems and beams.
    const placements = [];
    const rows = new Map();
    for (const [beat, items] of beats) {
      const allBounds = lookup.findBeats(beat) || [lookup.findBeat(beat)].filter(Boolean);
      items.sort((a, b) => b.note.realValue - a.note.realValue); // top number = top note
      for (const bb of allBounds) {
        const heads = (bb.notes || []).filter((nb) => items.some((it) => it.note === nb.note));
        const x = heads.length
          ? (({ x, w }) => x + w / 2)(heads.reduce((a, b) => (b.noteHeadBounds.y < a.noteHeadBounds.y ? b : a)).noteHeadBounds)
          : bb.visualBounds.x + bb.visualBounds.w / 2;
        const staff = bb.barBounds.visualBounds;
        const key = Math.round(staff.y) + ':' + Math.round(staff.x);
        if (!rows.has(key)) {
          // Lowest point of the staff above in the same system (if any): numbers must not reach it.
          const above = (bb.barBounds.masterBarBounds?.bars || [])
            .map((b) => b.visualBounds)
            .filter((v) => v.y < staff.y)
            .sort((a, b) => b.y - a.y)[0];
          rows.set(key, { top: Infinity, bottom: -Infinity, count: 0, limit: above ? above.y + above.h + staff.h / 4 * 1.5 : -Infinity });
        }
        const row = rows.get(key);
        const ext = beatExtent(beat, bb);
        row.top = Math.min(row.top, ext.top);
        row.bottom = Math.max(row.bottom, ext.bottom);
        row.count = Math.max(row.count, items.length);
        placements.push({ items, x, row });
      }
    }

    // Pass 2: numbers go above the notes; if that would run into the staff above
    // (e.g. left-hand chords under the treble staff), that bar's numbers go below instead.
    for (const { items, x, row } of placements) {
      const el = document.createElement('div');
      el.className = 'finger ' + items[0].hand;
      for (const it of items) {
        const s = document.createElement('span');
        s.textContent = it.finger;
        el.appendChild(s);
      }
      el.style.left = x + 'px';
      const fitsAbove = row.top - gap - row.count * lineH >= row.limit;
      if (fitsAbove) el.style.top = row.top - gap - items.length * lineH + 'px';
      else el.style.top = row.bottom + gap + 'px';
      layer.appendChild(el);
    }
    host.appendChild(layer);
  }

  /** Extra vertical room between staves and systems so the numbers never collide. */
  function applyFingeringSpacing(on) {
    const d = api.settings.display;
    d.systemPaddingTop = on ? 22 : 10;
    d.systemPaddingBottom = on ? 40 : 10;
    d.notationStaffPaddingTop = on ? 12 : 0;
  }

  function setFingering(on) {
    fingeringOn = on;
    localStorage.setItem('fingering', on ? '1' : '0');
    $('fingering').classList.toggle('on', on);
    applyFingeringSpacing(on);
    api.updateSettings();
    if (api.score) api.render(); // re-layout; numbers are drawn after rendering finishes
    else drawFingering();
  }

  function showOverlay(text) {
    overlayText.textContent = text;
    overlay.classList.add('show');
  }
  function hideOverlay() {
    overlay.classList.remove('show');
  }

  // ---------- loading scores ----------
  function ext(name) {
    return name.split('.').pop().toLowerCase();
  }

  function loadData(name, data) {
    showOverlay('Rendering score…');
    try {
      if (typeof data === 'string') api.tex(data);
      else api.load(data);
    } catch (e) {
      hideOverlay();
      alert('Could not open "' + name + '":\n' + (e.message || e));
    }
  }

  async function openFromLibrary(name) {
    showOverlay('Loading ' + name + '…');
    try {
      const res = await fetch('/scores/' + encodeURIComponent(name));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = TEXT_EXT.includes(ext(name)) ? await res.text() : new Uint8Array(await res.arrayBuffer());
      currentFile = null;
      currentLibraryName = name;
      $('save-btn').disabled = true;
      highlightLibrary();
      loadData(name, data);
    } catch (e) {
      hideOverlay();
      alert('Failed to load ' + name + ': ' + e.message);
    }
  }

  async function openLocalFile(file) {
    const isText = TEXT_EXT.includes(ext(file.name));
    const data = isText ? await file.text() : new Uint8Array(await file.arrayBuffer());
    currentFile = { name: file.name, data };
    currentLibraryName = null;
    $('save-btn').disabled = false;
    highlightLibrary();
    loadData(file.name, data);
  }

  // ---------- library ----------
  async function refreshLibrary() {
    const list = $('library');
    let files = [];
    try {
      files = await (await fetch('/api/scores')).json();
    } catch (_) {}
    list.innerHTML = '';
    if (!files.length) {
      list.innerHTML = '<li class="empty">No scores yet</li>';
      return files;
    }
    for (const f of files) {
      const li = document.createElement('li');
      li.dataset.name = f.name;
      li.title = f.name;
      const span = document.createElement('span');
      span.className = 'name';
      span.textContent = '♪ ' + f.name.replace(/\.[^.]+$/, '');
      const del = document.createElement('button');
      del.className = 'del';
      del.textContent = '✕';
      del.title = 'Remove from library';
      del.onclick = async (ev) => {
        ev.stopPropagation();
        if (!confirm('Delete "' + f.name + '" from the library?')) return;
        await fetch('/api/scores/' + encodeURIComponent(f.name), { method: 'DELETE' });
        refreshLibrary();
      };
      li.append(span, del);
      li.onclick = () => openFromLibrary(f.name);
      list.appendChild(li);
    }
    highlightLibrary();
    return files;
  }

  function highlightLibrary() {
    for (const li of $('library').children) {
      li.classList.toggle('active', li.dataset.name === currentLibraryName);
    }
  }

  $('save-btn').onclick = async () => {
    if (!currentFile) return;
    const body = typeof currentFile.data === 'string' ? currentFile.data : currentFile.data;
    const res = await fetch('/api/scores/' + encodeURIComponent(currentFile.name), { method: 'PUT', body });
    const out = await res.json();
    if (!res.ok) return alert(out.error || 'Save failed');
    currentLibraryName = out.name;
    currentFile = null;
    $('save-btn').disabled = true;
    refreshLibrary();
  };

  // ---------- file input & drag/drop ----------
  $('file-input').onchange = (e) => {
    const f = e.target.files[0];
    if (f) openLocalFile(f);
    e.target.value = '';
  };

  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    $('drop-zone').classList.add('show');
  });
  window.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) {
      dragDepth = 0;
      $('drop-zone').classList.remove('show');
    }
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    $('drop-zone').classList.remove('show');
    const f = e.dataTransfer.files[0];
    if (f) openLocalFile(f);
  });

  // ---------- score events ----------
  api.scoreLoaded.on((score) => {
    $('song-title').textContent = score.title || currentFile?.name || currentLibraryName || 'Untitled';
    const by = [score.artist, score.album, score.subTitle].filter(Boolean).join(' — ');
    $('song-artist').textContent = by || score.tracks.length + ' track' + (score.tracks.length > 1 ? 's' : '');
    document.title = (score.title || 'Score') + ' · Score Player';
    buildTrackList(score);
    computeFingering(score);
  });

  api.renderStarted.on(() => showOverlay('Rendering score…'));
  api.renderFinished.on(() => hideOverlay());
  api.postRenderFinished.on(() => drawFingering());
  api.error.on((e) => {
    if (loadingGrand) {
      // Grand piano failed to load (e.g. file missing): keep playing with the basic piano.
      loadingGrand = false;
      console.error(e);
      setSoundStatus('Concert grand unavailable — using basic piano. Run "npm run fetch-piano".');
      return;
    }
    hideOverlay();
    console.error(e);
    alert('Error: ' + (e.message || e));
  });

  // ---------- sound (SoundFonts) ----------
  // The small General MIDI SoundFont loads first (all instruments + metronome), so playback
  // is available right away. The sampled concert grand is appended on top of it: alphaTab
  // resolves presets newest-first, so it replaces only the piano (bank 0, program 0).
  const BASIC_SF = new URL('/alphatab/soundfont/sonivox.sf2', location.href).href;
  const GRAND_SF = new URL('/soundfonts/YDP-GrandPiano.sf2', location.href).href;
  let pianoSound = localStorage.getItem('pianoSound') || 'grand';
  let loadingGrand = false;
  let grandLoaded = false;
  $('piano-sound').value = pianoSound;

  function setSoundStatus(text) {
    $('sound-status').textContent = text;
  }

  function loadGrand() {
    if (loadingGrand || grandLoaded) return;
    loadingGrand = true;
    setSoundStatus('Loading concert grand…');
    api.loadSoundFont(GRAND_SF, true);
  }

  api.soundFontLoad.on((e) => {
    const pct = e.total ? Math.floor((e.loaded / e.total) * 100) : 0;
    if (loadingGrand) setSoundStatus('Loading concert grand… ' + pct + '%');
    else $('play').title = 'Loading sounds… ' + pct + '%';
  });
  api.soundFontLoaded.on(() => {
    if (loadingGrand) {
      loadingGrand = false;
      grandLoaded = true;
      setSoundStatus('Concert grand ready');
      setTimeout(() => grandLoaded && pianoSound === 'grand' && setSoundStatus(''), 2500);
    } else if (pianoSound === 'grand') {
      loadGrand(); // basic SoundFont is in; now stream the grand piano on top
    }
  });
  api.playerReady.on(() => {
    $('play').disabled = false;
    $('stop').disabled = false;
    $('play').title = 'Play / pause (Space)';
  });

  $('piano-sound').onchange = (e) => {
    pianoSound = e.target.value;
    localStorage.setItem('pianoSound', pianoSound);
    if (pianoSound === 'grand') {
      loadGrand();
    } else if (grandLoaded || loadingGrand) {
      // Drop the grand piano (frees its memory) and go back to the basic SoundFont only.
      loadingGrand = false;
      grandLoaded = false;
      setSoundStatus('');
      api.loadSoundFont(BASIC_SF, false);
    }
  };

  api.playerStateChanged.on((e) => {
    const playing = e.state === alphaTab.synth.PlayerState.Playing;
    $('play').textContent = playing ? '⏸' : '▶';
  });

  function fmt(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  let lastSecond = -1;
  let endTime = 0;
  api.playerPositionChanged.on((e) => {
    endTime = e.endTime;
    const sec = Math.floor(e.currentTime / 1000);
    if (sec !== lastSecond || e.isSeek) {
      lastSecond = sec;
      $('time-cur').textContent = fmt(e.currentTime);
      $('time-end').textContent = fmt(e.endTime);
    }
    $('progress-fill').style.width = (e.endTime ? (e.currentTime / e.endTime) * 100 : 0) + '%';
  });

  $('progress').onclick = (e) => {
    if (!endTime) return;
    const r = e.currentTarget.getBoundingClientRect();
    api.timePosition = ((e.clientX - r.left) / r.width) * endTime;
  };

  // ---------- tracks ----------
  function buildTrackList(score) {
    const list = $('tracks');
    list.innerHTML = '';
    const visible = new Set(api.tracks.map((t) => t.index));

    score.tracks.forEach((track) => {
      const li = document.createElement('li');
      li.className = 'track-row';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = visible.has(track.index);
      cb.title = 'Show this track';
      cb.onchange = () => {
        const selected = [...list.querySelectorAll('input[type=checkbox]')]
          .map((c, i) => (c.checked ? score.tracks[i] : null))
          .filter(Boolean);
        if (!selected.length) {
          cb.checked = true;
          return;
        }
        api.renderTracks(selected);
      };

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = track.name || 'Track ' + (track.index + 1);
      name.title = track.name;

      const mute = document.createElement('button');
      mute.className = 'ms mute';
      mute.textContent = 'M';
      mute.title = 'Mute';
      mute.onclick = () => {
        const on = !mute.classList.contains('on');
        mute.classList.toggle('on', on);
        api.changeTrackMute([track], on);
      };

      const solo = document.createElement('button');
      solo.className = 'ms solo';
      solo.textContent = 'S';
      solo.title = 'Solo';
      solo.onclick = () => {
        const on = !solo.classList.contains('on');
        solo.classList.toggle('on', on);
        api.changeTrackSolo([track], on);
      };

      li.append(cb, name, mute, solo);
      list.appendChild(li);
    });
  }

  // ---------- transport ----------
  $('play').onclick = () => api.playPause();
  $('stop').onclick = () => api.stop();

  function setSpeed(pct) {
    pct = Math.min(200, Math.max(25, pct));
    $('speed').value = pct;
    $('speed-val').textContent = pct + '%';
    api.playbackSpeed = pct / 100;
  }
  $('speed').oninput = (e) => setSpeed(+e.target.value);

  function toggle(btn, prop, fn) {
    const on = !btn.classList.contains('on');
    btn.classList.toggle('on', on);
    fn(on);
  }
  $('loop').onclick = () => toggle($('loop'), 'loop', (on) => (api.isLooping = on));
  $('metronome').onclick = () => toggle($('metronome'), 'met', (on) => (api.metronomeVolume = on ? 1 : 0));
  $('countin').onclick = () => toggle($('countin'), 'ci', (on) => (api.countInVolume = on ? 1 : 0));
  $('fingering').onclick = () => setFingering(!fingeringOn);
  $('fingering').classList.toggle('on', fingeringOn);
  applyFingeringSpacing(fingeringOn);
  api.updateSettings();
  $('volume').oninput = (e) => (api.masterVolume = e.target.value / 100);

  // ---------- view settings ----------
  function rerender(mutator) {
    mutator(api.settings);
    api.updateSettings();
    api.render();
  }
  $('layout').onchange = (e) => rerender((s) => (s.display.layoutMode = +e.target.value));
  $('stave').onchange = (e) => rerender((s) => (s.display.staveProfile = +e.target.value));
  $('zoom').onchange = (e) => rerender((s) => (s.display.scale = +e.target.value));

  // ---------- keyboard ----------
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input[type=text], textarea, select')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case ' ':
        e.preventDefault();
        if (!$('play').disabled) api.playPause();
        break;
      case 'l':
      case 'L':
        $('loop').click();
        break;
      case 'm':
      case 'M':
        $('metronome').click();
        break;
      case 'f':
      case 'F':
        setFingering(!fingeringOn);
        break;
      case '-':
      case '_':
        setSpeed(+$('speed').value - 5);
        break;
      case '=':
      case '+':
        setSpeed(+$('speed').value + 5);
        break;
      case 'Escape':
        api.playbackRange = null;
        api.clearPlaybackRangeHighlight?.();
        break;
    }
  });

  // ---------- boot ----------
  refreshLibrary().then((files) => {
    const wanted = params.get('score');
    const pick = files.find((f) => f.name === wanted || f.name.replace(/\.[^.]+$/, '') === wanted) || files[0];
    if (pick) openFromLibrary(pick.name);
  });
})();
