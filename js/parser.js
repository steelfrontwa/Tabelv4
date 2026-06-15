// ============================================================
// parser.js — чистый парсер текста чата
// Не зависит от UI. Зависит только от CFG (config.js)
// ============================================================

const Parser = (() => {

  // ── Определить тип машины ──────────────────────────────
  function machineType(num) {
    if (CFG.MINI.has(num)) return 'mini';
    if (CFG.EVAK.has(num)) return 'evak';
    if (CFG.DUMP.has(num)) return 'dump';
    return '';
  }

  // ── Помощники для текста ─────────────────────────────
  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function boundaryRegExp(value, flags = 'gi') {
    const escaped = escapeRegExp(value);
    return new RegExp(`(^|[^A-Za-z0-9_А-Яа-яЁё])${escaped}(?=$|[^A-Za-z0-9_А-Яа-яЁё])`, flags);
  }

  // ── Нормализовать алиасы в тексте ─────────────────────
  // эп → 7368, хово → 796, 49-30 → 4930 и т.д.
  function normalizeAliases(text) {
    let s = text;
    s = s.replace(/\b49[-,.]30\b/gi, '4930');
    for (const [alias, num] of Object.entries(CFG.ALIASES)) {
      s = s.replace(boundaryRegExp(alias), '$1' + num);
    }
    return s;
  }

  // ── Найти все номера машин в тексте ───────────────────
  function findMachines(text) {
    const found = [];
    for (const num of CFG.ALL) {
      if (boundaryRegExp(num).test(text)) {
        found.push(num);
      }
    }
    return found;
  }

  function stripVehicleWords(text) {
    return text.replace(/\b(эва?куатор|самосвал|мини(?:к)?|экскаватор[- ]погрузчик|камаз|каламаз|вдк|чел|ч\.л)\b/gi, '');
  }

  function extractRouteFromHeader(header, driverMachine) {
    let s = header;
    s = s.replace(/^\s*\d{1,2}[.,:]\d{2}(?:[.,:]\d{2,4})?(?:[\s,;:]+)?/i, '');
    if (driverMachine) {
      s = s.replace(boundaryRegExp(driverMachine), '$1');
    }
    s = stripVehicleWords(s);
    s = s.replace(/^[\s,;:\-\.]+|[\s,;:\-\.]+$/g, '').trim();
    return s;
  }

  // ── Распарсить дату ────────────────────────────────────
  // Форматы: 25.05 / 25,05 / 25. 05 / 25.05.26
  function parseDate(token) {
    const m = token.replace(/\s/g,'').match(/^(\d{1,2})[.,:](\d{2})(?:[.,:]\d{2,4})?\.?$/);
    return m ? m[1].padStart(2,'0') + '.' + m[2] : null;
  }

  // ── Часы с округлением вверх ──────────────────────────
  // 2ч 40мин → 3, 1 час 50 минут → 2, 4ч → 4
  function getHours(text) {
    // "2ч 40мин" / "2 часа 40 минут"
    const full = text.match(/(\d+)\s*ч(?:ас(?:а|ов)?)?\s*(\d+)\s*м(?:ин(?:уты|ут)?)?/i);
    if (full) {
      const h = parseInt(full[1]);
      const m = parseInt(full[2]);
      return m > 0 ? h + 1 : h;
    }
    // "4ч" / "8 часов"
    const simple = text.match(/(\d+(?:[.,]\d+)?)\s*ч(?:ас(?:а|ов)?)?\b/i);
    if (simple) {
      const v = parseFloat(simple[1].replace(',','.'));
      return Number.isInteger(v) ? v : Math.ceil(v);
    }
    return null;
  }

  // ── Рейсы ─────────────────────────────────────────────
  // Приоритет: явное "N рейсов" > нумерованные пункты > пробел-дефис-пробел
  function getTrips(text) {
    // явное число
    const explicit = text.match(/(\d+)\s*рейс/i);
    if (explicit) return parseInt(explicit[1]);
    // простой = нет рейсов
    if (/простой/i.test(text)) return null;
    // считаем только " - " (пробел-дефис-пробел) — разделитель маршрута
    // дефис-без-пробелов = часть названия (Ново-Садовая)
    const parts = text.split(/\s+-\s+/).map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) return parts.length - 1;
    return null;
  }

  // ── Сумма заказа (не зарплата) ────────────────────────
  function getOrderSum(text) {
    // "чл 4000"
    const cl = text.match(/\bчл\s+(\d{3,6})\b/i);
    if (cl) return parseInt(cl[1]);
    // отдельное число >= 1000 не являющееся номером машины
    const re = /(?<![.,\d])(\d{4,6})(?![.,\d])/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const n = parseInt(m[1]);
      if (!CFG.ALL.has(String(n)) && n >= 1000) return n;
    }
    return null;
  }

  // ── Заказчик ──────────────────────────────────────────
  function getClient(text) {
    const tl = normalizeAliases(text).toLowerCase();
    if (/\bчл\b|ч\/л/i.test(tl)) return 'Частное лицо';
    for (const [key, label] of CFG.CLIENTS) {
      if (boundaryRegExp(key).test(tl)) return label;
    }
    return '';
  }

  // ── Груз ──────────────────────────────────────────────
  function getCargo(text) {
    const tl = text.toLowerCase();
    return CFG.CARGO
      .filter(c => tl.includes(c))
      .map(c => c[0].toUpperCase() + c.slice(1))
      .join(', ');
  }

  // ── Скобки ────────────────────────────────────────────
  // (Фёдоров) → водитель, игнорируем
  // (без щётки) → заметка, добавляем к адресу
  function parseParens(text) {
    const m = text.match(/\(([^)]+)\)/g);
    if (!m) return { note: '' };
    const notes = [];
    for (const p of m) {
      const inner = p.slice(1,-1).trim();
      // фамилия = одно слово с заглавной буквы
      const isName = /^[А-ЯЁA-Z][а-яёa-z]+$/.test(inner);
      if (!isName) notes.push(inner);
    }
    return { note: notes.join(', ') };
  }

  // ── Тип работы ────────────────────────────────────────
  function getWorkType(driverMachine, lineMachines) {
    const dtype = machineType(driverMachine);
    const minis = lineMachines.filter(m => CFG.MINI.has(m) || m === '2054');
    if (dtype === 'mini') return 'Работа на погрузчике';
    if (dtype === 'evak' && minis.length) return 'Перевозка погрузчика';
    if (dtype === 'evak') return 'Эвакуатор';
    if (dtype === 'dump') return 'Самосвал';
    return '';
  }

  // ── Очистить адрес ────────────────────────────────────
  function cleanAddress(text) {
    let s = text;
    // убрать машины
    for (const num of CFG.ALL) {
      s = s.replace(new RegExp('(?<![.,\\d])' + num + '(?![.,\\d])', 'g'), '');
    }
    // убрать часы
    s = s.replace(/\d+\s*ч(?:ас(?:а|ов)?)?\s*\d*\s*м(?:ин(?:уты|ут)?)?\b/gi, '');
    s = s.replace(/\d+(?:[.,]\d+)?\s*ч(?:ас(?:а|ов)?)?\b/gi, '');
    // убрать рейсы
    s = s.replace(/\d+\s*рейс(?:а|ов)?\b/gi, '');
    // убрать тонны, литры
    s = s.replace(/\d+(?:[.,]\d+)?\s*[тТ]\b/g, '');
    s = s.replace(/\d+(?:[.,]\d+)?\s*[лЛ]\s*(?:дт|дизель)?\b/gi, '');
    // убрать чл + цену
    s = s.replace(/\bчл\b\s*\d*/gi, '');
    s = s.replace(/\bч\/л\b\s*\d*/gi, '');
    // убрать +что-то
    s = s.replace(/[+]\s*\w+/g, '');
    // убрать скобки
    s = s.replace(/\([^)]+\)/g, '');
    // убрать заказчиков
    for (const [key] of CFG.CLIENTS) {
      s = s.replace(boundaryRegExp(key), '');
    }
    // убрать числа >= 1000 не в адресе
    s = s.replace(/(?<![.,\d])\d{4,6}(?![.,\d])/g, '');
    // убрать нумерацию 1) 2)
    s = s.replace(/^\s*\d+[.)]\s*/gm, '');
    s = s.replace(/\s{2,}/g, ' ').trim().replace(/^[,.\s\-]+|[,.\s\-]+$/g, '').trim();
    return s;
  }

  // ── Является ли строка рейсом ─────────────────────────
  function isTripLine(line) {
    if (!line || line.length < 4) return false;
    if (CFG.SKIP.test(line)) return false;
    if (/простой/i.test(line)) return true;
    // маршрут через пробел-дефис-пробел
    if (/\S\s+-\s+\S/.test(line)) return true;
    // часы или рейсы
    if (/\d+\s*ч(?:ас)?|\d+\s*рейс/i.test(line)) return true;
    // достаточно длинная строка с адресом
    if (line.length > 10) return true;
    return false;
  }

  // ── Разбить блок на отдельные рейсы ──────────────────
  // Обрабатывает нумерованные пункты 1) 2) как отдельные рейсы
  function splitIntoTrips(lines) {
    const result = [];
    let current = [];

    for (const line of lines) {
      const trimmed = line.trim();
      // нумерованный пункт → новый рейс
      if (/^\s*\d+[.)]\s+/.test(trimmed)) {
        if (current.length) result.push(current.join(' '));
        current = [trimmed.replace(/^\s*\d+[.)]\s+/, '')];
      } else if (trimmed) {
        current.push(trimmed);
      }
    }
    if (current.length) result.push(current.join(' '));

    // если нумерации не было — каждая непустая строка отдельно
    if (result.length === 1 && lines.filter(l => l.trim()).length > 1) {
      return lines.filter(l => l.trim() && !CFG.SKIP.test(l.trim()));
    }
    return result;
  }

  // ── ГЛАВНАЯ ФУНКЦИЯ: парсинг текста чата ─────────────
  function parseChat(text) {
    const rows = [];
    const lines = text.split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i].trim();

      // Начало блока водителя: "Имя Фамилия:"
      if (/^[А-ЯЁа-яёA-Za-z0-9][^:\n]{1,50}:\s*$/.test(line)) {
        i++;
        // пропускаем пустые строки
        while (i < lines.length && !lines[i].trim()) i++;
        if (i >= lines.length) break;

        // Строка заголовка: дата + машина
        let header = normalizeAliases(lines[i].trim());
        i++;

        // Парсим дату
        const tokens = header.split(/[\s,]+/);
        let date = null;
        let driverMachine = '';

        for (const tok of tokens) {
          if (!date) {
            const d = parseDate(tok);
            if (d) { date = d; continue; }
          }
          if (CFG.ALL.has(tok)) { driverMachine = tok; }
        }
        // машина могла быть не отдельным токеном
        if (!driverMachine) {
          const hm = findMachines(header);
          if (hm.length) driverMachine = hm[0];
        }
        if (!date) continue;

        // Собираем строки рейсов до следующего блока
        const tripLines = [];
        while (i < lines.length) {
          if (/^[А-ЯЁа-яёA-Za-z0-9][^:\n]{1,50}:\s*$/.test(lines[i].trim())) break;
          const line = lines[i].trim();
          if (line) tripLines.push(line);
          i++;
        }

        // Если в заголовке нет номера машины, попробуем найти его в теле блока.
        if (!driverMachine) {
          for (const tripLine of tripLines) {
            const machines = findMachines(normalizeAliases(tripLine));
            if (machines.length) {
              driverMachine = machines[0];
              break;
            }
          }
        }

        const headerRoute = extractRouteFromHeader(header, driverMachine);
        const candidates = headerRoute ? [headerRoute, ...tripLines] : tripLines;
        const trips = splitIntoTrips(candidates);

        for (const tripRaw of trips) {
          const tline = normalizeAliases(tripRaw.trim());
          if (!tline || CFG.SKIP.test(tline)) continue;
          if (!isTripLine(tline)) continue;

          const lineMachines = findMachines(tline);
          const minis = lineMachines.filter(m => CFG.MINI.has(m) || m === '2054');

          let cargo = getCargo(tline);
          // для эвакуатора везущего погрузчик — погрузчик это груз
          if (machineType(driverMachine) === 'evak' && minis.length) {
            const miniLabels = minis.map(m => CFG.LABELS[m] || m).join(', ');
            cargo = miniLabels + (cargo ? ', ' + cargo : '');
          }

          const paren = parseParens(tline);
          const note  = paren.note ? ' (' + paren.note + ')' : '';

          rows.push({
            date,
            machine:   CFG.LABELS[driverMachine] || driverMachine,
            workType:  getWorkType(driverMachine, lineMachines),
            address:   cleanAddress(tline) + note,
            cargo,
            client:    getClient(tline),
            orderSum:  getOrderSum(tline) ?? '',
            hours:     getHours(tline)    ?? '',
            trips:     getTrips(tline)    ?? '',
            pay:       '',
            payManual: false,
          });
        }
      } else {
        i++;
      }
    }

    // Сортируем по дате
    rows.sort((a, b) => {
      const [ad, am] = a.date.split('.').map(Number);
      const [bd, bm] = b.date.split('.').map(Number);
      return (am - bm) || (ad - bd);
    });

    return rows;
  }

  // Публичный API
  return { parseChat, machineType, normalizeAliases };

})();
