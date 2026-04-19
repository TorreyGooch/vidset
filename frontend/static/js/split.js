const Split = {
  sources: [],
  selectedSource: null,
  mode: 'manual',          // 'manual' | 'auto'
  manualSegments: [],      // { start, end } from manual entry
  detectedSegments: [],    // from PySceneDetect, with checked flag
  minDuration: 1.5,

  async load() {
    try {
      this.sources = await papi('/sources');
    } catch { this.sources = []; }
    this.renderSourceList();
    this.renderSegmentList();
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

  selectSource(sid) {
    this.selectedSource = this.sources.find(s => s.id === sid) || null;
    this.manualSegments = [];
    this.detectedSegments = [];
    this.renderSourceList();
    this.renderVideo();
    this.renderSegmentList();
  },

  renderVideo() {
    const vid = document.getElementById('split-video');
    if (!vid || !this.selectedSource) return;
    vid.src = `/api/projects/${App.projectId}/media/source/${encodeURIComponent(this.selectedSource.filename)}`;
    vid.load();
  },

  setStartFromVideo() {
    const vid = document.getElementById('split-video');
    document.getElementById('seg-start').value = vid.currentTime.toFixed(2);
  },

  setEndFromVideo() {
    const vid = document.getElementById('split-video');
    document.getElementById('seg-end').value = vid.currentTime.toFixed(2);
  },

  addManualSegment() {
    const start = parseFloat(document.getElementById('seg-start').value);
    const end = parseFloat(document.getElementById('seg-end').value);
    if (isNaN(start) || isNaN(end) || end <= start) {
      toast('Invalid start/end times', 'error'); return;
    }
    this.manualSegments.push({ start, end, checked: true });
    document.getElementById('seg-start').value = '';
    document.getElementById('seg-end').value = '';
    this.renderSegmentList();
  },

  removeSegment(i) {
    if (this.mode === 'manual') this.manualSegments.splice(i, 1);
    else this.detectedSegments.splice(i, 1);
    this.renderSegmentList();
  },

  toggleSegment(i, checked) {
    const list = this.mode === 'manual' ? this.manualSegments : this.detectedSegments;
    list[i].checked = checked;
  },

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
      this.renderSegmentList();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Detect Scenes';
    }
  },

  renderSegmentList() {
    const el = document.getElementById('segment-list');
    if (!el) return;
    const list = this.mode === 'manual' ? this.manualSegments : this.detectedSegments;
    if (list.length === 0) {
      el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0">No segments yet</div>';
      return;
    }
    el.innerHTML = list.map((seg, i) => {
      const warn = seg.duration < this.minDuration ? `<span class="segment-warn">⚠ short</span>` : '';
      return `<div class="segment-item">
        <input type="checkbox" ${seg.checked ? 'checked' : ''}
          onchange="Split.toggleSegment(${i}, this.checked)">
        <span class="seg-time">${fmtTimecode(seg.start)} → ${fmtTimecode(seg.end)}</span>
        <span class="seg-dur">${fmtDuration(seg.duration ?? (seg.end - seg.start))}</span>
        ${warn}
        <button class="btn btn-ghost btn-sm" onclick="Split.removeSegment(${i})">✕</button>
      </div>`;
    }).join('');
  },

  setMode(mode) {
    this.mode = mode;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    document.getElementById('manual-controls').classList.toggle('hidden', mode !== 'manual');
    document.getElementById('auto-controls').classList.toggle('hidden', mode !== 'auto');
    this.renderSegmentList();
  },

  selectAll(checked) {
    const list = this.mode === 'manual' ? this.manualSegments : this.detectedSegments;
    list.forEach(s => s.checked = checked);
    this.renderSegmentList();
  },

  async extractSelected() {
    if (!this.selectedSource) { toast('Select a source first', 'error'); return; }
    const list = this.mode === 'manual' ? this.manualSegments : this.detectedSegments;
    const segs = list.filter(s => s.checked).map(s => ({
      source_id: this.selectedSource.id,
      start: s.start,
      end: s.end,
    }));
    if (segs.length === 0) { toast('No segments selected', 'error'); return; }

    const btn = document.getElementById('extract-btn');
    btn.disabled = true;
    btn.textContent = 'Extracting…';
    try {
      const clips = await papi('/clips/extract', {
        method: 'POST',
        body: { segments: segs, min_duration: this.minDuration },
      });
      toast(`Extracted ${clips.length} clips`, 'success');
      if (this.mode === 'manual') this.manualSegments = [];
      else this.detectedSegments = [];
      this.renderSegmentList();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Extract Selected';
    }
  },
};
