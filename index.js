/* ============================================================
   Donut Chart – Tableau Viz Extension
   ============================================================ */

const PALETTE = [
  '#2D6BE4', '#E8543A', '#2ECC8A', '#F5A623',
  '#9B59B6', '#1ABC9C', '#E74C3C', '#3498DB',
  '#F39C12', '#27AE60', '#8E44AD', '#16A085',
  '#D35400', '#2980B9', '#C0392B', '#7F8C8D'
];

const color = d3.scaleOrdinal(PALETTE);
let currentData = null;

tableau.extensions.initializeAsync().then(() => {
  const worksheet = tableau.extensions.worksheetContent.worksheet;
  renderFromWorksheet(worksheet);

  worksheet.addEventListener(
    tableau.TableauEventType.SummaryDataChanged,
    () => renderFromWorksheet(worksheet)
  );

  window.addEventListener('resize', () => {
    if (currentData && currentData.length > 0) draw(currentData);
  });

}).catch(err => {
  console.error('Init error:', err);
  showEmpty();
});

async function renderFromWorksheet(worksheet) {
  try {
    // Récupère toutes les données résumées
    const dataTableReader = await worksheet.getSummaryDataReaderAsync(undefined, { ignoreSelection: true });
    const dataTable = await dataTableReader.getAllPagesAsync();
    await dataTableReader.releaseAsync();

    const columns = dataTable.columns;
    const rows = dataTable.data;

    if (!columns || columns.length === 0 || rows.length === 0) {
      showEmpty();
      return;
    }

    // Cherche les encodings slice et value
    const encodingMap = worksheet.getEncodingMappings();
    let sliceIdx = -1;
    let valueIdx = -1;

    // Essaie via encodings
    if (encodingMap && encodingMap.size > 0) {
      const sliceEncoding = encodingMap.get('slice');
      const valueEncoding = encodingMap.get('value');

      if (sliceEncoding) {
        sliceIdx = columns.findIndex(c =>
          c.fieldName === sliceEncoding.field.name ||
          c.fieldName.includes(sliceEncoding.field.name)
        );
      }
      if (valueEncoding) {
        valueIdx = columns.findIndex(c =>
          c.fieldName === valueEncoding.field.name ||
          c.fieldName.includes(valueEncoding.field.name)
        );
      }
    }

    // Fallback : prend le premier string et le premier number
    if (sliceIdx < 0 || valueIdx < 0) {
      columns.forEach((col, i) => {
        if (sliceIdx < 0 && col.dataType === 'string') sliceIdx = i;
        if (valueIdx < 0 && (col.dataType === 'float' || col.dataType === 'int')) valueIdx = i;
      });
    }

    if (sliceIdx < 0 || valueIdx < 0) {
      showEmpty();
      return;
    }

    // Parse les données
    const data = rows
      .map(row => ({
        label: row[sliceIdx].formattedValue,
        value: Math.abs(+row[valueIdx].nativeValue)
      }))
      .filter(d => d.label && !isNaN(d.value) && d.value > 0)
      .sort((a, b) => b.value - a.value);

    if (data.length === 0) {
      showEmpty();
      return;
    }

    currentData = data;
    hideEmpty();
    draw(data);

  } catch (err) {
    console.error('Data error:', err);
    // Essaie l'ancienne API en fallback
    try {
      const summaryData = await worksheet.getSummaryDataAsync({ ignoreSelection: true });
      const columns = summaryData.columns;
      const rows = summaryData.data;

      let sliceIdx = -1, valueIdx = -1;
      columns.forEach((col, i) => {
        if (sliceIdx < 0 && col.dataType === 'string') sliceIdx = i;
        if (valueIdx < 0 && (col.dataType === 'float' || col.dataType === 'int')) valueIdx = i;
      });

      if (sliceIdx < 0 || valueIdx < 0) { showEmpty(); return; }

      const data = rows
        .map(row => ({
          label: row[sliceIdx].formattedValue,
          value: Math.abs(+row[valueIdx].nativeValue)
        }))
        .filter(d => d.label && !isNaN(d.value) && d.value > 0)
        .sort((a, b) => b.value - a.value);

      if (data.length === 0) { showEmpty(); return; }

      currentData = data;
      hideEmpty();
      draw(data);
    } catch (err2) {
      console.error('Fallback error:', err2);
      showEmpty();
    }
  }
}

