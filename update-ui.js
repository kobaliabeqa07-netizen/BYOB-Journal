// ══════════════════════════════════════════════════════════════
// BYOB Journal — Update popup
// ══════════════════════════════════════════════════════════════
(function () {
    'use strict';
    if (!window.byobUpdater) return;

    var style = document.createElement('style');
    style.textContent = [
        '.upd-box{position:fixed;right:20px;bottom:20px;z-index:200;width:340px;max-width:calc(100vw - 40px);',
        'background:var(--bg-card,#11141c);border:1px solid rgba(99,102,241,.45);border-radius:14px;padding:18px;',
        'box-shadow:0 20px 50px rgba(0,0,0,.55);color:#cbd5e1;font-family:Inter,"Segoe UI",system-ui,sans-serif;}',
        '.upd-box[hidden],.upd-box [hidden]{display:none!important;}',
        '.upd-title{margin:0 0 6px;font-size:15px;font-weight:700;color:#fff;}',
        '.upd-text{margin:0;font-size:13px;line-height:1.5;white-space:pre-line;max-height:140px;overflow-y:auto;}',
        '.upd-bar{height:6px;margin-top:14px;background:#1e293b;border-radius:99px;overflow:hidden;}',
        '.upd-fill{height:100%;width:0;background:#6366f1;transition:width .25s ease;}',
        '.upd-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px;}',
        '.upd-btn{border:0;border-radius:8px;padding:8px 14px;font:600 13px Inter,"Segoe UI",system-ui,sans-serif;cursor:pointer;}',
        '.upd-primary{background:#6366f1;color:#fff;}.upd-primary:hover{background:#4f46e5;}',
        '.upd-ghost{background:transparent;color:#94a3b8;}.upd-ghost:hover{color:#fff;}'
    ].join('');
    document.head.appendChild(style);

    var box = document.createElement('div');
    box.className = 'upd-box';
    box.setAttribute('role', 'dialog');
    box.hidden = true;
    box.innerHTML =
        '<p class="upd-title"></p><p class="upd-text"></p>' +
        '<div class="upd-bar" hidden><div class="upd-fill"></div></div>' +
        '<div class="upd-actions">' +
        '<button type="button" class="upd-btn upd-ghost">მოგვიანებით</button>' +
        '<button type="button" class="upd-btn upd-primary"></button></div>';
    document.body.appendChild(box);

    var title = box.querySelector('.upd-title');
    var text = box.querySelector('.upd-text');
    var bar = box.querySelector('.upd-bar');
    var fill = box.querySelector('.upd-fill');
    var later = box.querySelector('.upd-ghost');
    var main = box.querySelector('.upd-primary');
    var action = null;

    later.addEventListener('click', function () { box.hidden = true; });
    main.addEventListener('click', function () { if (action) action(); });

    // Release notes arrive as HTML — show them as plain text only
    function plainText(html) {
        if (typeof html !== 'string') return '';
        var withBreaks = html.replace(/<\/(p|li|h[1-6])>|<br\s*\/?>/gi, '$&\n');
        var doc = new DOMParser().parseFromString(withBreaks, 'text/html');
        return doc.body.textContent.replace(/\n\s*\n+/g, '\n').trim();
    }

    function show(options) {
        title.textContent = options.title;
        text.textContent = options.text;
        bar.hidden = !options.progress;
        main.hidden = !options.button;
        main.textContent = options.button || '';
        later.hidden = !options.later;
        action = options.action || null;
        box.hidden = false;
    }

    function startDownload() {
        fill.style.width = '0%';
        show({ title: 'ჩამოტვირთვა…', text: '0%', progress: true });
        window.byobUpdater.download();
    }

    window.byobUpdater.onStatus(function (status) {
        if (status.state === 'available') {
            show({
                title: 'ხელმისაწვდომია ახალი ვერსია ' + status.version,
                text: plainText(status.notes) || 'განაახლე აპი ახალი ცვლილებების მისაღებად.',
                button: 'განახლება', later: true, action: startDownload
            });
        } else if (status.state === 'downloading') {
            fill.style.width = status.percent + '%';
            show({ title: 'ჩამოტვირთვა…', text: status.percent + '%', progress: true });
        } else if (status.state === 'downloaded') {
            show({
                title: 'განახლება მზადაა',
                text: 'აპი დაიხურება, განახლდება და თავიდან გაიხსნება.',
                button: 'გადატვირთვა', later: true,
                action: function () { window.byobUpdater.install(); }
            });
        } else if (status.state === 'error') {
            show({
                title: 'განახლება ვერ ჩამოიტვირთა',
                text: 'შეამოწმე ინტერნეტი და სცადე თავიდან.',
                button: 'თავიდან ცდა', later: true, action: startDownload
            });
        }
    });

    window.byobUpdater.check();
})();
