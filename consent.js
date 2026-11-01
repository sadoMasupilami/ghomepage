/*
 * Cookie-Consent (Opt-in) für die Gothia-Website.
 * Google Analytics wird AUSSCHLIESSLICH nach aktiver Zustimmung geladen.
 * Auswahl wird lokal im Browser (localStorage) gespeichert.
 * Erneut öffnen/Widerruf: window.gothiaCookieSettings()  (z. B. Footer-Link)
 * Andere Skripte werden über das Event „gothia-consent“ (detail: 'granted' | 'denied' | null) informiert.
 */
(function () {
    'use strict';

    var GA_ID = 'G-TDHNXVECH4';
    var KEY = 'gothia-consent';           // Werte: 'granted' | 'denied'
    var gaLoaded = false;
    var banner = null;
    var lastFocus = null;

    /* ── Google Analytics laden (nur nach Zustimmung) ── */
    function loadGA() {
        if (gaLoaded) return;
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

    /* Widerruf: GA-Cookies dieser Domain löschen (Skript bleibt bis zum Neuladen im Speicher) */
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

    function readChoice() {
        try { return localStorage.getItem(KEY); } catch (e) { return null; }
    }
    function saveChoice(v) {
        try { localStorage.setItem(KEY, v); } catch (e) { /* privater Modus o. Ä. */ }
    }

    /* ── Banner-Styles (einmalig einfügen) ── */
    function injectStyles() {
        if (document.getElementById('gothia-cc-style')) return;
        var css =
            '.gothia-cc{position:fixed;left:1rem;right:1rem;bottom:1rem;z-index:2147483000;max-width:640px;margin:0 auto;' +
            'background:#0f2619;color:#fff;border-radius:20px;border:1px solid rgba(230,207,145,.22);' +
            'box-shadow:0 30px 80px rgba(0,0,0,.35);padding:1.4rem 1.5rem 1.3rem;overflow:hidden;' +
            "font-family:'Manrope',system-ui,-apple-system,'Segoe UI',sans-serif;" +
            'transform:translateY(calc(100% + 2rem));opacity:0;transition:transform .55s cubic-bezier(.22,1,.36,1),opacity .55s;}' +
            '.gothia-cc::before{content:"";position:absolute;left:0;right:0;top:0;height:4px;' +
            'background:linear-gradient(180deg,#c9a24c 0 18%,#0e6b45 18% 50%,#fff 50% 82%,#c9a24c 82% 100%);}' +
            '.gothia-cc.show{transform:none;opacity:1;}' +
            '.gothia-cc h2{margin:0 0 .4rem;font-family:"Newsreader",Georgia,serif;font-weight:450;font-size:1.35rem;line-height:1.2;color:#fff;}' +
            '.gothia-cc p{font-size:.88rem;line-height:1.6;margin:0 0 1.1rem;color:rgba(255,255,255,.78);}' +
            '.gothia-cc b{color:#fff;font-weight:700;}' +
            '.gothia-cc a{color:#e6cf91;text-decoration:underline;text-underline-offset:2px;}' +
            '.gothia-cc .btns{display:flex;gap:.6rem;flex-wrap:wrap;}' +
            '.gothia-cc button{flex:1 1 auto;min-width:160px;min-height:46px;cursor:pointer;border-radius:999px;' +
            'padding:.7rem 1.2rem;font-weight:700;font-size:.92rem;font-family:inherit;transition:background-color .25s,border-color .25s,transform .25s;}' +
            '.gothia-cc button:focus-visible{outline:2px solid #e6cf91;outline-offset:3px;}' +
            '.gothia-cc .accept{background:#c9a24c;color:#0a1b12;border:1.5px solid #c9a24c;}' +
            '.gothia-cc .accept:hover{background:#e6cf91;border-color:#e6cf91;transform:translateY(-1px);}' +
            '.gothia-cc .reject{background:transparent;color:#fff;border:1.5px solid rgba(255,255,255,.35);}' +
            '.gothia-cc .reject:hover{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.7);}' +
            '@media(max-width:520px){.gothia-cc{left:.75rem;right:.75rem;bottom:.75rem;padding:1.25rem 1.15rem 1.1rem}.gothia-cc button{flex-basis:100%;}}' +
            '@media(prefers-reduced-motion:reduce){.gothia-cc{transition:none}}';
        var st = document.createElement('style');
        st.id = 'gothia-cc-style';
        st.textContent = css;
        document.head.appendChild(st);
    }

    function buildBanner() {
        var el = document.createElement('div');
        el.className = 'gothia-cc';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'false');
        el.setAttribute('aria-labelledby', 'gothia-cc-title');
        el.innerHTML =
            '<h2 id="gothia-cc-title">Cookies &amp; eingebettete Inhalte</h2>' +
            '<p>Wir nutzen <b>Google Analytics</b> (Statistik) sowie eingebettete Inhalte von ' +
            '<b>Google Maps</b> und <b>Spotify</b> — nur mit deiner Zustimmung. Mit „Akzeptieren“ ' +
            'werden diese geladen; andernfalls kannst du sie später einzeln per Klick laden. ' +
            'Mehr in der <a href="datenschutz.html">Datenschutzerklärung</a>.</p>' +
            '<div class="btns">' +
            '<button type="button" class="reject">Nur notwendige</button>' +
            '<button type="button" class="accept">Akzeptieren</button>' +
            '</div>';
        el.querySelector('.accept').addEventListener('click', accept);
        el.querySelector('.reject').addEventListener('click', reject);
        el.addEventListener('keydown', function (e) { if (e.key === 'Escape' && readChoice()) hideBanner(); });
        return el;
    }

    function showBanner(focus) {
        injectStyles();
        if (!banner) {
            banner = buildBanner();
            document.body.appendChild(banner);
        }
        void banner.offsetWidth;   // Reflow erzwingen, dann einblenden
        banner.classList.add('show');
        if (focus) {
            lastFocus = document.activeElement;
            setTimeout(function () { var b = banner.querySelector('.accept'); if (b) b.focus(); }, 80);
        }
    }
    function hideBanner() {
        if (!banner) return;
        banner.classList.remove('show');
        if (lastFocus && lastFocus.focus) { lastFocus.focus(); lastFocus = null; }
    }

    /* Andere Skripte (z. B. Maps/Spotify auf der Startseite) über die Auswahl informieren */
    function notify(choice) {
        window.gothiaConsent = choice;
        try { document.dispatchEvent(new CustomEvent('gothia-consent', { detail: choice })); } catch (e) { /* alter Browser */ }
    }

    function accept() { saveChoice('granted'); hideBanner(); loadGA(); notify('granted'); }
    function reject() {
        var before = readChoice();
        saveChoice('denied');
        hideBanner();
        if (before === 'granted') clearGACookies();
        notify('denied');
    }

    /* Öffentlich: Banner erneut öffnen (Auswahl ändern / Einwilligung widerrufen) */
    window.gothiaCookieSettings = function () {
        if (document.body) showBanner(true);
        else document.addEventListener('DOMContentLoaded', function () { showBanner(true); });
    };

    function init() {
        var c = readChoice();
        if (c === 'granted') loadGA();
        else if (c !== 'denied') showBanner(false);   // nur zeigen, wenn noch nicht entschieden
        notify(c);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
