/* Ma Biblio : interface */
(function () {
  const S = window.Store;
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = new Intl.NumberFormat('fr-FR');
  const n = (v) => nf.format(v);

  const STATUS = {
    en_cours: { label: 'En cours', short: 'En cours' },
    a_commencer: { label: 'À commencer', short: 'À commencer' },
    terminee: { label: 'Terminée', short: 'Terminée' },
    collection: { label: 'Collection papier', short: 'Papier' },
  };
  const SPARKLE = 40;

  const ui = { q: '' };

  // ---------- Données dérivées ----------
  function derive(s) {
    const rel = S.rel(s);
    const latest = rel && rel.latest ? rel.latest : null;
    let unread = 0;
    if (latest) {
      if (s.status === 'en_cours' && s.next) unread = Math.max(0, latest - s.next + 1);
      else if (s.status === 'a_commencer') unread = latest - (s.next ? s.next - 1 : 0);
    }
    const read = s.next ? s.next - 1 : 0;
    return {
      rel, latest, unread, read,
      sparkle: s.status === 'en_cours' && unread >= SPARKLE,
      cover: rel?.cover || '',
      type: rel?.type || '',
      voDone: !!rel?.completed,
      changedAt: rel?.changed_at || null,
      pct: latest && read ? Math.min(100, Math.round((read / latest) * 100)) : (s.status === 'terminee' ? 100 : 0),
    };
  }

  function hue(str) { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
  function phStyle(t) { const h = hue(t); return `background:linear-gradient(150deg,hsl(${h} 55% 42%),hsl(${(h + 40) % 360} 60% 28%))`; }
  function initials(t) { return t.replace(/^(the|a|le|la|les)\s+/i, '').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase(); }
  function coverHtml(s, d, big = false) {
    const ph = `<div class="ph" style="${phStyle(s.title)}">${esc(big ? s.title : s.title)}</div>`;
    if (!d.cover) return ph;
    return `${ph}<img src="${esc(d.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`;
  }
  function thumbHtml(s, d) {
    return `<div class="ph" style="${phStyle(s.title)}">${esc(initials(s.title))}</div>${d.cover ? `<img src="${esc(d.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}`;
  }
  function ago(iso) {
    if (!iso) return '';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 3600) return 'il y a ' + Math.max(1, Math.round(diff / 60)) + ' min';
    if (diff < 86400) return 'il y a ' + Math.round(diff / 3600) + ' h';
    const dd = Math.round(diff / 86400);
    if (dd < 30) return dd === 1 ? 'hier' : `il y a ${dd} j`;
    return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }
  const fmtRating = (r) => (r == null ? '' : (Number.isInteger(r) ? r : r.toFixed(1).replace('.', ',')));

  // ---------- Routeur ----------
  const routes = { '': renderLibrary, nouveautes: renderNews, stats: renderStats, reglages: renderSettings };
  function route() {
    const h = location.hash;
    if (h.startsWith('#sync=')) {
      const t = decodeURIComponent(h.slice(6));
      history.replaceState(null, '', location.pathname + '#/reglages');
      S.setToken(t).then((ok) => toast(ok ? 'Synchronisation activée sur cet appareil' : 'Ce lien de synchronisation ne marche pas'));
    }
    const key = (location.hash.replace(/^#\/?/, '').split('?')[0]) || '';
    const fn = routes[key] || renderLibrary;
    const tab = { '': 'library', nouveautes: 'news', stats: 'stats', reglages: 'settings' }[key] || 'library';
    $$('[data-tab]').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
    $('.fab').hidden = tab !== 'library';
    if (tab === 'news') markNewsSeenSoon();
    fn();
  }

  // ---------- Bibliothèque ----------
  const FILTERS = [
    ['all', 'Tout', () => true],
    ['dispo', 'À lire', (s, d) => s.status === 'en_cours' && d.unread > 0],
    ['sparkle', '✨ 40+', (s, d) => d.sparkle],
    ['en_cours', 'En cours', (s) => s.status === 'en_cours'],
    ['a_commencer', 'À commencer', (s) => s.status === 'a_commencer'],
    ['terminee', 'Terminées', (s) => s.status === 'terminee'],
    ['papier', 'Papier', (s) => s.volumes > 0],
    ['verify', 'À vérifier', (s) => s.verify],
  ];
  const SORTS = {
    unread: ['Le plus à lire', (a, b) => sortUnread(b) - sortUnread(a) || a.s.title.localeCompare(b.s.title)],
    rating: ['Meilleure note', (a, b) => (b.s.rating ?? -1) - (a.s.rating ?? -1) || b.d.unread - a.d.unread],
    recent: ['Sorties récentes', (a, b) => (b.d.changedAt || '').localeCompare(a.d.changedAt || '') || b.d.unread - a.d.unread],
    updated: ['Modifiées récemment', (a, b) => (b.s.updated || '').localeCompare(a.s.updated || '')],
    title: ['Titre A → Z', (a, b) => a.s.title.localeCompare(b.s.title, 'fr')],
  };

  function sortUnread(x) { return x.s.status === 'en_cours' ? x.d.unread : x.s.status === 'a_commencer' ? -1 : -2; }
  function norm(t) { return (t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  function renderLibrary() {
    const view = $('#view');
    const items = S.all().map((s) => ({ s, d: derive(s) }));
    const enCours = items.filter((x) => x.s.status === 'en_cours');
    const toRead = enCours.reduce((a, x) => a + x.d.unread, 0);
    const sparkles = items.filter((x) => x.d.sparkle).length;
    const volumes = items.reduce((a, x) => a + (x.s.volumes || 0), 0);
    const p = S.prefs;

    view.innerHTML = `
      <div class="summary">
        <button class="stat" data-filter="en_cours"><b>${n(enCours.length)}</b><span>séries en cours</span></button>
        <button class="stat" data-filter="dispo"><b>${n(toRead)}</b><span>chapitres à lire</span></button>
        <button class="stat" data-filter="sparkle"><b>${n(sparkles)}</b><span>✨ avec 40+ à lire</span></button>
        <button class="stat" data-filter="papier"><b>${n(volumes)}</b><span>tomes papier</span></button>
      </div>
      <div class="toolbar">
        <label class="search"><svg viewBox="0 0 24 24"><path d="M10 3a7 7 0 1 0 4.2 12.6l5.1 5.1 1.4-1.4-5.1-5.1A7 7 0 0 0 10 3zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10z"/></svg>
          <input type="search" placeholder="Rechercher une série…" value="${esc(ui.q)}" data-q autocomplete="off" enterkeyhint="search"></label>
        <select class="select" data-sort aria-label="Trier">${Object.entries(SORTS).map(([k, [l]]) => `<option value="${k}" ${p.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <div class="viewtoggle" role="group" aria-label="Affichage">
          <button data-view="grid" class="${p.view === 'grid' ? 'on' : ''}" aria-label="Couvertures"><svg viewBox="0 0 24 24"><path d="M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z"/></svg></button>
          <button data-view="list" class="${p.view === 'list' ? 'on' : ''}" aria-label="Liste"><svg viewBox="0 0 24 24"><path d="M4 5h16v3H4zm0 5.5h16v3H4zM4 16h16v3H4z"/></svg></button>
        </div>
      </div>
      <div class="chips" data-chips></div>
      <div data-results></div>`;

    $('[data-q]', view).addEventListener('input', (e) => { ui.q = e.target.value; drawResults(); });
    $('[data-sort]', view).addEventListener('change', (e) => { S.setPrefs({ sort: e.target.value }); drawResults(); });
    $$('[data-view]', view).forEach((b) => b.addEventListener('click', () => { S.setPrefs({ view: b.dataset.view }); renderLibrary(); }));
    $$('.stat[data-filter]', view).forEach((b) => b.addEventListener('click', () => { S.setPrefs({ filter: b.dataset.filter }); drawResults(); }));
    drawResults();

    function drawResults() {
      const chips = $('[data-chips]', view);
      chips.innerHTML = FILTERS.map(([k, l, f]) => {
        const c = items.filter((x) => f(x.s, x.d)).length;
        if (k === 'verify' && !c) return '';
        return `<button class="chip ${p.filter === k ? 'on' : ''}" data-f="${k}">${l} <i>${c}</i></button>`;
      }).join('');
      $$('[data-f]', chips).forEach((b) => b.addEventListener('click', () => { S.setPrefs({ filter: b.dataset.f }); drawResults(); }));

      const f = (FILTERS.find((x) => x[0] === p.filter) || FILTERS[0])[2];
      const q = norm(ui.q).trim();
      let list = items.filter((x) => f(x.s, x.d));
      if (q) list = list.filter((x) => norm(x.s.title).includes(q) || norm(x.d.rel?.title).includes(q));
      list.sort((SORTS[p.sort] || SORTS.unread)[1]);

      const box = $('[data-results]', view);
      if (!list.length) {
        box.innerHTML = `<div class="empty"><b>Aucune série ici</b>${q ? 'Essaie un autre mot, ou ajoute-la avec le bouton +.' : 'Change de filtre pour voir le reste de ta bibliothèque.'}</div>`;
        return;
      }
      box.innerHTML = p.view === 'list' ? `<div class="list">${list.map(rowHtml).join('')}</div>` : `<div class="grid">${list.map(cardHtml).join('')}</div>`;
      bindItems(box);
    }
  }

  function metaLine(s, d) {
    if (s.status === 'en_cours') return s.next ? `Ch. ${n(s.next)}${d.latest ? ' / ' + n(d.latest) : ''}` : 'En cours';
    if (s.status === 'a_commencer') return d.latest ? `À commencer · ${n(d.latest)} ch.` : 'À commencer';
    if (s.status === 'terminee') return 'Terminée';
    return s.volumes ? `${n(s.volumes)} tome${s.volumes > 1 ? 's' : ''}` : 'Collection';
  }
  function newBadge(s, d) {
    if (s.status === 'terminee') return `<span class="badge done">✓</span>`;
    if (s.status === 'en_cours' && d.unread > 0) return `<span class="badge new ${d.sparkle ? 'big' : ''}">${d.sparkle ? '✨ ' : ''}+${n(d.unread)}</span>`;
    return '';
  }
  function cardHtml({ s, d }) {
    const canQuick = s.status === 'en_cours' && s.next;
    return `<article class="card" data-id="${esc(s.id)}">
      <div class="cover">${coverHtml(s, d)}
        ${s.rating != null ? `<span class="badge rating">★ ${fmtRating(s.rating)}</span>` : ''}
        ${newBadge(s, d)}
        ${canQuick ? `<button class="quick" data-quick aria-label="J'ai lu le chapitre ${s.next}">+1</button>` : ''}
        ${d.pct && s.status === 'en_cours' ? `<div class="progress"><span style="width:${d.pct}%"></span></div>` : ''}
      </div>
      <div class="t">${esc(s.title)}</div>
      <div class="m">${metaLine(s, d)}</div>
    </article>`;
  }
  function rowHtml({ s, d }) {
    const canQuick = s.status === 'en_cours' && s.next;
    return `<article class="row" data-id="${esc(s.id)}">
      <div class="thumb">${thumbHtml(s, d)}</div>
      <div><div class="t">${esc(s.title)}</div>
        <div class="m"><span>${metaLine(s, d)}</span>${s.status === 'en_cours' && d.unread ? `<span class="pill">${d.sparkle ? '✨ ' : ''}+${n(d.unread)}</span>` : ''}${s.rating != null ? `<span>★ ${fmtRating(s.rating)}</span>` : ''}${d.type ? `<span>${esc(d.type)}</span>` : ''}</div></div>
      <div class="act">${canQuick ? `<button class="btn small" data-quick>+1</button>` : ''}</div>
    </article>`;
  }
  function bindItems(box) {
    $$('[data-id]', box).forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-quick]')) { e.stopPropagation(); quickRead(el.dataset.id); return; }
        if (e.target.closest('[data-allread]')) { e.stopPropagation(); allRead(el.dataset.id); return; }
        openDetail(el.dataset.id);
      });
    });
  }

  function quickRead(id) {
    const s = S.get(id); const prev = { next: s.next, status: s.status };
    S.update(id, { next: (s.next || 1) + 1, status: 'en_cours' });
    if (navigator.vibrate) navigator.vibrate(10);
    toast(`${s.title} : chapitre ${prev.next} lu`, () => S.update(id, prev));
  }
  function allRead(id) {
    const s = S.get(id); const d = derive(s); const prev = { next: s.next, status: s.status };
    if (!d.latest) return;
    S.update(id, { next: d.latest + 1, status: 'en_cours' });
    toast(`${s.title} : à jour (ch. ${d.latest})`, () => S.update(id, prev));
  }

  // ---------- Nouveautés ----------
  let seenTimer;
  function markNewsSeenSoon() {
    clearTimeout(seenTimer);
    seenTimer = setTimeout(() => { S.setPrefs({ newsSeenAt: new Date().toISOString() }); updateBadges(); }, 4000);
  }
  function newsItems() {
    return S.all().map((s) => ({ s, d: derive(s) })).filter((x) => x.s.status === 'en_cours' && x.d.unread > 0);
  }
  function isFresh(d) { const seen = S.prefs.newsSeenAt; return d.changedAt && (!seen || d.changedAt > seen); }

  function renderNews() {
    const view = $('#view');
    const items = newsItems();
    const fresh = items.filter((x) => isFresh(x.d)).sort((a, b) => b.d.changedAt.localeCompare(a.d.changedAt));
    const week = Date.now() - 7 * 86400e3;
    const recent = items.filter((x) => !isFresh(x.d) && x.d.changedAt && new Date(x.d.changedAt) > week).sort((a, b) => b.d.changedAt.localeCompare(a.d.changedAt));
    const rest = items.filter((x) => !fresh.includes(x) && !recent.includes(x)).sort((a, b) => (b.s.rating ?? 0) - (a.s.rating ?? 0) || a.d.unread - b.d.unread);
    const checked = S.releases.checked_at;

    const group = (title, list, sub = '') => list.length ? `<div class="news-group"><h2>${title} <span class="sub" style="font-weight:500;font-size:14px">${sub}</span></h2><div class="list">${list.map(newsRow).join('')}</div></div>` : '';
    view.innerHTML = `
      <div class="news-head">
        <div><h1>Nouveautés</h1><p class="sub">${checked ? 'Dernière vérification ' + ago(checked) : 'Pas encore de vérification automatique'} · ${n(items.length)} séries avec des chapitres à lire</p></div>
        ${S.token ? `<button class="btn small ghost" data-check><svg viewBox="0 0 24 24"><path d="M12 4a8 8 0 0 0-7.9 6.6l2 .4A6 6 0 0 1 17.6 8H15v2h6V4h-2v2.3A8 8 0 0 0 12 4zm5.9 9A6 6 0 0 1 6.4 16H9v-2H3v6h2v-2.3A8 8 0 0 0 19.9 13.4z"/></svg>Vérifier maintenant</button>` : ''}
      </div>
      ${items.length ? '' : `<div class="empty"><b>Tu es à jour partout 🎉</b>Les nouveaux chapitres apparaîtront ici dès leur sortie.</div>`}
      ${group('Depuis ta dernière visite', fresh, fresh.length ? `${fresh.length} série${fresh.length > 1 ? 's' : ''}` : '')}
      ${group('Cette semaine', recent)}
      ${group('Toujours à rattraper', rest, 'triées par ta note')}`;
    bindItems(view);
    const c = $('[data-check]', view);
    if (c) c.addEventListener('click', async () => {
      c.disabled = true;
      try { await S.runChecker(); toast('Vérification lancée, résultats dans 2 à 3 minutes'); setTimeout(() => S.refresh(), 150000); }
      catch (e) { toast(e.message); }
      c.disabled = false;
    });
  }
  function newsRow({ s, d }) {
    return `<article class="row" data-id="${esc(s.id)}">
      <div class="thumb">${thumbHtml(s, d)}</div>
      <div><div class="t">${esc(s.title)}</div>
        <div class="m"><span>Ch. ${n(s.next)} → ${n(d.latest)}</span><span class="pill">${d.sparkle ? '✨ ' : ''}+${n(d.unread)}</span>${d.changedAt ? `<span>${ago(d.changedAt)}</span>` : ''}</div></div>
      <div class="act"><button class="btn small" data-quick>+1</button><button class="btn small ghost" data-allread title="Marquer tout comme lu">À jour</button></div>
    </article>`;
  }

  // ---------- Stats ----------
  function renderStats() {
    const items = S.all().map((s) => ({ s, d: derive(s) }));
    const by = (f) => items.reduce((m, x) => { const k = f(x); if (k) m[k] = (m[k] || 0) + 1; return m; }, {});
    const read = items.reduce((a, x) => a + (x.s.status === 'terminee' ? (x.d.latest || 0) : x.d.read), 0);
    const toRead = items.filter((x) => x.s.status === 'en_cours').reduce((a, x) => a + x.d.unread, 0);
    const rated = items.filter((x) => x.s.rating != null);
    const avg = rated.length ? rated.reduce((a, x) => a + x.s.rating, 0) / rated.length : 0;
    const hours = Math.round((toRead * 4) / 60);
    const bars = (obj, total) => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="bar"><span>${esc(k)}</span><div class="track"><span style="width:${(v / total) * 100}%"></span></div><b>${v}</b></div>`).join('');
    const types = by((x) => x.d.type || 'Inconnu');
    const statuses = by((x) => STATUS[x.s.status]?.label);
    const notes = by((x) => (x.s.rating != null ? '★ ' + Math.floor(x.s.rating) : null));
    const top = rated.slice().sort((a, b) => b.s.rating - a.s.rating).slice(0, 10);
    $('#view').innerHTML = `
      <h1>Statistiques</h1><p class="sub">Ta bibliothèque en chiffres</p>
      <div class="stats-grid">
        <div class="panel stat"><b>${n(items.length)}</b><span>séries suivies</span></div>
        <div class="panel stat"><b>${n(read)}</b><span>chapitres lus</span></div>
        <div class="panel stat"><b>${n(toRead)}</b><span>chapitres à rattraper</span></div>
        <div class="panel stat"><b>~${n(hours)} h</b><span>de lecture en retard</span></div>
        <div class="panel stat"><b>${avg.toFixed(1).replace('.', ',')}</b><span>note moyenne</span></div>
        <div class="panel stat"><b>${n(items.reduce((a, x) => a + (x.s.volumes || 0), 0))}</b><span>tomes papier</span></div>
      </div>
      <h2>Par statut</h2><div class="panel bars">${bars(statuses, items.length)}</div>
      <h2>Par type</h2><div class="panel bars">${bars(types, items.length)}</div>
      <h2>Tes notes</h2><div class="panel bars">${bars(notes, rated.length || 1)}</div>
      <h2>Ton top 10</h2><div class="list">${top.map((x) => rowHtml(x)).join('')}</div>`;
    bindItems($('#view'));
  }

  // ---------- Réglages ----------
  function renderSettings() {
    const view = $('#view');
    const syncLink = S.token ? `${location.origin}${location.pathname}#sync=${encodeURIComponent(S.token)}` : '';
    const st = { ok: '✅ Synchronisé', busy: '⏳ Synchronisation…', error: '⚠️ ' + S.syncError, idle: S.token ? 'Prêt' : 'Désactivée : tes changements restent sur cet appareil' }[S.syncState];
    view.innerHTML = `<div class="settings">
      <h1>Réglages</h1><p class="sub">${n(S.all().length)} séries · ${st}</p>

      <div class="panel">
        <h2>Synchroniser iPhone et PC</h2>
        ${S.token ? `
          <p>La synchronisation est active sur cet appareil.</p>
          <div class="field"><span>Lien pour ton autre appareil</span>
            <div class="actions"><button class="btn primary" data-copylink>Copier le lien</button>${navigator.share ? '<button class="btn" data-sharelink>Partager…</button>' : ''}</div>
            <p class="hint">Ouvre ce lien une fois sur ton autre appareil pour l'activer là-bas aussi. Garde-le pour toi : il donne accès en écriture à ta liste.</p></div>
          <div class="actions"><button class="btn small ghost" data-sync-now>Synchroniser maintenant</button><button class="btn small danger" data-token-off>Désactiver ici</button></div>
        ` : `
          <ol class="steps">
            <li>Ouvre <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">la page de création de jeton GitHub</a>.</li>
            <li>Nom : <code>Ma Biblio</code>, expiration : <b>1 an</b> (ou plus).</li>
            <li>Repository access : <b>Only select repositories</b> puis <code>${esc(CONFIG.repo)}</code>.</li>
            <li>Permissions : <b>Contents</b> → Read and write, et <b>Actions</b> → Read and write.</li>
            <li>Clique sur <b>Generate token</b>, copie-le et colle-le ci-dessous.</li>
          </ol>
          <div class="field"><input class="input" type="password" placeholder="github_pat_…" data-token autocomplete="off"></div>
          <button class="btn primary" data-token-save>Activer la synchronisation</button>`}
      </div>

      <div class="panel">
        <h2>Apparence</h2>
        <div class="seg" data-theme>${[['auto', 'Automatique'], ['light', 'Clair'], ['dark', 'Sombre']].map(([k, l]) => `<button data-v="${k}" class="${S.prefs.theme === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      </div>

      <div class="panel">
        <h2>Installer sur l'iPhone</h2>
        <ol class="steps"><li>Ouvre ce site dans <b>Safari</b>.</li><li>Touche le bouton <b>Partager</b> (carré avec une flèche).</li><li>Choisis <b>Sur l'écran d'accueil</b>, puis <b>Ajouter</b>.</li></ol>
        <p class="hint">Sur PC, avec Chrome ou Edge, clique sur l'icône d'installation à droite de la barre d'adresse.</p>
      </div>

      <div class="panel">
        <h2>Nouveaux chapitres</h2>
        <p>${S.releases.checked_at ? 'Dernière vérification ' + ago(S.releases.checked_at) + '.' : 'Pas encore vérifié.'} La vérification automatique tourne deux fois par jour.</p>
      </div>

      <div class="panel">
        <h2>Sauvegarde</h2>
        <div class="actions"><button class="btn" data-export>Télécharger ma liste (JSON)</button><button class="btn" data-export-csv>Télécharger en tableau (CSV)</button></div>
      </div>
    </div>`;

    $('[data-token-save]', view)?.addEventListener('click', async (e) => {
      const v = $('[data-token]', view).value.trim(); if (!v) return;
      e.target.disabled = true; e.target.textContent = 'Vérification…';
      const ok = await S.setToken(v);
      toast(ok ? 'Synchronisation activée' : 'Jeton refusé. Vérifie le dépôt et les permissions.');
      if (!ok) S.setToken('');
      renderSettings();
    });
    $('[data-token-off]', view)?.addEventListener('click', async () => { await S.setToken(''); renderSettings(); });
    $('[data-sync-now]', view)?.addEventListener('click', () => S.refresh());
    $('[data-copylink]', view)?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(syncLink); toast('Lien copié'); } catch { prompt('Copie ce lien', syncLink); } });
    $('[data-sharelink]', view)?.addEventListener('click', () => navigator.share({ title: 'Ma Biblio', url: syncLink }).catch(() => {}));
    $$('[data-theme] button', view).forEach((b) => b.addEventListener('click', () => { S.setPrefs({ theme: b.dataset.v }); applyTheme(); renderSettings(); }));
    $('[data-export]', view).addEventListener('click', () => download('ma-biblio.json', JSON.stringify(S.library, null, 1), 'application/json'));
    $('[data-export-csv]', view).addEventListener('click', () => {
      const head = ['titre', 'statut', 'prochain_chapitre', 'dernier_sorti', 'a_lire', 'note', 'tomes', 'type', 'fiche'];
      const lines = S.all().map((s) => { const d = derive(s); return [s.title, STATUS[s.status]?.label, s.next ?? '', d.latest ?? '', d.unread || '', s.rating ?? '', s.volumes || '', d.type, d.rel?.url || '']; });
      const csv = [head, ...lines].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
      download('ma-biblio.csv', '﻿' + csv, 'text/csv');
    });
  }
  function download(name, text, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---------- Fiche série ----------
  function openDetail(id) {
    const draw = () => {
      const s = S.get(id); if (!s || s.deleted) return closeSheet();
      const d = derive(s);
      const rel = d.rel;
      const sheet = $('#sheet');
      sheet.innerHTML = `
        <div class="grabber"></div>
        <button class="close" data-close aria-label="Fermer"><svg viewBox="0 0 24 24"><path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6 10.6 12 5 6.4z"/></svg></button>
        <div class="hero">
          ${d.cover ? `<div class="bgblur" style="background-image:url('${esc(d.cover)}')"></div>` : ''}
          <div class="cover">${coverHtml(s, d, true)}</div>
          <div class="info">
            <h3>${esc(s.title)}</h3>
            ${rel && norm(rel.title) !== norm(s.title) ? `<div class="alt">${esc(rel.title)}</div>` : ''}
            <div class="tags">
              ${d.type ? `<span class="tag">${esc(d.type)}</span>` : ''}
              ${rel ? `<span class="tag ${d.voDone ? 'good' : ''}">${d.voDone ? 'Finie en VO' : 'En cours en VO'}</span>` : ''}
              ${d.latest ? `<span class="tag">${n(d.latest)} chapitres</span>` : ''}
              ${d.sparkle ? `<span class="tag accent">✨ ${n(d.unread)} à lire</span>` : ''}
              ${s.volumes ? `<span class="tag">${n(s.volumes)} tomes${s.publisher ? ' · ' + esc(s.publisher) : ''}</span>` : ''}
            </div>
            ${rel?.url ? `<a class="btn small ghost" style="align-self:flex-start;margin-top:4px" href="${esc(rel.url)}" target="_blank" rel="noopener">Voir la fiche ↗</a>` : ''}
          </div>
        </div>

        ${s.verify || !s.mu ? `<div class="sec"><div class="warn">${s.mu ? `Je ne suis pas sûr que la fiche <b>${esc(rel?.title || '')}</b> soit la bonne.` : 'Cette série n’est reliée à aucune fiche, donc je ne peux pas suivre ses sorties.'}
          <div class="actions" style="margin-top:8px">${s.mu ? '<button class="btn small" data-okfiche>C’est la bonne</button>' : ''}<button class="btn small" data-fix>${s.mu ? 'Corriger' : 'Relier une fiche'}</button></div></div></div>` : ''}

        <div class="sec">
          <span class="lbl">Prochain chapitre à lire</span>
          <div class="stepper">
            <button data-step="-1" aria-label="Chapitre précédent">−</button>
            <div class="val"><input inputmode="numeric" pattern="[0-9]*" value="${s.next ?? ''}" placeholder="—" data-next aria-label="Prochain chapitre">
              <small>${d.latest ? (d.unread ? `${n(d.unread)} à lire · dernier sorti : ${n(d.latest)}` : `À jour · dernier sorti : ${n(d.latest)}`) : 'Dernier sorti inconnu'}</small></div>
            <button class="plus" data-step="1" aria-label="J'ai lu un chapitre">+</button>
          </div>
          <div class="quickrow">
            <button class="btn small" data-step="5">+5</button>
            <button class="btn small" data-step="10">+10</button>
            ${d.latest ? `<button class="btn small" data-uptodate>Je suis à jour</button>` : ''}
          </div>
        </div>

        <div class="sec">
          <span class="lbl">Statut</span>
          <div class="seg" data-status>${Object.entries(STATUS).map(([k, v]) => `<button data-v="${k}" class="${s.status === k ? 'on' : ''}">${v.short}</button>`).join('')}</div>
        </div>

        <div class="sec">
          <span class="lbl">Ma note</span>
          <div class="rating"><input type="range" min="0" max="10" step="0.5" value="${s.rating ?? 5}" data-rating aria-label="Note sur 10" style="${s.rating == null ? 'opacity:.4' : ''}">
            <output data-rating-out>${s.rating != null ? fmtRating(s.rating) + '<small>/10</small>' : '—'}</output></div>
        </div>

        <div class="sec">
          <span class="lbl">Tomes papier</span>
          <div class="mini-stepper"><button data-vol="-1" aria-label="Retirer un tome">−</button><b data-vol-out>${s.volumes || 0}</b><button data-vol="1" aria-label="Ajouter un tome">+</button></div>
        </div>

        <div class="sec">
          <span class="lbl">Notes perso</span>
          <textarea class="input" data-notes placeholder="Où tu lis, ce que tu en penses…">${esc(s.notes || '')}</textarea>
        </div>

        <div class="sec" data-fixbox hidden></div>

        <div class="sec actions">
          <button class="btn small ghost" data-rename>Renommer</button>
          ${s.mu && !s.verify ? '<button class="btn small ghost" data-fix>Changer de fiche</button>' : ''}
          <button class="btn small danger" data-delete>Supprimer</button>
        </div>`;

      const setNext = (v) => {
        v = v == null || isNaN(v) ? null : Math.max(1, Math.round(v));
        const patch = { next: v };
        if (v && s.status === 'a_commencer' && v > 1) patch.status = 'en_cours';
        S.update(id, patch); draw();
      };
      $$('[data-step]', sheet).forEach((b) => b.addEventListener('click', () => { setNext((s.next || 1) + Number(b.dataset.step)); if (navigator.vibrate) navigator.vibrate(8); }));
      $('[data-next]', sheet).addEventListener('change', (e) => setNext(parseInt(e.target.value, 10)));
      $('[data-uptodate]', sheet)?.addEventListener('click', () => { S.update(id, { next: d.latest + 1, status: 'en_cours' }); draw(); toast('À jour !'); });
      $$('[data-status] button', sheet).forEach((b) => b.addEventListener('click', () => { S.update(id, { status: b.dataset.v }); draw(); }));
      const r = $('[data-rating]', sheet);
      r.addEventListener('input', () => { r.style.opacity = 1; $('[data-rating-out]', sheet).innerHTML = fmtRating(Number(r.value)) + '<small>/10</small>'; });
      r.addEventListener('change', () => S.update(id, { rating: Number(r.value) }));
      $$('[data-vol]', sheet).forEach((b) => b.addEventListener('click', () => { S.update(id, { volumes: Math.max(0, (s.volumes || 0) + Number(b.dataset.vol)) }); draw(); }));
      $('[data-notes]', sheet).addEventListener('change', (e) => S.update(id, { notes: e.target.value }));
      $('[data-okfiche]', sheet)?.addEventListener('click', () => { S.update(id, { verify: false }); draw(); toast('Fiche validée'); });
      $$('[data-fix]', sheet).forEach((b) => b.addEventListener('click', () => showFix(sheet, s)));
      $('[data-rename]', sheet).addEventListener('click', () => { const t = prompt('Nouveau titre', s.title); if (t && t.trim()) { S.update(id, { title: t.trim() }); draw(); } });
      $('[data-delete]', sheet).addEventListener('click', () => {
        S.remove(id); closeSheet();
        toast(`${s.title} supprimée`, () => S.update(id, { deleted: false }));
      });
      $('[data-close]', sheet).addEventListener('click', closeSheet);
    };
    draw();
    showSheet();
  }

  function muIdFromInput(v) {
    v = (v || '').trim();
    const m = v.match(/mangaupdates\.com\/series\/([0-9a-z]+)/i);
    if (m) return parseInt(m[1], 36);
    if (/^\d{6,}$/.test(v)) return Number(v);
    return null;
  }
  function showFix(sheet, s) {
    const box = $('[data-fixbox]', sheet); box.hidden = false;
    box.innerHTML = `<span class="lbl">Relier la bonne fiche</span>
      <ol class="steps"><li><a href="https://www.mangaupdates.com/series?search=${encodeURIComponent(s.title)}" target="_blank" rel="noopener">Cherche « ${esc(s.title)} » sur MangaUpdates ↗</a></li>
      <li>Ouvre la bonne série (en évitant les « Novel »), copie l'adresse de la page et colle-la ici.</li></ol>
      <div class="field"><input class="input" data-mu placeholder="https://www.mangaupdates.com/series/…" autocomplete="off"></div>
      <button class="btn primary small" data-mu-save>Enregistrer</button>`;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('[data-mu-save]', box).addEventListener('click', async () => {
      const id = muIdFromInput($('[data-mu]', box).value);
      if (!id) return toast('Adresse non reconnue');
      S.update(s.id, { mu: id, verify: false });
      closeSheet();
      if (S.token) { try { await S.runChecker(); toast('Fiche enregistrée, couverture et chapitres d’ici 2 à 3 min'); setTimeout(() => S.refresh(), 150000); } catch { toast('Fiche enregistrée, mise à jour à la prochaine vérification'); } }
      else toast('Fiche enregistrée, mise à jour à la prochaine vérification');
    });
  }

  // ---------- Ajouter ----------
  function openAdd() {
    const sheet = $('#sheet');
    sheet.innerHTML = `<div class="grabber"></div>
      <button class="close" data-close aria-label="Fermer"><svg viewBox="0 0 24 24"><path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6 10.6 12 5 6.4z"/></svg></button>
      <div class="sec" style="border:0;padding-top:20px"><h3 style="margin:0 0 14px;font-size:20px">Ajouter une série</h3>
        <label class="field"><span>Titre</span><input class="input" data-title placeholder="Ex. Omniscient Reader" autocomplete="off"></label>
        <div class="field"><span>Statut</span><div class="seg" data-status>${['en_cours', 'a_commencer', 'terminee', 'collection'].map((k, i) => `<button data-v="${k}" class="${i === 1 ? 'on' : ''}">${STATUS[k].short}</button>`).join('')}</div></div>
        <label class="field"><span>Prochain chapitre à lire</span><input class="input" data-next inputmode="numeric" placeholder="Optionnel"></label>
        <label class="field"><span>Fiche MangaUpdates (optionnel)</span><input class="input" data-mu placeholder="https://www.mangaupdates.com/series/…" autocomplete="off">
          <p class="hint">Avec la fiche, l'appli suit les nouveaux chapitres et affiche la couverture. <a href="https://www.mangaupdates.com/series" target="_blank" rel="noopener" data-mu-search>Chercher ↗</a></p></label>
        <button class="btn primary" data-save style="width:100%">Ajouter</button>
      </div>`;
    let status = 'a_commencer';
    $$('[data-status] button', sheet).forEach((b) => b.addEventListener('click', () => { status = b.dataset.v; $$('[data-status] button', sheet).forEach((x) => x.classList.toggle('on', x === b)); }));
    $('[data-title]', sheet).addEventListener('input', (e) => { $('[data-mu-search]', sheet).href = 'https://www.mangaupdates.com/series?search=' + encodeURIComponent(e.target.value); });
    $('[data-save]', sheet).addEventListener('click', async () => {
      const title = $('[data-title]', sheet).value.trim(); if (!title) return $('[data-title]', sheet).focus();
      const next = parseInt($('[data-next]', sheet).value, 10) || null;
      const mu = muIdFromInput($('[data-mu]', sheet).value);
      const st = next && next > 1 && status === 'a_commencer' ? 'en_cours' : status;
      const item = S.add({ title, status: st, next, mu });
      closeSheet(); toast(`${title} ajoutée`);
      if (mu && S.token) S.runChecker().then(() => setTimeout(() => S.refresh(), 150000)).catch(() => {});
      setTimeout(() => openDetail(item.id), 350);
    });
    $('[data-close]', sheet).addEventListener('click', closeSheet);
    showSheet();
    setTimeout(() => $('[data-title]', sheet).focus(), 250);
  }

  // ---------- Sheet & toast ----------
  function showSheet() {
    $('#sheet').hidden = false; $('#sheet-backdrop').hidden = false; document.body.style.overflow = 'hidden';
    $('#sheet').scrollTop = 0;
  }
  function closeSheet() {
    $('#sheet').hidden = true; $('#sheet-backdrop').hidden = true; document.body.style.overflow = '';
    rerender();
  }
  $('#sheet-backdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });
  // Glisser vers le bas pour fermer (mobile)
  (() => {
    const sh = $('#sheet'); let y0 = null, dy = 0;
    sh.addEventListener('touchstart', (e) => { if (sh.scrollTop <= 0) { y0 = e.touches[0].clientY; dy = 0; } }, { passive: true });
    sh.addEventListener('touchmove', (e) => { if (y0 == null) return; dy = e.touches[0].clientY - y0; if (dy > 0) sh.style.transform = `translateY(${dy}px)`; }, { passive: true });
    sh.addEventListener('touchend', () => { if (y0 == null) return; sh.style.transform = ''; if (dy > 110) closeSheet(); y0 = null; });
  })();

  let toastTimer;
  function toast(msg, undo) {
    const t = $('#toast');
    t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button data-undo>Annuler</button>' : ''}`;
    t.hidden = false;
    if (undo) $('[data-undo]', t).addEventListener('click', () => { undo(); t.hidden = true; });
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), undo ? 5000 : 2600);
  }

  // ---------- Global ----------
  function applyTheme() {
    const t = S.prefs.theme;
    if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t;
  }
  function updateBadges() {
    const c = newsItems().filter((x) => isFresh(x.d)).length;
    $$('[data-news-count]').forEach((b) => { b.hidden = !c; b.textContent = c > 99 ? '99+' : c; });
    if (navigator.setAppBadge) { c ? navigator.setAppBadge(c).catch(() => {}) : navigator.clearAppBadge?.().catch(() => {}); }
  }
  function rerender() {
    if (!$('#sheet').hidden) return; // ne pas redessiner sous la fiche ouverte
    const y = window.scrollY;
    route(); window.scrollTo(0, y);
  }

  S.on((what) => {
    $('[data-sync]').dataset.state = S.syncState;
    $('[data-sync]').title = S.syncError || ({ ok: 'Synchronisé', busy: 'Synchronisation…', idle: 'Synchronisation désactivée' }[S.syncState] || '');
    if (what === 'data') { updateBadges(); rerender(); }
  });
  $('.fab').addEventListener('click', openAdd);
  window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') S.refresh(); });

  applyTheme();
  S.load().then(() => route());
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
