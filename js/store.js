/* Données : cache local + synchronisation avec la branche "data" du dépôt GitHub. */
(function () {
  const C = window.CONFIG;
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('mb:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('mb:' + k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem('mb:' + k); } catch {} },
  };

  const b64encode = (str) => { const bytes = new TextEncoder().encode(str); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); };
  const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
  const nowIso = () => new Date().toISOString();
  const api = (path) => `https://api.github.com/repos/${C.owner}/${C.repo}${path}`;
  const raw = (file) => `https://raw.githubusercontent.com/${C.owner}/${C.repo}/${C.dataBranch}/${file}`;

  const listeners = new Set();
  const Store = {
    library: LS.get('library', null),
    releases: LS.get('releases', { series: {} }),
    sha: LS.get('sha', null),
    dirty: LS.get('dirty', false),
    token: LS.get('token', ''),
    prefs: Object.assign({ view: 'grid', sort: 'unread', filter: 'all', theme: 'auto', newsSeenAt: null }, LS.get('prefs', {})),
    syncState: 'idle',
    syncError: '',

    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit(what) { listeners.forEach((fn) => fn(what)); },
    setPrefs(p) { Object.assign(this.prefs, p); LS.set('prefs', this.prefs); },
    setSync(state, err = '') { this.syncState = state; this.syncError = err; this.emit('sync'); },

    headers(json = true) {
      const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
      if (this.token) h.Authorization = 'Bearer ' + this.token;
      if (json) h['Content-Type'] = 'application/json';
      return h;
    },

    // ---------- Lecture ----------
    async load() {
      if (!this.library) {
        // Premier lancement : données de départ embarquées dans le site
        this.library = await fetch('data/library.json').then((r) => r.json());
        this.releases = await fetch('data/releases.json').then((r) => r.json()).catch(() => ({ series: {} }));
        this.persist(false);
      }
      this.emit('data');
      this.refresh();
    },

    async refresh() {
      this.setSync('busy');
      try {
        const [lib, rel] = await Promise.all([this.fetchFile('library.json'), this.fetchFile('releases.json')]);
        if (rel && rel.json) { this.releases = rel.json; LS.set('releases', this.releases); }
        if (lib && lib.json) {
          this.sha = lib.sha || this.sha;
          LS.set('sha', this.sha);
          this.library = this.dirty ? merge(this.library, lib.json) : lib.json;
          LS.set('library', this.library);
        }
        this.emit('data');
        if (this.dirty && this.token) await this.push();
        else this.setSync(this.token ? 'ok' : 'idle');
      } catch (e) {
        this.setSync('error', e.message);
      }
    },

    async fetchFile(name) {
      if (this.token) {
        const r = await fetch(api(`/contents/${name}?ref=${C.dataBranch}&t=${Date.now()}`), { headers: this.headers(false), cache: 'no-store' });
        if (r.status === 404) return null;
        if (r.status === 401) throw new Error('Jeton GitHub refusé (expiré ou invalide)');
        if (!r.ok) throw new Error('GitHub ' + r.status);
        const j = await r.json();
        let text;
        if (j.content) text = b64decode(j.content);
        else text = await fetch(j.download_url, { cache: 'no-store' }).then((x) => x.text()); // fichiers > 1 Mo
        return { json: JSON.parse(text), sha: j.sha };
      }
      const r = await fetch(raw(name) + '?t=' + Math.floor(Date.now() / 60000), { cache: 'no-store' });
      if (!r.ok) return null;
      return { json: await r.json(), sha: null };
    },

    // ---------- Écriture ----------
    persist(markDirty = true) {
      if (markDirty) { this.dirty = true; LS.set('dirty', true); this.library.updated = nowIso(); }
      LS.set('library', this.library);
      if (markDirty) this.schedulePush();
    },

    schedulePush() {
      if (!this.token) return;
      clearTimeout(this._t);
      this.setSync('busy');
      this._t = setTimeout(() => this.push().catch(() => {}), 2000);
    },

    async push(attempt = 0) {
      if (!this.token) return;
      this.setSync('busy');
      try {
        const body = { message: 'Mise à jour de la bibliothèque', content: b64encode(JSON.stringify(this.library, null, 1)), branch: C.dataBranch };
        if (this.sha) body.sha = this.sha;
        const r = await fetch(api('/contents/library.json'), { method: 'PUT', headers: this.headers(), body: JSON.stringify(body) });
        if ((r.status === 409 || r.status === 422) && attempt < 3) {
          // Quelqu'un (l'autre appareil) a écrit entre-temps : on fusionne puis on réessaie
          const remote = await this.fetchFile('library.json');
          if (remote) { this.library = merge(this.library, remote.json); this.sha = remote.sha; }
          return this.push(attempt + 1);
        }
        if (r.status === 401) throw new Error('Jeton GitHub refusé (expiré ou invalide)');
        if (!r.ok) throw new Error('GitHub ' + r.status);
        const j = await r.json();
        this.sha = j.content.sha; LS.set('sha', this.sha);
        this.dirty = false; LS.set('dirty', false);
        LS.set('library', this.library);
        this.setSync('ok');
      } catch (e) {
        this.setSync('error', e.message);
      }
    },

    async setToken(t) {
      this.token = (t || '').trim();
      if (this.token) LS.set('token', this.token); else LS.del('token');
      if (!this.token) { this.setSync('idle'); return true; }
      const r = await fetch(api(''), { headers: this.headers(false) });
      if (!r.ok) { this.setSync('error', 'Jeton refusé'); return false; }
      await this.refresh();
      return true;
    },

    async runChecker() {
      if (!this.token) throw new Error('Synchronisation non configurée');
      const r = await fetch(api(`/actions/workflows/${C.workflow}/dispatches`), { method: 'POST', headers: this.headers(), body: JSON.stringify({ ref: 'main' }) });
      if (!r.ok) throw new Error(r.status === 403 ? 'Le jeton n’a pas le droit « Actions »' : 'GitHub ' + r.status);
    },

    // ---------- Séries ----------
    all() { return (this.library?.series || []).filter((s) => !s.deleted); },
    get(id) { return this.library.series.find((s) => s.id === id); },
    update(id, patch) {
      const s = this.get(id); if (!s) return;
      Object.assign(s, patch, { updated: nowIso() });
      this.persist(); this.emit('data');
    },
    add(s) {
      let id = slug(s.title) || 'serie'; while (this.get(id)) id += '-2';
      const item = Object.assign({ id, status: 'a_commencer', next: null, rating: null, volumes: 0, publisher: null, mu: null, verify: false, notes: '' }, s, { id, updated: nowIso() });
      this.library.series.push(item); this.persist(); this.emit('data'); return item;
    },
    remove(id) { this.update(id, { deleted: true }); },
    rel(s) { return s && s.mu ? this.releases.series?.[String(s.mu)] || null : null; },
  };

  function merge(local, remote) {
    const map = new Map();
    for (const s of remote.series || []) map.set(s.id, s);
    for (const s of local.series || []) {
      const r = map.get(s.id);
      if (!r || (s.updated || '') > (r.updated || '')) map.set(s.id, s);
    }
    return Object.assign({}, remote, { series: [...map.values()], updated: nowIso() });
  }
  function slug(t) { return t.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60); }

  Store.slug = slug;
  Store.LS = LS;
  window.Store = Store;
})();
