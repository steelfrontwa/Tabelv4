// ============================================================
// pdf-generator.js — генерация PDF с кириллицей
// Зависит от: jsPDF, jspdf-autotable, fonts.js, calculator.js
// ============================================================

const PDFGenerator = (() => {

  function addFonts(doc) {
    doc.addFileToVFS('Roboto-Regular.ttf', FONTS.regular);
    doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
    doc.addFileToVFS('Roboto-Bold.ttf', FONTS.bold);
    doc.addFont('Roboto-Bold.ttf', 'Roboto', 'bold');
    doc.setFont('Roboto', 'normal');
  }

  function fmt(n) {
    return Number(n || 0).toLocaleString('ru-RU');
  }

  async function generateBlob(rows, settings, totalsData) {
    return new Promise((resolve, reject) => {
      try {
        const { jsPDF } = window.jspdf;
        if (!jsPDF) { reject(new Error('jsPDF не загружен')); return; }

        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        addFonts(doc);

        const { name, period, oklad, official, advance, fuel } = settings;
        const { totalH, totalT, totalP } = totalsData;
        const { base, rest } = Calculator.calcPayout({ totalP, oklad, official, advance, fuel });

        // ── Заголовок ──
        doc.setFont('Roboto', 'bold');
        doc.setFontSize(16);
        doc.text('ТАБЕЛЬ: ' + (name || 'Водитель'), 14, 16);

        doc.setFont('Roboto', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(120);
        if (period) doc.text('Период: ' + period, 14, 23);
        doc.setTextColor(0);

        // ── Таблица рейсов ──
        const head = [[
          'Дата','Машина','Тип работы','Маршрут / Объект',
          'Груз','Заказчик','Заказ ₽','Часов','Рейсов','Начислено ₽'
        ]];
        const body = rows.map(r => [
          r.date,
          r.machine  || '—',
          r.workType || '—',
          (r.address || '—').substring(0, 38),
          (r.cargo   || '—').substring(0, 18),
          (r.client  || '—').substring(0, 15),
          r.orderSum !== '' && r.orderSum ? fmt(r.orderSum) + ' ₽' : '—',
          r.hours !== '' ? String(r.hours) : '—',
          r.trips !== '' ? String(r.trips) : '—',
          (() => {
            const value = Calculator.resolveRowPay(r, settings);
            return value !== null && value !== undefined
              ? fmt(value) + ' ₽'
              : (r.pay !== '' ? fmt(r.pay) + ' ₽' : '—');
          })(),
        ]);

        const PAGE_H    = 297; // A4 portrait mm
        const MARGIN_B  = 15;  // нижний отступ
        const SUMMARY_H = 65;  // высота блока итогов (запас)

        doc.autoTable({
          head, body,
          startY: period ? 28 : 22,
          // Автоматический перенос на следующую страницу
          pageBreak: 'auto',
          rowPageBreak: 'auto',
          showHead: 'everyPage',
          styles: {
            font: 'Roboto', fontStyle: 'normal',
            fontSize: 8, cellPadding: 2,
            overflow: 'linebreak',
          },
          headStyles: {
            font: 'Roboto', fontStyle: 'bold',
            fillColor: [245, 166, 35], textColor: 0,
          },
          alternateRowStyles: { fillColor: [248, 248, 248] },
          columnStyles: {
            0: { cellWidth: 13 },
            1: { cellWidth: 20 },
            2: { cellWidth: 26 },
            3: { cellWidth: 48 },
            4: { cellWidth: 22 },
            5: { cellWidth: 20 },
            6: { cellWidth: 18, halign: 'right' },
            7: { cellWidth: 11 },
            8: { cellWidth: 11 },
            9: { cellWidth: 20, halign: 'right' },
          },
          margin: { left: 14, right: 14, bottom: MARGIN_B },
          // Добавить номер страницы в футере
          didDrawPage: (data) => {
            const pageCount = doc.internal.getNumberOfPages();
            doc.setFont('Roboto', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(150);
            doc.text(
              'Стр. ' + data.pageNumber + (pageCount > 1 ? ' / ' + pageCount : ''),
              doc.internal.pageSize.getWidth() / 2,
              doc.internal.pageSize.getHeight() - 6,
              { align: 'center' }
            );
          },
        });

        // ── Итоги — проверяем поместятся ли на текущей странице ──
        let y = doc.lastAutoTable.finalY + 10;
        const pageBottom = PAGE_H - MARGIN_B;

        // Если итоги не помещаются — добавляем страницу
        if (y + SUMMARY_H > pageBottom) {
          doc.addPage();
          y = 20;
        }

        const lines = [
          ['Всего часов:',         String(totalH)],
          ['Всего рейсов:',        String(totalT)],
          ['Начислено по табелю:', fmt(totalP) + ' ₽'],
          ['База расчёта:',        fmt(base)   + ' ₽'],
        ];
        if (official) lines.push(['Офиц. доход:',  '−' + fmt(official) + ' ₽']);
        if (advance)  lines.push(['Авансы:',        '−' + fmt(advance)  + ' ₽']);
        if (fuel)     lines.push(['Заправки:',      '−' + fmt(fuel)     + ' ₽']);

        doc.setFont('Roboto', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(0);
        lines.forEach(([k, v]) => {
          doc.text(k, 14, y);
          doc.text(v, 90, y, { align: 'right' });
          y += 5.5;
        });

        // НА РУКИ — крупно
        y += 4;
        // Горизонтальная линия
        doc.setDrawColor(200);
        doc.setLineWidth(0.3);
        doc.line(14, y - 2, 90, y - 2);

        doc.setFont('Roboto', 'bold');
        doc.setFontSize(13);
        const restColor = rest >= 0 ? [46, 204, 113] : [231, 76, 60];
        doc.setTextColor(...restColor);
        doc.text('НА РУКИ:', 14, y + 6);
        doc.text(fmt(rest) + ' ₽', 90, y + 6, { align: 'right' });

        resolve(doc.output('blob'));
      } catch (e) {
        reject(e);
      }
    });
  }

  function getFilename(name, period) {
    return 'tabel_'
      + (name   || 'driver').replace(/\s+/g, '_')
      + (period ? '_' + period.replace(/\s+/g, '_') : '')
      + '.pdf';
  }

  async function save(rows, settings, totals) {
    try {
      const blob = await generateBlob(rows, settings, totals);
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = getFilename(settings.name, settings.period);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      alert('Ошибка PDF: ' + e.message);
    }
  }

  async function share(rows, settings, totals) {
    try {
      const blob = await generateBlob(rows, settings, totals);
      const fname = getFilename(settings.name, settings.period);
      const file  = new File([blob], fname, { type: 'application/pdf' });

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ title: 'Табель водителя', files: [file] });
      } else if (navigator.share) {
        const url = URL.createObjectURL(blob);
        await navigator.share({ title: 'Табель', url });
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } else {
        // fallback — просто скачиваем
        await save(rows, settings, totals);
      }
    } catch (e) {
      if (e.name !== 'AbortError') alert('Ошибка: ' + e.message);
    }
  }

  return { save, share };

})();
