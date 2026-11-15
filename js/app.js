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

  const ui = { q: '', mode: 'scan' };

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
      cover: s.cover || hd(rel?.cover),
      coverFirst: (s.cover || '').split(/\s+/)[0] || hd(rel?.cover),
      type: rel?.type || '',
      voDone: !!rel?.completed,
      changedAt: rel?.changed_at || null,
      pct: latest && read ? Math.min(100, Math.round((read / latest) * 100)) : (s.status === 'terminee' ? 100 : 0),
    };
  }

  // Tomes papier : numéros possédés, total paru en VF, manquants
  function vols(s, d) {
    const extras = s.extras || 0;
    const owned = Array.isArray(s.owned) ? s.owned.slice().sort((a, b) => a - b) : Array.from({ length: Math.max(0, (s.volumes || 0) - extras) }, (_, i) => i + 1);
    const set = new Set(owned);
    const maxOwned = owned.length ? owned[owned.length - 1] : 0;
    // Tomes VF connus (Wikipédia) : parus ou annoncés
    const vf = S.vf(s);
    const today = new Date().toISOString().slice(0, 10);
    const info = {};
    let released = 0;
    const upcoming = [];
    for (const v of vf?.volumes || []) {
      info[v.n] = v;
      if (v.date && v.date.length >= 4 && v.date > today && !(v.date.length < 10 && today.startsWith(v.date))) upcoming.push(v);
      else released = Math.max(released, v.n);
    }
    const total = Math.max(s.vfTotal || 0, maxOwned, released);
    const missing = [];
    for (let i = 1; i <= total; i++) if (!set.has(i)) missing.push(i);
    const next = upcoming.filter((v) => v.n > total && !set.has(v.n)).sort((a, b) => a.n - b.n);
    return { owned, set, extras, total, missing, info, upcoming: next, wiki: vf?.page || null, known: !!s.vfTotal || !!released, vo: d?.rel?.vo_volumes || null, complete: !!s.complete && !missing.length };
  }
  function ranges(list) {
    const out = []; let a = null, b = null;
    for (const x of list) { if (a == null) { a = b = x; } else if (x === b + 1) { b = x; } else { out.push(a === b ? `${a}` : `${a} à ${b}`); a = b = x; } }
    if (a != null) out.push(a === b ? `${a}` : `${a} à ${b}`);
    return out.join(', ');
  }
  function saveOwned(id, owned, extra = {}) {
    const s = S.get(id); const u = [...new Set(owned)].sort((a, b) => a - b);
    S.update(id, Object.assign({ owned: u, volumes: u.length + (s.extras || 0) }, extra));
  }
  function hd(url) { return url ? url.replace('/image/thumb/', '/image/') : ''; }
  function hue(str) { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
  function phStyle(t) { const h = hue(t); return `background:linear-gradient(150deg,hsl(${h} 55% 42%),hsl(${(h + 40) % 360} 60% 28%))`; }
  function initials(t) { return t.replace(/^(the|a|le|la|les)\s+/i, '').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase(); }
  function coverHtml(s, d, big = false) {
    const ph = `<div class="ph" style="${phStyle(s.title)}">${esc(big ? s.title : s.title)}</div>`;
    return ph + imgHtml(d.cover);
  }
  function thumbHtml(s, d) {
    return `<div class="ph" style="${phStyle(s.title)}">${esc(initials(s.title))}</div>${imgHtml(d.cover)}`;
  }
  // Une image perso peut contenir plusieurs adresses séparées par des espaces : on essaie la suivante si l'une échoue.
  function imgHtml(cover) {
    if (!cover) return '';
    const [first, ...rest] = cover.trim().split(/\s+/);
    return `<img src="${esc(first)}" data-next="${esc(rest.join(' '))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="coverNext(this)" onload="if(this.naturalWidth<20)coverNext(this)">`;
  }
  window.coverNext = (img) => {
    const [n, ...rest] = (img.dataset.next || '').split(' ').filter(Boolean);
    if (!n) { img.remove(); return; }
    img.dataset.next = rest.join(' '); img.src = n;
  };
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
  const routes = { '': () => renderLibrary('scan'), papier: () => renderLibrary('papier'), nouveautes: renderNews, stats: renderStats, reglages: renderSettings };
  function route() {
    const h = location.hash;
    if (h.startsWith('#sync=')) {
      const t = decodeURIComponent(h.slice(6));
      history.replaceState(null, '', location.pathname + '#/reglages');
      S.setToken(t).then((ok) => toast(ok ? 'Synchronisation activée sur cet appareil' : 'Ce lien de synchronisation ne marche pas'));
    }
    const key = (location.hash.replace(/^#\/?/, '').split('?')[0]) || '';
    const fn = routes[key] || routes[''];
    const tab = { '': 'library', papier: 'papier', nouveautes: 'news', stats: 'stats', reglages: 'settings' }[key] || 'library';
    $$('[data-tab]').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
    if (!$('#sheet').hidden) { $('#sheet').hidden = true; $('#sheet-backdrop').hidden = true; document.body.style.overflow = ''; }
    $('[data-page-title]').textContent = { library: 'Mes scans', papier: 'Ma bibliothèque', news: 'Nouveautés', stats: 'Statistiques', settings: 'Réglages' }[tab];
    $('.fab').hidden = tab !== 'library' && tab !== 'papier';
    ui.mode = tab === 'papier' ? 'papier' : 'scan';
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
    ['verify', 'À vérifier', (s) => s.verify],
  ];
  const FILTERS_P = [
    ['all', 'Tout', () => true],
    ['complete', 'Complètes ✓', (s, d) => vols(s, d).complete],
    ['incomplete', 'Il en manque', (s, d) => vols(s, d).missing.length > 0],
    ['seul', 'Papier seulement', (s) => s.status === 'collection'],
    ['scan', 'Aussi en scan', (s) => s.status !== 'collection'],
    ['manga', 'Manga', (s, d) => d.type === 'Manga'],
    ['manhwa', 'Manhwa / webtoon', (s, d) => d.type === 'Manhwa' || d.type === 'Manhua'],
  ];
  const SORTS_P = {
    title: ['Titre A → Z', (a, b) => a.s.title.localeCompare(b.s.title, 'fr')],
    volumes: ['Le plus de tomes', (a, b) => (b.s.volumes || 0) - (a.s.volumes || 0) || a.s.title.localeCompare(b.s.title, 'fr')],
    publisher: ['Éditeur', (a, b) => (a.s.publisher || 'zz').localeCompare(b.s.publisher || 'zz', 'fr') || a.s.title.localeCompare(b.s.title, 'fr')],
    rating: ['Meilleure note', (a, b) => (b.s.rating ?? -1) - (a.s.rating ?? -1)],
    updated: ['Modifiées récemment', (a, b) => (b.s.updated || '').localeCompare(a.s.updated || '')],
  };
  const inMode = (s, mode) => (mode === 'papier' ? s.volumes > 0 || s.status === 'collection' : s.status !== 'collection');
  const SORTS = {
    unread: ['Le plus à lire', (a, b) => sortUnread(b) - sortUnread(a) || a.s.title.localeCompare(b.s.title)],
    rating: ['Meilleure note', (a, b) => (b.s.rating ?? -1) - (a.s.rating ?? -1) || b.d.unread - a.d.unread],
    recent: ['Sorties récentes', (a, b) => (b.d.changedAt || '').localeCompare(a.d.changedAt || '') || b.d.unread - a.d.unread],
    updated: ['Modifiées récemment', (a, b) => (b.s.updated || '').localeCompare(a.s.updated || '')],
    title: ['Titre A → Z', (a, b) => a.s.title.localeCompare(b.s.title, 'fr')],
  };

  function sortUnread(x) { return x.s.status === 'en_cours' ? x.d.unread : x.s.status === 'a_commencer' ? -1 : -2; }
  function norm(t) { return (t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  function renderLibrary(mode = 'scan') {
    const view = $('#view');
    const P = mode === 'papier';
    const all = S.all().filter((s) => inMode(s, mode)).map((s) => ({ s, d: derive(s) }));
    // Franchises : les séries rattachées (s.group) sont rangées sous la série principale.
    const byId = new Map(all.map((x) => [x.s.id, x]));
    const kids = {};
    for (const x of all) if (x.s.group && x.s.group !== x.s.id && byId.has(x.s.group)) (kids[x.s.group] ||= []).push(x);
    const items = all.filter((x) => !(x.s.group && x.s.group !== x.s.id && byId.has(x.s.group)));
    for (const x of items) x.kids = kids[x.s.id] || null;
    const filters = P ? FILTERS_P : FILTERS, sorts = P ? SORTS_P : SORTS;
    const fk = 'filter_' + mode, sk = 'sort_' + mode;
    if (!S.prefs[sk]) S.prefs[sk] = P ? 'title' : (S.prefs.sort || 'unread');
    if (!S.prefs[fk]) S.prefs[fk] = 'all';
    const publishers = new Set(items.map((x) => x.s.publisher).filter(Boolean)).size;
    const aCommencer = items.filter((x) => x.s.status === 'a_commencer').length;
    const enCours = items.filter((x) => x.s.status === 'en_cours');
    const toRead = enCours.reduce((a, x) => a + x.d.unread, 0);
    const sparkles = items.filter((x) => x.d.sparkle).length;
    const volumes = items.reduce((a, x) => a + (x.s.volumes || 0), 0);
    const p = S.prefs;

    view.innerHTML = `
      <h1>${P ? 'Ma bibliothèque' : 'Mes scans'}</h1>
      <div class="summary">${P ? `
        <button class="stat" data-filter="all"><b>${n(items.length)}</b><span>séries</span></button>
        <button class="stat" data-filter="all"><b>${n(volumes)}</b><span>tomes</span></button>
        <button class="stat" data-filter="complete"><b>${n(items.filter((x) => vols(x.s, x.d).complete).length)}</b><span>complètes ✓</span></button>
        <button class="stat" data-filter="incomplete"><b>${n(items.filter((x) => vols(x.s, x.d).missing.length).length)}</b><span>où il manque des tomes</span></button>` : `
        <button class="stat" data-filter="en_cours"><b>${n(enCours.length)}</b><span>séries en cours</span></button>
        <button class="stat" data-filter="dispo"><b>${n(toRead)}</b><span>chapitres à lire</span></button>
        <button class="stat" data-filter="sparkle"><b>${n(sparkles)}</b><span>✨ avec 40+ à lire</span></button>
        <button class="stat" data-filter="a_commencer"><b>${n(aCommencer)}</b><span>à commencer</span></button>`}
      </div>
      ${P ? '' : continueRow(items)}
      <div class="toolbar">
        <label class="search"><svg viewBox="0 0 24 24"><path d="M10 3a7 7 0 1 0 4.2 12.6l5.1 5.1 1.4-1.4-5.1-5.1A7 7 0 0 0 10 3zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10z"/></svg>
          <input type="search" placeholder="Rechercher une série…" value="${esc(ui.q)}" data-q autocomplete="off" enterkeyhint="search"></label>
        <select class="select" data-sort aria-label="Trier">${Object.entries(sorts).map(([k, [l]]) => `<option value="${k}" ${p[sk] === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <div class="viewtoggle" role="group" aria-label="Affichage">
          <button data-view="grid" class="${p.view === 'grid' ? 'on' : ''}" aria-label="Couvertures"><svg viewBox="0 0 24 24"><path d="M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z"/></svg></button>
          <button data-view="list" class="${p.view === 'list' ? 'on' : ''}" aria-label="Liste"><svg viewBox="0 0 24 24"><path d="M4 5h16v3H4zm0 5.5h16v3H4zM4 16h16v3H4z"/></svg></button>
        </div>
      </div>
      <div class="chips" data-chips></div>
      <div data-results></div>`;

    $('[data-q]', view).addEventListener('input', (e) => { ui.q = e.target.value; drawResults(); });
    $('[data-sort]', view).addEventListener('change', (e) => { S.setPrefs({ [sk]: e.target.value }); drawResults(); });
    $$('[data-view]', view).forEach((b) => b.addEventListener('click', () => { S.setPrefs({ view: b.dataset.view }); renderLibrary(mode); }));
    $$('.stat[data-filter]', view).forEach((b) => b.addEventListener('click', () => { S.setPrefs({ [fk]: b.dataset.filter }); drawResults(); }));
    drawResults();
    const cont = $('[data-continue]', view);
    if (cont) bindItems(cont, mode);

    function drawResults() {
      const chips = $('[data-chips]', view);
      chips.innerHTML = filters.map(([k, l, f]) => {
        const c = items.filter((x) => f(x.s, x.d)).length;
        if (k === 'verify' && !c) return '';
        return `<button class="chip ${p[fk] === k ? 'on' : ''}" data-f="${k}">${l} <i>${c}</i></button>`;
      }).join('');
      $$('[data-f]', chips).forEach((b) => b.addEventListener('click', () => { S.setPrefs({ [fk]: b.dataset.f }); drawResults(); }));

      const f = (filters.find((x) => x[0] === p[fk]) || filters[0])[2];
      const q = norm(ui.q).trim();
      let list = items.filter((x) => f(x.s, x.d));
      const hit = (x) => norm(x.s.title).includes(q) || norm(x.d.rel?.title).includes(q);
      if (q) list = list.filter((x) => hit(x) || (x.kids || []).some(hit));
      list.sort((sorts[p[sk]] || Object.values(sorts)[0])[1]);

      const box = $('[data-results]', view);
      if (!list.length) {
        box.innerHTML = `<div class="empty"><b>Aucune série ici</b>${q ? 'Essaie un autre mot, ou ajoute-la avec le bouton +.' : 'Change de filtre pour voir le reste de ta bibliothèque.'}</div>`;
        return;
      }
      box.innerHTML = p.view === 'list' ? `<div class="list">${list.map((x) => rowHtml(x, mode)).join('')}</div>` : `<div class="grid">${list.map((x) => cardHtml(x, mode)).join('')}</div>`;
      bindItems(box, mode);
    }
  }

  // Les séries en cours lues le plus récemment, puis celles avec le plus de chapitres à lire
  function continueRow(items) {
    const list = items.filter((x) => x.s.status === 'en_cours' && x.s.next)
      .sort((a, b) => (b.s.lastRead || '').localeCompare(a.s.lastRead || '') || b.d.unread - a.d.unread).slice(0, 10);
    if (list.length < 2) return '';
    return `<section class="continue" data-continue>
      <div class="sec-title">Continuer</div>
      <div class="crow">${list.map(({ s, d }) => `<article class="ccard" data-id="${esc(s.id)}">
        <div class="cover">${coverHtml(s, d)}${d.unread ? `<span class="badge new ${d.sparkle ? 'big' : ''}">+${n(d.unread)}</span>` : ''}
          <button class="quick" data-quick aria-label="J'ai lu le chapitre ${s.next}">+1</button>
          ${d.pct ? `<div class="progress"><span style="width:${d.pct}%"></span></div>` : ''}</div>
        <div class="t">${esc(s.title)}</div><div class="m">Ch. ${n(s.next)}</div>
      </article>`).join('')}</div>
    </section>`;
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
  function papierMeta(s) { return `${s.complete ? 'Complète · ' : ''}${n(s.volumes || 0)} tome${s.volumes > 1 ? 's' : ''}${s.publisher ? ' · ' + esc(s.publisher) : ''}`; }
  // Bandeau en bas de la couverture : barre de progression + état
  function volStrip(s, d) {
    const v = vols(s, d);
    if (!v.total) return '';
    const pct = Math.round((v.owned.length / v.total) * 100);
    let pill = '';
    if (v.complete) pill = `<span class="vpill full">Complète ✓</span>`;
    else if (v.missing.length) pill = `<span class="vpill miss">Manque ${v.missing.length}</span>`;
    return `${pill}<div class="vbar ${v.complete ? 'full' : v.missing.length ? 'miss' : ''}"><span style="width:${pct}%"></span></div>`;
  }
  function volMissingLine(s, d) {
    const v = vols(s, d);
    if (!v.missing.length) return v.upcoming.length ? `<div class="m soon-line">T.${v.upcoming[0].n} ${esc(onDate(v.upcoming[0].date))}</div>` : '';
    const txt = ranges(v.missing);
    return `<div class="m miss-line">Manque : ${txt.length > 28 ? ranges(v.missing.slice(0, 6)) + '…' : txt}</div>`;
  }
  function volBadge(s, d) {
    const v = vols(s, d);
    if (v.complete) return `<span class="badge vol full">${v.total} ✓</span>`;
    if (v.missing.length) return `<span class="badge vol miss">${v.owned.length}/${v.total}</span>`;
    if (v.known) return `<span class="badge vol full">${v.owned.length}/${v.total} ✓</span>`;
    return `<span class="badge vol">${n(s.volumes || 0)} t.</span>`;
  }
  function groupLine(kids) {
    return kids ? `<div class="m grp-line">${kids.length + 1} séries</div>` : '';
  }
  function cardHtml({ s, d, kids }, mode) {
    if (mode === 'papier') return `<article class="card ${kids ? 'stack' : ''}" data-id="${esc(s.id)}"${kids ? ' data-group' : ''}>
      <div class="cover">${coverHtml(s, d)}
        ${s.rating != null ? `<span class="badge rating ${s.rating >= 9 ? 'top' : ''}"><i>★</i>${fmtRating(s.rating)}</span>` : ''}
        ${volBadge(s, d)}
        ${volStrip(s, d)}
        ${s.complete ? '' : `<button class="quick" data-quickvol aria-label="J'ai un tome de plus">+1</button>`}
      </div>
      <div class="t">${esc(s.title)}</div>
      <div class="m">${papierMeta(s)}</div>
      ${volMissingLine(s, d)}
      ${groupLine(kids)}
    </article>`;
    const canQuick = s.status === 'en_cours' && s.next;
    return `<article class="card ${kids ? 'stack' : ''}" data-id="${esc(s.id)}"${kids ? ' data-group' : ''}>
      <div class="cover">${coverHtml(s, d)}
        ${s.rating != null ? `<span class="badge rating bl ${s.rating >= 9 ? 'top' : ''}"><i>★</i>${fmtRating(s.rating)}</span>` : ''}
        ${newBadge(s, d)}
        ${canQuick ? `<button class="quick" data-quick aria-label="J'ai lu le chapitre ${s.next}">+1</button>` : ''}
        ${d.pct && s.status === 'en_cours' ? `<div class="progress"><span style="width:${d.pct}%"></span></div>` : ''}
      </div>
      <div class="t">${esc(s.title)}</div>
      <div class="m">${metaLine(s, d)}</div>
      ${groupLine(kids)}
    </article>`;
  }
  function rowHtml({ s, d, kids }, mode) {
    if (mode === 'papier') return `<article class="row ${kids ? 'stack' : ''}" data-id="${esc(s.id)}"${kids ? ' data-group' : ''}>
      <div class="thumb">${thumbHtml(s, d)}</div>
      <div><div class="t">${esc(s.title)}${kids ? ` <span class="grp-tag">${kids.length + 1} séries</span>` : ''}</div>${volMissingLine(s, d)}<div class="m"><span>${papierMeta(s)}</span>${s.rating != null ? `<span>★ ${fmtRating(s.rating)}</span>` : ''}${d.type ? `<span>${esc(d.type)}</span>` : ''}</div></div>
      <div class="act"><button class="btn small" data-quickvol>+1 tome</button></div>
    </article>`;
    const canQuick = s.status === 'en_cours' && s.next;
    return `<article class="row ${kids ? 'stack' : ''}" data-id="${esc(s.id)}"${kids ? ' data-group' : ''}>
      <div class="thumb">${thumbHtml(s, d)}</div>
      <div><div class="t">${esc(s.title)}${kids ? ` <span class="grp-tag">${kids.length + 1} séries</span>` : ''}</div>
        <div class="m"><span>${metaLine(s, d)}</span>${s.status === 'en_cours' && d.unread ? `<span class="pill">${d.sparkle ? '✨ ' : ''}+${n(d.unread)}</span>` : ''}${s.rating != null ? `<span>★ ${fmtRating(s.rating)}</span>` : ''}${d.type ? `<span>${esc(d.type)}</span>` : ''}</div></div>
      <div class="act">${canQuick ? `<button class="btn small" data-quick>+1</button>` : ''}</div>
    </article>`;
  }
  function bindItems(box, mode) {
    $$('[data-id]', box).forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-quick]')) { e.stopPropagation(); quickRead(el.dataset.id); return; }
        if (e.target.closest('[data-quickvol]')) { e.stopPropagation(); quickVolume(el.dataset.id); return; }
        if (e.target.closest('[data-allread]')) { e.stopPropagation(); allRead(el.dataset.id); return; }
        if (el.hasAttribute('data-group') && mode) openGroup(el.dataset.id, mode);
        else openDetail(el.dataset.id);
      });
    });
  }

  // Liste des séries d'une franchise : on choisit laquelle ouvrir
  function openGroup(mainId, mode) {
    const draw = () => {
      const main = S.get(mainId); if (!main || main.deleted) return closeSheet();
      const list = [main, ...S.all().filter((s) => s.group === mainId && s.id !== mainId && inMode(s, mode))]
        .map((s) => ({ s, d: derive(s) }));
      const sheet = $('#sheet');
      sheet.innerHTML = `
        <div class="grabber"></div>
        <button class="close" data-close aria-label="Fermer"><svg viewBox="0 0 24 24"><path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6 10.6 12 5 6.4z"/></svg></button>
        <div class="sec grp-sheet">
          <span class="lbl">Univers ${esc(main.title)}</span>
          <h2>Quelle série veux-tu ouvrir ?</h2>
          <div class="list">${list.map((x, i) => rowHtml(x, mode).replace('class="row', `class="row${i === 0 ? ' main' : ''}`)).join('')}</div>
          <p class="hint">Seule la série principale (en haut) compte pour savoir si c'est complet ou terminé.</p>
        </div>`;
      $$('[data-id]', sheet).forEach((el) => el.addEventListener('click', (e) => {
        if (e.target.closest('[data-quick]')) { e.stopPropagation(); quickRead(el.dataset.id); draw(); return; }
        if (e.target.closest('[data-quickvol]')) { e.stopPropagation(); quickVolume(el.dataset.id); draw(); return; }
        openDetail(el.dataset.id);
      }));
      $('[data-close]', sheet).addEventListener('click', closeSheet);
    };
    draw();
    showSheet();
  }

  function quickRead(id) {
    const s = S.get(id); const prev = { next: s.next, status: s.status };
    S.update(id, { next: (s.next || 1) + 1, status: 'en_cours', lastRead: new Date().toISOString() });
    if (navigator.vibrate) navigator.vibrate(10);
    toast(`${s.title} : chapitre ${prev.next} lu`, () => S.update(id, prev));
  }
  function quickVolume(id) {
    const s = S.get(id); const v = vols(s, derive(s));
    const prev = { owned: s.owned ? s.owned.slice() : v.owned.slice(), volumes: s.volumes || 0, vfTotal: s.vfTotal ?? null };
    const next = v.missing.length ? v.missing[0] : v.total + 1; // comble d'abord un trou, sinon tome suivant
    saveOwned(id, [...v.owned, next], next > (s.vfTotal || 0) && s.vfTotal ? { vfTotal: next } : {});
    if (navigator.vibrate) navigator.vibrate(10);
    toast(`${s.title} : tome ${next} ajouté`, () => S.update(id, prev));
  }
  function allRead(id) {
    const s = S.get(id); const d = derive(s); const prev = { next: s.next, status: s.status };
    if (!d.latest) return;
    S.update(id, { next: d.latest + 1, status: 'en_cours', lastRead: new Date().toISOString() });
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
          ${d.cover ? `<div class="bgblur" style="background-image:url('${esc(d.coverFirst)}')"></div>` : ''}
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

        ${s.status === 'collection' ? '' : `<div class="sec">
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
        </div>`}

        <div class="sec">
          <span class="lbl">Statut</span>
          <div class="seg" data-status>${Object.entries(STATUS).map(([k, v]) => `<button data-v="${k}" class="${s.status === k ? 'on' : ''}">${v.short}</button>`).join('')}</div>
        </div>

        <div class="sec">
          <span class="lbl">Ma note</span>
          <div class="rating"><input type="range" min="0" max="10" step="0.5" value="${s.rating ?? 5}" data-rating aria-label="Note sur 10" style="${s.rating == null ? 'opacity:.4' : ''}">
            <output data-rating-out>${s.rating != null ? fmtRating(s.rating) + '<small>/10</small>' : '—'}</output></div>
        </div>

        ${volSection(s, d)}

        <div class="sec">
          <span class="lbl">Notes perso</span>
          <textarea class="input" data-notes placeholder="Où tu lis, ce que tu en penses…">${esc(s.notes || '')}</textarea>
        </div>

        <div class="sec" data-fixbox hidden></div>

        ${groupPicker(s)}

        <div class="sec actions">
          <button class="btn small ghost" data-rename>Renommer</button>
          <button class="btn small ghost" data-setcover>Changer l'image</button>
          ${s.mu && !s.verify ? '<button class="btn small ghost" data-fix>Changer de fiche</button>' : ''}
          <button class="btn small danger" data-delete>Supprimer</button>
        </div>`;

      const setNext = (v) => {
        v = v == null || isNaN(v) ? null : Math.max(1, Math.round(v));
        const patch = { next: v, lastRead: new Date().toISOString() };
        if (v && s.status === 'a_commencer' && v > 1) patch.status = 'en_cours';
        S.update(id, patch); draw();
      };
      $$('[data-step]', sheet).forEach((b) => b.addEventListener('click', () => { setNext((s.next || 1) + Number(b.dataset.step)); if (navigator.vibrate) navigator.vibrate(8); }));
      $('[data-next]', sheet)?.addEventListener('change', (e) => setNext(parseInt(e.target.value, 10)));
      $('[data-uptodate]', sheet)?.addEventListener('click', () => { S.update(id, { next: d.latest + 1, status: 'en_cours' }); draw(); toast('À jour !'); });
      $$('[data-status] button', sheet).forEach((b) => b.addEventListener('click', () => { S.update(id, { status: b.dataset.v }); draw(); }));
      const r = $('[data-rating]', sheet);
      r.addEventListener('input', () => { r.style.opacity = 1; $('[data-rating-out]', sheet).innerHTML = fmtRating(Number(r.value)) + '<small>/10</small>'; });
      r.addEventListener('change', () => S.update(id, { rating: Number(r.value) }));
      const v = vols(s, d);
      $$('[data-tome]', sheet).forEach((b) => b.addEventListener('click', () => {
        const k = Number(b.dataset.tome);
        saveOwned(id, v.set.has(k) ? v.owned.filter((x) => x !== k) : [...v.owned, k]);
        if (navigator.vibrate) navigator.vibrate(8); draw();
      }));
      $('[data-tome-add]', sheet)?.addEventListener('click', () => { const k = v.total + 1; saveOwned(id, [...v.owned, k], s.vfTotal ? { vfTotal: Math.max(s.vfTotal, k) } : {}); draw(); });
      $$('[data-vf]', sheet).forEach((b) => b.addEventListener('click', () => { S.update(id, { vfTotal: Math.max(v.owned.at(-1) || 0, (s.vfTotal || v.total) + Number(b.dataset.vf)) || null }); draw(); }));
      $('[data-vf-vo]', sheet)?.addEventListener('click', () => { S.update(id, { vfTotal: Math.max(v.vo, v.owned.at(-1) || 0) }); draw(); });
      $('[data-vf-unknown]', sheet)?.addEventListener('click', () => { S.update(id, { vfTotal: null, complete: false }); draw(); });
      $('[data-complete]', sheet)?.addEventListener('click', (e) => {
        const on = e.currentTarget.dataset.complete === '1';
        S.update(id, on ? { complete: true, vfTotal: v.total } : { complete: false }); draw();
        if (on) toast('Collection complète ✓');
      });
      $('[data-vf-all]', sheet)?.addEventListener('click', () => { saveOwned(id, Array.from({ length: v.total }, (_, i) => i + 1)); draw(); });
      $('[data-notes]', sheet).addEventListener('change', (e) => S.update(id, { notes: e.target.value }));
      $('[data-okfiche]', sheet)?.addEventListener('click', () => { S.update(id, { verify: false }); draw(); toast('Fiche validée'); });
      $$('[data-fix]', sheet).forEach((b) => b.addEventListener('click', () => showFix(sheet, s)));
      $('[data-group-of]', sheet)?.addEventListener('change', (e) => {
        S.update(id, { group: e.target.value || null }); draw();
        toast(e.target.value ? `Rangée avec ${S.get(e.target.value)?.title}` : 'Série séparée');
      });
      $('[data-setcover]', sheet).addEventListener('click', () => {
        const u = prompt("Colle l'adresse d'une image (clic droit ou appui long sur une image, puis « Copier l'adresse de l'image »). Laisse vide pour revenir à l'image automatique.", s.cover || '');
        if (u === null) return;
        const v = u.trim();
        if (v && !v.split(/\s+/).every((x) => /^https:\/\//.test(x))) { toast("L'adresse doit commencer par https://"); return; }
        S.update(id, { cover: v || null }); draw(); toast(v ? 'Image changée' : 'Image automatique');
      });
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

  function groupPicker(s) {
    const all = S.all().filter((x) => !x.deleted);
    const kids = all.filter((x) => x.group === s.id && x.id !== s.id);
    if (kids.length) return `<div class="sec"><span class="lbl">Série principale</span>
      <p class="hint">Regroupe aussi : ${kids.map((x) => esc(x.title)).join(', ')}.</p></div>`;
    const mains = all.filter((x) => x.id !== s.id && !x.group).sort((a, b) => a.title.localeCompare(b.title, 'fr'));
    return `<div class="sec"><span class="lbl">Ranger avec une autre série</span>
      <select class="select" data-group-of aria-label="Série principale">
        <option value="">Aucune, série à part</option>
        ${mains.map((x) => `<option value="${esc(x.id)}" ${s.group === x.id ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}
      </select>
      <p class="hint">Par exemple Boruto avec Naruto : une seule carte, et seule la série principale compte pour « complète ».</p></div>`;
  }

  function volSection(s, d) {
    const v = vols(s, d);
    if (!v.owned.length && !v.extras && s.status !== 'collection' && !s.vfTotal) {
      return `<div class="sec"><span class="lbl">Tomes papier</span><button class="btn small" data-tome-add>J'ai le tome 1</button></div>`;
    }
    let status;
    if (v.complete) status = `<div class="vol-status full">Série terminée et complète : tu as les ${v.total} tomes ✓</div>`;
    else if (v.missing.length) status = `<div class="vol-status miss">Il te manque ${v.missing.length > 1 ? 'les tomes' : 'le tome'} <b>${ranges(v.missing)}</b></div>`;
    else if (v.known) status = `<div class="vol-status full">Tu as tous les tomes parus, ${v.total} sur ${v.total} ✓${v.upcoming.length ? ` · prochain tome ${esc(onDate(v.upcoming[0].date))}` : ''}</div>`;
    else status = `<div class="vol-status">Tu as tous les tomes jusqu'au ${v.total}. Indique combien sont parus en VF pour voir ce qui manque.</div>`;
    const tiles = [];
    for (let i = 1; i <= v.total; i++) {
      const inf = v.info[i];
      const tip = inf && inf.date ? ` title="Paru ${esc(onDate(inf.date))}"` : '';
      tiles.push(`<button class="tome ${v.set.has(i) ? 'on' : 'miss'}" data-tome="${i}" aria-pressed="${v.set.has(i)}" aria-label="Tome ${i}"${tip}>${i}</button>`);
    }
    for (const u of v.upcoming) tiles.push(`<button class="tome soon" data-tome="${u.n}" aria-label="Tome ${u.n}, à paraître" title="À paraître ${esc(onDate(u.date))}">${u.n}</button>`);
    return `<div class="sec">
      <div class="vol-head"><span class="lbl">Mes tomes</span><b>${v.owned.length}${v.total ? ' / ' + v.total : ''}${v.extras ? ` <small>+ ${v.extras} hors-série</small>` : ''}</b></div>
      ${status}
      <div class="tomes">${tiles.join('')}<button class="tome add" data-tome-add aria-label="Ajouter le tome suivant">+</button></div>
      <p class="hint">Touche un numéro pour dire que tu l'as, ou que tu ne l'as plus.</p>
      ${volDetails(v)}
      <div class="vf-row">
        <span>Parus en VF</span>
        <div class="mini-stepper"><button data-vf="-1" aria-label="Un de moins">−</button><b>${v.known ? v.total : '?'}</b><button data-vf="1" aria-label="Un de plus">+</button></div>
      </div>
      <div class="actions" style="margin-top:8px">
        ${v.vo ? `<button class="btn small ghost" data-vf-vo>En VO : ${v.vo} tome${v.vo > 1 ? 's' : ''}${d.voDone ? ' (finie)' : ''}, utiliser ce nombre</button>` : ''}
        ${v.missing.length ? '<button class="btn small ghost" data-vf-all>Je les ai tous</button>' : ''}
        ${v.known ? '<button class="btn small ghost" data-vf-unknown>Je ne sais pas</button>' : ''}
        ${v.complete ? '<button class="btn small ghost" data-complete="0">Pas encore complète</button>' : (!v.missing.length && v.owned.length ? '<button class="btn small ghost" data-complete="1">Série terminée, j’ai tout ✓</button>' : '')}
      </div>
    </div>`;
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    if (d) return new Date(y, m - 1, d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    if (m) return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    return String(y);
  }
  function onDate(iso) { return iso ? (iso.length >= 10 ? 'le ' : 'en ') + fmtDate(iso) : ''; }
  function volDetails(v) {
    const miss = v.missing.map((n) => ({ n, ...(v.info[n] || {}) }));
    if (!miss.length && !v.upcoming.length) return v.wiki ? `<p class="hint src">Dates : <a href="https://fr.wikipedia.org/wiki/${encodeURIComponent(v.wiki.replace(/ /g, '_'))}" target="_blank" rel="noopener">Wikipédia</a></p>` : '';
    const row = (x, cls, label) => `<li class="${cls}"><b>Tome ${x.n}</b>${x.title ? `<span class="vt">${esc(x.title)}</span>` : ''}<span class="vd">${label}</span></li>`;
    const shown = miss.length > 12 ? [...miss.slice(0, 5), null, ...miss.slice(-5)] : miss;
    return `<ul class="vlist">
      ${shown.map((x) => (x ? row(x, 'gone', x.date ? 'paru ' + onDate(x.date) : 'déjà paru') : `<li class="more">… ${miss.length - 10} autres tomes manquants</li>`)).join('')}
      ${v.upcoming.map((x) => row(x, 'soon', x.date ? 'à paraître ' + onDate(x.date) : 'annoncé')).join('')}
    </ul>
    ${v.wiki ? `<p class="hint src">Dates : <a href="https://fr.wikipedia.org/wiki/${encodeURIComponent(v.wiki.replace(/ /g, '_'))}" target="_blank" rel="noopener">Wikipédia</a></p>` : ''}`;
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
    let status = ui.mode === 'papier' ? 'collection' : 'a_commencer';
    sheet.innerHTML = `<div class="grabber"></div>
      <button class="close" data-close aria-label="Fermer"><svg viewBox="0 0 24 24"><path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6 10.6 12 5 6.4z"/></svg></button>
      <div class="sec" style="border:0;padding-top:20px"><h3 style="margin:0 0 14px;font-size:20px">Ajouter une série</h3>
        <label class="field"><span>Titre</span><input class="input" data-title placeholder="Ex. Omniscient Reader" autocomplete="off"></label>
        <div class="field"><span>Statut</span><div class="seg" data-status>${['en_cours', 'a_commencer', 'terminee', 'collection'].map((k) => `<button data-v="${k}" class="${k === status ? 'on' : ''}">${STATUS[k].short}</button>`).join('')}</div></div>
        <label class="field"><span>Prochain chapitre à lire</span><input class="input" data-next inputmode="numeric" placeholder="Optionnel"></label>
        <label class="field"><span>Tomes papier possédés (du tome 1 au tome…)</span><input class="input" data-vols inputmode="numeric" placeholder="0" value="${ui.mode === 'papier' ? 1 : ''}"></label>
        <label class="field"><span>Fiche MangaUpdates (optionnel)</span><input class="input" data-mu placeholder="https://www.mangaupdates.com/series/…" autocomplete="off">
          <p class="hint">Avec la fiche, l'appli suit les nouveaux chapitres et affiche la couverture. <a href="https://www.mangaupdates.com/series" target="_blank" rel="noopener" data-mu-search>Chercher ↗</a></p></label>
        <button class="btn primary" data-save style="width:100%">Ajouter</button>
      </div>`;
    $$('[data-status] button', sheet).forEach((b) => b.addEventListener('click', () => { status = b.dataset.v; $$('[data-status] button', sheet).forEach((x) => x.classList.toggle('on', x === b)); }));
    $('[data-title]', sheet).addEventListener('input', (e) => { $('[data-mu-search]', sheet).href = 'https://www.mangaupdates.com/series?search=' + encodeURIComponent(e.target.value); });
    $('[data-save]', sheet).addEventListener('click', async () => {
      const title = $('[data-title]', sheet).value.trim(); if (!title) return $('[data-title]', sheet).focus();
      const next = parseInt($('[data-next]', sheet).value, 10) || null;
      const mu = muIdFromInput($('[data-mu]', sheet).value);
      const st = next && next > 1 && status === 'a_commencer' ? 'en_cours' : status;
      const volumes = parseInt($('[data-vols]', sheet).value, 10) || 0;
      const item = S.add({ title, status: st, next, mu, volumes, owned: Array.from({ length: volumes }, (_, i) => i + 1) });
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