function draw(data) {
  const wrap = document.getElementById('chart-wrap');
  const svg  = d3.select('#chart');
  svg.selectAll('*').remove();

  const W = wrap.clientWidth;
  const H = wrap.clientHeight;
  const size = Math.min(W, H);
  const outerR = (size / 2) * 0.78;
  const innerR = outerR * 0.52;
  const cx = W / 2;
  const cy = H / 2;

  svg.attr('width', W).attr('height', H);

  const g = svg.append('g').attr('transform', `translate(${cx},${cy})`);

  const arc = d3.arc()
    .innerRadius(innerR).outerRadius(outerR)
    .padAngle(0.025).cornerRadius(3);

  const arcHover = d3.arc()
    .innerRadius(innerR).outerRadius(outerR + 10)
    .padAngle(0.025).cornerRadius(3);

  const pie = d3.pie().value(d => d.value).sort(null);
  const arcs = pie(data);
  const total = d3.sum(data, d => d.value);

  // Slices avec animation
  const slices = g.selectAll('.slice')
    .data(arcs).enter()
    .append('path')
    .attr('class', 'slice')
    .attr('fill', d => color(d.data.label))
    .attr('opacity', 0.92)
    .style('cursor', 'pointer');

  slices
    .attr('d', d => arc({ startAngle: d.startAngle, endAngle: d.startAngle }))
    .transition().duration(700).delay((d, i) => i * 40)
    .ease(d3.easeCubicOut)
    .attr('d', arc);

  const tooltip = document.getElementById('tooltip');

  slices
    .on('mouseover', function(event, d) {
      d3.select(this).attr('d', arcHover).attr('opacity', 1);
      const pct = ((d.data.value / total) * 100).toFixed(1);
      tooltip.innerHTML = `<div class="tt-name">${d.data.label}</div><div class="tt-value">${formatNum(d.data.value)} · ${pct}%</div>`;
      tooltip.style.opacity = 1;
      updateCenter(d.data.label, pct + '%');
    })
    .on('mousemove', function(event) {
      tooltip.style.left = (event.clientX + 14) + 'px';
      tooltip.style.top  = (event.clientY - 32) + 'px';
    })
    .on('mouseout', function() {
      d3.select(this).attr('d', arc).attr('opacity', 0.92);
      tooltip.style.opacity = 0;
      updateCenter(null, null);
    });

  // Centre
  const centerG = g.append('g').attr('class', 'center-label');
  const totalText = centerG.append('text').attr('class', 'cl-value').attr('y', -6).text(formatNum(total));
  const subText   = centerG.append('text').attr('class', 'cl-name').attr('y', 14).text('Total');

  function updateCenter(name, pct) {
    if (name) {
      totalText.text(pct);
      subText.text(name.length > 18 ? name.slice(0, 16) + '…' : name);
    } else {
      totalText.text(formatNum(total));
      subText.text('Total');
    }
  }

  buildLegend(data, total);
}

function buildLegend(data, total) {
  const legend = document.getElementById('legend');
  legend.innerHTML = '';
  data.forEach(d => {
    const pct = ((d.value / total) * 100).toFixed(1);
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `
      <div class="legend-swatch" style="background:${color(d.label)}"></div>
      <span class="legend-label" title="${d.label}">${d.label}</span>
      <span class="legend-value">${pct}%</span>
    `;
    legend.appendChild(item);
  });
}

function formatNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return d3.format(',.0f')(n);
}

function showEmpty() {
  document.getElementById('app').classList.add('empty');
  document.getElementById('empty').classList.add('visible');
}

function hideEmpty() {
  document.getElementById('app').classList.remove('empty');
  document.getElementById('empty').classList.remove('visible');
}
