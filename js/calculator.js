// ============================================================
// calculator.js — логика расчёта зарплаты
// ============================================================

const Calculator = (() => {

  function getMachineId(machineLabel) {
    return CFG.getMachineIdByLabel(machineLabel);
  }

  function getMachineRate(row, settings = {}) {
    const machineId = getMachineId(row.machine);
    if (!machineId) return 0;

    const activeMachines = settings.activeMachines || [];
    if (activeMachines.length && !activeMachines.includes(machineId)) return 0;

    const rateMap = settings.rateMap || {};
    const rate = parseFloat(rateMap[machineId]);
    return Number.isFinite(rate) && rate > 0 ? rate : 0;
  }

  function resolveRowPay(row, settings = {}) {
    const hasStoredManualPay =
      row.pay !== '' && row.pay !== null && row.pay !== undefined && row.payManual !== false;

    if (row.payManual === true || hasStoredManualPay) {
      const manual = parseFloat(row.pay);
      return Number.isFinite(manual) ? manual : 0;
    }

    const hours = parseFloat(row.hours) || 0;
    const rate = getMachineRate(row, settings);
    if (!hours || !rate) return null;
    return hours * rate;
  }

  // Считает итоги по массиву строк табеля
  function calcTotals(rows, settings = {}) {
    const totalH = rows.reduce((a, r) => a + (parseFloat(r.hours) || 0), 0);
    const totalT = rows.reduce((a, r) => a + (parseInt(r.trips)   || 0), 0);
    const totalP = rows.reduce((a, r) => a + (resolveRowPay(r, settings) || 0), 0);
    return { totalH, totalT, totalP };
  }

  // Считает итоговую сумму к выдаче
  // Формула:
  //   база = MAX(начислено по табелю, фикс. оклад)
  //   на руки = база − официальный доход − авансы − заправки
  function calcPayout({ totalP, oklad, official, advance, fuel }) {
    const base = oklad > 0 ? Math.max(totalP, oklad) : totalP;
    const rest = base - (official || 0) - (advance || 0) - (fuel || 0);
    const hint = oklad > 0
      ? (totalP >= oklad ? '↑ табель > оклада' : '↓ оклад > табеля')
      : '';
    return { base, rest, hint };
  }

  return { calcTotals, calcPayout, resolveRowPay, getMachineRate };

})();
