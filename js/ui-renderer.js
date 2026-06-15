// ============================================================
// ui-renderer.js — рендер таблицы и обновление итогов
// ============================================================

const UI = (() => {

  function fmt(n) {
    return Number(n || 0).toLocaleString('ru-RU');
  }

  // ── Бейдж машины ─────────────────────────────────────
  function machineBadge(machine) {
    // находим номер по label
    const num = Object.keys(CFG.LABELS).find(k => CFG.LABELS[k] === machine) || '';
    const mt  = Parser.machineType(num);
    const cls = mt === 'mini' ? 'badge-mini'
              : mt === 'evak' ? 'badge-evak'
              : mt === 'dump' ? 'badge-dump' : '';
    return `<span class="badge ${cls}">${machine || '—'}</span>`;
  }

  // ── Рендер одной строки ───────────────────────────────
  function rowHTML(r) {
    const profile = App.getProfile ? App.getProfile() : {};
    const payValue = Calculator.resolveRowPay(r, profile);
    const payDisplay = payValue !== null && payValue !== undefined ? fmt(payValue) : (r.pay !== '' ? fmt(r.pay) : '—');
    return `<tr data-id="${r.id}">
      <td class="c-date">${r.date}</td>
      <td class="c-machine">${machineBadge(r.machine)}</td>
      <td class="c-type">${r.workType || '—'}</td>
      <td class="c-addr" title="${(r.address||'').replace(/"/g,"'")}">${r.address || '—'}</td>
      <td class="c-cargo">${r.cargo  || '—'}</td>
      <td class="c-client">${r.client || '—'}</td>
      <td class="c-order">${r.orderSum !== '' && r.orderSum ? fmt(r.orderSum)+' ₽' : '—'}</td>
      <td class="c-num"><input type="number" value="${r.hours}" placeholder="—"
        onchange="App.updRow(${r.id},'hours',this.value)" inputmode="decimal"></td>
      <td class="c-num"><input type="number" value="${r.trips}" placeholder="—"
        onchange="App.updRow(${r.id},'trips',this.value)" inputmode="decimal"></td>
      <td class="c-pay"><input type="number" value="${payDisplay}" placeholder="—"
        oninput="App.updRow(${r.id},'pay',this.value)" inputmode="decimal"></td>
      <td class="c-del"><button onclick="App.delRow(${r.id})">✕</button></td>
    </tr>`;
  }

  // ── Рендер таблицы ────────────────────────────────────
  function renderTable(rows) {
    const tbody = document.getElementById('tbody');
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="11">
        <div class="empty-state">Нет записей — вставь сообщения из чата</div>
      </td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(rowHTML).join('');
  }

  // ── Обновить итоги ────────────────────────────────────
  function renderTotals(rows, settings) {
    const profile = App.getProfile ? App.getProfile() : {};
    const { totalH, totalT, totalP } = Calculator.calcTotals(rows, profile);
    const { base, rest, hint }       = Calculator.calcPayout({
      totalP,
      oklad:    settings.oklad,
      official: settings.official,
      advance:  settings.advance,
      fuel:     settings.fuel,
    });

    document.getElementById('tot-h').textContent    = totalH || 0;
    document.getElementById('tot-t').textContent    = totalT || 0;
    document.getElementById('tot-p').textContent    = fmt(totalP) + ' ₽';
    document.getElementById('tot-baza').textContent = fmt(base)   + ' ₽';
    document.getElementById('baza-hint').textContent = hint;

    const restEl = document.getElementById('tot-rest');
    restEl.textContent = fmt(rest) + ' ₽';
    restEl.style.color = rest >= 0 ? '#2ecc71' : '#e74c3c';
  }

  // ── Обновить шапку (PDF заголовок) ───────────────────
  function renderHeader(name, period) {
    const title = document.getElementById('pdf-title');
    const sub   = document.getElementById('pdf-sub');
    if (title) title.textContent = 'Табель' + (name ? ': ' + name : '');
    if (sub)   sub.textContent   = period ? 'Период: ' + period : '';
    document.title = 'Табель' + (name ? ' — ' + name : '');
  }

  return { renderTable, renderTotals, renderHeader, fmt };

})();
