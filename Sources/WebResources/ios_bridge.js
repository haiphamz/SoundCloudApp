// iOS Extension Compatibility Bridge for SoundCloud
(function() {
  'use strict';
  if (window.__iosBridgeInitialized) return;
  window.__iosBridgeInitialized = true;

  console.log('[iOS Bridge] Khởi tạo Chrome Extension API Shim cho WKWebView...');

  let storageListeners = [];
  let liveClientId = null;
  const FALLBACK_CLIENT_IDS = [
    'iZIs9mchVcX5lhVR1HNjwtb1nfq09BQ1',
    'b426b38c957b6971e45f944d00718880',
    '2t9loNfh0ekOfHG3lJLUpNu4bg84fqeO'
  ];
  const streamCache = new Map();

  const storageShim = {
    local: {
      get: function(keys, callback) {
        let result = {};
        try {
          const raw = localStorage.getItem('sc_cue_storage');
          if (raw) {
            result = JSON.parse(raw);
          }
        } catch (e) {
          console.error('[iOS Bridge] Storage get error:', e);
        }

        if (typeof keys === 'string') {
          result = { [keys]: result[keys] };
        } else if (Array.isArray(keys)) {
          let filtered = {};
          keys.forEach(k => { filtered[k] = result[k]; });
          result = filtered;
        }

        if (callback) {
          setTimeout(() => callback(result), 0);
        }
      },
      set: function(items, callback) {
        try {
          let current = {};
          const raw = localStorage.getItem('sc_cue_storage');
          if (raw) current = JSON.parse(raw);
          Object.assign(current, items);
          localStorage.setItem('sc_cue_storage', JSON.stringify(current));

          storageListeners.forEach(listener => {
            try {
              let changes = {};
              for (let k in items) {
                changes[k] = { newValue: items[k] };
              }
              listener(changes, 'local');
            } catch (err) {}
          });

          if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.nativeStorage) {
            window.webkit.messageHandlers.nativeStorage.postMessage(JSON.stringify(current));
          }
        } catch (e) {
          console.error('[iOS Bridge] Storage set error:', e);
        }

        if (callback) {
          setTimeout(callback, 0);
        }
      },
      clear: function(callback) {
        try {
          localStorage.removeItem('sc_cue_storage');
          storageListeners.forEach(listener => {
            try {
              listener({ track_cues: { newValue: {} } }, 'local');
            } catch (err) {}
          });
        } catch(e) {}
        if (callback) setTimeout(callback, 0);
      }
    },
    onChanged: {
      addListener: function(fn) {
        if (typeof fn === 'function') {
          storageListeners.push(fn);
        }
      }
    }
  };

  async function resolveTrackStream(rawUrl, providedClientId) {
    const cleanPath = rawUrl.startsWith('http') ? rawUrl : `https://soundcloud.com${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;

    if (streamCache.has(cleanPath)) {
      const cached = streamCache.get(cleanPath);
      if (Date.now() - cached.time < 5 * 60 * 1000) {
        return cached.data;
      }
    }

    const clientId = providedClientId || liveClientId || FALLBACK_CLIENT_IDS[0];
    console.log('[iOS Bridge] Resolving track:', cleanPath, 'với clientId:', clientId);

    const resolveApi = `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(cleanPath)}&client_id=${clientId}`;
    const resolveResp = await fetch(resolveApi);
    if (!resolveResp.ok) {
      throw new Error(`SoundCloud API Resolve thất bại (Mã ${resolveResp.status})`);
    }

    const data = await resolveResp.json();
    const track = data.kind === 'playlist' && data.tracks?.length ? data.tracks[0] : data;

    const transcodings = track.media?.transcodings;
    if (!transcodings || !transcodings.length) {
      throw new Error('Không tìm thấy luồng âm thanh transcoding cho bài hát.');
    }

    const chosen = transcodings.find(t => t.format?.protocol === 'progressive') ||
                   transcodings.find(t => t.format?.protocol === 'hls') ||
                   transcodings[0];

    const sep = chosen.url.includes('?') ? '&' : '?';
    const cdnResp = await fetch(`${chosen.url}${sep}client_id=${clientId}`);
    if (!cdnResp.ok) {
      throw new Error(`Không lấy được link stream CDN (Mã ${cdnResp.status})`);
    }

    const cdnData = await cdnResp.json();
    const result = {
      streamUrl: cdnData.url,
      protocol: chosen.format?.protocol || 'hls',
      title: track.title || 'Bài tiếp theo',
      duration: Math.round((track.duration || 0) / 1000),
      permalink: track.permalink_url || cleanPath,
      artwork: track.artwork_url || track.user?.avatar_url || ''
    };

    streamCache.set(cleanPath, { time: Date.now(), data: result });
    return result;
  }

  const runtimeShim = {
    sendMessage: function(msg, callback) {
      if (!msg) return;
      if (msg.type === 'SET_LIVE_CLIENT_ID') {
        liveClientId = msg.clientId;
        console.log('[iOS Bridge] Live Client ID updated:', liveClientId);
        if (callback) callback({ success: true });
        return;
      }
      if (msg.type === 'RESOLVE_STREAM_URL') {
        resolveTrackStream(msg.trackUrl, msg.clientId)
          .then(res => {
            if (callback) callback({ success: true, ...res });
          })
          .catch(err => {
            console.error('[iOS Bridge] Resolve stream error:', err);
            if (callback) callback({ success: false, error: err.message });
          });
        return;
      }
    }
  };

  window.chrome = window.chrome || {};
  window.chrome.storage = storageShim;
  window.chrome.runtime = runtimeShim;
})();
