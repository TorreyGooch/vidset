const Download = {
  sources: [],

  async load() {
    await this.refresh();
  },

  async refresh() {
    try {
      this.sources = await papi('/sources');
    } catch { this.sources = []; }
    this.render();
  },

  render() {
    const tbody = document.getElementById('source-tbody');
    if (!tbody) return;
    if (this.sources.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="color:var(--muted);text-align:center;padding:20px">No source files yet</td></tr>';
      return;
    }
    tbody.innerHTML = this.sources.map(s => `
      <tr data-sid="${esc(s.id)}">
        <td>${esc(s.filename)}</td>
        <td>
          <input type="text" value="${esc(s.concept_name)}"
            onchange="Download.updateConcept('${esc(s.id)}', this.value)"
            style="width:100%">
        </td>
        <td style="color:var(--muted);font-size:12px">${esc(s.url || 'local')}</td>
        <td>
          <button class="btn btn-ghost btn-sm btn-danger"
            onclick="Download.deleteSource('${esc(s.id)}')">Delete</button>
        </td>
      </tr>`).join('');
  },

  async downloadUrl() {
    const url = document.getElementById('dl-url').value.trim();
    const start = document.getElementById('dl-start').value.trim();
    const end = document.getElementById('dl-end').value.trim();
    if (!url) { toast('Enter a URL', 'error'); return; }

    const btn = document.getElementById('dl-btn');
    btn.disabled = true;
    btn.textContent = 'Downloading…';

    try {
      const result = await papi('/sources/download', {
        method: 'POST',
        body: { url, start_time: start || null, end_time: end || null },
      });
      document.getElementById('dl-url').value = '';
      document.getElementById('dl-start').value = '';
      document.getElementById('dl-end').value = '';
      toast(`Downloaded ${result.length} file(s)`, 'success');
      await this.refresh();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Download';
    }
  },

  async importFile(files) {
    for (const file of files) {
      const fd = new FormData();
      fd.append('file', file);
      try {
        await fetch(`/api/projects/${App.projectId}/sources/import`, {
          method: 'POST',
          body: fd,
        });
        toast(`Imported ${file.name}`, 'success');
      } catch (e) {
        toast(`Import failed: ${e.message}`, 'error');
      }
    }
    await this.refresh();
  },

  async updateConcept(sid, value) {
    try {
      await papi(`/sources/${sid}`, { method: 'PATCH', body: { concept_name: value } });
    } catch (e) { toast(e.message, 'error'); }
  },

  async deleteSource(sid) {
    if (!confirm('Delete this source file? This cannot be undone.')) return;
    try {
      await papi(`/sources/${sid}`, { method: 'DELETE' });
      toast('Source deleted');
      await this.refresh();
    } catch (e) { toast(e.message, 'error'); }
  },
};

// Drop zone wiring
document.addEventListener('DOMContentLoaded', () => {
  const zone = document.getElementById('drop-zone');
  if (!zone) return;
  zone.addEventListener('click', () => document.getElementById('file-input').click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    Download.importFile(e.dataTransfer.files);
  });
  document.getElementById('file-input').addEventListener('change', e => {
    Download.importFile(e.target.files);
    e.target.value = '';
  });
});
