const missing = -32768;
const msPerDay = 86400000;
export const dayIndex = (iso, origin) => (Date.parse(iso) - Date.parse(origin)) / msPerDay;
export const addDays = (iso, days) => new Date(Date.parse(iso) + days * msPerDay).toISOString().slice(0, 10);
export function stepDay(iso, step, first, last) {
  const next=addDays(iso,step);
  return next>=first && next<=last ? next : null;
}
export function playbackStart(iso, first, last) {
  if (iso!==last) return iso;
  const start=addDays(last,-6);
  return start<first ? first : start;
}
export const peakDays = {storm:1, storm48:2, storm72:3};
const comparisonDigits = {maximumFractionDigits:1};
const comparisonScale = new Intl.NumberFormat("en",{...comparisonDigits,useGrouping:false});
export const formatValue = new Intl.NumberFormat("it-IT",comparisonDigits);
export function shownMeanDifference(a,b) {
  return Math.round(10*(Number(comparisonScale.format(a))-Number(comparisonScale.format(b))))/10;
}

export function aggregate(rows, size, first, last, metric, scale) {
  const values = new Float32Array(size).fill(NaN);
  const peaks = new Int16Array(size).fill(-1);
  const span = peakDays[metric];
  if (span && last - first + 1 < span) return {values, peaks};
  for (let i = 0; i < size; i++) {
    let sum = 0, rolling = 0, best = -1, peak = -1, d = first;
    for (; d <= last; d++) {
      const reading = rows[d * size + i];
      if (reading === missing) break;
      if (span) {
        rolling += reading;
        if (d - first >= span) rolling -= rows[(d - span) * size + i];
        if (d - first >= span - 1 && rolling > best) {
          best = rolling;
          peak = d;
        }
      } else if (metric === "frost") sum += reading <= 0;
      else if (metric === "heat") sum += reading >= 30 * scale;
      else sum += reading;
    }
    if (d <= last) continue;
    if (span) {
      values[i] = best / scale;
      if (best > 0) peaks[i] = peak;
    } else if (metric === "frost" || metric === "heat") values[i] = sum;
    else values[i] = sum / scale / (metric === "mean" ? last - first + 1 : 1);
  }
  return {values, peaks};
}

export function areaStats(values, areaGrid, elevation, id, [lo, hi], peaks) {
  let sum = 0, min = Infinity, max = -Infinity, count = 0, cells = 0, peak = -1;
  let zSum = 0, zMin = Infinity, zMax = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if ((id === null ? areaGrid[i] <= 0 : areaGrid[i] !== id) || elevation[i] < lo || elevation[i] >= hi) continue;
    cells++;
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    count++;
    sum += v;
    zSum += elevation[i];
    zMin = Math.min(zMin,elevation[i]);
    zMax = Math.max(zMax,elevation[i]);
    min = Math.min(min, v);
    const date = peaks?.[i] ?? -1;
    if (v > max || (v === max && date >= 0 && (peak < 0 || date < peak))) {
      max = v;
      peak = date;
    }
  }
  return {cells, stats: count ? {mean:sum/count, min, max, coverage:count/cells, peak,
    count, zMean:zSum/count, zMin, zMax} : null};
}
