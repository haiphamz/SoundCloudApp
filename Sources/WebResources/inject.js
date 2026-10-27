/**
 * SoundCloud Auto Crossfader - Main World Hook (inject.js)
 * Chạy trực tiếp trong execution context của soundcloud.com.
 * Nhiệm vụ:
 * 1. Bắt Live Client ID thực tế 100%.
 * 2. Bắt Audio Instance & gửi timeupdate sang Content Script.
 * 3. Nhận lệnh SEEK để tua bài hát chính xác đến từng giây.
 */

(() => {
  'use strict';

  let capturedClientId = null;

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

  // 3. Hook Audio constructor để theo dõi chính xác currentTime và tua bài
  function attachAudioTracker(audioEl) {
    if (!audioEl || audioEl.__scTrackerAttached) return;
    audioEl.__scTrackerAttached = true;
    window.__scActiveAudio = audioEl;

    audioEl.addEventListener('timeupdate', () => {
      window.postMessage({
        type: 'SC_AUDIO_TIME_SYNC',
        currentTime: audioEl.currentTime,
        duration: audioEl.duration
      }, '*');
    });
  }

  const origAudio = window.Audio;
  window.Audio = function (...args) {
    const a = new origAudio(...args);
    attachAudioTracker(a);
    return a;
  };

  const origCreateElement = document.createElement;
  document.createElement = function (tagName, ...args) {
    const el = origCreateElement.apply(this, [tagName, ...args]);
    if (tagName && typeof tagName === 'string' && tagName.toLowerCase() === 'audio') {
      attachAudioTracker(el);
    }
    return el;
  };

  // Lắng nghe lệnh TUA BÀI HÁT từ Content Script
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SC_SEEK_TO_SECONDS') {
      const targetSec = event.data.targetSec;
      if (typeof targetSec === 'number') {
        // Tua trên Audio instance
        if (window.__scActiveAudio) {
          try {
            window.__scActiveAudio.currentTime = targetSec;
            console.log(`%c[SC-Crossfader:MainWorld] Đã tua thành công đến: ${targetSec}s`, 'color: #00e676; font-weight: bold;');
          } catch (e) {}
        }
      }
    }
  });

  // Quét định kỳ
  setInterval(() => {
    try {
      const audios = document.querySelectorAll('audio');
      audios.forEach(attachAudioTracker);
    } catch (e) {}
  }, 1000);
})();
