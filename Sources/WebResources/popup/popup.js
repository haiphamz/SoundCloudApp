/**
 * Popup Script: Hiển thị, Chỉnh sửa, Xuất/Nhập danh sách Cue Points
 * Hiển thị thời gian định dạng mm:ss (phút:giây)
 */

document.addEventListener('DOMContentLoaded', () => {
  const cueListContainer = document.getElementById('cue-list');
  const countBadge = document.getElementById('cue-count-badge');
  const clearAllBtn = document.getElementById('clear-all-btn');
  const exportBtn = document.getElementById('export-json-btn');
  const importBtn = document.getElementById('import-json-btn');
  const importFileInput = document.getElementById('import-file-input');

  let editingKey = null;

  /**
   * Chuyển số giây thành chuỗi phút:giây (ví dụ 70 -> '1:10')
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

  function renderList() {
    chrome.storage.local.get(['track_cues'], (res) => {
      const cues = res.track_cues || {};
      const uniqueItems = [];
      const seenTitles = new Set();

      // Lấy danh sách các bài hát duy nhất
      Object.keys(cues).forEach((key) => {
        const item = cues[key];
        if (!item || !item.title) return;
        const normalized = item.title.toLowerCase().trim();
        if (!seenTitles.has(normalized)) {
          seenTitles.add(normalized);
          uniqueItems.push(item);
        }
      });

      countBadge.textContent = `${uniqueItems.length} bài`;

      if (uniqueItems.length === 0) {
        cueListContainer.innerHTML = `
          <div class="empty-state">
            <p>Chưa có bài nào được lưu.<br>Hãy mở SoundCloud và lưu mốc phát cho bài hát.</p>
          </div>
        `;
        return;
      }

      cueListContainer.innerHTML = '';
      uniqueItems.forEach((item) => {
        const itemKey = item.key || item.path || item.title;
        const row = document.createElement('div');
        row.className = 'cue-item';

        // CHẾ ĐỘ CHỈNH SỬA (INLINE EDIT)
        if (editingKey === itemKey) {
          row.classList.add('editing');
          row.innerHTML = `
            <div class="cue-item-title" title="${item.title}">${item.title}</div>
            <div class="edit-row">
              <div class="edit-group">
                <label>Bắt đầu (phút:giây)</label>
                <input type="text" class="edit-input" id="edit-start-input" value="${formatSecondsToMMSS(item.startSec || 0)}" placeholder="0:00">
              </div>
              <div class="edit-group">
                <label>Kết thúc (phút:giây)</label>
                <input type="text" class="edit-input" id="edit-stop-input" value="${item.stopSec ? formatSecondsToMMSS(item.stopSec) : ''}" placeholder="Hết bài - 5s">
              </div>
            </div>
            <div class="edit-actions">
              <button class="save-edit-btn">Lưu thay đổi</button>
              <button class="cancel-edit-btn">Hủy</button>
            </div>
          `;

          // Lưu chỉnh sửa
          row.querySelector('.save-edit-btn').addEventListener('click', () => {
            const newStartStr = row.querySelector('#edit-start-input').value;
            const newStopStr = row.querySelector('#edit-stop-input').value;

            const newStartSec = parseMMSSToSeconds(newStartStr);
            const newStopSec = parseMMSSToSeconds(newStopStr);

            item.startSec = newStartSec;
            item.stopSec = newStopSec;

            // Cập nhật vào storage
            if (item.key) cues[item.key] = item;
            if (item.path) cues[item.path] = item;
            if (item.title) cues[item.title.toLowerCase().trim()] = item;

            chrome.storage.local.set({ track_cues: cues }, () => {
              editingKey = null;
              renderList();
            });
          });

          // Hủy chỉnh sửa
          row.querySelector('.cancel-edit-btn').addEventListener('click', () => {
            editingKey = null;
            renderList();
          });
        } 
        // CHẾ ĐỘ XEM BÌNH THƯỜNG
        else {
          const startFormatted = formatSecondsToMMSS(item.startSec || 0);
          const stopFormatted = item.stopSec ? formatSecondsToMMSS(item.stopSec) : 'Hết - 5s';

          row.innerHTML = `
            <div class="cue-item-info">
              <div class="cue-item-title" title="${item.title}">${item.title}</div>
              <div class="cue-item-points">
                <span>Bắt đầu: <span class="cue-point-tag">${startFormatted}</span></span>
                <span>Kết thúc: <span class="cue-point-tag">${stopFormatted}</span></span>
              </div>
            </div>
            <div class="cue-item-actions">
              <button class="action-btn-sm edit-cue-btn" title="Chỉnh sửa bài này">Sửa</button>
              <button class="action-btn-sm delete-cue-btn" title="Xóa bài này">Xóa</button>
            </div>
          `;

          // Bấm Sửa
          row.querySelector('.edit-cue-btn').addEventListener('click', () => {
            editingKey = itemKey;
            renderList();
          });

          // Bấm Xóa
          row.querySelector('.delete-cue-btn').addEventListener('click', () => {
            const k = item.key;
            const p = item.path;
            const t = (item.title || '').toLowerCase().trim();

            if (k) delete cues[k];
            if (p) delete cues[p];
            if (t) delete cues[t];

            chrome.storage.local.set({ track_cues: cues }, () => {
              renderList();
            });
          });
        }

        cueListContainer.appendChild(row);
      });
    });
  }

  // 1. XUẤT FILE JSON RA NGOÀI MÁY TÍNH
  exportBtn.addEventListener('click', () => {
    chrome.storage.local.get(['track_cues'], (res) => {
      const cues = res.track_cues || {};
      const keys = Object.keys(cues);

      if (keys.length === 0) {
        alert('Danh sách hiện tại đang trống, chưa có bài nào để xuất!');
        return;
      }

      const exportData = {
        app: "SoundCloud By VanHai",
        version: "4.3",
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
    });
  });

  // 2. NHẬP FILE JSON TỪ MÁY TÍNH
  importBtn.addEventListener('click', () => {
    importFileInput.click();
  });

  importFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        const incomingTracks = parsed.tracks || parsed;

        if (typeof incomingTracks !== 'object' || incomingTracks === null) {
          throw new Error('Định dạng file không hợp lệ.');
        }

        chrome.storage.local.get(['track_cues'], (res) => {
          const current = res.track_cues || {};
          let count = 0;

          Object.keys(incomingTracks).forEach((k) => {
            const item = incomingTracks[k];
            if (item && item.title) {
              current[k] = item;
              count++;
            }
          });

          chrome.storage.local.set({ track_cues: current }, () => {
            alert(`Đã nhập thành công ${count} mục bài hát vào danh sách!`);
            renderList();
            importFileInput.value = '';
          });
        });
      } catch (err) {
        alert('Lỗi: File JSON không đúng định dạng!');
      }
    };
    reader.readAsText(file);
  });

  // Xóa toàn bộ
  clearAllBtn.addEventListener('click', () => {
    if (confirm('Bạn có chắc muốn xóa tất cả bài hát đã lưu trong danh sách?')) {
      chrome.storage.local.set({ track_cues: {} }, () => {
        renderList();
      });
    }
  });

  renderList();
});
