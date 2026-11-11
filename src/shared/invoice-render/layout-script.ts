/**
 * Inline-Skript des Rechnungs-HTML (läuft im Vorschau-iframe UND im versteckten PDF-Fenster).
 *
 * Ablauf:
 * 1. Wartet auf die eingebetteten Schriften (`document.fonts.load` + `fonts.ready`) und das Logo
 *    (höchstens 3 s, danach geht es trotzdem weiter).
 * 2. Verteilt den Inhalt (`.flow`) auf A4-Seiten: Was nicht über die Fußzeile passt, kommt auf eine neue Seite.
 *    Die Positionstabelle bricht zeilenweise um (Kopfzeile wird wiederholt, die letzte Position bleibt beim
 *    Summenblock), Textblöcke (`.fb-split`) absatzweise. Die Fußzeile steht auf jeder Seite, ab 2 Seiten
 *    zusätzlich „Seite x von y“.
 * 3. Setzt `window.__FESTBUERO_RENDER_DONE__ = true` (und `__FESTBUERO_PAGES__`) und meldet der Vorschau
 *    `{ type: 'festbuero:rendered', height, pages, renderId }` per `parent.postMessage`
 *    (`renderId` = Attribut `data-render-id` am <html>, setzt die Vorschau zur Zuordnung; sonst null).
 *
 * DOM-Code steht bewusst nur als Zeichenkette hier (src/shared ist plattformneutral).
 */

export interface LayoutScriptOptions {
  /** CSS-Familienname der Schrift, z. B. `"FB Arimo"` */
  fontFamily: string
  /** Mindestabstand zwischen Inhalt und Fußzeile in mm */
  footerGapMm: number
}

