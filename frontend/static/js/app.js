// Core app state and shared utilities

const App = {
  projectId: null,
  projectName: null,
  currentPage: null,

  async init() {
    const stored = localStorage.getItem('vidset_project');
    if (stored) {
      const { id, name } = JSON.parse(stored);
      this.projectId = id;
      this.projectName = name;
    }

    await this.renderProjectOverlay();

    document.querySelectorAll('.sidebar-nav li').forEach(li => {
      li.addEventListener('click', () => this.navigate(li.dataset.page));
    });
  },

  async renderProjectOverlay() {
    const projects = await api('/api/projects');
    const list = document.getElementById('recent-projects');
    list.innerHTML = '';

    if (projects.length === 0) {
      list.innerHTML = '<div style="color:var(--muted);font-size:13px">No recent projects</div>';
    } else {
      projects.forEach(p => {
        const div = document.createElement('div');
        div.className = 'project-item';
        div.innerHTML = `
          <div>
            <div class="proj-name">${esc(p.name)}</div>
            <div class="proj-path">${esc(p.path)}</div>
          </div>
          <button class="btn btn-ghost btn-sm">Open</button>`;
        div.querySelector('button').addEventListener('click', () => this.openProject(p.id, p.name));
        list.appendChild(div);
      });
    }

    if (this.projectId) {
      this.enterApp();
    } else {
      document.getElementById('project-overlay').classList.remove('hidden');
      document.getElementById('app').classList.add('hidden');
    }
  },

  openProject(id, name) {
    this.projectId = id;
    this.projectName = name;
    localStorage.setItem('vidset_project', JSON.stringify({ id, name }));
    document.getElementById('project-overlay').classList.add('hidden');
    this.enterApp();
  },

  enterApp() {
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('sidebar-proj-name').textContent = this.projectName;
    this.navigate('download');
  },

  navigate(page) {
    this.currentPage = page;
    document.querySelectorAll('.sidebar-nav li').forEach(li => {
      li.classList.toggle('active', li.dataset.page === page);
    });
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(`page-${page}`).classList.add('active');

    const handlers = {
      download: () => Download.load(),
      split: () => Split.load(),
      review: () => Review.load(),
      export: () => Export.load(),
    };
    handlers[page]?.();
  },

  switchProject() {
    this.projectId = null;
    this.projectName = null;
    localStorage.removeItem('vidset_project');
    document.getElementById('app').classList.add('hidden');
    this.renderProjectOverlay();
    document.getElementById('project-overlay').classList.remove('hidden');
  },
};

// ── API helper ────────────────────────────────────────────────────────────────

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Request failed');
  }
  return res.json();
}

function papi(path, options = {}) {
  return api(`/api/projects/${App.projectId}${path}`, options);
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast${type ? ' toast-' + type : ''}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDuration(s) {
  s = Math.round(s);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function fmtTimecode(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toFixed(2).padStart(5, '0');
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${sec}`;
}

// ── Project creation / open forms ─────────────────────────────────────────────

async function createProject() {
  const name = document.getElementById('new-proj-name').value.trim();
  const path = document.getElementById('new-proj-path').value.trim();
  if (!name || !path) { toast('Name and path are required', 'error'); return; }
  try {
    const p = await api('/api/projects', { method: 'POST', body: { name, path } });
    toast('Project created', 'success');
    App.openProject(p.id, p.name);
  } catch (e) { toast(e.message, 'error'); }
}

async function openExistingProject() {
  const path = document.getElementById('open-proj-path').value.trim();
  if (!path) { toast('Path required', 'error'); return; }
  try {
    const p = await api('/api/projects/open', { method: 'POST', body: { path } });
    toast('Project opened', 'success');
    App.openProject(p.id, p.name);
  } catch (e) { toast(e.message, 'error'); }
}

document.addEventListener('DOMContentLoaded', () => App.init());
