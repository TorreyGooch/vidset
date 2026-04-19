const Split = {
  sources: [],
  selectedSource: null,
  mode: 'manual',
  keyframes: [],           // sorted timestamps (seconds) — manual mode
  detectedSegments: [],    // { start, end, duration, checked } — auto mode
  fps: 30,
  minDuration: 1.5,

  async load() {
    try {
      this.sources = await papi('/sources');
    } catch { this.sources = []; }
    this.renderSourceList();
    this.renderManualView();
  },

  renderSourceList() {
    const el = document.getElementById('split-source-list');
    if (!el) return;
    if (this.sources.length === 0) {
      el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px">No sources — download some first</div>';
      return;
    }
    el.innerHTML = this.sources.map(s => `
      <div class="source-select-item ${this.selectedSource?.id === s.id ? 'active' : ''}"
           onclick="Split.selectSource('${esc(s.id)}')">
        <div class="src-name">${esc(s.filename)}</div>
        <div class="src-concept">${esc(s.concept_name)}</div>
      </div>`).join('');
  },

  async selectSource(sid) {
    this.selectedSource = this.sources.find(s => s.id === sid) || null;
    this.keyframes = [];
    this.detectedSegments = [];
    this.fps = 30;
    this.renderSourceList();
    this.renderVideo();
    this.renderManualView();
    this.renderAutoView();

    if (this.selectedSource) {
      try {
        const r = await papi(`/sources/${this.selectedSource.id}/fps`);
        this.fps = r.fps || 30;
        document.getElementById('fps-display').textContent = `${this.fps.toFixed(2)} fps`;
      } catch {
        document.getElementById('fps-display').textContent = '30 fps (default)';
      }
    }
  },

  renderVideo() {
    const vid = document.getElementById('split-video');
    if (!vid || !this.selectedSource) return;
    vid.src = `/api/projects/${App.projectId}/media/source/${encodeURIComponent(this.selectedSource.filename)}`;
    vid.load();
    vid.ontimeupdate = () => this.updateTimeDisplay();
  },

  updateTimeDisplay() {
    const vid = document.getElementById('split-video');
    if (!vid) return;
    const el = document.getElementById('frame-time-display');
    if (el) el.textContent = fmtPrecise(vid.currentTime);
  },

  // ── Keyframe (manual) mode ────────────────────────────────────────────────

  markKeyframe() {
    const vid = document.getElementById('split-video');
    if (!vid || !this.selectedSource) { toast('Select a source first', 'error'); return; }
    const t = parseFloat(vid.currentTime.toFixed(6));
    if (this.keyframes.some(k => Math.abs(k - t) < 0.001)) return; // dedupe
    this.keyframes.push(t);
    this.keyframes.sort((a, b) => a - b);
    this.renderManualView();
  },

  removeKeyframe(idx) {
    this.keyframes.splice(idx, 1);
    this.renderManualView();
  },

  seekToKeyframe(t) {
    const vid = document.getElementById('split-video');
    if (vid) vid.currentTime = t;
  },

  stepFrames(n) {
    const vid = document.getElementById('split-video');
    if (!vid) return;
    vid.currentTime = Math.max(0, vid.currentTime + n * (1 / this.fps));
    this.updateTimeDisplay();
  },

  clearKeyframes() {
    if (this.keyframes.length === 0) return;
    if (!confirm('Clear all keyframes?')) return;
    this.keyframes = [];
    this.renderManualView();
  },

  renderManualView() {
    const el = document.getElementById('keyframe-list');
    if (!el) return;

    if (this.keyframes.length === 0) {
      el.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:10px 0">
        No keyframes yet. Play the video and press <kbd style="background:var(--surface2);border:1px solid var(--border);border-radius:3px;padding:1px 5px">M</kbd> to mark a cut point.
      </div>`;
      return;
    }

    let html = '<div class="keyframe-list">';
    this.keyframes.forEach((t, i) => {
      html += `
        <div class="keyframe-entry" onclick="Split.seekToKeyframe(${t})">
          <span class="kf-num">${i + 1}</span>
          <span class="kf-time">${fmtPrecise(t)}</span>
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();Split.removeKeyframe(${i})">✕</button>
        </div>`;

      if (i < this.keyframes.length - 1) {
        const dur = this.keyframes[i + 1] - t;
        const warn = dur < this.minDuration ? '<span style="color:var(--orange)">⚠ short</span>' : '';
        html += `
          <div class="clip-bridge">
            <span class="bridge-label">Clip ${i + 1}</span>
            <span class="bridge-dur">${fmtDuration(dur)}</span>
            ${warn}
          </div>`;
      }
    });
    html += '</div>';

    const clipCount = this.keyframes.length - 1;
    if (clipCount < 1) {
      html += '<div style="color:var(--muted);font-size:12px;margin-top:8px">Mark at least 2 keyframes to define a clip.</div>';
    } else {
      html += `<div style="color:var(--muted);font-size:12px;margin-top:8px">${clipCount} clip${clipCount !== 1 ? 's' : ''} ready to extract.</div>`;
    }

    el.innerHTML = html;
  },

  getSegmentsFromKeyframes() {
    const segs = [];
    for (let i = 0; i < this.keyframes.length - 1; i++) {
      segs.push({
        source_id: this.selectedSource.id,
        start: this.keyframes[i],
        end: this.keyframes[i + 1],
      });
    }
    return segs;
  },

  // ── Auto-detect mode ──────────────────────────────────────────────────────

  async detectScenes() {
    if (!this.selectedSource) { toast('Select a source first', 'error'); return; }
    const threshold = parseFloat(document.getElementById('detect-threshold').value) || 27;
    const btn = document.getElementById('detect-btn');
    btn.disabled = true;
    btn.textContent = 'Detecting…';
    try {
      const scenes = await papi('/clips/detect', {
        method: 'POST',
        body: { source_id: this.selectedSource.id, threshold },
      });
      this.detectedSegments = scenes.map(s => ({ ...s, checked: true }));
      toast(`Found ${scenes.length} scenes`, 'success');
      this.renderAutoView();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Detect Scenes';
    }
  },

  toggleSegment(i, checked) {
    this.detectedSegments[i].checked = checked;
  },

  removeDetectedSegment(i) {
    this.detectedSegments.splice(i, 1);
    this.renderAutoView();
  },

  renderAutoView() {
    const el = document.getElementById('segment-list');
    if (!el) return;
    const list = this.detectedSegments;
    if (list.length === 0) {
      el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0">No scenes detected yet</div>';
      return;
    }
    el.innerHTML = list.map((seg, i) => {
      const warn = seg.duration < this.minDuration ? `<span class="segment-warn">⚠ short</span>` : '';
      return `<div class="segment-item">
        <input type="checkbox" ${seg.checked ? 'checked' : ''}
          onchange="Split.toggleSegment(${i}, this.checked)">
        <span class="seg-time">${fmtPrecise(seg.start)} → ${fmtPrecise(seg.end)}</span>
        <span class="seg-dur">${fmtDuration(seg.duration)}</span>
        ${warn}
        <button class="btn btn-ghost btn-sm" onclick="Split.removeDetectedSegment(${i})">✕</button>
      </div>`;
    }).join('');
  },

  selectAll(checked) {
    this.detectedSegments.forEach(s => s.checked = checked);
    this.renderAutoView();
  },

  // ── Mode switching ────────────────────────────────────────────────────────

  setMode(mode) {
    this.mode = mode;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    document.getElementById('manual-controls').classList.toggle('hidden', mode !== 'manual');
    document.getElementById('auto-controls').classList.toggle('hidden', mode !== 'auto');
  },

  // ── Extraction ────────────────────────────────────────────────────────────

  async extractAll() {
    if (!this.selectedSource) { toast('Select a source first', 'error'); return; }

    let segs;
    if (this.mode === 'manual') {
      segs = this.getSegmentsFromKeyframes();
      if (segs.length === 0) { toast('Mark at least 2 keyframes first', 'error'); return; }
    } else {
      segs = this.detectedSegments
        .filter(s => s.checked)
        .map(s => ({ source_id: this.selectedSource.id, start: s.start, end: s.end }));
      if (segs.length === 0) { toast('No segments selected', 'error'); return; }
    }

    const btn = document.getElementById('extract-btn');
    btn.disabled = true;
    btn.textContent = 'Extracting…';
    try {
      const clips = await papi('/clips/extract', {
        method: 'POST',
        body: { segments: segs, min_duration: this.minDuration },
      });
      toast(`Extracted ${clips.length} clips`, 'success');
      if (this.mode === 'manual') {
        this.keyframes = [];
        this.renderManualView();
      } else {
        this.detectedSegments = [];
        this.renderAutoView();
      }
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Extract';
    }
  },
};

// ── Keyboard handler ──────────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  if (App.currentPage !== 'split') return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

  if (e.key === 'm' || e.key === 'M') {
    Split.markKeyframe();
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    Split.stepFrames(e.shiftKey ? 10 : 1);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    Split.stepFrames(e.shiftKey ? -10 : -1);
  }
});
