// ============================================================
// app.js — инициализация, состояние, роутинг
// ИСПРАВЛЕНИЯ: убраны requireEl на несуществующие элементы,
// слушатели не дублируются, init безопасный
// ============================================================

function getEl(id) {
  return document.getElementById(id);
}

const App = (() => {

  // ── Состояние ─────────────────────────────────────────
  let rows = [];
  let uid  = 1;
  let _initialized = false;

  let profile = {
    name: '',
    period: '',
    oklad: 0,
    activeMachines: [],
    rateMap: {},
  };

  const MACHINE_ORDER = ['4850','4930','3977','6547','7368','607','628','570','764','796','542','2054'];

  function getProfile() { return profile; }

  function setProfile(nextProfile) {
    profile = {
      name:           nextProfile.name           || '',
      period:         nextProfile.period         || '',
      oklad:          parseFloat(nextProfile.oklad) || 0,
      activeMachines: Array.isArray(nextProfile.activeMachines) ? nextProfile.activeMachines : [],
      rateMap:        nextProfile.rateMap        || {},
    };
  }

  // ── Статусная строка ──────────────────────────────────
  function setStatus(message, type = 'info') {
    const el = getEl('app-status');
    if (!el) return;
    if (!message) {
      el.textContent = '';
      el.className   = 'app-status';
      el.style.display = 'none';
      return;
    }
    el.className     = 'app-status is-visible is-' + type;
    el.textContent   = message;
    el.style.display = '';
  }

  // ── Настройки ─────────────────────────────────────────
  function getSettings() {
    return {
      name:     profile.name,
      period:   profile.period,
      oklad:    profile.oklad,
      official: parseFloat(getEl('official')?.value)  || 0,
      advance:  parseFloat(getEl('advance')?.value)   || 0,
      fuel:     parseFloat(getEl('fuel')?.value)      || 0,
    };
  }

  function saveSettings() {
    localStorage.setItem('tabel_cfg', JSON.stringify({
      name:           profile.name,
      period:         profile.period,
      oklad:          profile.oklad,
      activeMachines: profile.activeMachines,
      rateMap:        profile.rateMap,
    }));
  }

  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem('tabel_cfg') || '{}');
      if (s && typeof s === 'object') setProfile(s);
    } catch (e) {}
  }

  // ── Шапка приложения ──────────────────────────────────
  function renderProfilePreview() {
    const nameEl = getEl('driver-pill-name');
    const metaEl = getEl('driver-pill-meta');
    if (nameEl) nameEl.textContent = profile.name || 'Водитель';
    if (metaEl) {
      const n = profile.activeMachines.length;
      metaEl.textContent = (profile.period || 'Без периода') + ' · ' + n + ' техн.';
    }
  }

  // ── Рендер ───────────────────────────────────────────
  function render() {
    try {
      const s = getSettings();
      UI.renderTable(rows);
      UI.renderTotals(rows, s);
      UI.renderHeader(s.name, s.period);
      const badge = getEl('row-badge');
      if (badge) {
        badge.textContent    = rows.length ? String(rows.length) : '';
        badge.style.display  = rows.length ? 'inline-block' : 'none';
      }
      renderProfilePreview();
    } catch (e) {
      console.error('render error', e);
      setStatus('Ошибка рендера: ' + e.message, 'error');
    }
  }

  // ── Парсинг чата ──────────────────────────────────────
  function parsePaste() {
    const el   = getEl('chat-in');
    const text = el ? el.value.trim() : '';
    if (!text) { setStatus('Вставь сообщения из чата в поле выше.', 'error'); return; }

    try {
      setStatus('Разбираю сообщения…', 'info');
      const parsed = Parser.parseChat(text);
      let added = 0;

      parsed.forEach(r => { r.id = uid++; rows.push(r); added++; });

      rows.sort((a, b) => {
        const [ad, am] = a.date.split('.').map(Number);
        const [bd, bm] = b.date.split('.').map(Number);
        return (am - bm) || (ad - bd);
      });

      if (el) el.value = '';
      render();

      if (added) {
        const suf = added === 1 ? 'а' : added < 5 ? 'и' : '';
        setStatus('Готово: добавлено ' + added + ' строк' + suf + '.', 'success');
        switchTab('tabel');
      } else {
        setStatus('Не удалось распознать строки. Проверь формат сообщения.', 'error');
      }
    } catch (e) {
      console.error('parse error', e);
      setStatus('Ошибка разбора: ' + e.message, 'error');
    }
  }

  // ── ИИ-парсинг через DeepSeek ────────────────────────
  async function parseWithAI() {
    const el  = getEl('chat-in');
    const text = el ? el.value.trim() : '';
    if (!text) { setStatus('Вставь сообщения из чата в поле выше.', 'error'); return; }

    if (!DeepSeek.getKey()) {
      setStatus('Укажи API-ключ DeepSeek в настройках (⚙️).', 'error');
      switchTab('settings');
      return;
    }

    const btn = getEl('ai-parse-btn');
    if (btn) { btn.textContent = '🤖 ИИ думает…'; btn.disabled = true; }
    setStatus('Отправляю данные в DeepSeek…', 'info');

    try {
      const parsed = await DeepSeek.parseChatWithDeepSeek(text);
      let added = 0;

      parsed.forEach(r => { r.id = uid++; rows.push(r); added++; });

      rows.sort((a, b) => {
        const [ad, am] = (a.date || '01.01').split('.').map(Number);
        const [bd, bm] = (b.date || '01.01').split('.').map(Number);
        return (am - bm) || (ad - bd);
      });

      if (el) el.value = '';
      render();

      if (added) {
        const suf = added === 1 ? 'а' : added < 5 ? 'и' : '';
        setStatus('🤖 ИИ распознал ' + added + ' строк' + suf + '.', 'success');
        switchTab('tabel');
      } else {
        setStatus('ИИ не нашёл данных. Проверь формат сообщений.', 'error');
      }
    } catch (e) {
      console.error('AI parse error', e);
      setStatus('Ошибка ИИ: ' + e.message, 'error');
    } finally {
      if (btn) { btn.textContent = '🤖 Умный разбор (ИИ)'; btn.disabled = false; }
    }
  }

  // ── Добавить строку вручную ───────────────────────────
  function addManual() {
    try {
      let mraw = getEl('a-machine')?.value.trim() || '';
      mraw     = Parser.normalizeAliases(mraw);
      const machine = CFG.LABELS[mraw] || mraw;

      rows.push({
        id:        uid++,
        date:      getEl('a-date')?.value.trim()  || '—',
        machine,
        workType:  '',
        address:   getEl('a-addr')?.value.trim()   || '',
        cargo:     getEl('a-cargo')?.value.trim()  || '',
        client:    getEl('a-client')?.value.trim() || '',
        hours:     parseFloat(getEl('a-hours')?.value) || '',
        trips:     parseInt(getEl('a-trips')?.value)   || '',
        orderSum:  '',
        pay:       '',
        payManual: false,
      });

      ['a-date','a-machine','a-addr','a-cargo','a-client','a-hours','a-trips']
        .forEach(id => { const el = getEl(id); if (el) el.value = ''; });

      render();
      setStatus('Строка добавлена вручную.', 'success');
      switchTab('tabel');
    } catch (e) {
      console.error('addManual error', e);
      setStatus('Ошибка: ' + e.message, 'error');
    }
  }

  // ── Удалить / обновить строку ─────────────────────────
  function delRow(id) {
    rows = rows.filter(r => r.id !== id);
    render();
  }

  function updRow(id, field, val) {
    const r = rows.find(r => r.id === id);
    if (!r) return;
    r[field] = ['hours','trips','pay','orderSum'].includes(field)
      ? (parseFloat(val) || '')
      : val;
    if (field === 'pay') r.payManual = true;
    UI.renderTotals(rows, getSettings());
  }

  // ── Очистить ─────────────────────────────────────────
  function clearAll() {
    if (!confirm('Очистить табель? Настройки останутся.')) return;
    rows = [];
    ['official','advance','fuel','chat-in'].forEach(id => {
      const el = getEl(id); if (el) el.value = '';
    });
    render();
    setStatus('Табель очищен.', 'info');
    switchTab('insert');
  }

  // ── Копировать текстом ────────────────────────────────
  function copyText() {
    const s = getSettings();
    const { totalH, totalT, totalP } = Calculator.calcTotals(rows, profile);
    const { base, rest } = Calculator.calcPayout({
      totalP, oklad: s.oklad, official: s.official, advance: s.advance, fuel: s.fuel,
    });
    const f = UI.fmt;

    let t = 'ТАБЕЛЬ: ' + (s.name || 'Водитель') + '\n';
    if (s.period) t += 'Период: ' + s.period + '\n';
    t += '─'.repeat(50) + '\n';

    rows.forEach(r => {
      const d  = r.date.padEnd(8);
      const m  = (r.machine || '').substring(0,14).padEnd(15);
      const a  = (r.address || '').substring(0,18).padEnd(19);
      const os = r.orderSum ? f(r.orderSum) + '₽' : '—';
      const h  = String(r.hours || '').padEnd(4);
      const tr = String(r.trips || '').padEnd(4);
      const pay = Calculator.resolveRowPay(r, profile);
      const p  = pay !== null ? f(pay) + ' ₽' : '—';
      t += d + ' ' + m + ' ' + a + ' ' + os.padEnd(8) + ' ' + h + ' ' + tr + ' ' + p + '\n';
    });

    t += '─'.repeat(50) + '\n';
    t += 'Часов: ' + totalH + '  Рейсов: ' + totalT + '  Начислено: ' + f(totalP) + ' ₽\n';
    if (s.oklad)    t += 'Оклад: ' + f(s.oklad) + ' ₽\n';
    t += 'База: ' + f(base) + ' ₽\n';
    if (s.official) t += 'Офиц. доход: −' + f(s.official) + ' ₽\n';
    if (s.advance)  t += 'Авансы: −' + f(s.advance) + ' ₽\n';
    if (s.fuel)     t += 'Заправки: −' + f(s.fuel) + ' ₽\n';
    t += 'НА РУКИ: ' + f(rest) + ' ₽';

    navigator.clipboard.writeText(t)
      .then(() => alert('Скопировано!'))
      .catch(() => alert('Ошибка — скопируй вручную'));
  }

  // ── PDF ───────────────────────────────────────────────
  async function savePDF() {
    try {
      setStatus('Готовлю PDF…', 'info');
      const s      = getSettings();
      const totals = Calculator.calcTotals(rows, profile);
      await PDFGenerator.save(rows, { ...s, activeMachines: profile.activeMachines, rateMap: profile.rateMap }, totals);
      setStatus('PDF сохранён.', 'success');
    } catch (e) {
      console.error(e);
      setStatus('Ошибка PDF: ' + e.message, 'error');
    }
  }

  async function sharePDF() {
    try {
      setStatus('Подготавливаю отправку PDF…', 'info');
      const s      = getSettings();
      const totals = Calculator.calcTotals(rows, profile);
      await PDFGenerator.share(rows, { ...s, activeMachines: profile.activeMachines, rateMap: profile.rateMap }, totals);
      setStatus('PDF готов.', 'success');
    } catch (e) {
      console.error(e);
      setStatus('Ошибка отправки: ' + e.message, 'error');
    }
  }

  // ── Настройки (вкладка ⚙️) ──────────────────────────
  function initSettingsTab() {
    // Заполнить поля из profile
    const n = getEl('s-name');   if (n) n.value = profile.name   || '';
    const p = getEl('s-period'); if (p) p.value = profile.period || '';
    const o = getEl('s-oklad');  if (o) o.value = profile.oklad  || '';

    // Заполнить API ключ
    const k = getEl('s-api-key');
    if (k) k.value = DeepSeek.getKey();

    // Кнопка показать/скрыть ключ
    const toggle = getEl('s-api-key-toggle');
    if (toggle && !toggle._bound) {
      toggle._bound = true;
      toggle.addEventListener('click', () => {
        if (!k) return;
        k.type = k.type === 'password' ? 'text' : 'password';
        toggle.textContent = k.type === 'password' ? '👁' : '🙈';
      });
    }

    // Кнопка тест соединения
    const aiStatus = getEl('ai-status');
    const testBtn  = getEl('s-test-api');
    if (testBtn && !testBtn._bound) {
      testBtn._bound = true;
      testBtn.addEventListener('click', async () => {
        const key = getEl('s-api-key')?.value.trim();
        if (!key) { if (aiStatus) { aiStatus.textContent = '⚠️ Введи ключ'; aiStatus.className = 'ai-status error'; } return; }
        DeepSeek.saveKey(key);
        testBtn.textContent = 'Проверяю…';
        testBtn.disabled    = true;
        try {
          await DeepSeek.testConnection();
          if (aiStatus) { aiStatus.textContent = '✅ Соединение работает'; aiStatus.className = 'ai-status success'; }
        } catch (e) {
          if (aiStatus) { aiStatus.textContent = '❌ ' + e.message; aiStatus.className = 'ai-status error'; }
        } finally {
          testBtn.textContent = 'Проверить соединение';
          testBtn.disabled    = false;
        }
      });
    }

    // Кнопка сохранить настройки
    const saveBtn = getEl('s-save-btn');
    if (saveBtn && !saveBtn._bound) {
      saveBtn._bound = true;
      saveBtn.addEventListener('click', () => {
        // Сохраняем профиль
        profile.name   = getEl('s-name')?.value.trim()            || profile.name;
        profile.period = getEl('s-period')?.value.trim()          || profile.period;
        profile.oklad  = parseFloat(getEl('s-oklad')?.value)      || profile.oklad;

        // Сохраняем API ключ
        const apiKey = getEl('s-api-key')?.value.trim();
        if (apiKey) DeepSeek.saveKey(apiKey);
        else DeepSeek.clearKey();

        saveSettings();
        render();
        setStatus('Настройки сохранены.', 'success');
        switchTab('insert');
      });
    }

    // Кнопка сменить пароль
    const pwBtn = getEl('s-save-password');
    if (pwBtn && !pwBtn._bound) {
      pwBtn._bound = true;
      pwBtn.addEventListener('click', () => {
        const newPw = getEl('s-new-password')?.value.trim();
        if (!newPw || newPw.length < 4) {
          setStatus('Пароль должен быть минимум 4 символа.', 'error'); return;
        }
        localStorage.setItem('tabel_password', newPw);
        if (getEl('s-new-password')) getEl('s-new-password').value = '';
        setStatus('Пароль изменён.', 'success');
      });
    }
  }

  // ── Вкладки ───────────────────────────────────────────
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.tab-content').forEach(c =>
      c.classList.toggle('active', c.id === 'tab-' + name));
    if (name === 'tabel')    UI.renderTable(rows);
    if (name === 'itogi')    UI.renderTotals(rows, getSettings());
    if (name === 'settings') initSettingsTab();
  }

  // ── Экран профиля ─────────────────────────────────────
  function renderProfileForm() {
    const grid  = getEl('machine-grid');
    const rates = getEl('rate-list');
    if (!grid || !rates) return;

    grid.innerHTML = MACHINE_ORDER.map(id => {
      const label  = CFG.getMachineLabelById(id);
      const active = profile.activeMachines.includes(id);
      return `<label class="machine-chip ${active ? 'is-active' : ''}">
        <input type="checkbox" data-machine-toggle="${id}" ${active ? 'checked' : ''}>
        <div class="label">${label}</div>
        <div class="meta">${id}</div>
      </label>`;
    }).join('');

    const activeOnes = MACHINE_ORDER.filter(id => profile.activeMachines.includes(id));
    rates.innerHTML = activeOnes.length
      ? activeOnes.map(id => {
          const label = CFG.getMachineLabelById(id);
          const rate  = profile.rateMap[id] ?? '';
          return `<div class="rate-item">
            <div><strong>${label}</strong><span>${id}</span></div>
            <input type="number" inputmode="decimal" placeholder="₽/ч" value="${rate}" data-rate-input="${id}">
          </div>`;
        }).join('')
      : '<div class="empty-state">Сначала включи хотя бы одну технику.</div>';
  }

  function bindProfileForm() {
    const grid  = getEl('machine-grid');
    const rates = getEl('rate-list');
    const save  = getEl('profile-save');

    if (grid && !grid._bound) {
      grid._bound = true;
      grid.addEventListener('change', e => {
        const t = e.target;
        if (!t || !t.dataset.machineToggle) return;
        const id = t.dataset.machineToggle;
        if (t.checked) {
          if (!profile.activeMachines.includes(id)) profile.activeMachines.push(id);
        } else {
          profile.activeMachines = profile.activeMachines.filter(x => x !== id);
          delete profile.rateMap[id];
        }
        renderProfileForm();
      });
    }

    if (rates && !rates._bound) {
      rates._bound = true;
      rates.addEventListener('input', e => {
        const t = e.target;
        if (!t || !t.dataset.rateInput) return;
        profile.rateMap[t.dataset.rateInput] = parseFloat(t.value) || 0;
      });
    }

    if (save && !save._bound) {
      save._bound = true;
      save.addEventListener('click', () => {
        profile.name   = getEl('profile-name')?.value.trim()            || '';
        profile.period = getEl('profile-period')?.value.trim()          || '';
        profile.oklad  = parseFloat(getEl('profile-oklad')?.value)      || 0;

        if (profile.activeMachines.length === 0) {
          setStatus('Выбери хотя бы одну технику.', 'error');
          return;
        }
        saveSettings();

        getEl('profile-modal').style.display = 'none';
        getEl('main-app').style.display      = 'block';

        // Инициализируем если ещё не было, иначе просто рендерим
        if (!_initialized) {
          _doInit();
        } else {
          render();
          setStatus('Профиль обновлён.', 'success');
        }
      });
    }
  }

  function setElFromProfile() {
    const n = getEl('profile-name');   if (n) n.value = profile.name   || '';
    const p = getEl('profile-period'); if (p) p.value = profile.period || '';
    const o = getEl('profile-oklad');  if (o) o.value = profile.oklad  || '';
  }

  function openProfileScreen() {
    getEl('auth-modal').style.display   = 'none';
    getEl('profile-modal').style.display = 'block';
    getEl('main-app').style.display     = 'none';
    setElFromProfile();
    renderProfileForm();
    bindProfileForm();
    setStatus('Настрой профиль водителя и технику.', 'info');
  }

  // ── Инициализация (вызывается один раз) ──────────────
  function _doInit() {
    try {
      _initialized = true;
      render();

      // Вкладки
      document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
      });

      // Слушатели итогов
      ['official','advance','fuel'].forEach(id => {
        const el = getEl(id);
        if (el && !el._bound) {
          el._bound = true;
          el.addEventListener('input', () => UI.renderTotals(rows, getSettings()));
        }
      });

      // Кнопки действий
      const buttons = {
        'parse-btn':      parsePaste,
        'ai-parse-btn':   parseWithAI,
        'add-manual-btn': addManual,
        'copy-text-btn':  copyText,
        'clear-all-btn':  clearAll,
        'save-pdf-btn':   savePDF,
        'share-pdf-btn':  sharePDF,
      };
      Object.entries(buttons).forEach(([id, fn]) => {
        const el = getEl(id);
        if (el && !el._bound) { el._bound = true; el.addEventListener('click', fn); }
      });

      setStatus('Готово. Вставьте сообщения и нажмите «Разобрать».', 'success');
    } catch (e) {
      console.error('init error', e);
      setStatus('Ошибка инициализации: ' + e.message, 'error');
    }
  }

  // Публичный API
  return { init: _doInit, updRow, delRow, switchTab, getProfile, openProfileScreen };

})();

