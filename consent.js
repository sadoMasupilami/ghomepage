/*
 * Cookie-Consent (Opt-in) für die Gothia-Website.
 *
 * Zwei getrennte Einwilligungen (DSGVO: je Zweck einzeln):
 *   • stats — Statistik (Google Analytics)
 *   • media — externe Medien (Google Maps, Spotify)
 * Beides ist standardmäßig AUS. Ohne Einwilligung wird nichts von Google oder Spotify geladen.
 *
 * Speicherung lokal im Browser (localStorage, Schlüssel „gothia-consent“):
 *   'granted' = alles erlaubt · 'denied' = nur notwendige · sonst JSON {"stats":bool,"media":bool}
 * Erneut öffnen/Widerruf: window.gothiaCookieSettings()  (z. B. Footer-Link)
 * Andere Skripte erfahren die Auswahl über das Event „gothia-consent“
 *   (detail: { stats: bool, media: bool } oder null, solange noch nichts gewählt wurde)
 * und jederzeit über window.gothiaConsentState.
 */
(function () {
    'use strict';

    var GA_ID = 'G-TDHNXVECH4';
    var KEY = 'gothia-consent';
    var gaLoaded = false;
    var banner = null;
    var lastFocus = null;
    var current = null;     // aktuelle Auswahl {stats, media} oder null

    /* ── Google Analytics laden (nur nach Zustimmung) ── */
    function loadGA() {
        window['ga-disable-' + GA_ID] = false;
        if (gaLoaded) { if (window.gtag) window.gtag('config', GA_ID); return; }
        gaLoaded = true;
        var s = document.createElement('script');
        s.async = true;
        s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
        document.head.appendChild(s);
        window.dataLayer = window.dataLayer || [];
        window.gtag = function () { window.dataLayer.push(arguments); };
        window.gtag('js', new Date());
        window.gtag('config', GA_ID);
    }

    /* Widerruf: GA-Cookies dieser Domain löschen */
    function clearGACookies() {
        var host = location.hostname.replace(/^www\./, '');
        document.cookie.split(';').forEach(function (c) {
            var name = c.split('=')[0].trim();
            if (/^_ga/.test(name) || name === '_gid' || name === '_gat') {
                ['', '; domain=' + host, '; domain=.' + host].forEach(function (d) {
                    document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + d;
                });
            }
        });
        window['ga-disable-' + GA_ID] = true;
    }

    /* ── Auswahl lesen / speichern ── */
    function readChoice() {
        var raw = null;
        try { raw = localStorage.getItem(KEY); } catch (e) { return null; }
        if (raw === 'granted') return { stats: true, media: true };
        if (raw === 'denied') return { stats: false, media: false };
        if (!raw) return null;
        try {
            var o = JSON.parse(raw);
            if (o && typeof o === 'object') return { stats: !!o.stats, media: !!o.media };
        } catch (e) { /* unlesbar → wie „noch nicht entschieden“ */ }
        return null;
    }
    function saveChoice(c) {
        var v = c.stats && c.media ? 'granted' : (!c.stats && !c.media ? 'denied' : JSON.stringify(c));
        try { localStorage.setItem(KEY, v); } catch (e) { /* privater Modus o. Ä. */ }
    }

    /* ── Banner-Styles (einmalig einfügen) ── */
    function injectStyles() {
        if (document.getElementById('gothia-cc-style')) return;
        var css =
            '.gothia-cc{position:fixed;left:1rem;right:1rem;bottom:1rem;z-index:2147483000;max-width:660px;margin:0 auto;' +
            'max-height:calc(100vh - 1.5rem);max-height:calc(100dvh - 1.5rem);overflow-y:auto;overscroll-behavior:contain;' +
            'background:#0f2619;color:#fff;border-radius:20px;border:1px solid rgba(230,207,145,.22);' +
            'box-shadow:0 30px 80px rgba(0,0,0,.35);padding:1.4rem 1.5rem 1.3rem;' +
            "font-family:'Manrope',system-ui,-apple-system,'Segoe UI',sans-serif;" +
            'visibility:hidden;transform:translateY(calc(100% + 2rem));opacity:0;' +
            'transition:transform .55s cubic-bezier(.22,1,.36,1),opacity .55s,visibility 0s linear .55s;}' +
            '.gothia-cc::before{content:"";position:absolute;left:0;right:0;top:0;height:4px;' +
            'background:linear-gradient(180deg,#c9a24c 0 18%,#0e6b45 18% 50%,#fff 50% 82%,#c9a24c 82% 100%);}' +
            '.gothia-cc.show{visibility:visible;transform:none;opacity:1;transition-delay:0s;}' +
            '.gothia-cc h2{margin:0 0 .4rem;font-family:"Newsreader",Georgia,serif;font-weight:450;font-size:1.35rem;line-height:1.2;color:#fff;}' +
            '.gothia-cc p{font-size:.88rem;line-height:1.6;margin:0 0 1rem;color:rgba(255,255,255,.8);}' +
            '.gothia-cc b{color:#fff;font-weight:700;}' +
            '.gothia-cc a{color:#e6cf91;text-decoration:underline;text-underline-offset:2px;}' +
            '.gothia-cc fieldset{border:0;margin:0 0 1.1rem;padding:0;display:grid;gap:.5rem;}' +
            '.gothia-cc legend{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;}' +
            '.gothia-cc label{display:flex;gap:.75rem;align-items:flex-start;padding:.7rem .85rem;border-radius:12px;cursor:pointer;' +
            'background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);font-size:.86rem;line-height:1.45;color:rgba(255,255,255,.78);}' +
            '.gothia-cc label:hover{border-color:rgba(230,207,145,.45);}' +
            '.gothia-cc label strong{display:block;color:#fff;font-size:.92rem;}' +
            '.gothia-cc input[type=checkbox]{flex:none;width:20px;height:20px;margin:.1rem 0 0;accent-color:#c9a24c;cursor:pointer;}' +
            '.gothia-cc .btns{display:flex;gap:.6rem;flex-wrap:wrap;}' +
            '.gothia-cc button{flex:1 1 auto;min-width:150px;min-height:46px;cursor:pointer;border-radius:999px;' +
            'padding:.7rem 1.1rem;font-weight:700;font-size:.9rem;font-family:inherit;line-height:1.2;transition:background-color .25s,border-color .25s,transform .25s;}' +
            '.gothia-cc :focus-visible{outline:2px solid #e6cf91;outline-offset:3px;}' +
            '.gothia-cc .accept{background:#c9a24c;color:#0a1b12;border:1.5px solid #c9a24c;}' +
            '.gothia-cc .accept:hover{background:#e6cf91;border-color:#e6cf91;transform:translateY(-1px);}' +
            '.gothia-cc .reject,.gothia-cc .save{background:transparent;color:#fff;border:1.5px solid rgba(255,255,255,.4);}' +
            '.gothia-cc .reject:hover,.gothia-cc .save:hover{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.75);}' +
            '@media(max-width:520px){.gothia-cc{left:.75rem;right:.75rem;bottom:.75rem;padding:1.25rem 1.15rem 1.1rem}' +
            '.gothia-cc button{flex-basis:100%;}}' +
            '@media(max-height:500px){.gothia-cc{padding:1rem 1.1rem}.gothia-cc button{min-width:0;flex-basis:auto;}}' +
            '@media(prefers-reduced-motion:reduce){.gothia-cc{transition:none}}';
        var st = document.createElement('style');
        st.id = 'gothia-cc-style';
        st.textContent = css;
        document.head.appendChild(st);
    }

    function buildBanner() {
        var el = document.createElement('section');
        el.className = 'gothia-cc';
        el.setAttribute('aria-labelledby', 'gothia-cc-title');
        el.innerHTML =
            '<h2 id="gothia-cc-title">Cookies &amp; eingebettete Inhalte</h2>' +
            '<p>Wir möchten <b>Google Analytics</b> (Statistik) nutzen und Inhalte von <b>Google Maps</b> und ' +
            '<b>Spotify</b> einbinden — beides nur mit deiner Zustimmung. Ohne Zustimmung kannst du Karte und ' +
            'Spotify-Player später auch einzeln per Klick laden. Mehr in der ' +
            '<a href="/datenschutz.html">Datenschutzerklärung</a>.</p>' +
            '<fieldset><legend>Einwilligungen</legend>' +
            '<label><input type="checkbox" name="stats"><span><strong>Statistik</strong>' +
            'Google Analytics hilft uns zu verstehen, welche Seiten gelesen werden.</span></label>' +
            '<label><input type="checkbox" name="media"><span><strong>Externe Medien</strong>' +
            'Google-Maps-Karte und Spotify-Player werden automatisch geladen.</span></label>' +
            '</fieldset>' +
            '<div class="btns">' +
            '<button type="button" class="reject">Nur notwendige</button>' +
            '<button type="button" class="save">Auswahl speichern</button>' +
            '<button type="button" class="accept">Alle akzeptieren</button>' +
            '</div>';
        el.querySelector('.accept').addEventListener('click', function () { decide({ stats: true, media: true }); });
        el.querySelector('.reject').addEventListener('click', function () { decide({ stats: false, media: false }); });
        el.querySelector('.save').addEventListener('click', function () {
            decide({ stats: el.querySelector('[name=stats]').checked, media: el.querySelector('[name=media]').checked });
        });
        el.addEventListener('keydown', function (e) { if (e.key === 'Escape' && readChoice()) hideBanner(); });
        return el;
    }

    function showBanner(focus) {
        injectStyles();
        if (!banner) {
            banner = buildBanner();
            // Direkt nach dem „Zum Inhalt“-Link einfügen: so ist der Hinweis der erste Tab-Stopp
            var skip = document.querySelector('.skip-link');
            if (skip && skip.parentNode === document.body) document.body.insertBefore(banner, skip.nextSibling);
            else document.body.insertBefore(banner, document.body.firstChild);
        }
        var c = readChoice() || { stats: false, media: false };
        banner.querySelector('[name=stats]').checked = c.stats;
        banner.querySelector('[name=media]').checked = c.media;
        void banner.offsetWidth;   // Reflow erzwingen, dann einblenden
        banner.classList.add('show');
        // Fokussierte Elemente nicht hinter dem Hinweis verstecken
        requestAnimationFrame(function () {
            if (banner && banner.classList.contains('show')) {
                document.documentElement.style.scrollPaddingBottom = (banner.offsetHeight + 24) + 'px';
            }
        });
        if (focus) {
            lastFocus = document.activeElement;
            setTimeout(function () { var b = banner.querySelector('.accept'); if (b) b.focus(); }, 80);
        }
    }
    function hideBanner() {
        if (!banner) return;
        var hadFocus = banner.contains(document.activeElement);
        banner.classList.remove('show');
        document.documentElement.style.scrollPaddingBottom = '';
        if (hadFocus) {
            var target = lastFocus && document.contains(lastFocus) && lastFocus !== document.body ? lastFocus : document.getElementById('inhalt');
            if (target) {
                if (target.id === 'inhalt' && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
                target.focus({ preventScroll: true });
            }
        }
        lastFocus = null;
    }

    /* Andere Skripte (z. B. Maps/Spotify auf der Startseite) über die Auswahl informieren */
    function notify(choice) {
        current = choice;
        window.gothiaConsentState = choice;
        window.gothiaConsent = !choice ? null : (choice.stats && choice.media ? 'granted' : (!choice.stats && !choice.media ? 'denied' : 'partial'));
        try { document.dispatchEvent(new CustomEvent('gothia-consent', { detail: choice })); } catch (e) { /* alter Browser */ }
    }

    function decide(c) {
        var before = readChoice();
        saveChoice(c);
        hideBanner();
        // Widerruf einer früheren Einwilligung: bereits geladene Dienste (GA-Skript, Karte, Player)
        // lassen sich nur durch Neuladen der Seite sicher stoppen.
        var revoked = before && ((before.stats && !c.stats) || (before.media && !c.media));
        if (before && before.stats && !c.stats) clearGACookies();
        if (revoked && (gaLoaded || document.querySelector('[data-embed] iframe'))) { location.reload(); return; }
        if (c.stats) loadGA();
        notify(c);
    }

    /* Öffentlich: Banner erneut öffnen (Auswahl ändern / Einwilligung widerrufen) */
    window.gothiaCookieSettings = function () {
        if (document.body) showBanner(true);
        else document.addEventListener('DOMContentLoaded', function () { showBanner(true); });
    };

    function init() {
        var c = readChoice();
        if (c && c.stats) loadGA();
        if (!c) showBanner(false);   // nur zeigen, wenn noch nicht entschieden
        notify(c);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
