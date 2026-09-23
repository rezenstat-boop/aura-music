// AURA MUSIC — music player (mini + full), queue, shuffle/repeat, MediaSession
const Player = (() => {
  let audio = null;
  let queue = [];          // array of song objects
  let index = -1;          // current position in queue
  let order = [];          // play order (indices) for shuffle support
  let shuffle = false;
  let repeat = 'off';      // off | all | one
  let playing = false;
  let current = null;      // current song object
  let lastPlayReport = 0;

  const PLAY_SVG = '<path d="M8 5v14l11-7z"/>';
  const PAUSE_SVG = '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>';

  function init() {
    audio = document.getElementById('audio');
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', () => {
      document.getElementById('fp-duration').textContent = UI.fmtTime(audio.duration);
      document.getElementById('fp-seek-bar').max = audio.duration || 100;
    });
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', () => {
      if (current) UI.toast('Could not load audio for this song.', 'error');
    });

    // mini player controls
    document.getElementById('mp-info').onclick = openFull;
    document.getElementById('mp-play').onclick = togglePlay;
    document.getElementById('mp-prev').onclick = () => prev();
    document.getElementById('mp-next').onclick = () => next();

    // full player controls
    document.getElementById('fp-close').onclick = closeFull;
    document.getElementById('fp-play').onclick = togglePlay;
    document.getElementById('fp-prev').onclick = () => prev();
    document.getElementById('fp-next').onclick = () => next();
    document.getElementById('fp-shuffle').onclick = toggleShuffle;
    document.getElementById('fp-repeat').onclick = toggleRepeat;
    document.getElementById('fp-queue-btn').onclick = toggleQueue;
    document.getElementById('queue-close').onclick = toggleQueue;
    document.getElementById('fp-volume').oninput = (e) => { audio.volume = parseFloat(e.target.value); };
    document.getElementById('fp-seek-bar').oninput = (e) => { seekTo(parseFloat(e.target.value)); };
  }

  // ---------- queue / play ----------
  function play(song, songList) {
    if (songList) queue = songList.slice();
    index = queue.findIndex((s) => s.id === song.id);
    if (index === -1) { queue.push(song); index = queue.length - 1; }
    buildOrder();
    loadCurrent();
    playAudio();
  }

  function playFromQueue(songId) {
    const i = queue.findIndex((s) => s.id === songId);
    if (i !== -1) { index = i; loadCurrent(); playAudio(); }
  }

  function buildOrder() {
    order = queue.map((_, i) => i);
    if (shuffle) {
      order.splice(order.indexOf(index), 1);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      order.unshift(index);
    }
  }

  function nextInOrder() {
    const pos = order.indexOf(index);
    if (repeat === 'all' && pos === order.length - 1) return order[0];
    if (pos !== -1 && pos < order.length - 1) return order[pos + 1];
    return null;
  }

  function loadCurrent() {
    current = queue[index];
    if (!current) return;
    audio.src = audioUrl(current.id);
    lastPlayReport = 0;
    // report a play after 10 seconds of listening (or on song end)
    if (Auth.isLoggedIn()) {
      setTimeout(() => {
        if (current && audio.src.includes(current.id) && !audio.paused && lastPlayReport === 0) {
          lastPlayReport = Date.now();
          API.recordPlay(current.id);
        }
      }, 10000);
    }
    renderMini();
    renderFull();
    renderQueue();
    updateMediaSession();
  }

  function playAudio() {
    audio.play().then(() => { playing = true; updatePlayIcons(); })
      .catch(() => { playing = false; updatePlayIcons(); });
  }

  function togglePlay() {
    if (!current) return;
    if (audio.paused) playAudio();
    else { audio.pause(); playing = false; updatePlayIcons(); }
  }

  function next(userInitiated = true) {
    if (!queue.length) return;
    const ni = nextInOrder();
    if (ni === null) {
      if (userInitiated) { index = order[0]; }
      else { audio.pause(); playing = false; updatePlayIcons(); return; }
    } else index = ni;
    loadCurrent();
    playAudio();
  }

  function prev() {
    if (!queue.length) return;
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    const pos = order.indexOf(index);
    const pi = pos > 0 ? order[pos - 1] : order[order.length - 1];
    index = pi;
    loadCurrent();
    playAudio();
  }

  function onEnded() {
    if (repeat === 'one') { audio.currentTime = 0; audio.play(); return; }
    next(false);
  }

  function onTimeUpdate() {
    if (!current) return;
    const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
    document.getElementById('mp-progress-fill').style.width = pct + '%';
    if (!document.getElementById('full-player').classList.contains('hidden')) {
      document.getElementById('fp-current').textContent = UI.fmtTime(audio.currentTime);
      const bar = document.getElementById('fp-seek-bar');
      if (!bar.matches(':active')) bar.value = audio.currentTime;
    }
  }

  function seekTo(t) { if (current && audio.duration) audio.currentTime = t; }

  function toggleShuffle() {
    shuffle = !shuffle;
    buildOrder();
    document.getElementById('fp-shuffle').classList.toggle('active', shuffle);
    UI.toast(shuffle ? 'Shuffle on' : 'Shuffle off');
  }

  function toggleRepeat() {
    repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off';
    const btn = document.getElementById('fp-repeat');
    btn.classList.toggle('active', repeat !== 'off');
    btn.title = 'Repeat: ' + repeat;
    UI.toast(repeat === 'off' ? 'Repeat off' : repeat === 'all' ? 'Repeat all' : 'Repeat one');
  }

  // ---------- rendering ----------
  function coverImg(song, big = false) {
    return `<img src="${coverUrl('song', song.id)}" alt="" onerror="this.remove()" />`;
  }

  function renderMini() {
    const mp = document.getElementById('mini-player');
    if (!current) { mp.classList.add('hidden'); return; }
    mp.classList.remove('hidden');
    document.getElementById('mp-title').textContent = current.title;
    document.getElementById('mp-artist').textContent = current.artist_name || '';
    document.getElementById('mp-cover').innerHTML = coverImg(current);
    updatePlayIcons();
  }

  function renderFull() {
    if (!current) return;
    document.getElementById('fp-title').textContent = current.title;
    const artistEl = document.getElementById('fp-artist');
    artistEl.textContent = current.artist_name || '';
    artistEl.href = `#/artist/${current.artist_id}`;
    document.getElementById('fp-cover').innerHTML = coverImg(current);
    document.getElementById('fp-duration').textContent = UI.fmtTime(current.duration || audio.duration);
    renderLikeButton();
  }

  function renderLikeButton() {
    const actions = document.getElementById('fp-actions');
    if (!current) { actions.innerHTML = ''; return; }
    const liked = !!current.liked;
    actions.innerHTML = `
      <button id="fp-like" class="${liked ? 'liked' : ''}" aria-label="Like">
        <svg viewBox="0 0 24 24"><path d="M12 21s-8-4.5-8-11a4.5 4.5 0 018-3 4.5 4.5 0 018 3c0 6.5-8 11-8 11z"/></svg>
      </button>
      <button id="fp-addpl" aria-label="Add to playlist">
        <svg viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>
      </button>`;
    document.getElementById('fp-like').onclick = () => App.toggleLike(current, renderLikeButton);
    document.getElementById('fp-addpl').onclick = () => App.openAddToPlaylist(current);
  }

  function renderQueue() {
    const list = document.getElementById('queue-list');
    if (!list) return;
    if (!queue.length) {
      list.innerHTML = UI.emptyState('Queue is empty', 'Play a song to start the queue.');
      return;
    }
    list.innerHTML = queue.map((s, i) => `
      <div class="queue-item ${i === index ? 'current' : ''}" data-q-play="${UI.escapeHtml(s.id)}">
        <div class="q-idx">${i === index ? '▶' : i + 1}</div>
        <div class="t-info">
          <div class="t-title">${UI.escapeHtml(s.title)}</div>
          <div class="t-artist">${UI.escapeHtml(s.artist_name || '')}</div>
        </div>
      </div>`).join('');
    list.querySelectorAll('[data-q-play]').forEach((el) => {
      el.onclick = () => playFromQueue(el.dataset.qPlay);
    });
  }

  function updatePlayIcons() {
    const icon = playing ? PAUSE_SVG : PLAY_SVG;
    document.getElementById('mp-play-icon').innerHTML = icon;
    document.getElementById('fp-play-icon').innerHTML = icon;
    if ('mediaSession' in navigator && current) {
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    }
  }

  function updateMediaSession() {
    if (!('mediaSession' in navigator) || !current) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: current.title,
        artist: current.artist_name || '',
        album: current.album_title || APP_NAME,
        artwork: [{ src: coverUrl('song', current.id), sizes: '512x512' }],
      });
      navigator.mediaSession.setActionHandler('play', () => playAudio());
      navigator.mediaSession.setActionHandler('pause', () => audio.pause());
      navigator.mediaSession.setActionHandler('previoustrack', () => prev());
      navigator.mediaSession.setActionHandler('nexttrack', () => next());
    } catch (e) { /* not supported */ }
  }

  // ---------- overlays ----------
  function openFull() {
    if (!current) return;
    document.getElementById('full-player').classList.remove('hidden');
  }
  function closeFull() {
    document.getElementById('full-player').classList.add('hidden');
  }
  function toggleQueue() {
    document.getElementById('queue-panel').classList.toggle('hidden');
  }

  function getQueue() { return queue; }
  function getCurrent() { return current; }
  function isPlaying() { return playing; }

  return { init, play, playFromQueue, togglePlay, next, prev, seekTo, openFull, closeFull, getQueue, getCurrent, isPlaying, toggleQueue };
})();
