"""Cherche les nouveaux chapitres de chaque série sur MangaUpdates.

Lit library.json et releases.json dans le dossier donné (la branche "data"),
met à jour releases.json, et indique s'il y a eu des changements.
"""
import datetime
import difflib
import json
import unicodedata
import re
import pathlib
import sys
import time
import urllib.request

API = "https://api.mangaupdates.com/v1/series/"
folder = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")

library = json.loads((folder / "library.json").read_text(encoding="utf-8"))
rel_path = folder / "releases.json"
releases = json.loads(rel_path.read_text(encoding="utf-8")) if rel_path.exists() else {"series": {}}
known = releases.setdefault("series", {})


def fetch(series_id):
    for attempt in range(4):
        try:
            req = urllib.request.Request(API + str(series_id), headers={"User-Agent": "ma-bibliotheque-manga/1.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(5 * (attempt + 1))
        except Exception:
            time.sleep(5 * (attempt + 1))
    return None


# ---------- Séries ajoutées sans fiche : on cherche la fiche à partir du titre ----------
SKIP_TYPES = {"Novel", "Doujinshi", "Artbook"}
auto = releases.setdefault("auto", {})


def norm(t):
    t = unicodedata.normalize("NFKD", (t or "").lower()).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", t)


def score(title, names):
    a = norm(title)
    best = 0.0
    for x in names:
        b = norm(x)
        if not a or not b:
            continue
        best = max(best, 1.0 if a == b else difflib.SequenceMatcher(None, a, b).ratio())
    return best


def search(q):
    for attempt in range(3):
        try:
            req = urllib.request.Request(API + "search", data=json.dumps({"search": q, "perpage": 10}).encode(),
                                         headers={"User-Agent": "ma-bibliotheque-manga/1.0", "Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r).get("results", [])
        except Exception:
            time.sleep(5 * (attempt + 1))
    return None


def find_series(title):
    """Meilleure fiche MangaUpdates pour ce titre (titres traduits compris), ou None."""
    queries = {title}
    low = title.lower()
    for a, b in (("reincarnation", "regression"), ("regression", "reincarnation"), ("reincarnated", "regressed"), ("regressed", "reincarnated")):
        if a in low:
            queries.add(re.sub(a, b, title, flags=re.I))
    cands = {}
    for q in queries:
        res = search(q)
        time.sleep(0.5)
        if res is None:
            return "error"
        for h in res:
            rec = h.get("record", {})
            if rec.get("type") in SKIP_TYPES:
                continue
            sid = rec.get("series_id")
            cands[sid] = max(cands.get(sid, 0), score(title, [h.get("hit_title"), rec.get("title")]))
    best = None
    for sid, sc in sorted(cands.items(), key=lambda kv: -kv[1])[:4]:
        d = fetch(sid)
        time.sleep(0.5)
        if not d:
            continue
        names = [d.get("title")] + [x.get("title") for x in d.get("associated", [])]
        sc = max(sc, score(title, names))
        if not best or sc > best[1]:
            best = (sid, sc, d.get("title"))
    return best


for s in library.get("series", []):
    if s.get("deleted") or s.get("mu") or s.get("cover") or s.get("verify"):
        continue
    prev = auto.get(s["id"])
    if prev and (prev.get("mu") or prev.get("retry", "") > now) and prev.get("for") == s["title"]:
        continue
    best = find_series(s["title"])
    if best == "error":
        continue
    if best and best[1] >= 0.88:
        auto[s["id"]] = {"mu": best[0], "for": s["title"], "title": best[2], "score": round(best[1], 2), "at": now}
        print(f"Fiche trouvée : {s['title']} -> {best[2]} ({best[1]:.2f})")
    else:
        retry = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=7)).isoformat(timespec="seconds")
        auto[s["id"]] = {"mu": None, "for": s["title"], "retry": retry, "at": now}
        print(f"Pas de fiche sûre pour : {s['title']}" + (f" (meilleure : {best[2]} {best[1]:.2f})" if best else ""))

ids = sorted({str(s["mu"]) for s in library.get("series", []) if s.get("mu") and not s.get("deleted")}
             | {str(a["mu"]) for a in auto.values() if a.get("mu")})
new_count = 0
for sid in ids:
    d = fetch(sid)
    time.sleep(0.5)
    if not d:
        continue
    old = known.get(sid, {})
    latest = d.get("latest_chapter") or None
    cover = ((d.get("image") or {}).get("url") or {}).get("thumb") or old.get("cover", "")
    entry = {
        "title": d.get("title", old.get("title", "")),
        "url": d.get("url", old.get("url", "")),
        "type": d.get("type", old.get("type", "")),
        "latest": latest,
        "completed": bool(d.get("completed")),
        "cover": cover,
        "changed_at": old.get("changed_at"),
        "history": old.get("history", []),
    }
    m = re.search(r"(\d+)\s*Volumes?", d.get("status") or "", re.I)
    if m:
        entry["vo_volumes"] = int(m.group(1))
    if latest and old.get("latest") and latest > old["latest"]:
        entry["changed_at"] = now
        entry["history"] = ([{"chapter": latest, "at": now}] + entry["history"])[:20]
        new_count += 1
        print(f"Nouveau : {entry['title']} -> {latest}")
    known[sid] = entry

releases["checked_at"] = now
rel_path.write_text(json.dumps(releases, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"{len(ids)} séries vérifiées, {new_count} avec de nouveaux chapitres")
