const Export = {
  clips: [],
  exports: [],

  async load() {
    try {
      [this.clips, this.exports] = await Promise.all([
        papi('/clips'),
        papi('/exports'),
      ]);
    } catch {
      this.clips = [];
      this.exports = [];
    }
    this.renderSummary();
    this.renderHistory();
    this.renderTriggerWord();
  },

  async renderTriggerWord() {
    try {
      const proj = await papi('');
      document.getElementById('trigger-word-input').value = proj.trigger_word || '';
    } catch {}
  },

  async saveTriggerWord() {
    const val = document.getElementById('trigger-word-input').value.trim();
    try {
      await papi('', { method: 'PATCH', body: { trigger_word: val } });
      toast('Trigger word saved', 'success');
    } catch (e) { toast(e.message, 'error'); }
  },

  renderSummary() {
    const approved = this.clips.filter(c => c.status === 'approved').length;
    const flagged = this.clips.filter(c => c.status === 'flagged').length;
    const unreviewed = this.clips.filter(c => c.status === 'unreviewed').length;
    const captioned = this.clips.filter(c => c.has_caption).length;
    const totalDur = this.clips
      .filter(c => c.status === 'approved')
      .reduce((s, c) => s + (c.duration || 0), 0);

    document.getElementById('exp-stat-approved').textContent = approved;
    document.getElementById('exp-stat-flagged').textContent = flagged;
    document.getElementById('exp-stat-unreviewed').textContent = unreviewed;
    document.getElementById('exp-stat-captioned').textContent = captioned;
    document.getElementById('exp-stat-duration').textContent = fmtDuration(totalDur);
  },

  renderHistory() {
    const el = document.getElementById('export-history-list');
    if (!el) return;
    if (this.exports.length === 0) {
      el.innerHTML = '<div style="color:var(--muted);font-size:13px">No exports yet</div>';
      return;
    }
    el.innerHTML = [...this.exports].reverse().map(e => `
      <div class="export-entry">
        <div>
          <div class="exp-name">${esc(e.name)}</div>
          <div class="exp-meta">${esc(e.clip_count)} clips · ${esc(e.created?.slice(0, 10))}</div>
        </div>
        <div class="exp-meta" style="font-size:11px;word-break:break-all">${esc(e.path)}</div>
      </div>`).join('');
  },

  async runExport() {
    const name = (document.getElementById('export-name').value || 'export').trim();
    const approvedOnly = document.getElementById('export-approved-only').checked;

    const btn = document.getElementById('export-btn');
    btn.disabled = true;
    btn.textContent = 'Exporting…';

    try {
      const result = await papi('/export', {
        method: 'POST',
        body: { name, approved_only: approvedOnly },
      });
      toast(`Exported ${result.clip_count} clips to "${name}"`, 'success');
      await this.load();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Run Export';
    }
  },
};