window.App = App;

// ── Авторизация ───────────────────────────────────────────
(function initAuth() {
  const PASSWORD = localStorage.getItem('tabel_password') || 'tabel2025';

  function unlock() {
    loadSettingsAndOpen();
  }

  function loadSettingsAndOpen() {
    // Загружаем настройки из localStorage
    try {
      const s = JSON.parse(localStorage.getItem('tabel_cfg') || '{}');
      if (s && typeof s === 'object') {
        // Устанавливаем через внутренний getProfile/setProfile через App
        if (s.name || s.activeMachines?.length) {
          // Есть сохранённый профиль — открываем приложение сразу
          App.openProfileScreen();
          return;
        }
      }
    } catch (e) {}
    // Нет профиля — открываем экран настройки
    App.openProfileScreen();
  }

  if (sessionStorage.getItem('tabel_auth') === 'true') {
    unlock();
    return;
  }

  getEl('auth-submit').addEventListener('click', () => {
    const pw  = getEl('auth-password').value;
    const err = getEl('auth-error');
    if (pw === PASSWORD) {
      sessionStorage.setItem('tabel_auth', 'true');
      unlock();
    } else {
      err.textContent = 'Неверный пароль';
      getEl('auth-password').value = '';
    }
  });

  getEl('auth-password').addEventListener('keypress', e => {
    if (e.key === 'Enter') getEl('auth-submit').click();
  });
})();

// ── Service Worker ────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
  });
}
