/**
 * SoundCloud Auto Cue & Player Controller (content.js)
 * Tự động tua đến Start Cue & tự động chuyển bài khi chạm Stop Cue
 * Tích hợp thanh điều khiển: Tua bài, Next/Prev, Play/Pause, Lưu mốc bài hát
 */

(() => {
  'use strict';

  console.log('[SC-CueApp] Khởi tạo hệ thống quản lý mốc bài hát & tua bài SoundCloud...');

  let trackCueDatabase = {};
  let currentTrackPath = '';
  let currentTrackTitle = '';
  let activeTrackKey = '';
  let liveAudioCurrentTime = 0;
  let liveAudioDuration = 0;
  let isUserDraggingSlider = false;

  // Trạng thái áp dụng Cue cho bài hát hiện tại
  let trackState = {
    key: '',
    startSeeked: false,
    stopTriggered: false
  };

  // Đồng bộ cấu hình Cue từ storage
  function loadTrackCues(cb) {
    chrome.storage.local.get(['track_cues'], (res) => {
      trackCueDatabase = res.track_cues || {};
      if (typeof cb === 'function') cb(trackCueDatabase);
    });
  }

  loadTrackCues();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.track_cues) {
      trackCueDatabase = changes.track_cues.newValue || {};
      updateCueBarTrack(currentTrackTitle, getTotalDurationSeconds());
    }
  });

  // Lắng nghe dữ liệu đồng bộ thời gian từ inject.js (Main World)
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
      // Gọi trực tiếp checkAndApplyCues khi có timeupdate để chạy ngầm ngay cả khi tắt màn hình
      checkAndApplyCues(Math.floor(liveAudioCurrentTime), Math.floor(liveAudioDuration));
    }
  });

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
   * Chuyển số giây thành phút:giây (ví dụ 75 -> '1:15')
   */
  function formatSecondsToMMSS(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  /**
   * Chuyển chuỗi '1:10' hoặc số 70 thành số giây 70
   */
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

  /**
   * Lấy số giây đang phát hiện tại từ nhiều nguồn khác nhau
   */
  function getCurrentPlaybackSeconds() {
    if (typeof liveAudioCurrentTime === 'number' && liveAudioCurrentTime > 0) {
      return Math.floor(liveAudioCurrentTime);
    }
    if (window.__scActiveAudio && typeof window.__scActiveAudio.currentTime === 'number' && window.__scActiveAudio.currentTime > 0) {
      return Math.floor(window.__scActiveAudio.currentTime);
    }
    if (typeof window.__scLiveCurrentTime === 'number' && window.__scLiveCurrentTime > 0) {
      return Math.floor(window.__scLiveCurrentTime);
    }

    const allAudios = Array.from(document.querySelectorAll('audio, video')).filter(a => a.id !== 'sc-hot-deck2');
    for (const a of allAudios) {
      if (typeof a.currentTime === 'number' && a.currentTime > 0) {
        return Math.floor(a.currentTime);
      }
    }

    const progressEl = document.querySelector('.playbackTimeline [role="progressbar"], .playbackTimeline [aria-valuenow], [data-testid="playback-timeline"] [role="progressbar"], [role="progressbar"]');
    if (progressEl && progressEl.getAttribute('aria-valuenow')) {
      const val = parseFloat(progressEl.getAttribute('aria-valuenow'));
      if (!isNaN(val) && val >= 0) return Math.floor(val);
    }

    const timePassedEl = document.querySelector('.playbackTimeline__timePassed span[aria-hidden="true"], .playbackTimeline__timePassed, [class*="timePassed"], [class*="time_passed"]');
    if (timePassedEl && timePassedEl.textContent) {
      const sec = parseTimeStringToSeconds(timePassedEl.textContent);
      if (sec > 0) return sec;
    }

    return 0;
  }

  /**
   * Lấy tổng thời lượng bài hát hiện tại
   */
  function getTotalDurationSeconds() {
    const progressEl = document.querySelector('.playbackTimeline [role="progressbar"], .playbackTimeline [aria-valuemax]');
    if (progressEl && progressEl.getAttribute('aria-valuemax')) {
      const val = parseFloat(progressEl.getAttribute('aria-valuemax'));
      if (!isNaN(val) && val > 0) return Math.floor(val);
    }

    const durEl = document.querySelector('.playbackTimeline__duration span[aria-hidden="true"], .playbackTimeline__duration');
    if (durEl && durEl.textContent) {
      const sec = parseTimeStringToSeconds(durEl.textContent);
      if (sec > 0) return sec;
    }

    if (liveAudioDuration > 0) {
      return Math.floor(liveAudioDuration);
    }

    const allAudios = Array.from(document.querySelectorAll('audio')).filter(a => a.id !== 'sc-hot-deck2');
    const playing = allAudios.find(a => a.duration > 0) || allAudios[0];
    if (playing && playing.duration > 0) {
      return Math.floor(playing.duration);
    }

    return 0;
  }

  /**
   * Tạo Track Key duy nhất cho từng bài hát
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
   * Tìm cấu hình mốc phát đã lưu cho bài hát theo path hoặc tên bài
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
      for (let i = 0; i < values.length; i++) {
        const item = values[i];
        if (item && item.title && item.title.toLowerCase().trim() === lowerTitle) {
          return item;
        }
      }
    }
    return null;
  }

  /**
   * Lấy thông tin bài hát đang phát hiện tại
   */
  function getCurrentTrackInfo() {
    let title = '';
    let path = '';

    const badge = document.querySelector('.playbackSoundBadge');
    if (badge) {
      const allLinks = Array.from(badge.querySelectorAll('a[href]'));
      const trackLink = allLinks.find(a => {
        const href = (a.getAttribute('href') || '').split('?')[0];
        const parts = href.split('/').filter(Boolean);
        return parts.length >= 2 && !['sets', 'albums', 'reposts', 'likes'].includes(parts[1]);
      }) || allLinks.find(a => a.classList.contains('playbackSoundBadge__title')) || allLinks[allLinks.length - 1];

      if (trackLink) {
        path = (trackLink.getAttribute('href') || '').split('?')[0];
        title = trackLink.getAttribute('title') || trackLink.textContent.trim();
      }

      const artistLink = allLinks.find(a => a.classList.contains('playbackSoundBadge__lightLink'));
      if (artistLink && title && !title.includes(' - ')) {
        const artist = artistLink.textContent.trim();
        if (artist && !title.startsWith(artist)) {
          title = `${artist} - ${title}`;
        }
      }
    }

    if ((!title || title.length < 3) && navigator.mediaSession && navigator.mediaSession.metadata) {
      const meta = navigator.mediaSession.metadata;
      if (meta.title) {
        title = meta.artist ? `${meta.artist} - ${meta.title}` : meta.title;
      }
    }

    if (!title && document.title) {
      const docTitle = document.title.replace(/^▶\s*/, '').trim();
      if (!docTitle.toLowerCase().includes('stream and listen') && !docTitle.toLowerCase().includes('discover')) {
        title = docTitle.split('|')[0].trim();
      }
    }

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
   * TUA BÀI HÁT TRÊN SOUNDCLOUD (Hỗ trợ 3 lớp đảm bảo tua thành công 100%)
   */
  function seekSoundCloudPlayback(targetSec) {
    if (typeof targetSec !== 'number' || isNaN(targetSec) || targetSec < 0) return;

    console.log(`%c[SC-CueApp] ⏩ THỰC HIỆN TUA ĐẾN GIÂY: ${targetSec}s`, 'color: #00e676; font-weight: bold;');

    // Cập nhật ngay thanh trượt và text trên giao diện Cue bar
    const totalSec = getTotalDurationSeconds();
    updateCueBarTime(targetSec, totalSec);

    // Lớp 1: Gửi lệnh sang Main World để tua trực tiếp mọi Audio instance
    window.postMessage({ type: 'SC_SEEK_TO_SECONDS', targetSec }, '*');

    // Lớp 2: Tua trực tiếp trên mọi thẻ audio/video trong DOM
    const allAudios = Array.from(document.querySelectorAll('audio, video')).filter(a => a.id !== 'sc-hot-deck2');
    allAudios.forEach(a => {
      try {
        a.currentTime = targetSec;
        a.dispatchEvent(new Event('seeking'));
        a.dispatchEvent(new Event('seeked'));
        a.dispatchEvent(new Event('timeupdate'));
      } catch (e) {}
    });

    // Lớp 3: Giả lập click chuột và PointerEvent trên thanh timeline scrubber của SoundCloud
    const targets = [
      document.querySelector('.playbackTimeline__progressWrapper'),
      document.querySelector('.playbackTimeline'),
      document.querySelector('[data-testid="playback-timeline"]'),
      document.querySelector('.playbackTimeline [role="progressbar"]'),
      document.querySelector('[role="progressbar"]')
    ].filter(Boolean);

    if (totalSec > 0) {
      for (const pWrap of targets) {
        try {
          const rect = pWrap.getBoundingClientRect();
          if (rect.width > 0) {
            const ratio = Math.min(0.995, Math.max(0.001, targetSec / totalSec));
            const clickX = rect.left + rect.width * ratio;
            const clickY = rect.top + rect.height / 2;

            const opts = {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: clickX,
              clientY: clickY,
              screenX: clickX,
              screenY: clickY,
              button: 0,
              buttons: 1,
              pointerId: 1,
              pointerType: 'mouse',
              isPrimary: true
            };

            if (window.PointerEvent) {
              pWrap.dispatchEvent(new PointerEvent('pointerdown', opts));
              pWrap.dispatchEvent(new PointerEvent('pointerup', opts));
            }
            pWrap.dispatchEvent(new MouseEvent('mousedown', opts));
            pWrap.dispatchEvent(new MouseEvent('mouseup', opts));
            pWrap.dispatchEvent(new MouseEvent('click', opts));
            break;
          }
        } catch (e) {}
      }
    }

    // Kiểm tra lại sau 400ms: Nếu chưa tua được thì retry lại 1 lần
    setTimeout(() => {
      const cur = getCurrentPlaybackSeconds();
      if (Math.abs(cur - targetSec) > 3) {
        window.postMessage({ type: 'SC_SEEK_TO_SECONDS', targetSec }, '*');
      }
    }, 400);
  }

  /**
   * CHUYỂN SANG BÀI TIẾP THEO (NEXT TRACK)
   */
  function skipToNextTrack() {
    console.log('[SC-CueApp] ⏭ Bấm chuyển sang bài tiếp theo...');
    window.postMessage({ type: 'SC_CONTROL_NEXT' }, '*');

    const nextSelectors = [
      '.playControls__next',
      'button.playControls__next',
      'button[title="Next"]',
      'button[title="Next track"]',
      'button[aria-label="Next"]',
      'button[aria-label="Next track"]',
      '.skipControl__next',
      '[data-testid="control-next"]'
    ];

    for (const sel of nextSelectors) {
      const btn = document.querySelector(sel);
      if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
        btn.click();
        return true;
      }
    }

    // Dự phòng: Tua đến gần sát cuối bài (totalSec - 0.5s) để SoundCloud tự động Next bài theo cơ chế gốc
    const total = getTotalDurationSeconds();
    if (total > 1) {
      seekSoundCloudPlayback(total - 0.5);
      return true;
    }
    return false;
  }

  /**
   * QUAY LẠI BÀI TRƯỚC (PREVIOUS TRACK)
   */
  function skipToPrevTrack() {
    console.log('[SC-CueApp] ⏮ Quay lại bài trước...');
    window.postMessage({ type: 'SC_CONTROL_PREV' }, '*');

    const prevSelectors = [
      '.playControls__prev',
      'button.playControls__prev',
      'button[title="Previous"]',
      'button[title="Previous track"]',
      'button[aria-label="Previous"]',
      'button[aria-label="Previous track"]',
      '.skipControl__previous'
    ];

    for (const sel of prevSelectors) {
      const btn = document.querySelector(sel);
      if (btn) {
        btn.click();
        return true;
      }
    }
    seekSoundCloudPlayback(0);
    return false;
  }

  /**
   * PHÁT / DỪNG NHẠC (PLAY/PAUSE)
   */
  function togglePlayPause() {
    window.postMessage({ type: 'SC_CONTROL_TOGGLE' }, '*');

    const playSelectors = [
      '.playControls__play',
      'button.playControls__play',
      'button[title*="Play"]',
      'button[title*="Pause"]',
      'button[aria-label*="Play"]',
      'button[aria-label*="Pause"]'
    ];

    for (const sel of playSelectors) {
      const btn = document.querySelector(sel);
      if (btn) {
        btn.click();
        return true;
      }
    }
    return false;
  }

  /**
   * KIỂM TRA VÀ TỰ ĐỘNG ÁP DỤNG START CUE / STOP CUE
   */
  function checkAndApplyCues(currentSec, totalSec) {
    if (currentSec <= 0) return;

    // 1. Nhận diện bài hát đang phát
    const info = getCurrentTrackInfo();
    const title = info.title || currentTrackTitle;
    const path = info.path || currentTrackPath;
    const key = getTrackKey(path, title);

    // Khi đổi bài hát mới -> Reset cờ tua
    if (key !== trackState.key) {
      trackState = {
        key: key,
        startSeeked: false,
        stopTriggered: false
      };
      currentTrackPath = path;
      currentTrackTitle = title;
      activeTrackKey = key;
      updateCueBarTrack(currentTrackTitle, totalSec);
      console.log(`[SC-CueApp] 🎵 Chuyển sang bài mới: "${currentTrackTitle}" (${key})`);
    }

    const savedCue = findSavedCue(path, title);

    // 2. TỰ ĐỘNG TUA ĐẾN START CUE
    if (savedCue && savedCue.startSec > 0 && !trackState.startSeeked) {
      // Nếu bài hát đang ở trước mốc startSec
      if (currentSec < savedCue.startSec) {
        trackState.startSeeked = true;
        console.log(`[SC-CueApp] ÁP DỤNG START CUE: Tự động tua "${title}" từ ${currentSec}s đến ${savedCue.startSec}s!`);
        updateCueBarStatus(`Tua đến ${formatSecondsToMMSS(savedCue.startSec)}`);
        seekSoundCloudPlayback(savedCue.startSec);

        // Sau 500ms kiểm tra lại xem đã tua thành công chưa
        setTimeout(() => {
          const curNow = getCurrentPlaybackSeconds();
          if (curNow < savedCue.startSec - 2) {
            seekSoundCloudPlayback(savedCue.startSec);
          }
        }, 500);
      } else {
        // Nếu bài đã qua startSec rồi thì đánh dấu đã tua
        trackState.startSeeked = true;
      }
    }

    // 3. TỰ ĐỘNG CHUYỂN BÀI KHI CHẠM MỐC STOP CUE
    if (totalSec > 5 && !trackState.stopTriggered) {
      let stopAtSec = totalSec - 5; // Mặc định trước khi hết 5 giây
      if (savedCue && savedCue.stopSec > 0 && savedCue.stopSec < totalSec) {
        stopAtSec = savedCue.stopSec;
      }

      if (currentSec >= stopAtSec && currentSec < totalSec) {
        trackState.stopTriggered = true;
        console.log(`[SC-CueApp] ÁP DỤNG STOP CUE: Chạm mốc ${stopAtSec}s -> Chuyển sang bài tiếp theo!`);
        updateCueBarStatus(`Next bài (${formatSecondsToMMSS(stopAtSec)})`);
        skipToNextTrack();
      }
    }
  }

  /**
   * Giám sát liên tục và cập nhật thời gian thực (chạy song song cả interval và timeupdate)
   */
  function startContinuousWatcher() {
    setInterval(() => {
      const currentSec = getCurrentPlaybackSeconds();
      const totalSec = getTotalDurationSeconds();

      // Kiểm tra thông tin bài hát
      const info = getCurrentTrackInfo();
      if (info && info.title && info.title !== currentTrackTitle) {
        currentTrackPath = info.path;
        currentTrackTitle = info.title;
        updateCueBarTrack(currentTrackTitle, totalSec);
      }

      // Kiểm tra mốc Cue
      checkAndApplyCues(currentSec, totalSec);

      // Cập nhật giao diện đồng hồ & thanh trượt
      if (!isUserDraggingSlider) {
        updateCueBarTime(currentSec, totalSec);
      }
    }, 250);
  }

  // =========================================================================================
  // GIAO DIỆN THANH ĐIỀU KHIỂN CUE BAR (THIẾT KẾ DÀNH RIÊNG CHO IPHONE / MOBILE)
  // =========================================================================================
  let inSecInput = null;
  let outSecInput = null;
  let statusBadgeEl = null;
  let currentTrackNameEl = null;
  let currentTimeDisplayEl = null;
  let cueSliderEl = null;

  function createCueBarUI() {
    if (document.getElementById('sc-cue-bar')) return;

    const bar = document.createElement('div');
    bar.id = 'sc-cue-bar';
    bar.innerHTML = `
      <div class="sc-cue-header">
        <div class="sc-cue-title-area">
          <strong id="sc-cue-track-name">Đang phát hiện bài...</strong>
        </div>
        <div class="sc-cue-right">
          <span id="sc-cue-time">0:00 / 0:00</span>
          <button id="sc-cue-min-btn" title="Thu gọn/Mở rộng">−</button>
        </div>
      </div>
      <div class="sc-cue-body">
        <!-- Thanh trượt tua bài (Seek Scrubber) -->
        <div class="sc-cue-slider-row">
          <input type="range" id="sc-cue-slider" min="0" max="100" value="0">
        </div>

        <!-- Hàng nút điều khiển tua bài & Next bài -->
        <div class="sc-cue-ctrl-row">
          <button id="sc-btn-prev" class="sc-ctrl-btn" title="Bài trước">⏮</button>
          <button id="sc-btn-rewind" class="sc-ctrl-btn" title="Lùi 10s">⏪ -10s</button>
          <button id="sc-btn-playpause" class="sc-ctrl-btn sc-btn-play" title="Phát/Dừng">⏯</button>
          <button id="sc-btn-forward" class="sc-ctrl-btn" title="Tới 10s">+10s ⏩</button>
          <button id="sc-btn-next" class="sc-ctrl-btn sc-btn-next-action" title="Next bài">⏭ Next</button>
        </div>

        <!-- Cài đặt mốc Bắt đầu & Kết thúc -->
        <div class="sc-cue-row">
          <div class="sc-cue-col">
            <label>Bắt đầu (In):</label>
            <div class="sc-cue-input-group">
              <input type="text" id="sc-cue-in-input" placeholder="0:00" value="0:00">
              <button id="sc-cue-set-in-btn" class="sc-cue-btn-take" title="Lấy mốc thời gian hiện tại">Lấy giờ</button>
            </div>
          </div>
          <div class="sc-cue-col">
            <label>Kết thúc (Out):</label>
            <div class="sc-cue-input-group">
              <input type="text" id="sc-cue-out-input" placeholder="Hết - 5s">
              <button id="sc-cue-set-out-btn" class="sc-cue-btn-take" title="Lấy mốc thời gian hiện tại">Lấy giờ</button>
            </div>
          </div>
        </div>

        <!-- Các nút hành động: Lưu cấu hình, Xuất file -->
        <div class="sc-cue-actions">
          <button id="sc-cue-save-btn">Lưu bài hát</button>
          <button id="sc-cue-export-bar-btn" title="Xuất danh sách ra file .json">Xuất file</button>
          <span id="sc-cue-status-badge">Sẵn sàng</span>
        </div>
      </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
      #sc-cue-bar {
        position: fixed !important;
        bottom: 58px !important;
        right: 10px !important;
        z-index: 2147483647 !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        font-size: 11px !important;
        background: #fff8f9 !important;
        color: #4a3b40 !important;
        border: 2px solid #ffccd5 !important;
        border-radius: 14px !important;
        box-shadow: 0 8px 24px rgba(255, 117, 143, 0.28), 0 0 12px rgba(255, 182, 193, 0.35) !important;
        width: 350px !important;
        max-width: calc(100vw - 20px) !important;
        box-sizing: border-box !important;
        transition: transform 0.2s ease, opacity 0.2s ease !important;
      }
      #sc-cue-bar * {
        box-sizing: border-box !important;
      }
      #sc-cue-bar.minimized .sc-cue-body {
        display: none !important;
      }
      #sc-cue-bar.minimized {
        width: auto !important;
        max-width: calc(100vw - 20px) !important;
        box-shadow: 0 4px 14px rgba(255, 117, 143, 0.3) !important;
      }
      .sc-cue-header {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        padding: 8px 12px !important;
        background: linear-gradient(135deg, #ffe5ec 0%, #ffccd5 100%) !important;
        border-bottom: 1.5px solid #ffccd5 !important;
        border-radius: 12px 12px 0 0 !important;
        cursor: pointer !important;
      }
      #sc-cue-bar.minimized .sc-cue-header {
        border-radius: 12px !important;
        border-bottom: none !important;
      }
      .sc-cue-title-area {
        max-width: 175px !important;
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
        gap: 8px !important;
        font-size: 11px !important;
        color: #ff4d6d !important;
        font-weight: 700 !important;
      }
      #sc-cue-min-btn {
        background: #ffffff !important;
        border: 1px solid #ffb3c1 !important;
        color: #ff4d6d !important;
        font-size: 13px !important;
        font-weight: 800 !important;
        cursor: pointer !important;
        width: 22px !important;
        height: 22px !important;
        border-radius: 50% !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        line-height: 1 !important;
        padding: 0 !important;
      }
      .sc-cue-body {
        padding: 8px 10px !important;
      }
      /* Thanh tua bài Scrubber Slider */
      .sc-cue-slider-row {
        margin-bottom: 8px !important;
        display: flex !important;
        align-items: center !important;
      }
      #sc-cue-slider {
        width: 100% !important;
        height: 6px !important;
        -webkit-appearance: none !important;
        appearance: none !important;
        background: #ffccd5 !important;
        border-radius: 4px !important;
        outline: none !important;
        margin: 0 !important;
        cursor: pointer !important;
      }
      #sc-cue-slider::-webkit-slider-thumb {
        -webkit-appearance: none !important;
        appearance: none !important;
        width: 16px !important;
        height: 16px !important;
        border-radius: 50% !important;
        background: #ff4d6d !important;
        cursor: pointer !important;
        box-shadow: 0 2px 6px rgba(255, 77, 109, 0.4) !important;
        border: 2px solid #ffffff !important;
      }
      /* Hàng nút điều khiển phát nhạc */
      .sc-cue-ctrl-row {
        display: flex !important;
        gap: 5px !important;
        margin-bottom: 8px !important;
        justify-content: space-between !important;
      }
      .sc-ctrl-btn {
        flex: 1 !important;
        background: #ffffff !important;
        color: #c9184a !important;
        border: 1.5px solid #ffccd5 !important;
        border-radius: 8px !important;
        font-size: 11px !important;
        font-weight: 700 !important;
        padding: 6px 2px !important;
        height: 30px !important;
        cursor: pointer !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        transition: all 0.15s ease !important;
      }
      .sc-ctrl-btn:active {
        transform: scale(0.96) !important;
        background: #ffe5ec !important;
      }
      .sc-btn-play {
        background: #fff0f3 !important;
        color: #ff4d6d !important;
        font-weight: 800 !important;
      }
      .sc-btn-next-action {
        background: linear-gradient(135deg, #ff758f 0%, #ff4d6d 100%) !important;
        color: #ffffff !important;
        border-color: #ff4d6d !important;
      }
      .sc-cue-row {
        display: flex !important;
        gap: 8px !important;
        margin-bottom: 8px !important;
      }
      .sc-cue-col {
        flex: 1 !important;
        background: #fff0f3 !important;
        border: 1.5px solid #ffccd5 !important;
        border-radius: 9px !important;
        padding: 6px 8px !important;
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
        gap: 5px !important;
      }
      #sc-cue-bar input[type="text"] {
        width: 58px !important;
        background: #ffffff !important;
        border: 1.5px solid #ff758f !important;
        color: #c9184a !important;
        font-weight: 800 !important;
        padding: 3px 2px !important;
        border-radius: 6px !important;
        font-size: 11px !important;
        text-align: center !important;
        outline: none !important;
        height: 26px !important;
      }
      #sc-cue-bar input.sc-input-flash {
        background: #ff4d6d !important;
        color: #ffffff !important;
        border-color: #c9184a !important;
        transform: scale(1.05) !important;
      }
      #sc-cue-bar .sc-cue-btn-take {
        flex: 1 !important;
        background: linear-gradient(135deg, #ff758f 0%, #ff4d6d 100%) !important;
        color: #ffffff !important;
        border: none !important;
        border-radius: 6px !important;
        cursor: pointer !important;
        font-size: 10px !important;
        font-weight: 700 !important;
        height: 26px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
      }
      #sc-cue-bar .sc-cue-btn-take.sc-btn-flashed {
        background: linear-gradient(135deg, #70e000 0%, #38b000 100%) !important;
      }
      .sc-cue-actions {
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
        border-top: 1px dashed #ffccd5 !important;
        padding-top: 8px !important;
      }
      #sc-cue-save-btn {
        background: linear-gradient(135deg, #ff758f 0%, #ff4d6d 100%) !important;
        color: #ffffff !important;
        border: none !important;
        padding: 5px 12px !important;
        border-radius: 7px !important;
        font-weight: 700 !important;
        font-size: 11px !important;
        cursor: pointer !important;
        height: 28px !important;
      }
      #sc-cue-save-btn:active {
        transform: scale(0.97) !important;
      }
      #sc-cue-export-bar-btn {
        background: #ffffff !important;
        color: #ff4d6d !important;
        border: 1.5px solid #ffccd5 !important;
        padding: 5px 8px !important;
        border-radius: 7px !important;
        font-weight: 700 !important;
        font-size: 10px !important;
        cursor: pointer !important;
        height: 28px !important;
      }
      #sc-cue-status-badge {
        font-size: 10px !important;
        color: #ff4d6d !important;
        max-width: 110px !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
        font-weight: 700 !important;
        margin-left: auto !important;
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(bar);

    inSecInput = document.getElementById('sc-cue-in-input');
    outSecInput = document.getElementById('sc-cue-out-input');
    statusBadgeEl = document.getElementById('sc-cue-status-badge');
    currentTrackNameEl = document.getElementById('sc-cue-track-name');
    currentTimeDisplayEl = document.getElementById('sc-cue-time');
    cueSliderEl = document.getElementById('sc-cue-slider');

    // Nút thu gọn / mở rộng
    const toggleMin = () => {
      bar.classList.toggle('minimized');
      document.getElementById('sc-cue-min-btn').textContent = bar.classList.contains('minimized') ? '+' : '−';
    };
    document.getElementById('sc-cue-min-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMin();
    });
    document.querySelector('.sc-cue-header').addEventListener('click', () => {
      if (bar.classList.contains('minimized')) toggleMin();
    });

    // Điều khiển tua bằng thanh trượt (Scrubber Slider)
    if (cueSliderEl) {
      cueSliderEl.addEventListener('input', () => {
        isUserDraggingSlider = true;
        const target = parseFloat(cueSliderEl.value);
        const total = getTotalDurationSeconds();
        if (!isNaN(target)) {
          currentTimeDisplayEl.textContent = `${formatSecondsToMMSS(target)} / ${formatSecondsToMMSS(total)}`;
        }
      });

      cueSliderEl.addEventListener('change', () => {
        isUserDraggingSlider = false;
        const target = parseFloat(cueSliderEl.value);
        if (!isNaN(target)) {
          seekSoundCloudPlayback(target);
        }
      });
    }

    // Các nút điều khiển: Prev, Lùi 10s, Play/Pause, Tới 10s, Next
    document.getElementById('sc-btn-prev')?.addEventListener('click', (e) => {
      e.stopPropagation();
      skipToPrevTrack();
    });

    document.getElementById('sc-btn-rewind')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const cur = getCurrentPlaybackSeconds();
      seekSoundCloudPlayback(Math.max(0, cur - 10));
    });

    document.getElementById('sc-btn-playpause')?.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePlayPause();
    });

    document.getElementById('sc-btn-forward')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const cur = getCurrentPlaybackSeconds();
      const dur = getTotalDurationSeconds();
      seekSoundCloudPlayback(Math.min(dur || 9999, cur + 10));
    });

    document.getElementById('sc-btn-next')?.addEventListener('click', (e) => {
      e.stopPropagation();
      skipToNextTrack();
    });

    // Hiệu ứng phản hồi khi bấm nút lấy mốc
    function flashInputAndButton(inputEl, btnEl, originalText) {
      if (inputEl) inputEl.classList.add('sc-input-flash');
      if (btnEl) {
        btnEl.textContent = 'Đã lấy!';
        btnEl.classList.add('sc-btn-flashed');
      }

      setTimeout(() => {
        if (inputEl) inputEl.classList.remove('sc-input-flash');
        if (btnEl) {
          btnEl.classList.remove('sc-btn-flashed');
          btnEl.textContent = originalText;
        }
      }, 700);
    }

    // LẤY GIÂY BẮT ĐẦU (IN)
    const inBtn = document.getElementById('sc-cue-set-in-btn');
    inBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sec = getCurrentPlaybackSeconds();
      const formatted = formatSecondsToMMSS(sec);
      inSecInput.value = formatted;
      updateCueBarStatus(`Bắt đầu: ${formatted}`);
      flashInputAndButton(inSecInput, inBtn, 'Lấy giờ');
    });

    // LẤY GIÂY KẾT THÚC (OUT)
    const outBtn = document.getElementById('sc-cue-set-out-btn');
    outBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sec = getCurrentPlaybackSeconds();
      const formatted = formatSecondsToMMSS(sec);
      outSecInput.value = formatted;
      updateCueBarStatus(`Kết thúc: ${formatted}`);
      flashInputAndButton(outSecInput, outBtn, 'Lấy giờ');
    });

    // NÚT XUẤT FILE TRỰC TIẾP
    document.getElementById('sc-cue-export-bar-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.storage.local.get(['track_cues'], (res) => {
        const cues = res.track_cues || {};
        if (Object.keys(cues).length === 0) {
          alert('Chưa có bài nào trong danh sách để xuất file!');
          return;
        }

        const exportData = {
          app: "SoundCloud By VanHai",
          version: "4.4",
          exportedAt: new Date().toLocaleString(),
          tracks: cues
        };

        const jsonStr = JSON.stringify(exportData, null, 2);
        const blob = new Blob([jsonStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const dateStr = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `soundcloud_cues_${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        updateCueBarStatus('Đã xuất file!');
      });
    });

    // NÚT LƯU / CẬP NHẬT CẤU HÌNH BÀI HÁT
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

          console.log(`[SC-CueApp] ĐÃ LƯU BÀI: "${title}" (${startFormatted} -> ${stopFormatted})`);

          const saveBtn = document.getElementById('sc-cue-save-btn');
          saveBtn.style.background = 'linear-gradient(135deg, #70e000 0%, #38b000 100%)';
          saveBtn.textContent = 'ĐÃ LƯU!';
          updateCueBarStatus(`Đã lưu (${startFormatted} - ${stopFormatted})`);

          setTimeout(() => {
            saveBtn.style.background = 'linear-gradient(135deg, #ff758f 0%, #ff4d6d 100%)';
            saveBtn.textContent = 'Cập nhật bài';
          }, 2000);
        });
      });
    });
  }

  function updateCueBarTrack(title, duration) {
    if (currentTrackNameEl) currentTrackNameEl.textContent = title;
    const savedCue = findSavedCue(currentTrackPath, title);
    const saveBtn = document.getElementById('sc-cue-save-btn');

    if (savedCue) {
      if (inSecInput) inSecInput.value = formatSecondsToMMSS(savedCue.startSec || 0);
      if (outSecInput) outSecInput.value = savedCue.stopSec ? formatSecondsToMMSS(savedCue.stopSec) : '';
      updateCueBarStatus('Đã có mốc lưu');
      if (saveBtn) saveBtn.textContent = 'Cập nhật bài';
    } else {
      if (inSecInput) inSecInput.value = '0:00';
      if (outSecInput) outSecInput.value = duration ? formatSecondsToMMSS(duration - 5) : '';
      updateCueBarStatus('Chưa lưu');
      if (saveBtn) saveBtn.textContent = 'Lưu bài hát';
    }
  }

  function updateCueBarTime(cur, dur) {
    if (currentTimeDisplayEl) {
      currentTimeDisplayEl.textContent = `${formatSecondsToMMSS(cur)} / ${formatSecondsToMMSS(dur)}`;
    }
    if (cueSliderEl && !isUserDraggingSlider && dur > 0) {
      cueSliderEl.max = dur;
      cueSliderEl.value = cur;
    }
  }

  function updateCueBarStatus(msg) {
    if (statusBadgeEl) statusBadgeEl.textContent = msg;
  }

  // Khởi động
  function bootstrap() {
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
})();
