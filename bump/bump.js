'use strict';

/* ============================================================
   Bump Chart – Tableau Viz Extension
   D3.js v7 + Tableau Extensions API
   ============================================================ */

// ── Default settings ──────────────────────────────────────
const DEFAULTS = {
  bgColor:  '#0f172a',
  maxLines: 6,
  colors: [
    '#4e79a7','#f28e2b','#e15759','#76b7b2',
    '#59a14f','#edc948','#b07aa1','#ff9da7',
    '#9c755f','#bab0ac','#e76f51','#2a9d8f'
  ]
};

let settings = { ...DEFAULTS };
let currentData = null;

// ── Initialize ────────────────────────────────────────────
tableau.extensions.initializeAsync({ configure }).then(() => {
  loadSettings();
  const ws = tableau.extensions.worksheetContent.worksheet;

  ws.addEventListener(tableau.TableauEventType.SummaryDataChanged, () => {
    loadSettings();
    render(ws);
  });

  tableau.extensions.settings.addEventListener(tableau.TableauEventType.SettingsChanged, () => {
    loadSettings();
    if (currentData) draw(currentData);
  });

  render(ws);
}).catch(err => console.error('Init error:', err));

// ── Settings ──────────────────────────────────────────────
function loadSettings() {
  const s = tableau.extensions.settings;
  settings.bgColor  = s.get('bgColor')  || DEFAULTS.bgColor;
  settings.maxLines = parseInt(s.get('maxLines') || DEFAULTS.maxLines);
  settings.colors   = JSON.parse(s.get('colors') || 'null') || DEFAULTS.colors;
  applyBackground();
}

function applyBackground() {
  document.body.style.background = settings.bgColor;
  // Determine if bg is dark or light for text color
  const isDark = isDarkColor(settings.bgColor);
  document.body.style.color = isDark ? '#f1f5f9' : '#0f172a';
  const emptyEls = document.querySelectorAll('#empty h3, #empty p, #empty svg');
  emptyEls.forEach(el => el.style.color = isDark ? '#f1f5f9' : '#0f172a');
}

function isDarkColor(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return (r * 0.299 + g * 0.587 + b * 0.114) < 128;
}

// ── Configure (opens popup) ───────────────────────────────
function configure() {
  const popupUrl = `${window.location.origin}${window.location.pathname.replace('index.html','config.html')}`;
  tableau.extensions.ui.displayDialogAsync(popupUrl, '', { height: 580, width: 480 })
    .then(() => {
      loadSettings();
      if (currentData) draw(currentData);
    })
    .catch(err => console.log('Dialog closed:', err));
}

// ── Fetch data ────────────────────────────────────────────
async function render(worksheet) {
  try {
    const visualSpec = await worksheet.getVisualSpecificationAsync();
    const marksCard  = visualSpec.marksSpecifications[visualSpec.activeMarksSpecificationIndex];

    let seriesField = null, periodField = null, valueField = null;
    for (const enc of marksCard.encodings) {
      if (enc.id === 'series') seriesField = enc.field.name;
      if (enc.id === 'period') periodField = enc.field.name;
      if (enc.id === 'value')  valueField  = enc.field.name;
    }

    if (!seriesField || !periodField || !valueField) {
      showEmpty(); return;
    }

    const reader = await worksheet.getSummaryDataReaderAsync(undefined, { ignoreSelection: true });
    const table  = await reader.getAllPagesAsync();
    await reader.releaseAsync();

    const cols = table.columns;
    const rows = table.data;

    const si = cols.findIndex(c => c.fieldName === seriesField);
    const pi = cols.findIndex(c => c.fieldName === periodField);
    const vi = cols.findIndex(c => c.fieldName === valueField);

    if (si < 0 || pi < 0 || vi < 0) { showEmpty(); return; }

    // Build flat data
    const flat = rows.map(r => ({
      series: r[si].formattedValue,
      period: r[pi].formattedValue,
      value:  +r[vi].nativeValue
    })).filter(d => d.series && d.period && !isNaN(d.value));

    if (flat.length === 0) { showEmpty(); return; }

    // Compute ranks per period
    const periods = [...new Set(flat.map(d => d.period))];
    const ranked  = [];

    periods.forEach(period => {
      const slice = flat.filter(d => d.period === period)
        .sort((a, b) => b.value - a.value);
      slice.forEach((d, i) => {
        ranked.push({ ...d, rank: i + 1 });
      });
    });

    // Limit to top N series (by average rank)
    const allSeries = [...new Set(ranked.map(d => d.series))];
    const avgRank = allSeries.map(s => ({
      series: s,
      avg: d3.mean(ranked.filter(d => d.series === s), d => d.rank)
    })).sort((a, b) => a.avg - b.avg);

    const topSeries = avgRank.slice(0, settings.maxLines).map(d => d.series);
    const filtered  = ranked.filter(d => topSeries.includes(d.series));

    currentData = { filtered, topSeries, periods };
    hideEmpty();
    draw(currentData);

  } catch(err) {
    console.error('Render error:', err);
    showEmpty();
  }
}

