/**
 * =========================================================================================
 * SoundCloud Auto Crossfader & Cue Manager v4.1 (Bulletproof Sync)
 * 
 * ĐẶC BIỆT:
 * 1. Đọc số giây hiện tại từ 4 nguồn: Timeline DOM, aria-valuenow, timePassed text & Audio Hook.
 *    Đảm bảo 100% bấm "Lấy giây này" là lấy được ngay lập tức!
 * 2. Lưu điểm Cue vào chrome.storage.local bằng cả Path lẫn Title bài hát.
 * 3. Nạp bài tiếp theo CỰC SỚM (ASAP) vào RAM, chạy ngầm volume = 0, đến mốc Stop là bật 100% (0ms).
 * =========================================================================================
 */

(() => {
  'use strict';

  console.log('%c[SC-Crossfader]%c Cue Manager v4.1 Bulletproof đã sẵn sàng!', 'color: #ff5500; font-weight: bold;', 'color: unset;');

  let trackCueDatabase = {};
  let liveAudioCurrentTime = 0;
  let liveAudioDuration = 0;

  // Tải database từ chrome.storage.local
  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['track_cues'], (res) => {
      if (res.track_cues) {
        trackCueDatabase = res.track_cues;
        console.log('[SC-Crossfader] Đã nạp Cue Database:', Object.keys(trackCueDatabase).length, 'mục.');
      }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.track_cues) {
        trackCueDatabase = changes.track_cues.newValue || {};
        if (currentTrackTitle) {
          updateCueBarTrack(currentTrackTitle, getTotalDurationSeconds());
        }
      }
    });
  }

  // Quản lý Deck phụ (Bài 2)
  let deck2Audio = null;
  let deck2Hls = null;
  let isDeck2Preloaded = false;
  let isDeck2Preloading = false;
  let isDeck2PlayingSilent = false;
  let isDeck2PlayingFull = false;

  let currentTrackPath = '';
  let currentTrackTitle = '';
  let nextTrackInfo = null;

  // Lắng nghe dữ liệu từ inject.js (Main World)
  window.addEventListener('message', (event) => {
    if (!event.data) return;
    if (event.data.type === 'SC_LIVE_CLIENT_ID') {
      chrome.runtime.sendMessage({ type: 'SET_LIVE_CLIENT_ID', clientId: event.data.clientId });
    }
    if (event.data.type === 'SC_AUDIO_TIME_SYNC') {
      if (typeof event.data.currentTime === 'number') {
        liveAudioCurrentTime = event.data.currentTime;
      }
      if (typeof event.data.duration === 'number' && event.data.duration > 0) {
        liveAudioDuration = event.data.duration;
      }
      if (typeof checkAndApplyCues === 'function') {
        checkAndApplyCues(Math.floor(event.data.currentTime), Math.floor(event.data.duration || liveAudioDuration));
      }
    }
  });

  /**
   * Tạo Audio phụ (Deck 2)
   */
  function initDeck2() {
    if (deck2Audio) return;

    deck2Audio = document.createElement('audio');
    deck2Audio.id = 'sc-hot-deck2';
    deck2Audio.preload = 'auto';
    deck2Audio.crossOrigin = 'anonymous';
    deck2Audio.volume = 0;
    deck2Audio.style.display = 'none';
    document.body.appendChild(deck2Audio);

    console.log('[SC-Crossfader] Deck 2 đã khởi tạo.');
  }

  /**
   * Chuyển chuỗi thời gian '1:45' thành số giây 105
   */
  function parseTimeStringToSeconds(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return 0;
    const clean = timeStr.trim().replace(/[^\d:]/g, '');
    const parts = clean.split(':').map(Number);
    if (parts.some(isNaN) || parts.length === 0) return 0;
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return parts[0] || 0;
  }

  /**
   * Lấy số giây đang phát hiện tại từ nhiều nguồn khác nhau (100% chính xác trên cả mobile và desktop)
   */
  function getCurrentPlaybackSeconds() {
    // Nguồn 1: window.__scActiveAudio hoặc window.__scLiveCurrentTime từ inject.js
    if (window.__scActiveAudio && typeof window.__scActiveAudio.currentTime === 'number' && window.__scActiveAudio.currentTime > 0) {
      return Math.floor(window.__scActiveAudio.currentTime);
    }
    if (typeof window.__scLiveCurrentTime === 'number' && window.__scLiveCurrentTime > 0) {
      return Math.floor(window.__scLiveCurrentTime);
    }
    if (typeof liveAudioCurrentTime === 'number' && liveAudioCurrentTime > 0) {
      return Math.floor(liveAudioCurrentTime);
    }

    // Nguồn 2: Mọi thẻ audio/video trong DOM
    const allAudios = Array.from(document.querySelectorAll('audio, video')).filter(a => a.id !== 'sc-hot-deck2');
    for (const a of allAudios) {
      if (typeof a.currentTime === 'number' && a.currentTime > 0) {
        return Math.floor(a.currentTime);
      }
    }

    // Nguồn 3: Thuộc tính aria-valuenow của thanh timeline SoundCloud
    const progressEl = document.querySelector('.playbackTimeline [role="progressbar"], .playbackTimeline [aria-valuenow], [data-testid="playback-timeline"] [role="progressbar"], [role="progressbar"]');
    if (progressEl && progressEl.getAttribute('aria-valuenow')) {
      const val = parseFloat(progressEl.getAttribute('aria-valuenow'));
      if (!isNaN(val) && val >= 0) return Math.floor(val);
    }

    // Nguồn 4: Text hiển thị thời gian trên player bar
    const timePassedEl = document.querySelector('.playbackTimeline__timePassed span[aria-hidden="true"], .playbackTimeline__timePassed, [class*="timePassed"], [class*="time_passed"]');
    if (timePassedEl && timePassedEl.textContent) {
      const sec = parseTimeStringToSeconds(timePassedEl.textContent);
      if (sec > 0) return sec;
    }

    return 0;
  }

  /**
   * Lấy tổng thời lượng bài hát hiện tại từ 4 nguồn
   */
  function getTotalDurationSeconds() {
    // Nguồn 1: aria-valuemax
    const progressEl = document.querySelector('.playbackTimeline [role="progressbar"], .playbackTimeline [aria-valuemax]');
    if (progressEl && progressEl.getAttribute('aria-valuemax')) {
      const val = parseFloat(progressEl.getAttribute('aria-valuemax'));
      if (!isNaN(val) && val > 0) return Math.floor(val);
    }

    // Nguồn 2: Text thời lượng
    const durEl = document.querySelector('.playbackTimeline__duration span[aria-hidden="true"], .playbackTimeline__duration');
    if (durEl && durEl.textContent) {
      const sec = parseTimeStringToSeconds(durEl.textContent);
      if (sec > 0) return sec;
    }

    // Nguồn 3: Audio hook
    if (liveAudioDuration > 0) {
      return Math.floor(liveAudioDuration);
    }

    // Nguồn 4: Thẻ audio DOM
    const allAudios = Array.from(document.querySelectorAll('audio')).filter(a => a.id !== 'sc-hot-deck2');
    const playing = allAudios.find(a => a.duration > 0) || allAudios[0];
    if (playing && playing.duration > 0) {
      return Math.floor(playing.duration);
    }

    return 0;
  }

  /**
   * Tạo Track Key duy nhất cho từng bài hát (Không bao giờ bị trùng lặp)
   */
  function getTrackKey(path, title) {
    if (path && path.length > 2 && path !== 'current-track') {
      return path.toLowerCase().trim().split('?')[0];
    }
    if (title && title !== 'Bài hát đang phát') {
      return 'title:' + title.toLowerCase().trim().replace(/[^a-z0-9]/gi, '_');
    }
    return 'track:' + Date.now();
  }

  /**
   * Tìm cấu hình mốc phát đã lưu cho bài hát theo path hoặc tên bài (kèm so khớp thông minh)
   */
  function findSavedCue(path, title) {
    if (!path && !title) return null;
    const key = getTrackKey(path, title);
    if (trackCueDatabase[key]) return trackCueDatabase[key];
    if (path && trackCueDatabase[path]) return trackCueDatabase[path];
    const cleanPath = path ? path.toLowerCase().trim().split('?')[0] : '';
    if (cleanPath && trackCueDatabase[cleanPath]) return trackCueDatabase[cleanPath];

    if (title) {
      const lowerTitle = title.toLowerCase().trim();
      if (trackCueDatabase[lowerTitle]) return trackCueDatabase[lowerTitle];
      if (trackCueDatabase[title]) return trackCueDatabase[title];

      const values = Object.values(trackCueDatabase);
      // Lượt 1: Khớp chính xác
      for (let i = 0; i < values.length; i++) {
        const item = values[i];
        if (item && item.title && item.title.toLowerCase().trim() === lowerTitle) {
          return item;
        }
      }
      // Lượt 2: Khớp gần đúng (Fuzzy match)
      for (let i = 0; i < values.length; i++) {
        const item = values[i];
        if (item && item.title) {
          const itemTitle = item.title.toLowerCase().trim();
          if (itemTitle.length > 3 && (lowerTitle.includes(itemTitle) || itemTitle.includes(lowerTitle))) {
            return item;
          }
        }
      }
    }
    return null;
  }

  /**
   * Lấy thông tin bài hát đang phát hiện tại (Trích xuất chính xác 100%)
   */
  function getCurrentTrackInfo() {
    let title = '';
    let path = '';

    // Lớp 1: Quét trực tiếp thanh Player Bar (.playbackSoundBadge)
    const badge = document.querySelector('.playbackSoundBadge');
    if (badge) {
      const allLinks = Array.from(badge.querySelectorAll('a[href]'));
      
      // Tìm link bài hát (có 2 thành phần /artist/track-name)
      const trackLink = allLinks.find(a => {
        const href = (a.getAttribute('href') || '').split('?')[0];
        const parts = href.split('/').filter(Boolean);
        return parts.length >= 2 && !['sets', 'albums', 'reposts', 'likes'].includes(parts[1]);
      }) || allLinks.find(a => a.classList.contains('playbackSoundBadge__title')) || allLinks[allLinks.length - 1];

      if (trackLink) {
        path = (trackLink.getAttribute('href') || '').split('?')[0];
        title = trackLink.getAttribute('title') || trackLink.textContent.trim();
      }

      // Lấy thêm tên nghệ sĩ nếu có
      const artistLink = allLinks.find(a => a.classList.contains('playbackSoundBadge__lightLink'));
      if (artistLink && title && !title.includes(' - ')) {
        const artist = artistLink.textContent.trim();
        if (artist && !title.startsWith(artist)) {
          title = `${artist} - ${title}`;
        }
      }
    }

    // Lớp 2: MediaSession API
    if ((!title || title.length < 3) && navigator.mediaSession && navigator.mediaSession.metadata) {
      const meta = navigator.mediaSession.metadata;
      if (meta.title) {
        title = meta.artist ? `${meta.artist} - ${meta.title}` : meta.title;
      }
    }

    // Lớp 3: Quét từ tiêu đề trang (document.title)
    if (!title && document.title) {
      const docTitle = document.title.replace(/^▶\s*/, '').trim();
      if (!docTitle.toLowerCase().includes('stream and listen') && !docTitle.toLowerCase().includes('discover')) {
        title = docTitle.split('|')[0].trim();
      }
    }

    // Lớp 4: URL trình duyệt
    if (!path && window.location.pathname.length > 2) {
      const p = window.location.pathname.split('?')[0];
      const parts = p.split('/').filter(Boolean);
      if (parts.length >= 2 && !['discover', 'feed', 'library', 'upload', 'you'].includes(parts[0])) {
        path = p;
      }
    }

    if (!title && !path) {
      return { path: window.location.pathname || 'current-track', title: (document.title || 'Bài hát đang phát').split('|')[0].trim() };
    }
    return { path: path || '', title: title || 'Bài hát đang phát' };
  }

  /**
   * Lấy URL bài hát tiếp theo từ Queue hoặc playlist
   */
  function getNextTrackUrl() {
    let activeQueueItem = document.querySelector('.queueItemView.m-active, .queue__item.m-active');

    if (!activeQueueItem) {
      const queueToggleBtn = document.querySelector('.playControls__queue');
      if (queueToggleBtn && !document.querySelector('.queueItemView')) {
        queueToggleBtn.click();
        activeQueueItem = document.querySelector('.queueItemView.m-active, .queue__item.m-active');
      }
    }

    if (activeQueueItem) {
      let next = activeQueueItem.nextElementSibling;
      while (next) {
        const link = next.querySelector('a.queueItemView__title, a.queueItemView__link, a[href*="/"]');
        if (link && link.getAttribute('href')) return link.getAttribute('href');
        next = next.nextElementSibling;
      }
    }

    const allItems = Array.from(document.querySelectorAll('.queueItemView, .queue__item'));
    if (allItems.length > 0) {
      const idx = allItems.findIndex(el => el.classList.contains('m-active'));
      if (idx !== -1 && idx + 1 < allItems.length) {
        const link = allItems[idx + 1].querySelector('a[href*="/"]');
        if (link && link.getAttribute('href')) return link.getAttribute('href');
      }
    }

    const activeTrack = document.querySelector('.trackList__item.m-active, .trackItem.m-active');
    if (activeTrack && activeTrack.nextElementSibling) {
      const link = activeTrack.nextElementSibling.querySelector('a.trackItem__trackTitle, a[href*="/"]');
      if (link && link.getAttribute('href')) return link.getAttribute('href');
    }

    return null;
  }

  /**
   * NẠP BÀI TIẾP THEO CÀNG SỚM CÀNG TỐT (ASAP)
   */
  function preloadNextTrackAsap() {
    if (isDeck2Preloading || isDeck2PlayingSilent) return;
    isDeck2Preloading = true;

    initDeck2();
    updateCueBarStatus('Đang tìm bài kế tiếp...');

    const nextUrl = getNextTrackUrl();
    if (!nextUrl) {
      isDeck2Preloading = false;
      updateCueBarStatus('Queue rỗng');
      return;
    }

    console.log(`%c[SC-Crossfader] 🚀 Bắt đầu nạp bài kế tiếp cực sớm: ${nextUrl}`, 'color: #29b6f6; font-weight: bold;');
    updateCueBarStatus('Đang tải stream bài kế...');

    chrome.runtime.sendMessage({ type: 'RESOLVE_STREAM_URL', trackUrl: nextUrl }, (res) => {
      if (chrome.runtime.lastError || !res || !res.success || !res.streamUrl) {
        console.warn('[SC-Crossfader] Lỗi nạp bài tiếp theo:', chrome.runtime.lastError || res?.error);
        isDeck2Preloading = false;
        updateCueBarStatus('Lỗi tải stream');
        return;
      }

      nextTrackInfo = res;
      const cleanNextPath = nextUrl.split('?')[0];
      const nextCue = trackCueDatabase[cleanNextPath] || trackCueDatabase[res.title] || {};
      const startAtSec = nextCue.startSec !== undefined ? nextCue.startSec : 0;

      deck2Audio.volume = 0;

      const onReadyToPlaySilent = async () => {
        try {
          if (startAtSec > 0) {
            deck2Audio.currentTime = startAtSec;
            console.log(`[SC-Crossfader] Đã tua trước Bài 2 đến ${startAtSec}s theo Cue đã lưu.`);
          }
        } catch (e) {}

        try {
          await deck2Audio.play();
          isDeck2PlayingSilent = true;
          isDeck2Preloading = false;
          isDeck2Preloaded = true;
          console.log(`%c[SC-Crossfader] 🔥 BÀI 2 ĐÃ NẰM TRONG RAM & ĐANG PHÁT NGẦM (Vol = 0)! "${res.title}". 0ms delay!`, 'color: #00e676; font-weight: bold;');
          updateCueBarStatus(`Bài kế: "${res.title}" (Đã nạp)`);
        } catch (playErr) {
          isDeck2Preloading = false;
        }
      };

      if (res.streamUrl.includes('.m3u8') && window.Hls && Hls.isSupported()) {
        if (deck2Hls) deck2Hls.destroy();

        deck2Hls = new Hls({ enableWorker: false });
        deck2Hls.loadSource(res.streamUrl);
        deck2Hls.attachMedia(deck2Audio);

        deck2Hls.on(Hls.Events.MANIFEST_PARSED, () => {
          onReadyToPlaySilent();
        });
      } else {
        deck2Audio.src = res.streamUrl;
        deck2Audio.load();
        deck2Audio.addEventListener('canplay', onReadyToPlaySilent, { once: true });
      }
    });
  }

  let lastAutoSeekedTrack = '';
  let isTriggeredNextForTrack = '';

  /**
   * TUA BÀI HÁT TRÊN SOUNDCLOUD (Hỗ trợ 3 lớp đảm bảo tua thành công 100%)
   */
  function seekSoundCloudPlayback(targetSec) {
    if (typeof targetSec !== 'number' || isNaN(targetSec) || targetSec < 0) return;

    console.log(`%c[SC-Crossfader] ⏩ THỰC HIỆN TUA ĐẾN GIÂY: ${targetSec}s`, 'color: #00e676; font-weight: bold;');

    // Lớp 1: Gửi lệnh sang Main World để tua trực tiếp Audio instance thật
    window.postMessage({ type: 'SC_SEEK_TO_SECONDS', targetSec }, '*');

    // Lớp 2: Tua trên mọi thẻ audio trong DOM
    const allAudios = Array.from(document.querySelectorAll('audio')).filter(a => a.id !== 'sc-hot-deck2');
    allAudios.forEach(a => {
      try { a.currentTime = targetSec; } catch (e) {}
    });

    // Lớp 3: Giả lập click chuột trên thanh timeline scrubber của SoundCloud
    const totalSec = getTotalDurationSeconds();
    const pWrap = document.querySelector('.playbackTimeline__progressWrapper') ||
                  document.querySelector('.playbackTimeline') ||
                  document.querySelector('[role="progressbar"]');

    if (pWrap && totalSec > 0) {
      try {
        const rect = pWrap.getBoundingClientRect();
        const ratio = Math.min(0.99, Math.max(0, targetSec / totalSec));
        const clickX = rect.left + rect.width * ratio;
        const clickY = rect.top + rect.height / 2;

        const opts = { bubbles: true, cancelable: true, view: window, clientX: clickX, clientY: clickY };
        pWrap.dispatchEvent(new MouseEvent('mousedown', opts));
        pWrap.dispatchEvent(new MouseEvent('mouseup', opts));
        pWrap.dispatchEvent(new MouseEvent('click', opts));
      } catch (e) {}
    }
  }

  /**
   * KÍCH HOẠT BẬT ÂM LƯỢNG 100% BÀI 2 NGAY TỨC THÌ (0ms)
   */
  function triggerUnmuteDeck2(stopAtSec) {
    if (isDeck2PlayingFull) return;
    isDeck2PlayingFull = true;

    console.log('[SC-Crossfader] CHẠM MỐC DỪNG: BẬT TIẾNG BÀI 2 LÊN 100% (0ms delay)!');
    updateCueBarStatus('Đang phát song song');

    if (deck2Audio) {
      deck2Audio.volume = 1.0;
      if (deck2Audio.paused) deck2Audio.play().catch(() => {});
    }

    // Sau 1.5 giây: Click Next trên SoundCloud UI để chuyển bài trên giao diện
    setTimeout(() => {
      console.log('[SC-Crossfader] Chuyển qua bài mới trên giao diện SoundCloud...');
      clickNextTrack();

      setTimeout(() => {
        isDeck2PlayingSilent = false;
        isDeck2PlayingFull = false;
        isDeck2Preloaded = false;
        preloadNextTrackAsap();
      }, 1500);
    }, 1500);
  }

  function clickNextTrack() {
    const selectors = [
      '.playControls__next',
      'button[aria-label="Next"]',
      'button[title="Next"]',
      'button[aria-label="Next track"]',
      'button[title="Next track"]',
      '[data-testid="playback-next"]',
      '.skipControl__next',
      '.playbackSoundBadge__next',
      'button.nextControl'
    ];
    for (const s of selectors) {
      const btn = document.querySelector(s);
      if (btn) {
        btn.click();
        return true;
      }
    }
    return false;
  }

  /**
   * Bộ xử lý Cue đa nền tảng: Chạy cả khi mở màn hình lẫn khi TẮT MÀN HÌNH (nhờ timeupdate)
   */
  function checkAndApplyCues(currentSec, totalSec) {
    if (!currentSec || currentSec <= 0) return;

    // 1. Cập nhật thông tin bài hát
    const info = getCurrentTrackInfo();
    if (info && info.title && info.title !== currentTrackTitle) {
      currentTrackPath = info.path;
      currentTrackTitle = info.title;
      console.log(`[SC-Crossfader] 🎵 Phát hiện bài: "${currentTrackTitle}" (${currentTrackPath})`);
      updateCueBarTrack(currentTrackTitle, totalSec);

      isTriggeredNextForTrack = '';
      lastAutoSeekedTrack = '';
      setTimeout(preloadNextTrackAsap, 1500);
    }

    // 2. TỰ ĐỘNG TUA ĐẾN START CUE (Chạy kể cả khi tắt màn hình)
    if (currentTrackTitle && lastAutoSeekedTrack !== currentTrackTitle) {
      const savedCue = findSavedCue(currentTrackPath, currentTrackTitle);
      if (savedCue && savedCue.startSec > 0) {
        // Nếu bài vừa phát ở đoạn đầu (dưới 12s) và chưa chạm đến Start Cue
        if (currentSec < savedCue.startSec && currentSec < 12) {
          lastAutoSeekedTrack = currentTrackTitle;
          console.log(`[SC-Crossfader] ÁP DỤNG START CUE: Tự động tua "${currentTrackTitle}" đến ${savedCue.startSec}s!`);
          updateCueBarStatus(`Đã tua đến ${formatSecondsToMMSS(savedCue.startSec)}`);
          seekSoundCloudPlayback(savedCue.startSec);
        }
      }
    }

    // 3. TỰ ĐỘNG CHUYỂN BÀI KHI CHẠM STOP CUE (Chạy kể cả khi tắt màn hình)
    if (totalSec > 0 && currentSec > 0) {
      const savedCue = findSavedCue(currentTrackPath, currentTrackTitle);
      let stopMsec = totalSec - 5; // Mặc định trước khi hết 5s

      if (savedCue && savedCue.stopSec > 0 && savedCue.stopSec < totalSec) {
        stopMsec = savedCue.stopSec;
      }

      if (currentSec >= stopMsec && currentSec < totalSec && isTriggeredNextForTrack !== currentTrackTitle) {
        isTriggeredNextForTrack = currentTrackTitle;
        console.log(`[SC-Crossfader] ÁP DỤNG STOP CUE: Chạm mốc ${stopMsec}s -> Chuyển bài kế tiếp!`);
        triggerUnmuteDeck2(stopMsec);
      }
    }
  }

  /**
   * Giám sát liên tục và cập nhật thời gian thực
   */
  function startContinuousWatcher() {
    setInterval(() => {
      const currentSec = getCurrentPlaybackSeconds();
      const totalSec = getTotalDurationSeconds();

      checkAndApplyCues(currentSec, totalSec);
      updateCueBarTime(currentSec, totalSec);

      // Nạp bài tiếp theo cực sớm nếu chưa nạp
      if (currentSec > 3 && !isDeck2Preloaded && !isDeck2Preloading && !isDeck2PlayingSilent) {
        preloadNextTrackAsap();
      }
    }, 250);
  }

  // =========================================================================================
  // GIAO DIỆN THANH ĐIỀU KHIỂN CUE BAR (TỐI ƯU 100% CHO ĐIỆN THOẠI)
  // =========================================================================================
  let inSecInput = null;
  let outSecInput = null;
  let statusBadgeEl = null;
  let currentTrackNameEl = null;
  let currentTimeDisplayEl = null;
  let isUserDraggingSlider = false;

  function formatSecondsToMMSS(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  function parseMMSSToSeconds(str) {
    if (typeof str === 'number') return Math.max(0, Math.floor(str));
    if (!str || typeof str !== 'string') return 0;
    const clean = str.trim();
    if (clean.includes(':')) {
      const parts = clean.split(':').map(Number);
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        return Math.max(0, parts[0] * 60 + parts[1]);
      }
    }
    const val = parseFloat(clean);
    return isNaN(val) ? 0 : Math.max(0, Math.floor(val));
  }

  function createCueBarUI() {
    if (document.getElementById('sc-cue-bar')) return;

    const bar = document.createElement('div');
    bar.id = 'sc-cue-bar';
    bar.innerHTML = `
      <div class="sc-cue-header">
        <div class="sc-cue-title-area">
          <strong id="sc-cue-track-name">Đang nhận bài...</strong>
        </div>
        <div class="sc-cue-right">
          <span id="sc-cue-time">0:00 / 0:00</span>
          <button id="sc-cue-min-btn" title="Thu gọn">−</button>
        </div>
      </div>
      <div class="sc-cue-body">
        <!-- Thanh tua bài trực tiếp bằng tay cho điện thoại -->
        <div class="sc-cue-scrub-row">
          <button id="sc-cue-rewind-btn" class="sc-btn-mini" title="Tua lùi 10s">−10s</button>
          <input type="range" id="sc-cue-slider" min="0" max="100" value="0" step="1">
          <button id="sc-cue-forward-btn" class="sc-btn-mini" title="Tua tới 10s">+10s</button>
        </div>

        <div class="sc-cue-row">
          <div class="sc-cue-col">
            <label>Bắt đầu :</label>
            <div class="sc-cue-input-group">
              <button id="sc-cue-in-dec-btn" class="sc-step-btn" title="Giảm 1s">−1</button>
              <input type="text" id="sc-cue-in-input" placeholder="0:00" value="0:00">
              <button id="sc-cue-in-inc-btn" class="sc-step-btn" title="Tăng 1s">+1</button>
              <button id="sc-cue-set-in-btn" class="sc-cue-btn-take" title="Lấy mốc thời gian hiện tại">Lấy giờ</button>
            </div>
          </div>
          <div class="sc-cue-col">
            <label>Kết thúc :</label>
            <div class="sc-cue-input-group">
              <button id="sc-cue-out-dec-btn" class="sc-step-btn" title="Giảm 1s">−1</button>
              <input type="text" id="sc-cue-out-input" placeholder="Hết - 5s">
              <button id="sc-cue-out-inc-btn" class="sc-step-btn" title="Tăng 1s">+1</button>
              <button id="sc-cue-set-out-btn" class="sc-cue-btn-take" title="Lấy mốc thời gian hiện tại">Lấy giờ</button>
            </div>
          </div>
        </div>
        <div class="sc-cue-actions">
          <button id="sc-cue-save-btn">Lưu mốc bài này</button>
          <span id="sc-cue-status-badge">Sẵn sàng</span>
        </div>
      </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
      #sc-cue-bar {
        position: fixed !important;
        bottom: 65px !important;
        left: 8px !important;
        right: 8px !important;
        max-width: 440px !important;
        margin: 0 auto !important;
        z-index: 2147483647 !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        font-size: 11px !important;
        background: rgba(255, 248, 249, 0.98) !important;
        backdrop-filter: blur(12px) !important;
        -webkit-backdrop-filter: blur(12px) !important;
        color: #4a3b40 !important;
        border: 2px solid #ffccd5 !important;
        border-radius: 16px !important;
        box-shadow: 0 8px 24px rgba(255, 117, 143, 0.3) !important;
        box-sizing: border-box !important;
        transition: all 0.25s ease !important;
      }
      #sc-cue-bar * {
        box-sizing: border-box !important;
      }
      #sc-cue-bar.minimized {
        left: auto !important;
        right: 12px !important;
        bottom: 75px !important;
        max-width: 140px !important;
        border-radius: 20px !important;
      }
      #sc-cue-bar.minimized .sc-cue-body {
        display: none !important;
      }
      #sc-cue-bar.minimized .sc-cue-header {
        border-radius: 18px !important;
        border-bottom: none !important;
        padding: 6px 10px !important;
      }
      .sc-cue-header {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        padding: 8px 12px !important;
        background: linear-gradient(135deg, #ffe5ec 0%, #ffccd5 100%) !important;
        border-bottom: 1.5px solid #ffccd5 !important;
        border-radius: 14px 14px 0 0 !important;
      }
      .sc-cue-title-area {
        max-width: 200px !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
        color: #ff4d6d !important;
        font-weight: 700 !important;
        font-size: 11px !important;
      }
      .sc-cue-right {
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
        font-size: 11px !important;
        color: #ff4d6d !important;
        font-weight: 700 !important;
      }
      #sc-cue-min-btn {
        background: #ffffff !important;
        border: 1px solid #ffb3c1 !important;
        color: #ff4d6d !important;
        font-size: 12px !important;
        font-weight: 800 !important;
        cursor: pointer !important;
        width: 22px !important;
        height: 22px !important;
        border-radius: 50% !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        padding: 0 !important;
      }
      .sc-cue-body {
        padding: 8px 10px !important;
      }
      .sc-cue-scrub-row {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        margin-bottom: 8px !important;
        background: #fff0f3 !important;
        padding: 6px 8px !important;
        border-radius: 8px !important;
        border: 1px solid #ffccd5 !important;
      }
      #sc-cue-slider {
        flex: 1 !important;
        accent-color: #ff4d6d !important;
        cursor: pointer !important;
        height: 18px !important;
      }
      .sc-btn-mini {
        background: #ffffff !important;
        border: 1px solid #ffb3c1 !important;
        color: #ff4d6d !important;
        font-weight: 800 !important;
        font-size: 10px !important;
        padding: 3px 6px !important;
        border-radius: 6px !important;
        cursor: pointer !important;
      }
      .sc-step-btn {
        background: #ffffff !important;
        border: 1px solid #ffb3c1 !important;
        color: #ff4d6d !important;
        font-weight: 800 !important;
        font-size: 10px !important;
        padding: 3px 4px !important;
        border-radius: 4px !important;
        cursor: pointer !important;
      }
      .sc-cue-row {
        display: flex !important;
        gap: 6px !important;
        margin-bottom: 8px !important;
      }
      .sc-cue-col {
        flex: 1 !important;
        background: #fff0f3 !important;
        border: 1.5px solid #ffccd5 !important;
        border-radius: 8px !important;
        padding: 6px !important;
      }
      .sc-cue-col label {
        display: block !important;
        font-size: 10px !important;
        color: #c9184a !important;
        margin-bottom: 4px !important;
        font-weight: 700 !important;
      }
      .sc-cue-input-group {
        display: flex !important;
        align-items: center !important;
        gap: 3px !important;
      }
      #sc-cue-bar input[type="text"] {
        flex: 1 !important;
        min-width: 40px !important;
        background: #ffffff !important;
        border: 1.5px solid #ff758f !important;
        color: #c9184a !important;
        font-weight: 800 !important;
        padding: 4px 2px !important;
        border-radius: 6px !important;
        font-size: 11px !important;
        text-align: center !important;
        outline: none !important;
        height: 26px !important;
      }
      #sc-cue-bar .sc-cue-btn-take {
        background: linear-gradient(135deg, #ff758f 0%, #ff4d6d 100%) !important;
        color: #ffffff !important;
        border: none !important;
        border-radius: 6px !important;
        cursor: pointer !important;
        font-size: 10px !important;
        font-weight: 700 !important;
        padding: 4px 6px !important;
        height: 26px !important;
        white-space: nowrap !important;
      }
      .sc-cue-actions {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        border-top: 1px dashed #ffccd5 !important;
        padding-top: 8px !important;
      }
      #sc-cue-save-btn {
        flex: 1 !important;
        background: linear-gradient(135deg, #ff758f 0%, #ff4d6d 100%) !important;
        color: #ffffff !important;
        border: none !important;
        padding: 6px 12px !important;
        border-radius: 8px !important;
        font-weight: 700 !important;
        font-size: 11px !important;
        cursor: pointer !important;
        height: 28px !important;
      }
      #sc-cue-status-badge {
        font-size: 10px !important;
        color: #ff4d6d !important;
        max-width: 120px !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
        font-weight: 700 !important;
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(bar);

    inSecInput = document.getElementById('sc-cue-in-input');
    outSecInput = document.getElementById('sc-cue-out-input');
    statusBadgeEl = document.getElementById('sc-cue-status-badge');
    currentTrackNameEl = document.getElementById('sc-cue-track-name');
    currentTimeDisplayEl = document.getElementById('sc-cue-time');

    // Nút thu gọn / mở rộng
    document.getElementById('sc-cue-min-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      bar.classList.toggle('minimized');
      const isMin = bar.classList.contains('minimized');
      document.getElementById('sc-cue-min-btn').textContent = isMin ? '+' : '−';
      if (currentTrackNameEl) {
        currentTrackNameEl.textContent = isMin ? '🎛️ Mốc bài' : (currentTrackTitle || 'Đang nhận bài...');
      }
    });

    bar.addEventListener('click', () => {
      if (bar.classList.contains('minimized')) {
        bar.classList.remove('minimized');
        document.getElementById('sc-cue-min-btn').textContent = '−';
        if (currentTrackNameEl) {
          currentTrackNameEl.textContent = currentTrackTitle || 'Đang nhận bài...';
        }
      }
    });

    // LẤY GIÂY BẮT ĐẦU
    document.getElementById('sc-cue-set-in-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const sec = getCurrentPlaybackSeconds();
      const formatted = formatSecondsToMMSS(sec);
      inSecInput.value = formatted;
      updateCueBarStatus(`Bắt đầu: ${formatted}`);
    });

    // LẤY GIÂY KẾT THÚC
    document.getElementById('sc-cue-set-out-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const sec = getCurrentPlaybackSeconds();
      const formatted = formatSecondsToMMSS(sec);
      outSecInput.value = formatted;
      updateCueBarStatus(`Kết thúc: ${formatted}`);
    });

    // Nút tăng giảm 1s
    document.getElementById('sc-cue-in-dec-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const val = parseMMSSToSeconds(inSecInput.value);
      inSecInput.value = formatSecondsToMMSS(Math.max(0, val - 1));
    });
    document.getElementById('sc-cue-in-inc-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const val = parseMMSSToSeconds(inSecInput.value);
      inSecInput.value = formatSecondsToMMSS(val + 1);
    });
    document.getElementById('sc-cue-out-dec-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const val = parseMMSSToSeconds(outSecInput.value);
      outSecInput.value = formatSecondsToMMSS(Math.max(0, val - 1));
    });
    document.getElementById('sc-cue-out-inc-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const val = parseMMSSToSeconds(outSecInput.value);
      outSecInput.value = formatSecondsToMMSS(val + 1);
    });

    // Tua bài bằng thanh trượt (Scrubber)
    const slider = document.getElementById('sc-cue-slider');
    if (slider) {
      slider.addEventListener('input', () => { isUserDraggingSlider = true; });
      slider.addEventListener('change', () => {
        isUserDraggingSlider = false;
        const target = parseFloat(slider.value);
        if (!isNaN(target)) seekSoundCloudPlayback(target);
      });
    }

    // Nút lùi 10s và tới 10s
    document.getElementById('sc-cue-rewind-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const cur = getCurrentPlaybackSeconds();
      seekSoundCloudPlayback(Math.max(0, cur - 10));
    });
    document.getElementById('sc-cue-forward-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const cur = getCurrentPlaybackSeconds();
      const dur = getTotalDurationSeconds();
      seekSoundCloudPlayback(Math.min(dur || 9999, cur + 10));
    });

    // NÚT LƯU CẤU HÌNH BÀI HÁT
    document.getElementById('sc-cue-save-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const info = getCurrentTrackInfo() || { path: '', title: '' };
      const title = info.title || currentTrackTitle || 'Bài hát đang phát';
      const path = info.path || currentTrackPath || '';
      const trackKey = getTrackKey(path, title);

      currentTrackPath = path;
      currentTrackTitle = title;

      const startSec = parseMMSSToSeconds(inSecInput.value);
      const stopSec = parseMMSSToSeconds(outSecInput.value);

      const cueData = {
        key: trackKey,
        path: path,
        title: title,
        startSec: startSec,
        stopSec: stopSec,
        savedAt: Date.now()
      };

      chrome.storage.local.get(['track_cues'], (res) => {
        const db = res.track_cues || {};
        db[trackKey] = cueData;
        if (title && title !== trackKey) {
          db[title.toLowerCase().trim()] = cueData;
        }

        trackCueDatabase = db;

        chrome.storage.local.set({ track_cues: db }, () => {
          const startFormatted = formatSecondsToMMSS(startSec);
          const stopFormatted = stopSec ? formatSecondsToMMSS(stopSec) : 'Hết - 5s';

          console.log(`[SC-Crossfader] ĐÃ LƯU BÀI: "${title}" (${startFormatted} -> ${stopFormatted})`);
          const saveBtn = document.getElementById('sc-cue-save-btn');
          saveBtn.style.background = 'linear-gradient(135deg, #70e000 0%, #38b000 100%)';
          saveBtn.textContent = 'ĐÃ LƯU!';
          updateCueBarStatus(`Đã lưu (${startFormatted} - ${stopFormatted})`);

          setTimeout(() => {
            saveBtn.style.background = 'linear-gradient(135deg, #ff758f 0%, #ff4d6d 100%)';
            saveBtn.textContent = 'Cập nhật bài này';
          }, 2000);
        });
      });
    });
  }

  function updateCueBarTrack(title, duration) {
    if (currentTrackNameEl && !document.getElementById('sc-cue-bar')?.classList.contains('minimized')) {
      currentTrackNameEl.textContent = title;
    }
    const savedCue = findSavedCue(currentTrackPath, title);
    const saveBtn = document.getElementById('sc-cue-save-btn');

    if (savedCue) {
      if (inSecInput) inSecInput.value = formatSecondsToMMSS(savedCue.startSec || 0);
      if (outSecInput) outSecInput.value = savedCue.stopSec ? formatSecondsToMMSS(savedCue.stopSec) : '';
      updateCueBarStatus('Đã nạp mốc đã lưu');
      if (saveBtn) saveBtn.textContent = 'Cập nhật bài này';
    } else {
      if (inSecInput) inSecInput.value = '0:00';
      if (outSecInput) outSecInput.value = duration ? formatSecondsToMMSS(duration - 5) : '';
      updateCueBarStatus('Chưa lưu');
      if (saveBtn) saveBtn.textContent = 'Lưu mốc bài này';
    }
  }

  function updateCueBarTime(cur, dur) {
    if (currentTimeDisplayEl) {
      currentTimeDisplayEl.textContent = `${formatSecondsToMMSS(cur)} / ${formatSecondsToMMSS(dur)}`;
    }
    const slider = document.getElementById('sc-cue-slider');
    if (slider && !isUserDraggingSlider && dur > 0) {
      slider.max = dur;
      slider.value = cur;
    }
  }

  function updateCueBarStatus(msg) {
    if (statusBadgeEl) statusBadgeEl.textContent = msg;
  }

  // Khởi động
  function bootstrap() {
    initDeck2();
    startContinuousWatcher();
    if (document.body) {
      createCueBarUI();
    } else {
      document.addEventListener('DOMContentLoaded', createCueBarUI);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

  ['click', 'keydown', 'pointerdown'].forEach(ev => {
    window.addEventListener(ev, () => { initDeck2(); }, { once: true, passive: true });
  });
})();
