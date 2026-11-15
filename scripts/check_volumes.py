"""Récupère sur Wikipédia (fr) la liste des tomes VF de chaque série papier.

Pour chaque série de library.json qui a des tomes papier, cherche une page
Wikipédia qui utilise le modèle {{TomeBD}} (listes de volumes), puis en tire,
pour l'édition française : numéro, date de sortie, titre éventuel et ISBN.
Les tomes annoncés (date future) sont gardés.

Résultat : volumes.json dans le dossier donné (branche "data").
Usage : python check_volumes.py DOSSIER [--only "Titre"]
"""
import datetime
import difflib
import json
import pathlib
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

API = "https://fr.wikipedia.org/w/api.php"
UA = "ma-bibliotheque-manga/1.0 (https://github.com/LucasMPF1/ma-bibliotheque-manga)"
MOIS = {m: i + 1 for i, m in enumerate(["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"])}
MOIS.update({"fevrier": 2, "aout": 8, "decembre": 12, "1er": None})


def norm(t):
    t = unicodedata.normalize("NFKD", (t or "").lower()).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", t)


_last = [0.0]
errors = [0]


def api(**params):
    params.update(format="json", formatversion="2")
    url = API + "?" + urllib.parse.urlencode(params)
    for attempt in range(5):
        wait = 1.2 - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            # Wikipédia limite le débit : on respecte le délai demandé
            time.sleep(int(e.headers.get("retry-after") or 5 * (attempt + 1)) + 1)
        except Exception:
            time.sleep(5 * (attempt + 1))
    errors[0] += 1
    return None


def candidates(titles):
    """Pages fr.wikipedia avec {{TomeBD}} qui correspondent à l'un des titres."""
    seen = {}
    for t in titles:
        if not t:
            continue
        d = api(action="query", list="search", srsearch=f'hastemplate:"TomeBD" {t}', srlimit=8, srnamespace=0)
        for h in (d or {}).get("query", {}).get("search", []):
            name = h["title"]
            core = re.sub(r"^(Liste des (chapitres|volumes|tomes) d[eu'’] ?(la |l'|les )?)", "", name, flags=re.I)
            core = re.sub(r"\s*\(.*\)$", "", core)
            score = max(difflib.SequenceMatcher(None, norm(core), norm(x)).ratio() for x in titles if x)
            if norm(core) and any(norm(core) == norm(x) for x in titles if x):
                score = 1.0
            seen[name] = max(seen.get(name, 0), score)
    return sorted(seen.items(), key=lambda kv: -kv[1])


def split_templates(text, name):
    """Renvoie le contenu de chaque {{name ...}} (gère les modèles imbriqués)."""
    out, i = [], 0
    pat = re.compile(r"\{\{\s*" + re.escape(name) + r"\s*\|", re.I)
    while True:
        m = pat.search(text, i)
        if not m:
            return out
        depth, j = 0, m.start()
        while j < len(text):
            if text.startswith("{{", j):
                depth += 1
                j += 2
            elif text.startswith("}}", j):
                depth -= 1
                j += 2
                if depth == 0:
                    break
            else:
                j += 1
        out.append(text[m.end():j - 2])
        i = j


def params(body):
    """Découpe les paramètres d'un modèle en respectant les {{ }} et [[ ]] imbriqués."""
    parts, depth, cur, k = [], 0, "", 0
    while k < len(body):
        two = body[k:k + 2]
        if two in ("{{", "[["):
            depth += 1
            cur += two
            k += 2
            continue
        if two in ("}}", "]]"):
            depth -= 1
            cur += two
            k += 2
            continue
        if body[k] == "|" and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += body[k]
        k += 1
    parts.append(cur)
    res = {}
    for p in parts:
        if "=" in p:
            key, val = p.split("=", 1)
            res[key.strip().lower()] = val.strip()
    return res


def clean(v):
    v = re.sub(r"<ref[^>]*/>", "", v or "")
    v = re.sub(r"<ref[^>]*>.*?</ref>", "", v, flags=re.S)
    v = re.sub(r"<[^>]+>", " ", v)
    v = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", v)
    v = re.sub(r"\{\{(?:lang|langue)\|[^|]*\|([^}]*)\}\}", r"\1", v, flags=re.I)
    v = re.sub(r"\{\{japonais\|([^|}]*)[^}]*\}\}", r"\1", v, flags=re.I)
    v = re.sub(r"'''?", "", v)
    return re.sub(r"\s+", " ", v).strip()