// ── Draw ──────────────────────────────────────────────────
function draw({ filtered, topSeries, periods }) {
  const container = document.getElementById('chart-container');
  const svg = d3.select('#chart');
  svg.selectAll('*').remove();

  const W = container.clientWidth;
  const H = container.clientHeight;
  const isDark = isDarkColor(settings.bgColor);
  const textColor    = isDark ? '#f1f5f9' : '#1e293b';
  const subtextColor = isDark ? '#64748b' : '#94a3b8';
  const gridColor    = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  const margin = { top: 40, right: 130, bottom: 50, left: 50 };
  const iW = W - margin.left - margin.right;
  const iH = H - margin.top - margin.bottom;

  svg.attr('width', W).attr('height', H);
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const maxRank = topSeries.length;
  const color   = d3.scaleOrdinal(settings.colors).domain(topSeries);

  // Scales
  const xScale = d3.scalePoint().domain(periods).range([0, iW]).padding(0.3);
  const yScale = d3.scaleLinear().domain([1, maxRank]).range([0, iH]);

  // Grid lines (horizontal per rank)
  for (let r = 1; r <= maxRank; r++) {
    g.append('line')
      .attr('x1', 0).attr('x2', iW)
      .attr('y1', yScale(r)).attr('y2', yScale(r))
      .attr('stroke', gridColor)
      .attr('stroke-dasharray', '4,4');
  }

  // X axis labels
  periods.forEach(p => {
    g.append('text')
      .attr('class', 'axis-label')
      .attr('x', xScale(p))
      .attr('y', iH + 24)
      .attr('text-anchor', 'middle')
      .attr('fill', subtextColor)
      .attr('font-size', 11)
      .text(p);
  });

  // Y axis labels (#1 = top)
  for (let r = 1; r <= maxRank; r++) {
    g.append('text')
      .attr('x', -12)
      .attr('y', yScale(r))
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'central')
      .attr('fill', subtextColor)
      .attr('font-size', 10)
      .text(`#${r}`);
  }

  // Line generator
  const lineGen = d3.line()
    .x(d => xScale(d.period))
    .y(d => yScale(d.rank))
    .curve(d3.curveCatmullRom.alpha(0.5));

  const tooltip = document.getElementById('tooltip');

  // Draw series
  topSeries.forEach(series => {
    const seriesData = periods.map(p => {
      const pt = filtered.find(d => d.series === series && d.period === p);
      return pt || null;
    }).filter(Boolean);

    const c = color(series);

    // Line
    const path = g.append('path')
      .datum(seriesData)
      .attr('class', 'bump-line')
      .attr('d', lineGen)
      .attr('stroke', c)
      .attr('stroke-opacity', 0.85);

    // Animate line
    const totalLen = path.node().getTotalLength();
    path
      .attr('stroke-dasharray', totalLen)
      .attr('stroke-dashoffset', totalLen)
      .transition().duration(900).ease(d3.easeCubicOut)
      .attr('stroke-dashoffset', 0);

    // Dots
    seriesData.forEach((d, i) => {
      g.append('circle')
        .attr('class', 'bump-dot')
        .attr('cx', xScale(d.period))
        .attr('cy', yScale(d.rank))
        .attr('r', 7)
        .attr('fill', c)
        .attr('stroke', settings.bgColor)
        .attr('stroke-width', 2.5)
        .style('opacity', 0)
        .transition().delay(100 + i * 60).duration(300)
        .style('opacity', 1);

      // Rank number inside dot
      g.append('text')
        .attr('class', 'rank-label')
        .attr('x', xScale(d.period))
        .attr('y', yScale(d.rank))
        .attr('fill', isDark ? '#0f172a' : '#ffffff')
        .attr('font-size', 9)
        .attr('font-weight', 700)
        .style('opacity', 0)
        .text(d.rank)
        .transition().delay(150 + i * 60).duration(300)
        .style('opacity', 1);
    });

    // Hover interactions on dots (redraw on top)
    seriesData.forEach(d => {
      g.append('circle')
        .attr('cx', xScale(d.period))
        .attr('cy', yScale(d.rank))
        .attr('r', 13)
        .attr('fill', 'transparent')
        .on('mouseover', function(event) {
          // Fade other lines
          svg.selectAll('.bump-line')
            .attr('stroke-opacity', l => l[0]?.series === series ? 1 : 0.12);
          tooltip.style.opacity = 1;
          tooltip.style.background = isDark ? 'rgba(15,23,42,0.92)' : 'rgba(255,255,255,0.92)';
          tooltip.style.color = isDark ? '#f1f5f9' : '#0f172a';
          tooltip.style.boxShadow = isDark ? '0 4px 20px rgba(0,0,0,0.5)' : '0 4px 20px rgba(0,0,0,0.15)';
          tooltip.innerHTML = `
            <div class="tt-series" style="color:${c}">${d.series}</div>
            <div class="tt-row">${d.period} · Rang #${d.rank}</div>
            <div class="tt-row">Valeur : ${d3.format(',.0f')(d.value)}</div>
          `;
        })
        .on('mousemove', function(event) {
          tooltip.style.left = (event.clientX + 14) + 'px';
          tooltip.style.top  = (event.clientY - 48) + 'px';
        })
        .on('mouseout', function() {
          svg.selectAll('.bump-line').attr('stroke-opacity', 0.85);
          tooltip.style.opacity = 0;
        });
    });

    // End label
    const last = seriesData[seriesData.length - 1];
    if (last) {
      g.append('text')
        .attr('class', 'series-label')
        .attr('x', xScale(last.period) + 16)
        .attr('y', yScale(last.rank))
        .attr('dominant-baseline', 'central')
        .attr('fill', c)
        .attr('font-size', 11)
        .attr('font-weight', 600)
        .style('opacity', 0)
        .text(series.length > 14 ? series.slice(0,13) + '…' : series)
        .transition().delay(900).duration(400)
        .style('opacity', 1);
    }
  });

  window.addEventListener('resize', () => {
    if (currentData) draw(currentData);
  }, { once: true });
}

// ── Helpers ───────────────────────────────────────────────
function showEmpty() {
  document.getElementById('chart-container').style.display = 'none';
  document.getElementById('empty').classList.add('visible');
}

function hideEmpty() {
  document.getElementById('chart-container').style.display = 'block';
  document.getElementById('empty').classList.remove('visible');
}
