// ============================================================
// deepseek.js — интеграция DeepSeek API для умного парсинга
// Зависит от: config.js (CFG), parser.js (Parser)
// ============================================================

const DeepSeek = (() => {

  const API_URL      = 'https://api.deepseek.com/v1/chat/completions';
  const MODEL        = 'deepseek-chat';
  const LS_KEY       = 'sk-b76a110172444ad4a5152ff2b1ebc2ec';

  // ── Системный промпт ──────────────────────────────────
  const SYSTEM_PROMPT = `Ты — профессиональный автоматизированный бухгалтер для компаний по аренде спецтехники. Твоя единственная задача — прочитать хаотичный текст отчётов водителей из мессенджера и извлечь из него структурированные данные.

Ты должен вернуть СТРОГО валидный JSON-массив объектов. Никакого лишнего текста, никаких вступлений, никаких объяснений, никаких markdown-тегов. Только чистый массив [].

Каждый объект — это ОДНА рабочая запись (рейс или смена). Один блок сообщения может содержать несколько записей — создавай отдельный объект для каждой.

Поля каждого объекта (если данных нет — ставь null):
- "дата": строка в формате "ДД.ММ" (например "06.05")
- "водитель": имя или ник водителя из заголовка сообщения
- "техника": номер машины или тип техники (например "628", "764", "ЭП", "4850")
- "объект": адрес маршрута или название объекта/заказчика
- "часы": число (количество отработанных часов; 2ч 40мин = 3, округляй вверх)
- "рейсы": число (количество рейсов; если маршрут "А - Б - В" то 2 рейса)
- "заказ_сумма": число (сумма заказа если указана, например "чл 4000" = 4000)
- "заправка": число (литры ДТ или сумма заправки если указана)
- "заказчик": название заказчика если указан (ЧЛ = "Частное лицо")
- "груз": тип груза если указан (чернозём, песок, щебень и т.д.)

Примеры входных данных:
"Дмитрий Самарский:\n06.05 764\n9 просека - ракита 1 рейс\n9 просека - база 2 рейса"
→ два объекта: {дата:"06.05", водитель:"Дмитрий Самарский", техника:"764", объект:"9 просека - ракита", рейсы:1, ...} и {объект:"9 просека - база", рейсы:2, ...}

"Вашик:\n25.05 Тольятти 10ч эп Антарстрой 120л дт"
→ {дата:"25.05", водитель:"Вашик", техника:"ЭП", объект:"Тольятти", часы:10, заказчик:"Антарстрой", заправка:120}`;

  // ── Получить / сохранить ключ ─────────────────────────
  function getKey()       { return localStorage.getItem(LS_KEY) || ''; }
  function saveKey(key)   { localStorage.setItem(LS_KEY, key.trim()); }
  function clearKey()     { localStorage.removeItem(LS_KEY); }

  // ── Маппинг ответа ИИ → формат строки табеля ─────────
  function mapAIRowToTableRow(aiRow) {
    // Нормализуем технику через наш справочник
    let machineRaw = String(aiRow['техника'] || '').trim();
    machineRaw     = Parser.normalizeAliases(machineRaw);
    const machine  = CFG.LABELS[machineRaw] || machineRaw || '—';

    // Часы — целое
    let hours = null;
    if (aiRow['часы'] !== null && aiRow['часы'] !== undefined) {
      hours = Math.ceil(parseFloat(aiRow['часы']) || 0) || '';
    }

    // Рейсы
    let trips = null;
    if (aiRow['рейсы'] !== null && aiRow['рейсы'] !== undefined) {
      trips = parseInt(aiRow['рейсы']) || '';
    }

    return {
      date:      aiRow['дата']         || '—',
      machine,
      workType:  '',                   // определится при рендере
      address:   aiRow['объект']       || '',
      cargo:     aiRow['груз']         || '',
      client:    aiRow['заказчик']     || '',
      orderSum:  parseFloat(aiRow['заказ_сумма']) || '',
      hours:     hours ?? '',
      trips:     trips ?? '',
      pay:       '',
      payManual: false,
      // Сохраняем исходные данные для отладки
      _aiRaw:    aiRow,
    };
  }

  // ── Основная функция парсинга ─────────────────────────
  async function parseChatWithDeepSeek(rawText) {
    const apiKey = getKey();
    if (!apiKey) {
      throw new Error('API ключ не указан. Зайди в Настройки и добавь ключ DeepSeek.');
    }

    const payload = {
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: rawText },
      ],
      temperature: 0.1,   // минимальная случайность для точного JSON
      max_tokens:  4096,
    };

    const response = await fetch(API_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      if (response.status === 401) {
        throw new Error('Неверный API ключ. Проверь ключ в Настройках.');
      }
      if (response.status === 402) {
        throw new Error('Недостаточно средств на балансе DeepSeek.');
      }
      if (response.status === 429) {
        throw new Error('Превышен лимит запросов DeepSeek. Подожди немного.');
      }
      throw new Error(`Ошибка API (${response.status}): ${errText.slice(0, 200)}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || '';

    if (!content) {
      throw new Error('ИИ вернул пустой ответ. Попробуй ещё раз.');
    }

    // Чистим возможные markdown-обёртки
    const cleaned = content
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      // Пробуем найти массив внутри текста
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) {
        try { parsed = JSON.parse(match[0]); }
        catch { throw new Error('ИИ вернул невалидный JSON. Попробуй ещё раз.'); }
      } else {
        throw new Error('ИИ вернул не JSON. Ответ: ' + cleaned.slice(0, 100));
      }
    }

    if (!Array.isArray(parsed)) {
      // Иногда возвращает объект с массивом внутри
      const arr = Object.values(parsed).find(v => Array.isArray(v));
      if (arr) parsed = arr;
      else throw new Error('ИИ вернул не массив. Проверь формат входных данных.');
    }

    // Маппим в формат табеля
    return parsed
      .filter(row => row && typeof row === 'object')
      .map(mapAIRowToTableRow);
  }

  // ── Тест соединения ───────────────────────────────────
  async function testConnection() {
    const apiKey = getKey();
    if (!apiKey) throw new Error('Ключ не указан');

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: 'Ответь одним словом: работает' }],
        max_tokens: 10,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Статус ${response.status}`);
    }

    return true;
  }

  return { parseChatWithDeepSeek, getKey, saveKey, clearKey, testConnection };

})();