def parse_date(v):
    v = v or ""
    m = re.search(r"\{\{\s*date\s*\|\s*(\d{1,2}|1er)\s*\|\s*([^|}]+)\|\s*(\d{4})", v, re.I)
    if m:
        d = 1 if m.group(1) == "1er" else int(m.group(1))
        mo = MOIS.get(m.group(2).strip().lower())
        if mo:
            return f"{int(m.group(3)):04d}-{mo:02d}-{d:02d}"
    v2 = clean(v).lower()
    m = re.search(r"(\d{1,2}|1er)\s+([a-zéû]+)\s+(\d{4})", v2)
    if m and MOIS.get(m.group(2)):
        d = 1 if m.group(1) == "1er" else int(m.group(1))
        return f"{int(m.group(3)):04d}-{MOIS[m.group(2)]:02d}-{d:02d}"
    m = re.search(r"([a-zéû]+)\s+(\d{4})", v2)
    if m and MOIS.get(m.group(1)):
        return f"{int(m.group(2)):04d}-{MOIS[m.group(1)]:02d}"
    m = re.search(r"\{\{\s*date\s*\|\s*\|?\s*([^|}]+)\|\s*(\d{4})", v, re.I)
    if m and MOIS.get(m.group(1).strip().lower()):
        return f"{int(m.group(2)):04d}-{MOIS[m.group(1).strip().lower()]:02d}"
    m = re.search(r"\b(20\d\d|19\d\d)\b", v2)
    return m.group(1) if m else None


def parse_page(text):
    """Liste des tomes de l'édition française trouvés dans la page."""
    fr_idx = None
    for head in split_templates(text, "TomeBD/Entête"):
        p = params(head)
        for k, v in p.items():
            if re.match(r"langage_\d+$", k) and ("fran" in v.lower()):
                fr_idx = k.split("_")[1]
                break
        if fr_idx:
            break
    vols = {}
    for body in split_templates(text, "TomeBD"):
        p = params(body)
        num = re.match(r"\s*(\d+)", clean(p.get("volume", "")))
        if not num:
            continue
        n = int(num.group(1))
        if n in vols:
            break  # la numérotation repart à 1 : c'est une autre série (ex. Tokyo Ghoul puis Tokyo Ghoul:re)
        if p.get("langage_unique", "").lower() == "oui":
            idx = fr_idx or "1"
        else:
            idx = fr_idx or "2"
        date_raw = p.get(f"sortie_{idx}", "")
        isbn = clean(p.get(f"isbn_{idx}", ""))
        title = clean(p.get(f"titre_{idx}", "") or p.get("titre_fr", "") or p.get("titre", ""))
        date = parse_date(date_raw)
        if not date and not re.search(r"\d{3}", isbn):
            continue  # tome pas (encore) annoncé en VF
        vols[n] = {"n": n, "date": date, "isbn": isbn or None, "title": title or None}
    return [vols[k] for k in sorted(vols)]


def main():
    folder = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    library = json.loads((folder / "library.json").read_text(encoding="utf-8"))
    rel = json.loads((folder / "releases.json").read_text(encoding="utf-8")).get("series", {}) if (folder / "releases.json").exists() else {}
    out_path = folder / "volumes.json"
    out = json.loads(out_path.read_text(encoding="utf-8")) if out_path.exists() else {"series": {}}
    known = out.setdefault("series", {})
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")

    for s in library.get("series", []):
        if s.get("deleted") or not (s.get("volumes") or s.get("status") == "collection"):
            continue
        if only and norm(only) not in norm(s["title"]):
            continue
        prev = known.get(s["id"], {})
        page = s.get("wiki") or prev.get("page")
        if not page and prev.get("none_until", "") > now:
            continue
        if not page:
            mu = rel.get(str(s.get("mu")), {})
            err_before = errors[0]
            cands = candidates([s["title"], mu.get("title")])
            if errors[0] > err_before:
                print(f"!! {s['title']} : Wikipédia indisponible, on réessaiera")
                continue
            page = cands[0][0] if cands and cands[0][1] >= 0.8 else None
            if not page:
                # rien trouvé : on réessaiera dans 30 jours
                until = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=30)).isoformat(timespec="seconds")
                known[s["id"]] = {"page": None, "none_until": until}
                print(f"-- {s['title']} : aucune page")
                continue
        # Les longues séries sont découpées : « … (1re partie) », « … (2e partie) »…
        base = re.sub(r"\s*\(\d+(re|e|ère) partie\)$", "", page)
        pages = [page]
        if base.lower().startswith("liste des"):
            ps = api(action="query", list="prefixsearch", pssearch=base, pslimit=20) or {}
            pages = sorted({h["title"] for h in ps.get("query", {}).get("prefixsearch", [])
                            if h["title"] == base or re.fullmatch(re.escape(base) + r" \(\d+(re|e|ère) partie\)", h["title"])} | {page})
        merged = {}
        err_before = errors[0]
        for pg in pages:
            d = api(action="parse", page=pg, prop="wikitext", redirects=1)
            for v in parse_page((d or {}).get("parse", {}).get("wikitext", "")):
                merged[v["n"]] = v
        vols = [merged[k] for k in sorted(merged)]
        if errors[0] > err_before:
            print(f"!! {s['title']} : Wikipédia indisponible, on garde l'ancienne liste")
            continue
        if not vols:
            known[s["id"]] = {"page": None, "none_until": now}
            print(f"-- {s['title']} : page {page} sans tomes VF")
            continue
        known[s["id"]] = {"page": page, "pages": pages, "checked_at": now, "volumes": vols}
        print(f"OK {s['title']} -> {page} : {len(vols)} tomes VF (dernier {vols[-1]['n']} le {vols[-1]['date']})")

    out["checked_at"] = now
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
