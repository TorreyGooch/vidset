const Review = {
  clips: [],
  filtered: [],
  filter: 'all',
  selected: new Set(),       // clip ids
  focusedId: null,           // the single clip shown in detail panel
  caption: '',               // current caption text in editor
  lastClickIdx: null,        // for shift+click range select

  async load() {
    await this.refresh();
  },

  async refresh() {
    try {
      this.clips = await papi('/clips');
    } catch { this.clips = []; }
    this.applyFilter();
    this.renderStats();
    this.renderGrid();
    if (this.focusedId) {
      const still = this.clips.find(c => c.id === this.focusedId);
      if (still) this.openDetail(still);
      else this.closeDetail();
    }
  },

  applyFilter() {
    this.filtered = this.filter === 'all'
      ? [...this.clips]
      : this.clips.filter(c => c.status === this.filter);
    // keep selection valid
    const ids = new Set(this.filtered.map(c => c.id));
    for (const id of this.selected) {
      if (!ids.has(id)) this.selected.delete(id);
    }
  },

  setFilter(f) {
    this.filter = f;
    this.selected.clear();
    this.applyFilter();
    this.renderGrid();
    this.renderStats();
    this.renderBatchBar();
    document.querySelectorAll('.filter-btn').forEach(b => {
      b.className = 'filter-btn' + (b.dataset.filter === f ? ` active-${f}` : '');
    });
  },

  renderStats() {
    const total = this.clips.length;
    const approved = this.clips.filter(c => c.status === 'approved').length;
    const flagged = this.clips.filter(c => c.status === 'flagged').length;
    const unreviewed = this.clips.filter(c => c.status === 'unreviewed').length;
    const el = document.getElementById('review-stats');
    if (el) el.textContent = `${total} clips — ${approved} approved · ${flagged} flagged · ${unreviewed} unreviewed`;
  },

  renderGrid() {
    const grid = document.getElementById('thumb-grid');
    if (!grid) return;
    if (this.filtered.length === 0) {
      grid.innerHTML = '<div style="color:var(--muted);font-size:13px;grid-column:1/-1;padding:20px">No clips match this filter</div>';
      return;
    }
    grid.innerHTML = this.filtered.map((clip, idx) => {
      const sel = this.selected.has(clip.id);
      const focused = this.focusedId === clip.id;
      const thumb = `/api/projects/${App.projectId}/clips/${encodeURIComponent(clip.id)}/thumbnail`;
      return `
        <div class="thumb-card ${sel ? 'selected' : ''} ${focused ? 'focused' : ''}"
             data-id="${esc(clip.id)}" data-idx="${idx}"
             onclick="Review.handleClick(event, '${esc(clip.id)}', ${idx})">
          <div class="check-mark">✓</div>
          <img src="${thumb}" onerror="this.style.background='#111'" alt="">
          <div class="thumb-status"><span class="badge badge-${clip.status}">${clip.status}</span></div>
          <div class="thumb-info">
            <div class="thumb-id">${esc(clip.id)}</div>
            <div class="thumb-dur">${fmtDuration(clip.duration)}</div>
          </div>
        </div>`;
    }).join('');
  },

  handleClick(event, clipId, idx) {
    if (event.shiftKey && this.lastClickIdx !== null) {
      // Range select
      const lo = Math.min(this.lastClickIdx, idx);
      const hi = Math.max(this.lastClickIdx, idx);
      for (let i = lo; i <= hi; i++) {
        this.selected.add(this.filtered[i].id);
      }
    } else if (event.ctrlKey || event.metaKey) {
      // Toggle
      if (this.selected.has(clipId)) this.selected.delete(clipId);
      else this.selected.add(clipId);
    } else {
      // Single click: if already the only selection, open detail
      if (this.selected.size === 1 && this.selected.has(clipId)) {
        // already selected, open detail
      } else {
        this.selected.clear();
        this.selected.add(clipId);
      }
      // Open detail
      const clip = this.filtered[idx];
      this.openDetail(clip);
    }
    this.lastClickIdx = idx;
    this.renderGrid();
    this.renderBatchBar();
  },

  renderBatchBar() {
    const bar = document.getElementById('batch-bar');
    if (!bar) return;
    const count = this.selected.size;
    bar.classList.toggle('hidden', count === 0);
    document.getElementById('batch-sel-count').textContent = `${count} selected`;
  },

  async applyBatchTag() {
    const tag = document.getElementById('batch-tag-input').value.trim();
    if (!tag) { toast('Enter a tag', 'error'); return; }
    try {
      await papi('/clips/batch-tag', {
        method: 'POST',
        body: { clip_ids: [...this.selected], tag, action: 'add' },
      });
      document.getElementById('batch-tag-input').value = '';
      toast(`Tag "${tag}" added to ${this.selected.size} clips`, 'success');
      await this.refresh();
    } catch (e) { toast(e.message, 'error'); }
  },

  async applyBatchRemoveTag() {
    const tag = document.getElementById('batch-tag-input').value.trim();
    if (!tag) { toast('Enter a tag to remove', 'error'); return; }
    try {
      await papi('/clips/batch-tag', {
        method: 'POST',
        body: { clip_ids: [...this.selected], tag, action: 'remove' },
      });
      document.getElementById('batch-tag-input').value = '';
      toast(`Tag "${tag}" removed`, 'success');
      await this.refresh();
    } catch (e) { toast(e.message, 'error'); }
  },

  async applyBatchStatus(status) {
    try {
      await papi('/clips/batch-status', {
        method: 'POST',
        body: { clip_ids: [...this.selected], status },
      });
      toast(`Marked ${this.selected.size} clips as ${status}`, 'success');
      this.selected.clear();
      await this.refresh();
    } catch (e) { toast(e.message, 'error'); }
  },

  clearSelection() {
    this.selected.clear();
    this.renderGrid();
    this.renderBatchBar();
  },

  async batchDelete() {
    const count = this.selected.size;
    if (count === 0) return;
    if (!confirm(`Delete ${count} clip${count !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    const ids = [...this.selected];
    let failed = 0;
    for (const id of ids) {
      try {
        await papi(`/clips/${id}`, { method: 'DELETE' });
      } catch { failed++; }
    }
    this.selected.clear();
    if (this.focusedId && ids.includes(this.focusedId)) this.closeDetail();
    await this.refresh();
    toast(failed ? `Deleted ${ids.length - failed}, ${failed} failed` : `Deleted ${ids.length} clips`);
  },

  // ── Detail panel ──────────────────────────────────────────────────────────

  async openDetail(clip) {
    this.focusedId = clip.id;
    document.getElementById('detail-empty').classList.add('hidden');
    document.getElementById('detail-content').classList.remove('hidden');

    // Video
    const vid = document.getElementById('detail-video');
    vid.src = `/api/projects/${App.projectId}/media/clips/${encodeURIComponent(clip.filename)}`;
    vid.load();

    // Meta
    document.getElementById('detail-clip-id').textContent = clip.id;
    document.getElementById('detail-duration').textContent = fmtDuration(clip.duration);
    document.getElementById('detail-concept').textContent = clip.concept_name || '—';
    document.getElementById('detail-status-badge').className = `badge badge-${clip.status}`;
    document.getElementById('detail-status-badge').textContent = clip.status;

    // Tags
    this._currentClip = clip;
    this.renderDetailTags(clip.tags || []);

    // Caption
    try {
      const capData = await papi(`/clips/${clip.id}/caption`);
      this.caption = capData.text;
    } catch { this.caption = ''; }
    const ta = document.getElementById('caption-editor');
    ta.value = this.caption;
    this.updateWordCount();
  },

  closeDetail() {
    this.focusedId = null;
    this._currentClip = null;
    document.getElementById('detail-empty').classList.remove('hidden');
    document.getElementById('detail-content').classList.add('hidden');
  },

  renderDetailTags(tags) {
    const el = document.getElementById('detail-tags');
    el.innerHTML = tags.map((t, i) => `
      <span class="tag-pill">
        ${esc(t)}
        <span class="remove-tag" onclick="Review.removeDetailTag(${i})">×</span>
      </span>`).join('') + `<span style="color:var(--muted);font-size:12px">${tags.length === 0 ? 'No tags' : ''}</span>`;
  },

  async removeDetailTag(idx) {
    if (!this._currentClip) return;
    const tags = [...(this._currentClip.tags || [])];
    tags.splice(idx, 1);
    try {
      const updated = await papi(`/clips/${this._currentClip.id}`, {
        method: 'PATCH', body: { tags },
      });
      this._currentClip.tags = updated.tags;
      this.renderDetailTags(updated.tags);
      await this.refresh();
    } catch (e) { toast(e.message, 'error'); }
  },

  async addDetailTag() {
    if (!this._currentClip) return;
    const input = document.getElementById('add-tag-input');
    const tag = input.value.trim();
    if (!tag) return;
    const tags = [...(this._currentClip.tags || [])];
    if (!tags.includes(tag)) tags.push(tag);
    try {
      const updated = await papi(`/clips/${this._currentClip.id}`, {
        method: 'PATCH', body: { tags },
      });
      this._currentClip.tags = updated.tags;
      input.value = '';
      this.renderDetailTags(updated.tags);
      await this.refresh();
    } catch (e) { toast(e.message, 'error'); }
  },

  updateWordCount() {
    const ta = document.getElementById('caption-editor');
    const words = ta.value.trim() ? ta.value.trim().split(/\s+/).length : 0;
    document.getElementById('caption-word-count').textContent = `${words} words`;
  },

  async saveCaption() {
    if (!this._currentClip) return;
    const text = document.getElementById('caption-editor').value;
    try {
      await papi(`/clips/${this._currentClip.id}`, {
        method: 'PATCH',
        body: { caption: text, caption_source: 'manual' },
      });
      toast('Caption saved', 'success');
      await this.refresh();
    } catch (e) { toast(e.message, 'error'); }
  },

  async setDetailStatus(status) {
    if (!this._currentClip) return;
    try {
      const updated = await papi(`/clips/${this._currentClip.id}`, {
        method: 'PATCH', body: { status },
      });
      this._currentClip.status = updated.status;
      document.getElementById('detail-status-badge').className = `badge badge-${status}`;
      document.getElementById('detail-status-badge').textContent = status;
      await this.refresh();
      // Auto-advance to next clip
      this.advanceToNext();
    } catch (e) { toast(e.message, 'error'); }
  },

  async deleteDetailClip() {
    if (!this._currentClip) return;
    if (!confirm('Delete this clip and its caption? This cannot be undone.')) return;
    try {
      await papi(`/clips/${this._currentClip.id}`, { method: 'DELETE' });
      this.closeDetail();
      await this.refresh();
    } catch (e) { toast(e.message, 'error'); }
  },

  advanceToNext() {
    const idx = this.filtered.findIndex(c => c.id === this.focusedId);
    if (idx < this.filtered.length - 1) {
      const next = this.filtered[idx + 1];
      this.selected.clear();
      this.selected.add(next.id);
      this.openDetail(next);
      this.renderGrid();
    }
  },

  // Keyboard navigation
  handleKey(e) {
    if (!this.focusedId) return;
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
    const idx = this.filtered.findIndex(c => c.id === this.focusedId);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      if (idx < this.filtered.length - 1) {
        const next = this.filtered[idx + 1];
        this.selected.clear();
        this.selected.add(next.id);
        this.openDetail(next);
        this.renderGrid();
      }
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      if (idx > 0) {
        const prev = this.filtered[idx - 1];
        this.selected.clear();
        this.selected.add(prev.id);
        this.openDetail(prev);
        this.renderGrid();
      }
    } else if (e.key === 'a') {
      this.setDetailStatus('approved');
    } else if (e.key === 'f') {
      this.setDetailStatus('flagged');
    } else if (e.key === 'u') {
      this.setDetailStatus('unreviewed');
    }
  },
};

// Keyboard handler
document.addEventListener('keydown', e => {
  if (App.currentPage === 'review') Review.handleKey(e);
});

// Caption auto-save on blur
document.addEventListener('DOMContentLoaded', () => {
  const ta = document.getElementById('caption-editor');
  if (ta) {
    ta.addEventListener('input', () => Review.updateWordCount());
    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        Review.saveCaption();
      }
    });
  }
  const addTagInput = document.getElementById('add-tag-input');
  if (addTagInput) {
    addTagInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') Review.addDetailTag();
    });
  }
  const batchInput = document.getElementById('batch-tag-input');
  if (batchInput) {
    batchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') Review.applyBatchTag();
    });
  }
});
