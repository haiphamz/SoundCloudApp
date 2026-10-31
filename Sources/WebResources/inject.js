/**
 * SoundCloud Auto Crossfader - Main World Hook (inject.js)
 * Chạy trực tiếp trong execution context của soundcloud.com.
 * Nhiệm vụ:
 * 1. Bắt Live Client ID thực tế 100%.
 * 2. Bắt Audio Instance & gửi timeupdate sang Content Script.
 * 3. Nhận lệnh SEEK để tua bài hát chính xác đến từng giây.
 * 4. Hỗ trợ lệnh điều khiển phát/dừng/next bài trực tiếp.
 */

(() => {
  'use strict';

  let capturedClientId = null;
  const trackedAudios = new Set();

  function broadcastClientId(cid) {
    if (cid && cid !== capturedClientId && cid.length === 32) {
      capturedClientId = cid;
      window.postMessage({ type: 'SC_LIVE_CLIENT_ID', clientId: cid }, '*');
      console.log('%c[SC-Crossfader:MainWorld]%c Live Client ID: ' + cid, 'color: #00e676; font-weight: bold;', 'color: unset;');
    }
  }

  // 1. Hook fetch
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    try {
      const url = args[0] ? (typeof args[0] === 'string' ? args[0] : args[0].url) : '';
      if (url && typeof url === 'string') {
        const match = url.match(/client_id=([a-zA-Z0-9]{32})/);
        if (match && match[1]) {
          broadcastClientId(match[1]);
        }
      }
    } catch (e) {}
    return originalFetch.apply(this, args);
  };

  // 2. Hook XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try {
      if (url && typeof url === 'string') {
        const match = url.match(/client_id=([a-zA-Z0-9]{32})/);
        if (match && match[1]) {
          broadcastClientId(match[1]);
        }
      }
    } catch (e) {}
    return originalOpen.apply(this, [method, url, ...rest]);
  };

  // 3. Hook Audio & MediaElement để theo dõi chính xác currentTime và tua bài
  function attachAudioTracker(audioEl) {
    if (!audioEl || audioEl.id === 'sc-hot-deck2') return;

    trackedAudios.add(audioEl);
    window.__scActiveAudio = audioEl;

    if (audioEl.__scTrackerAttached) return;
    audioEl.__scTrackerAttached = true;

    const syncTime = () => {
      // Chỉ gửi sync khi element đang phát hoặc có thời lượng
      if (typeof audioEl.currentTime === 'number') {
        if (!audioEl.paused || audioEl.currentTime > 0) {
          window.__scActiveAudio = audioEl;
        }
        window.__scLiveCurrentTime = audioEl.currentTime;
        window.__scLiveDuration = audioEl.duration || 0;
        window.postMessage({
          type: 'SC_AUDIO_TIME_SYNC',
          currentTime: audioEl.currentTime,
          duration: audioEl.duration
        }, '*');
      }
    };

    audioEl.addEventListener('timeupdate', syncTime);
    audioEl.addEventListener('playing', syncTime);
    audioEl.addEventListener('seeked', syncTime);
    audioEl.addEventListener('play', syncTime);
  }

  // Hook new Audio()
  const origAudio = window.Audio;
  window.Audio = function (...args) {
    const a = new origAudio(...args);
    attachAudioTracker(a);
    return a;
  };

  // Hook document.createElement('audio')
  const origCreateElement = document.createElement;
  document.createElement = function (tagName, ...args) {
    const el = origCreateElement.apply(this, [tagName, ...args]);
    if (tagName && typeof tagName === 'string' && (tagName.toLowerCase() === 'audio' || tagName.toLowerCase() === 'video')) {
      attachAudioTracker(el);
    }
    return el;
  };

  // Hook HTMLMediaElement.prototype.play (Bắt 100% audio instance khi bắt đầu phát trên iOS)
  if (window.HTMLMediaElement && window.HTMLMediaElement.prototype) {
    const origPlay = window.HTMLMediaElement.prototype.play;
    window.HTMLMediaElement.prototype.play = function (...args) {
      attachAudioTracker(this);
      return origPlay.apply(this, args);
    };
  }

  // Hàm tua bài hát trên tất cả audio instances đang hoạt động
  function seekAllAudios(targetSec) {
    if (typeof targetSec !== 'number' || isNaN(targetSec) || targetSec < 0) return;

    let seekedAny = false;
    const candidates = new Set([...trackedAudios, ...document.querySelectorAll('audio, video')]);

    for (const a of candidates) {
      if (a && a.id !== 'sc-hot-deck2') {
        try {
          a.currentTime = targetSec;
          a.dispatchEvent(new Event('seeking'));
          a.dispatchEvent(new Event('seeked'));
          a.dispatchEvent(new Event('timeupdate'));
          seekedAny = true;
        } catch (e) {
          console.warn('[SC:MainWorld] Seek audio error:', e);
        }
      }
    }

    console.log(`%c[SC-Crossfader:MainWorld] Đã tua đến: ${targetSec}s (seeked: ${seekedAny})`, 'color: #00e676; font-weight: bold;');
  }

  // Lắng nghe lệnh từ Content Script
  window.addEventListener('message', (event) => {
    if (!event.data) return;

    if (event.data.type === 'SC_SEEK_TO_SECONDS') {
      seekAllAudios(event.data.targetSec);
    }

    if (event.data.type === 'SC_CONTROL_NEXT') {
      const nextBtn = document.querySelector('.playControls__next, button.playControls__next, button[title="Next"], button[aria-label="Next"], [data-testid="control-next"]');
      if (nextBtn) nextBtn.click();
    }

    if (event.data.type === 'SC_CONTROL_PREV') {
      const prevBtn = document.querySelector('.playControls__prev, button.playControls__prev, button[title="Previous"], button[aria-label="Previous"]');
      if (prevBtn) prevBtn.click();
    }

    if (event.data.type === 'SC_CONTROL_TOGGLE') {
      const playBtn = document.querySelector('.playControls__play, button.playControls__play, button[title*="Play"], button[title*="Pause"]');
      if (playBtn) playBtn.click();
    }
  });

  // Quét định kỳ mọi thẻ audio trong DOM
  setInterval(() => {
    try {
      const audios = document.querySelectorAll('audio, video');
      audios.forEach(attachAudioTracker);
    } catch (e) {}
  }, 1000);
})();
