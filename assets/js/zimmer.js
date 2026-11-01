/*
 * Zimmer am Gothenhaus — Zimmerliste, Filter und Fotogalerie (nur zimmer.html)
 *
 * Daten: zimmer.json (wird von Hand auf GitHub gepflegt — siehe "_hinweise" dort).
 * Alle Texte aus der JSON-Datei werden ausschließlich per textContent/setAttribute
 * in die Seite geschrieben, nie als HTML.
 */
(function () {
    'use strict';

    var doc = document;
    var SVGNS = 'http://www.w3.org/2000/svg';
    var MAIL = 'heimleitung@studentenheim-gothenhaus.at';
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* Status: Reihenfolge = Sortierung der Liste */
    var STATUS = {
        frei:         { label: 'Frei',        order: 0 },
        reserviert:   { label: 'Reserviert',  order: 1 },
        gaestezimmer: { label: 'Gästezimmer', order: 2 },
        belegt:       { label: 'Belegt',      order: 3 }
    };
    var OTHER_ORDER = 4;

    var FILTERS = [
        { key: 'alle',         label: 'Alle' },
        { key: 'frei',         label: 'Frei',        dot: true },
        { key: 'reserviert',   label: 'Reserviert',  dot: true },
        { key: 'gaestezimmer', label: 'Gästezimmer', dot: true },
        { key: 'belegt',       label: 'Belegt',      dot: true },
        { key: 'balkon',       label: 'Balkon',      icon: 'i-balcony' }
    ];

    var grid = doc.getElementById('roomsGrid');
    var toolbar = doc.getElementById('roomsToolbar');
    var filterBar = doc.getElementById('filterBar');
    var countEl = doc.getElementById('roomsCount');
    var availCard = doc.getElementById('availCard');
    if (!grid) return;

    var rooms = [];
    var cards = [];
    var activeFilter = 'alle';

    /* ── Hilfsfunktionen ── */
    function el(tag, cls, text) {
        var e = doc.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }
    function icon(id, cls) {
        var svg = doc.createElementNS(SVGNS, 'svg');
        svg.setAttribute('class', 'icon' + (cls ? ' ' + cls : ''));
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        var use = doc.createElementNS(SVGNS, 'use');
        use.setAttribute('href', '#' + id);
        svg.appendChild(use);
        return svg;
    }
    function str(v) { return (typeof v === 'string' || typeof v === 'number') ? String(v).trim() : ''; }
    function num(v) {
        if (typeof v === 'number' && isFinite(v)) return v;
        if (typeof v === 'string' && v.trim() !== '') {
            var n = Number(v.replace(/[^\d,.\-]/g, '').replace(',', '.'));
            return isFinite(n) ? n : null;
        }
        return null;
    }
    function fmt(n) {
        try { return n.toLocaleString('de-AT', { maximumFractionDigits: 2 }); } catch (e) { return String(n); }
    }
    function plural(n, one, many) { return n === 1 ? one : many; }

    /* Statuswert tolerant lesen: "Frei", "Gästezimmer", " belegt " … */
    function normStatus(v) {
        return str(v).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/\s+/g, '');
    }
    function normBool(v) {
        if (v === true) return true;
        if (typeof v === 'string') return /^(true|ja|yes|1)$/i.test(v.trim());
        return v === 1;
    }

    /* Bildpfad sicher als URL kodieren (Leerzeichen, Klammern, Umlaute …) */
    function toUrl(p) {
        if (/^(https?:)?\/\//i.test(p)) return encodeURI(p);
        return p.split('/').map(function (seg) {
            try { seg = decodeURIComponent(seg); } catch (e) { /* bereits roh */ }
            return encodeURIComponent(seg);
        }).join('/');
    }
    /* Vorschaubild: images/thumbs/<Pfad ohne "images/">.webp — neue Fotos haben ggf. noch keins */
    function thumbOf(p) {
        if (!/^images\//i.test(p)) return p;
        return 'images/thumbs/' + p.slice(7).replace(/\.[a-z0-9]{2,5}$/i, '') + '.webp';
    }
    /* <img> mit Fallback: je Foto erst Vorschaubild (WebP), dann Original;
       fehlt beides, das nächste Foto der Liste — sonst onFail() */
    function setImage(img, photos, onFail) {
        var queue = [];
        [].concat(photos).forEach(function (p) {
            var t = thumbOf(p);
            if (t !== p) queue.push(t);
            queue.push(p);
        });
        var i = 0;
        img.addEventListener('error', function onError() {
            if (++i < queue.length) { img.src = toUrl(queue[i]); return; }
            img.removeEventListener('error', onError);
            if (onFail) onFail();
        });
        img.src = toUrl(queue[0]);
    }

    function normalize(raw, i) {
        if (!raw || typeof raw !== 'object') return null;
        var status = normStatus(raw.status);
        var photos = Array.isArray(raw.photos)
            ? raw.photos.map(str).filter(function (p) { return p && !/^\s*javascript:/i.test(p); })
            : [];
        return {
            index: i,
            name: str(raw.name) || ('Zimmer ' + (i + 1)),
            size: num(raw.size),
            price: num(raw.price),
            status: STATUS[status] ? status : '',
            balkon: normBool(raw.balkon),
            hinweis: str(raw.hinweis),
            photos: photos
        };
    }

    function priceText(r) { return r.price != null ? fmt(r.price) + ' €' : 'auf Anfrage'; }
    function mailtoFor(r) {
        var body = 'Hallo!\r\n\r\nIch interessiere mich für das Zimmer „' + r.name + '“ im Gothenhaus.\r\n\r\n' +
            'Studiengang, Hochschule, Semester:\r\n' +
            'Gewünschtes Einzugsdatum:\r\n' +
            'Musikalische Vorbildung (Gesang/Instrument):\r\n\r\nViele Grüße\r\n';
        return 'mailto:' + MAIL + '?subject=' + encodeURIComponent('Zimmeranfrage: ' + r.name) + '&body=' + encodeURIComponent(body);
    }

    function matches(r, key) {
        if (key === 'alle') return true;
        if (key === 'balkon') return r.balkon;
        return r.status === key;
    }

    /* ── Karte bauen ── */
    function buildCard(r, n) {
        var titleId = 'zimmer-' + n;
        var card = el('article', 'room-card' + (r.status ? ' is-' + r.status : ''));
        card.setAttribute('aria-labelledby', titleId);

        /* Bild (öffnet die Galerie) */
        var media;
        var count = r.photos.length;
        if (count) {
            media = el('button', 'room-media');
            media.type = 'button';
            media.setAttribute('aria-haspopup', 'dialog');
            media.setAttribute('aria-label', 'Fotos von Zimmer ' + r.name + ' ansehen (' + count + ' ' + plural(count, 'Foto', 'Fotos') + ')');
            var img = el('img');
            img.alt = '';
            img.loading = 'lazy';
            img.decoding = 'async';
            img.width = 570;
            img.height = 428;
            setImage(img, r.photos, function () { showPlaceholder(media, img); });
            media.appendChild(img);
            var zoom = el('span', 'room-zoom');
            zoom.setAttribute('aria-hidden', 'true');
            zoom.appendChild(icon('i-expand'));
            zoom.appendChild(doc.createTextNode('Galerie öffnen'));
            media.appendChild(zoom);
            var pc = el('span', 'room-photos');
            pc.setAttribute('aria-hidden', 'true');
            pc.appendChild(icon('i-images'));
            pc.appendChild(doc.createTextNode(String(count)));
            media.appendChild(pc);
            media.addEventListener('click', function () { openGallery(r, 0, media); });
        } else {
            media = el('div', 'room-media room-media--empty');
            appendPlaceholder(media);
        }

        /* Status- und Hinweis-Abzeichen (rein visuell, Text steht zusätzlich unten für Screenreader) */
        if (r.status || r.hinweis) {
            var badges = el('div', 'room-badges');
            badges.setAttribute('aria-hidden', 'true');
            if (r.status) {
                var st = el('span', 'room-status room-status--' + r.status);
                st.appendChild(el('span', 'dot'));
                st.appendChild(doc.createTextNode(STATUS[r.status].label));
                badges.appendChild(st);
            }
            if (r.hinweis) badges.appendChild(el('span', 'room-note', r.hinweis));
            media.appendChild(badges);
        }
        card.appendChild(media);

        /* Inhalt */
        var body = el('div', 'room-body');
        var head = el('div', 'room-head');
        var h3 = el('h3', 'room-name');
        h3.id = titleId;
        h3.appendChild(el('span', 'room-kicker', 'Zimmer'));
        h3.appendChild(doc.createTextNode(' ' + r.name));
        head.appendChild(h3);

        var price = el('p', 'room-price' + (r.price == null ? ' room-price--ask' : ''));
        if (r.price != null) {
            price.appendChild(el('strong', null, priceText(r)));
            price.appendChild(el('small', null, 'pro Monat'));
        } else {
            price.appendChild(el('strong', null, 'auf Anfrage'));
            price.appendChild(el('small', null, 'Preis'));
        }
        head.appendChild(price);
        body.appendChild(head);

        var srParts = [];
        if (r.status) srParts.push('Status: ' + STATUS[r.status].label);
        if (r.hinweis) srParts.push('Hinweis: ' + r.hinweis);
        if (srParts.length) body.appendChild(el('p', 'sr-only', srParts.join('. ') + '.'));

        var facts = el('ul', 'room-facts');
        facts.setAttribute('aria-label', 'Ausstattung');
        if (r.size != null) {
            var li = el('li');
            li.appendChild(icon('i-ruler'));
            li.appendChild(doc.createTextNode(fmt(r.size) + ' m²'));
            facts.appendChild(li);
        }
        var furn = el('li');
        furn.appendChild(icon('i-armchair'));
        furn.appendChild(doc.createTextNode('Teilmöbliert'));
        facts.appendChild(furn);
        if (r.balkon) {
            var bal = el('li', 'is-balkon');
            bal.appendChild(icon('i-balcony'));
            bal.appendChild(doc.createTextNode('Balkon'));
            facts.appendChild(bal);
        }
        body.appendChild(facts);
        card.appendChild(body);

        /* Anfragen */
        var cta = el('a', 'room-cta');
        cta.href = mailtoFor(r);
        cta.setAttribute('aria-label', 'Zimmer ' + r.name + ' anfragen — E-Mail an die Heimleitung');
        var ctaText = el('span');
        ctaText.appendChild(icon('i-mail'));
        ctaText.appendChild(doc.createTextNode('Anfragen'));
        cta.appendChild(ctaText);
        cta.appendChild(icon('i-arrow-right', 'icon--arrow'));
        card.appendChild(cta);

        return card;
    }

    function appendPlaceholder(media) {
        var ph = el('span', 'room-ph');
        var ic = el('span', 'room-ph-icon');
        ic.appendChild(icon('i-bed'));
        ph.appendChild(ic);
        ph.appendChild(el('span', 'room-ph-text', 'Fotos folgen'));
        media.appendChild(ph);
    }
    /* Vorschau- und Originalfoto fehlen → Platzhalter, Galerie bleibt bedienbar */
    function showPlaceholder(media, img) {
        if (img && img.parentNode) img.parentNode.removeChild(img);
        media.classList.add('room-media--empty');
        if (!media.querySelector('.room-ph')) media.insertBefore(el('span', 'room-ph'), media.firstChild);
        var ph = media.querySelector('.room-ph');
        if (!ph.firstChild) {
            var ic = el('span', 'room-ph-icon');
            ic.appendChild(icon('i-bed'));
            ph.appendChild(ic);
            ph.appendChild(el('span', 'room-ph-text', 'Foto nicht verfügbar'));
        }
    }

    /* ── Filter ── */
    var chipEls = {};
    var counts = {};

    function renderFilters() {
        filterBar.textContent = '';
        FILTERS.forEach(function (f) {
            counts[f.key] = rooms.filter(function (r) { return matches(r, f.key); }).length;
            if (f.key !== 'alle' && counts[f.key] === 0) return;     // leere Filter ausblenden
            var b = el('button', 'filter-chip');
            b.type = 'button';
            b.setAttribute('data-filter', f.key);
            b.setAttribute('aria-pressed', f.key === activeFilter ? 'true' : 'false');
            if (f.dot) { var d = el('span', 'filter-dot dot--' + f.key); d.setAttribute('aria-hidden', 'true'); b.appendChild(d); }
            if (f.icon) b.appendChild(icon(f.icon));
            b.appendChild(el('span', 'filter-label', f.label));
            var c = el('span', 'filter-count', String(counts[f.key]));
            c.setAttribute('aria-hidden', 'true');
            b.appendChild(c);
            b.appendChild(el('span', 'sr-only', ' (' + counts[f.key] + ' Zimmer)'));
            b.addEventListener('click', function () { setFilter(f.key, true); });
            filterBar.appendChild(b);
            chipEls[f.key] = b;
        });
    }

    function resultText(key, n) {
        switch (key) {
            case 'frei':         return n + ' ' + plural(n, 'freies Zimmer', 'freie Zimmer');
            case 'reserviert':   return n + ' ' + plural(n, 'reserviertes Zimmer', 'reservierte Zimmer');
            case 'gaestezimmer': return n + ' Gästezimmer';
            case 'belegt':       return n + ' ' + plural(n, 'belegtes Zimmer', 'belegte Zimmer');
            case 'balkon':       return n + ' Zimmer mit Balkon';
            default:             return n === 1 ? '1 Zimmer' : 'Alle ' + n + ' Zimmer';
        }
    }

    function setFilter(key, fromUser) {
        if (!chipEls[key]) key = 'alle';
        activeFilter = key;
        Object.keys(chipEls).forEach(function (k) { chipEls[k].setAttribute('aria-pressed', k === key ? 'true' : 'false'); });
        var shown = 0;
        cards.forEach(function (c) {
            var on = matches(c.room, key);
            c.el.hidden = !on;
            if (on) c.el.style.setProperty('--i', Math.min(shown++, 8));
        });
        countEl.textContent = resultText(key, shown) + (key === 'alle' ? ' · sortiert nach Verfügbarkeit' : '');
        if (fromUser && window.history && history.replaceState) {
            try {
                var url = new URL(window.location.href);
                if (key === 'alle') url.searchParams.delete('filter'); else url.searchParams.set('filter', key);
                history.replaceState(null, '', url.pathname + url.search + url.hash);
            } catch (e) { /* ältere Browser: URL bleibt */ }
        }
    }

    /* ── Live-Zusammenfassung im Seitenkopf ── */
    function renderSummary() {
        if (!availCard) return;
        var total = rooms.length;
        var free = rooms.filter(function (r) { return r.status === 'frei'; });
        var prices = free.map(function (r) { return r.price; }).filter(function (p) { return p != null; });
        var q = function (k) { return availCard.querySelector('[data-avail="' + k + '"]'); };
        var link = q('link');
        q('num').textContent = String(free.length);
        if (free.length) {
            q('title').textContent = free.length + ' von ' + total + ' ' + plural(total, 'Zimmer', 'Zimmern') + ' frei';
            q('meta').textContent = prices.length ? 'ab ' + fmt(Math.min.apply(null, prices)) + ' € / Monat · teilmöbliert' : 'Preis auf Anfrage · teilmöbliert';
            q('linktext').textContent = free.length === 1 ? 'Freies Zimmer zeigen' : 'Freie Zimmer zeigen';
            link.setAttribute('href', '#zimmer');
            link.addEventListener('click', function () { setFilter('frei', true); });
        } else {
            availCard.classList.add('is-none');
            q('title').textContent = 'Derzeit alle Zimmer vergeben';
            q('meta').textContent = 'Zimmer werden laufend frei — frag gerne nach.';
            q('linktext').textContent = 'So bewirbst du dich';
            link.setAttribute('href', '#vergabe');
            link.querySelector('use').setAttribute('href', '#i-arrow-right');
        }
        availCard.hidden = false;
    }

    /* ── Zustände ── */
    function showState(title, text, withRetry) {
        grid.setAttribute('aria-busy', 'false');
        grid.textContent = '';
        var box = el('div', 'rooms-state');
        box.setAttribute('role', 'status');
        var ic = el('span', 'rooms-state-icon');
        ic.setAttribute('aria-hidden', 'true');
        ic.appendChild(icon('i-bed'));
        box.appendChild(ic);
        box.appendChild(el('strong', null, title));
        var p = el('p');
        p.appendChild(doc.createTextNode(text + ' '));
        var a = el('a', null, MAIL);
        a.href = 'mailto:' + MAIL;
        p.appendChild(a);
        box.appendChild(p);
        if (withRetry) {
            var row = el('div', 'btn-row');
            var btn = el('button', 'btn btn--forest btn--sm');
            btn.type = 'button';
            btn.appendChild(icon('i-refresh'));
            btn.appendChild(doc.createTextNode('Erneut versuchen'));
            btn.addEventListener('click', load);
            row.appendChild(btn);
            box.appendChild(row);
        }
        grid.appendChild(box);
    }

    function render(data) {
        var list = Array.isArray(data) ? data : (data && Array.isArray(data.zimmer) ? data.zimmer : []);
        rooms = list.map(normalize).filter(Boolean);
        // Sortierung: frei → reserviert → Gästezimmer → belegt → Rest, innerhalb gleich wie in der JSON-Datei
        rooms.sort(function (a, b) {
            var oa = a.status ? STATUS[a.status].order : OTHER_ORDER;
            var ob = b.status ? STATUS[b.status].order : OTHER_ORDER;
            return (oa - ob) || (a.index - b.index);
        });

        if (!rooms.length) {
            showState('Derzeit sind keine Zimmer eingetragen.', 'Frag gerne direkt bei der Heimleitung nach:', false);
            return;
        }

        grid.textContent = '';
        cards = rooms.map(function (r, n) {
            var card = buildCard(r, n);
            grid.appendChild(card);
            return { room: r, el: card };
        });
        grid.setAttribute('aria-busy', 'false');

        renderFilters();
        toolbar.hidden = false;
        var wanted = null;
        try { wanted = new URLSearchParams(window.location.search).get('filter'); } catch (e) { /* ignorieren */ }
        setFilter(wanted && chipEls[wanted] ? wanted : 'alle', false);
        renderSummary();
    }

    function load() {
        grid.setAttribute('aria-busy', 'true');
        if (!window.fetch) {
            showState('Die Zimmerliste konnte gerade nicht geladen werden …', 'Dein Browser ist leider zu alt. Schreib der Heimleitung direkt:', false);
            return;
        }
        fetch('zimmer.json', { cache: 'no-cache' })
            .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
            .then(render)
            .catch(function (err) {
                if (window.console) console.warn('Zimmerliste konnte nicht geladen werden:', err);
                toolbar.hidden = true;
                showState('Die Zimmerliste konnte gerade nicht geladen werden …',
                    'Bitte versuch es gleich noch einmal oder lade die Seite neu. Fragen zu freien Zimmern beantwortet dir die Heimleitung auch direkt:', true);
            });
    }

    /* ══════════ Fotogalerie ══════════ */
    var lb = doc.getElementById('lightbox');
    var lbTitle = doc.getElementById('lbTitle');
    var lbCounter = doc.getElementById('lbCounter');
    var lbStatus = doc.getElementById('lbStatus');
    var lbFigure = doc.getElementById('lbFigure');
    var lbImg = doc.getElementById('lbImage');
    var lbThumbs = doc.getElementById('lbThumbs');
    var lbStage = doc.getElementById('lbStage');
    var lbPrev = doc.getElementById('lbPrev');
    var lbNext = doc.getElementById('lbNext');
    var lbClose = doc.getElementById('lbClose');

    var lbRoom = null;
    var lbIndex = 0;
    var lbToken = 0;
    var lbOpen = false;
    var lbReturn = null;
    var lbInert = [];
    var lbCloseTimer = null;
    var preloaded = {};

    function photoUrl(i) { return toUrl(lbRoom.photos[i]); }
    function wrap(i) { var n = lbRoom.photos.length; return ((i % n) + n) % n; }

    function preload(i) {
        var src = photoUrl(wrap(i));
        if (preloaded[src]) return;
        preloaded[src] = true;
        var im = new Image();
        im.decoding = 'async';
        im.src = src;
    }

    function show(i) {
        if (!lbRoom) return;
        var n = lbRoom.photos.length;
        lbIndex = wrap(i);
        var src = photoUrl(lbIndex);
        var alt = 'Zimmer ' + lbRoom.name + ' — Foto ' + (lbIndex + 1) + ' von ' + n;
        var token = ++lbToken;

        lbCounter.textContent = (lbIndex + 1) + ' / ' + n;
        lbStatus.textContent = 'Foto ' + (lbIndex + 1) + ' von ' + n;
        lbFigure.classList.remove('is-error');
        lbFigure.classList.add('is-loading');

        var im = new Image();
        im.onload = function () {
            if (token !== lbToken) return;
            lbImg.src = src;
            lbImg.alt = alt;
            lbFigure.classList.add('has-image');
            lbFigure.classList.remove('is-loading');
        };
        im.onerror = function () {
            if (token !== lbToken) return;
            lbImg.removeAttribute('src');
            lbImg.alt = '';
            lbFigure.classList.remove('is-loading', 'has-image');
            lbFigure.classList.add('is-error');
        };
        im.src = src;
        preloaded[src] = true;

        Array.prototype.forEach.call(lbThumbs.children, function (t, ti) {
            if (ti === lbIndex) {
                t.setAttribute('aria-current', 'true');
                // Aktives Vorschaubild sichtbar halten, ohne die Seite zu scrollen
                var left = t.offsetLeft - (lbThumbs.clientWidth - t.offsetWidth) / 2;
                if (lbThumbs.scrollWidth > lbThumbs.clientWidth) {
                    lbThumbs.scrollTo({ left: Math.max(0, left), behavior: reduceMotion || !lbOpen ? 'auto' : 'smooth' });
                }
            } else {
                t.removeAttribute('aria-current');
            }
        });

        if (n > 1) { preload(lbIndex + 1); preload(lbIndex - 1); }
    }

    function buildThumbs() {
        lbThumbs.textContent = '';
        var n = lbRoom.photos.length;
        lbRoom.photos.forEach(function (p, i) {
            var b = el('button', 'lb-thumb');
            b.type = 'button';
            b.setAttribute('aria-label', 'Foto ' + (i + 1) + ' von ' + n + ' anzeigen');
            var img = el('img');
            img.alt = '';
            img.loading = 'lazy';
            img.decoding = 'async';
            setImage(img, p, null);
            b.appendChild(img);
            b.addEventListener('click', function () { show(i); });
            lbThumbs.appendChild(b);
        });
    }

    function focusables() {
        return Array.prototype.filter.call(lb.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])'), function (x) {
            return !x.disabled && x.offsetParent !== null;
        });
    }

    function setInert(on) {
        if (on) {
            lbInert = Array.prototype.filter.call(doc.body.children, function (x) {
                return x !== lb && !/^(SCRIPT|STYLE|TEMPLATE)$/.test(x.tagName) && !x.hasAttribute('inert');
            });
            lbInert.forEach(function (x) { x.setAttribute('inert', ''); });
        } else {
            lbInert.forEach(function (x) { x.removeAttribute('inert'); });
            lbInert = [];
        }
    }

    function lockScroll(on) {
        var html = doc.documentElement;
        if (on) {
            var sw = window.innerWidth - html.clientWidth;
            html.classList.add('is-locked');
            if (sw > 0) doc.body.style.paddingRight = sw + 'px';
        } else {
            html.classList.remove('is-locked');
            doc.body.style.paddingRight = '';
        }
    }

    function openGallery(room, start, trigger) {
        if (!room || !room.photos.length || !lb) return;
        clearTimeout(lbCloseTimer);
        lbRoom = room;
        lbReturn = trigger || doc.activeElement;
        lbTitle.textContent = 'Zimmer ' + room.name;
        lb.classList.toggle('is-single', room.photos.length < 2);
        lbFigure.classList.remove('has-image', 'is-error');
        lbImg.removeAttribute('src');
        buildThumbs();

        lb.hidden = false;
        setInert(true);
        lockScroll(true);
        void lb.offsetWidth;            // Reflow, damit die Einblendung animiert
        lb.classList.add('is-open');
        show(start || 0);
        lbOpen = true;
        doc.addEventListener('keydown', onKey, true);
        lbClose.focus();
    }

    function closeGallery() {
        if (!lbOpen) return;
        lbOpen = false;
        lbToken++;
        doc.removeEventListener('keydown', onKey, true);
        lb.classList.remove('is-open');
        setInert(false);
        lockScroll(false);
        lbCloseTimer = setTimeout(function () {
            lb.hidden = true;
            lbThumbs.textContent = '';
            lbImg.removeAttribute('src');
        }, reduceMotion ? 0 : 350);
        if (lbReturn && lbReturn.focus) {
            try { lbReturn.focus({ preventScroll: true }); } catch (e) { lbReturn.focus(); }
        }
        lbReturn = null;
    }

    function onKey(e) {
        if (!lbOpen) return;
        switch (e.key) {
            case 'Escape': case 'Esc':
                e.preventDefault(); e.stopPropagation(); closeGallery(); return;
            case 'ArrowLeft': case 'Left':
                if (lbRoom.photos.length > 1) { e.preventDefault(); show(lbIndex - 1); } return;
            case 'ArrowRight': case 'Right':
                if (lbRoom.photos.length > 1) { e.preventDefault(); show(lbIndex + 1); } return;
            case 'Home':
                e.preventDefault(); show(0); return;
            case 'End':
                e.preventDefault(); show(lbRoom.photos.length - 1); return;
            case 'Tab':
                // Fokus in der Galerie halten (zusätzlich zu "inert" für ältere Browser)
                var f = focusables();
                if (!f.length) { e.preventDefault(); return; }
                var i = f.indexOf(doc.activeElement);
                if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
                else if (!e.shiftKey && (i === f.length - 1 || i === -1)) { e.preventDefault(); f[0].focus(); }
                return;
        }
    }

    if (lb) {
        lbClose.addEventListener('click', closeGallery);
        lbPrev.addEventListener('click', function () { show(lbIndex - 1); });
        lbNext.addEventListener('click', function () { show(lbIndex + 1); });
        // Klick auf den freien Bereich neben dem Foto schließt
        lbStage.addEventListener('click', function (e) {
            if (e.target === lbStage || e.target === lbFigure) closeGallery();
        });

        // Wischen auf Touch-Geräten
        var tx = null, ty = 0, tt = 0;
        lbStage.addEventListener('touchstart', function (e) {
            if (e.touches.length !== 1) { tx = null; return; }
            tx = e.touches[0].clientX; ty = e.touches[0].clientY; tt = Date.now();
        }, { passive: true });
        lbStage.addEventListener('touchend', function (e) {
            if (tx == null || !lbRoom || lbRoom.photos.length < 2) return;
            var t = e.changedTouches[0];
            var dx = t.clientX - tx, dy = t.clientY - ty;
            tx = null;
            if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3 && Date.now() - tt < 800) {
                show(lbIndex + (dx < 0 ? 1 : -1));
            }
        }, { passive: true });
    }

    load();
})();
