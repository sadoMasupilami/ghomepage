/*
 * Gothia — gemeinsame Seitenlogik (alle Seiten)
 * Navigation, mobiles Menü, Einblendungen, eingebettete Inhalte (nach Einwilligung),
 * Kontaktformular (mailto), Zimmer-Verfügbarkeit, „Nach oben“-Button.
 */
(function () {
    'use strict';

    var doc = document;
    var body = doc.body;
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ── Jahr im Copyright ── */
    doc.querySelectorAll('[data-year]').forEach(function (el) { el.textContent = new Date().getFullYear(); });

    /* ── Kopfzeile: transparent über dem dunklen Seitenkopf, danach hell ── */
    var header = doc.getElementById('siteHeader');
    var overlayMode = body.getAttribute('data-header') === 'overlay';
    var heroEl = doc.querySelector('.hero, .page-hero');
    var toTop = doc.getElementById('toTop');

    function onScroll() {
        var y = window.scrollY || window.pageYOffset;
        if (header) {
            if (overlayMode && heroEl) {
                var limit = Math.max(80, heroEl.offsetHeight - header.offsetHeight - 10);
                header.classList.toggle('is-over-hero', y < limit);
            }
            header.classList.toggle('is-scrolled', y > 10);
        }
        if (toTop) toTop.classList.toggle('is-visible', y > 700);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    onScroll();

    if (toTop) {
        toTop.addEventListener('click', function () {
            window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
        });
    }

    /* ── Mobiles Menü ── */
    var toggle = doc.getElementById('menuToggle');
    var mobileNav = doc.getElementById('mobileNav');
    var lastFocus = null;

    function setMenu(open) {
        if (!toggle || !mobileNav) return;
        body.classList.toggle('menu-open', open);
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggle.setAttribute('aria-label', open ? 'Menü schließen' : 'Menü öffnen');
        if (open) {
            lastFocus = doc.activeElement;
            var first = mobileNav.querySelector('a');
            if (first) setTimeout(function () { first.focus(); }, 60);
        } else if (lastFocus && lastFocus.focus) {
            lastFocus.focus();
        }
    }
    if (toggle && mobileNav) {
        toggle.addEventListener('click', function () { setMenu(!body.classList.contains('menu-open')); });
        mobileNav.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
        doc.addEventListener('keydown', function (e) {
            if (!body.classList.contains('menu-open')) return;
            if (e.key === 'Escape') { setMenu(false); return; }
            if (e.key === 'Tab') {     // Fokus im Menü halten (inkl. Schließen-Button)
                var items = [toggle].concat(Array.prototype.slice.call(mobileNav.querySelectorAll('a, button')));
                var i = items.indexOf(doc.activeElement);
                if (e.shiftKey && i <= 0) { e.preventDefault(); items[items.length - 1].focus(); }
                else if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); items[0].focus(); }
            }
        });
        window.addEventListener('resize', function () {
            if (window.innerWidth > 1080 && body.classList.contains('menu-open')) setMenu(false);
        });
    }

    /* ── Einblenden beim Scrollen ── */
    var reveals = doc.querySelectorAll('.reveal, .reveal-fade');
    if ('IntersectionObserver' in window && !reduceMotion) {
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-visible');
                    io.unobserve(entry.target);
                }
            });
        }, { rootMargin: '0px 0px -8% 0px', threshold: 0.01 });
        reveals.forEach(function (el) { io.observe(el); });
    } else {
        reveals.forEach(function (el) { el.classList.add('is-visible'); });
    }

    /* ── Aktiver Navigationspunkt ── */
    var navLinks = doc.querySelectorAll('.nav-links a[href^="#"]');
    if (navLinks.length && 'IntersectionObserver' in window) {
        var byId = {};
        navLinks.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
        var spy = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                navLinks.forEach(function (a) { a.classList.remove('is-active'); a.removeAttribute('aria-current'); });
                var link = byId[entry.target.id];
                if (link) { link.classList.add('is-active'); link.setAttribute('aria-current', 'true'); }
            });
        }, { rootMargin: '-45% 0px -50% 0px' });
        doc.querySelectorAll('main section[id]').forEach(function (s) { spy.observe(s); });
    }

    /* ── Eingebettete Inhalte (Spotify, Google Maps): erst nach Zustimmung oder Klick ── */
    function fillEmbed(gate) {
        var tpl = gate.querySelector('template');
        var ph = gate.querySelector('.embed-ph');
        if (!tpl || !ph) return;
        gate.appendChild(tpl.content.cloneNode(true));
        ph.remove();
        tpl.remove();
    }
    function loadAllEmbeds() { doc.querySelectorAll('[data-embed]').forEach(fillEmbed); }
    doc.querySelectorAll('[data-load-embed]').forEach(function (btn) {
        btn.addEventListener('click', function () { fillEmbed(btn.closest('[data-embed]')); });
    });
    try { if (localStorage.getItem('gothia-consent') === 'granted') loadAllEmbeds(); } catch (e) { /* ignorieren */ }
    doc.addEventListener('gothia-consent', function (e) { if (e.detail === 'granted') loadAllEmbeds(); });
    // Rückwärtskompatibel für alte Aufrufe loadEmbed('id')
    window.loadEmbed = function (id) { var g = doc.getElementById(id); if (g) fillEmbed(g); };

    /* ── Cookie-Einstellungen (Footer-Links) ── */
    doc.querySelectorAll('[data-cookie-settings]').forEach(function (el) {
        el.addEventListener('click', function (e) {
            e.preventDefault();
            if (typeof window.gothiaCookieSettings === 'function') window.gothiaCookieSettings();
        });
    });

    /* ── Kontaktformular → E-Mail-Programm ── */
    var form = doc.getElementById('contactForm');
    var interestSelect = doc.getElementById('cf-interesse');
    // Buttons mit data-interest wählen das passende Thema vor
    doc.querySelectorAll('[data-interest]').forEach(function (el) {
        el.addEventListener('click', function () {
            if (!interestSelect) return;
            var want = el.getAttribute('data-interest');
            Array.prototype.forEach.call(interestSelect.options, function (o) { if (o.text === want) interestSelect.value = o.value; });
        });
    });

    function showToast(text) {
        var toast = doc.getElementById('toast');
        if (!toast) return;
        if (text) toast.querySelector('span').textContent = text;
        toast.classList.add('is-visible');
        clearTimeout(showToast.t);
        showToast.t = setTimeout(function () { toast.classList.remove('is-visible'); }, 4500);
    }

    if (form) {
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var val = function (id) { var el = doc.getElementById(id); return el ? el.value.trim() : ''; };
            var name = [val('cf-vorname'), val('cf-nachname')].filter(Boolean).join(' ');
            var interesse = val('cf-interesse');
            var nachricht = val('cf-nachricht');
            var subject = 'Anfrage über die Website' + (interesse ? ' – ' + interesse : '');
            var lines = ['Name: ' + (name || '—'), 'Interesse: ' + (interesse || '—'), '', 'Nachricht:', nachricht || '—'];
            // Anfragen zum Wohnen gehen an die Heimleitung, alles Übrige an die Gothia
            var recipient = interesse === 'Wohnen im Gothenhaus'
                ? 'heimleitung@studentenheim-gothenhaus.at'
                : 'info@gothia-graz.at';
            window.location.href = 'mailto:' + recipient +
                '?subject=' + encodeURIComponent(subject) +
                '&body=' + encodeURIComponent(lines.join('\r\n'));
            showToast('E-Mail-Programm geöffnet — bitte nur noch abschicken.');
        });
    }

    /* ── Freie Zimmer (Startseite): Anzahl live aus zimmer.json ── */
    var avail = doc.getElementById('availability');
    if (avail && window.fetch) {
        fetch('zimmer.json', { cache: 'no-cache' })
            .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
            .then(function (data) {
                var rooms = Array.isArray(data) ? data : (data.zimmer || []);
                var free = rooms.filter(function (r) { return r.status === 'frei'; });
                var prices = free.map(function (r) { return r.price; }).filter(function (p) { return typeof p === 'number'; });
                var text;
                if (free.length) {
                    text = 'Aktuell ' + (free.length === 1 ? '1 Zimmer' : free.length + ' Zimmer') + ' frei' +
                        (prices.length ? ' · ab ' + Math.min.apply(null, prices) + ' € / Monat' : '');
                } else {
                    text = 'Derzeit alle Zimmer vergeben — frag gerne nach';
                    avail.classList.add('is-none');
                }
                avail.querySelector('[data-avail-text]').textContent = text;
                avail.hidden = false;
            })
            .catch(function () { /* Badge bleibt ausgeblendet */ });
    }
})();