export function buildLayoutScript(opts: LayoutScriptOptions): string {
  // JSON.stringify + Escapen von "<" verhindert, dass "</script" im Skript landen kann.
  const family = JSON.stringify(opts.fontFamily).replace(/</g, '\\u003c')
  const gap = Number.isFinite(opts.footerGapMm) ? opts.footerGapMm : 5
  return `(function () {
  'use strict';
  var MM = 96 / 25.4;
  var FAMILY = ${family};
  var FOOTER_GAP = ${gap} * MM;
  var finished = false;

  function toArray(list) { return Array.prototype.slice.call(list); }
  function bottom(el) { return el.getBoundingClientRect().bottom; }

  function finish(pages) {
    if (finished) return;
    finished = true;
    var doc = document.getElementById('fb-doc');
    var height = doc ? Math.ceil(doc.getBoundingClientRect().bottom + (window.scrollY || 0)) : document.documentElement.scrollHeight;
    window.__FESTBUERO_RENDER_DONE__ = true;
    window.__FESTBUERO_PAGES__ = pages;
    document.documentElement.setAttribute('data-render-done', 'true');
    var renderId = document.documentElement.getAttribute('data-render-id');
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'festbuero:rendered', height: height, pages: pages, renderId: renderId }, '*');
      }
    } catch (e) {}
  }

  function waitForAssets() {
    var tasks = [];
    if (document.fonts && document.fonts.load) {
      ['400 12px ', '700 12px ', 'italic 400 12px ', 'italic 700 12px '].forEach(function (spec) {
        tasks.push(document.fonts.load(spec + FAMILY).catch(function () {}));
      });
    }
    toArray(document.images).forEach(function (img) {
      if (img.decode) tasks.push(img.decode().catch(function () {}));
    });
    return Promise.all(tasks).then(function () {
      return document.fonts && document.fonts.ready ? document.fonts.ready : null;
    });
  }

  function contentLimit(page) {
    var footer = page.querySelector('.page-footer');
    var rect = page.getBoundingClientRect();
    var ref = footer && footer.offsetHeight > 0 ? footer.getBoundingClientRect().top : rect.bottom - 20 * MM;
    return ref - FOOTER_GAP + 0.5;
  }

  function createPage(after, first) {
    var page = document.createElement('section');
    page.className = 'page page-cont';
    var flow = document.createElement('div');
    flow.className = 'flow';
    page.appendChild(flow);
    var footer = first.querySelector('.page-footer');
    if (footer) page.appendChild(footer.cloneNode(true));
    var num = first.querySelector('.page-number');
    if (num) page.appendChild(num.cloneNode(true));
    after.parentNode.insertBefore(page, after.nextSibling);
    return page;
  }

  function splitTable(table, limit, isFirst) {
    var body = table.querySelector('tbody.items-body');
    var totals = table.querySelector('tbody.totals');
    var rows = body ? toArray(body.rows) : [];
    var k = -1;
    for (var i = 0; i < rows.length; i++) {
      if (bottom(rows[i]) > limit) { k = i; break; }
    }
    if (k < 0) {
      // Positionen passen, der Summenblock nicht: letzte Position zusammen mit dem Summenblock umbrechen
      if (!totals) return isFirst ? null : table;
      k = rows.length - 1;
    }
    if (k <= 0) return isFirst ? null : table;
    var clone = table.cloneNode(false);
    clone.classList.add('fb-cont');
    var colgroup = table.querySelector('colgroup');
    if (colgroup) clone.appendChild(colgroup.cloneNode(true));
    if (table.tHead) clone.appendChild(table.tHead.cloneNode(true));
    var newBody = body.cloneNode(false);
    clone.appendChild(newBody);
    for (var j = k; j < rows.length; j++) newBody.appendChild(rows[j]);
    if (totals) clone.appendChild(totals);
    return clone;
  }

  function splitChildren(el, limit, isFirst) {
    var children = toArray(el.children);
    var j = -1;
    for (var i = 0; i < children.length; i++) {
      if (bottom(children[i]) > limit) { j = i; break; }
    }
    if (j < 0) return isFirst ? null : el;
    var part;
    if (j === 0) {
      if (!isFirst) return el;
      part = split(children[0], limit, true);
      if (!part) return null;
    } else {
      part = split(children[j], limit, false);
    }
    var clone = el.cloneNode(false);
    clone.classList.add('fb-cont');
    if (part) clone.appendChild(part);
    for (var t = j + 1; t < children.length; t++) clone.appendChild(children[t]);
    return clone;
  }

  function split(el, limit, isFirst) {
    if (el.matches && el.matches('table.items')) return splitTable(el, limit, isFirst);
    if (el.classList && el.classList.contains('fb-split')) return splitChildren(el, limit, isFirst);
    return isFirst ? null : el;
  }

  function paginate() {
    var doc = document.getElementById('fb-doc');
    var first = doc && doc.querySelector('.page');
    if (!first) return 1;
    var page = first;
    for (var guard = 0; guard < 500; guard++) {
      var flow = page.querySelector('.flow');
      if (!flow) break;
      var limit = contentLimit(page);
      var kids = toArray(flow.children);
      var idx = -1;
      for (var i = 0; i < kids.length; i++) {
        if (bottom(kids[i]) > limit) { idx = i; break; }
      }
      if (idx < 0) break;
      var next = createPage(page, first);
      var nextFlow = next.querySelector('.flow');
      var moved = false;
      var part = split(kids[idx], limit, idx === 0);
      if (part) { nextFlow.appendChild(part); moved = true; }
      for (var j = idx + 1; j < kids.length; j++) { nextFlow.appendChild(kids[j]); moved = true; }
      if (!moved) { next.parentNode.removeChild(next); break; }
      page = next;
    }
    var pages = doc.querySelectorAll('.page');
    if (pages.length > 1) {
      for (var p = 0; p < pages.length; p++) {
        var num = pages[p].querySelector('.page-number');
        if (num) num.textContent = 'Seite ' + (p + 1) + ' von ' + pages.length;
      }
    }
    return pages.length;
  }

  function run() {
    var pages = 1;
    try { pages = paginate(); } catch (e) { try { console.error('Seitenumbruch fehlgeschlagen', e); } catch (e2) {} }
    finish(pages);
  }

  var timeout = new Promise(function (resolve) { setTimeout(resolve, 3000); });
  Promise.race([waitForAssets(), timeout]).then(run, run);
})();`
}
