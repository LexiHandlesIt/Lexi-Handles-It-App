const ExcelJS = require('exceljs');
const path = require('path');

const workbook = new ExcelJS.Workbook();

// ── Colours ──────────────────────────────────────────────────────────────────
const WALNUT   = '7D5730';
const SAGE     = '6B7C5C';
const CREAM    = 'FDF8F2';
const WHITE    = 'FFFFFF';
const HEADER_TEXT = 'FFFFFF';
const LIGHT_SAGE  = 'EEF4EA';
const BORDER_COL  = 'DDD5C8';

// ── Trade data ────────────────────────────────────────────────────────────────
const trades = [
  {
    name: 'Gardener',
    jobs: [
      ['Lawn mowing (small garden)',    'Per visit',  25,  45,  ''],
      ['Lawn mowing (large garden)',    'Per visit',  45,  80,  ''],
      ['Hedge trimming (small)',        'Per job',    40,  80,  ''],
      ['Hedge trimming (large)',        'Per job',    80, 200,  ''],
      ['Garden tidy / clear up',        'Per day',   150, 250,  ''],
      ['Weeding',                       'Per hour',   15,  25,  ''],
      ['Planting / bedding',            'Per hour',   20,  30,  ''],
      ['Turf laying',                   'Per m²',     12,  20,  'Excludes turf supply cost'],
      ['Tree pruning (small)',          'Per job',    80, 200,  ''],
      ['Tree removal (small)',          'Per job',   200, 500,  ''],
      ['Stump grinding',                'Per stump', 100, 300,  ''],
      ['Pressure washing patio',        'Per job',    80, 200,  ''],
      ['Fencing (supply & fit)',        'Per panel',  80, 150,  ''],
      ['Decking installation',          'Per m²',    120, 200,  'Materials extra'],
      ['Garden design consultation',    'Per hour',   50, 100,  ''],
    ]
  },
  {
    name: 'Electrician',
    jobs: [
      ['Consumer unit replacement',     'Per job',   300, 600,  'Includes certification'],
      ['Socket installation',           'Per socket', 80, 150,  ''],
      ['Light fitting installation',    'Per fitting',50, 100,  ''],
      ['Downlight installation',        'Per light',  50,  80,  ''],
      ['EV charger installation',       'Per job',   500, 900,  'OZEV grant may apply'],
      ['Electrical inspection (EICR)',  'Per property',150,300, ''],
      ['Smoke alarm installation',      'Per alarm',  50,  80,  ''],
      ['Outdoor socket installation',   'Per socket', 150, 250, ''],
      ['Garden lighting',               'Per job',   200, 500,  ''],
      ['Full rewire (3 bed house)',      'Per job',  3000,5000,  ''],
      ['Fault finding / diagnosis',     'Per hour',   60,  90,  ''],
      ['Emergency call out',            'Per call',  100, 150,  ''],
      ['First fix (new build)',         'Per day',   250, 350,  ''],
      ['Second fix (new build)',        'Per day',   250, 350,  ''],
      ['Cooker installation',           'Per job',   100, 200,  ''],
    ]
  },
  {
    name: 'Plumber',
    jobs: [
      ['Tap replacement',               'Per tap',    80, 150,  ''],
      ['Toilet installation',           'Per job',   150, 250,  ''],
      ['Radiator installation',         'Per radiator',150,250, ''],
      ['Leak repair',                   'Per job',    80, 200,  ''],
      ['Bathroom installation (basic)', 'Per job',  1500,3000,  'Labour only'],
      ['Pipe repair',                   'Per hour',   60,  90,  ''],
      ['Drain unblocking',              'Per job',    80, 200,  ''],
      ['Shower installation',           'Per job',   200, 400,  ''],
      ['Stopcock replacement',          'Per job',   100, 200,  ''],
      ['Outside tap installation',      'Per tap',   150, 250,  ''],
      ['CCTV drain survey',             'Per survey', 100, 250,  ''],
      ['Emergency call out',            'Per call',  100, 150,  ''],
      ['Boiler service',                'Per service', 80, 120,  ''],
      ['Power flush',                   'Per job',   300, 600,  ''],
      ['Unvented cylinder service',     'Per service',100, 150,  ''],
    ]
  },
  {
    name: 'Painter',
    jobs: [
      ['Interior painting (small room)','Per room',  200, 350,  'Labour only'],
      ['Interior painting (large room)','Per room',  350, 600,  'Labour only'],
      ['Exterior painting',             'Per day',   180, 280,  ''],
      ['Wallpapering',                  'Per roll',   40,  80,  ''],
      ['Full house repaint (3 bed)',    'Per job',  2000,5000,  'Labour only'],
      ['Door painting',                 'Per door',   50, 100,  ''],
      ['Window frame painting',         'Per window', 40,  80,  ''],
      ['Garden fence painting',         'Per panel',  15,  30,  ''],
      ['Wood staining / varnishing',    'Per day',   180, 280,  ''],
      ['Spray painting',                'Per day',   250, 350,  ''],
      ['Coving / cornice painting',     'Per m',       5,  10,  ''],
      ['Ceiling painting (per room)',   'Per room',   80, 150,  ''],
      ['Gloss woodwork (per room)',     'Per room',   80, 160,  ''],
      ['Feature wall',                  'Per wall',   80, 200,  ''],
      ['Preparation / filling',         'Per hour',   25,  40,  ''],
    ]
  },
  {
    name: 'Carpenter',
    jobs: [
      ['Door hanging',                  'Per door',   80, 150,  ''],
      ['Skirting board fitting',        'Per m',      15,  25,  'Labour only'],
      ['Kitchen fitting',               'Per day',   200, 300,  ''],
      ['Built-in wardrobe fitting',     'Per job',   500,1500,  ''],
      ['Decking installation',          'Per m²',    120, 200,  'Materials extra'],
      ['Loft boarding',                 'Per m²',     30,  50,  ''],
      ['Fence erection',                'Per panel',  80, 150,  ''],
      ['Window fitting',                'Per window', 150, 250,  ''],
      ['Flat pack assembly',            'Per hour',   40,  60,  ''],
      ['Bespoke shelving',              'Per job',   200, 500,  ''],
      ['Staircase fitting',             'Per job',  1500,3000,  ''],
      ['Architrave fitting',            'Per m',      10,  20,  ''],
      ['Timber framing',                'Per day',   200, 300,  ''],
      ['Garden gate hanging',           'Per gate',   80, 150,  ''],
      ['Lock / handle fitting',         'Per door',   40,  80,  ''],
    ]
  },
  {
    name: 'Builder',
    jobs: [
      ['Brick laying',                  'Per day',   200, 350,  ''],
      ['Plastering (per room)',         'Per room',  300, 600,  ''],
      ['Block paving',                  'Per m²',     80, 150,  'Materials extra'],
      ['Patio laying',                  'Per m²',     60, 120,  'Materials extra'],
      ['Groundwork',                    'Per day',   200, 350,  ''],
      ['Foundation work',               'Per m²',    100, 200,  ''],
      ['Damp proofing',                 'Per job',   500,2000,  ''],
      ['Demolition',                    'Per day',   200, 350,  ''],
      ['Extension (labour)',            'Per m²',   1500,2500,  'Labour only'],
      ['Garage conversion',             'Per job',  8000,20000, 'Full conversion'],
      ['Loft conversion',               'Per job', 20000,50000, 'Dependent on spec'],
      ['Repointing',                    'Per m²',     25,  50,  ''],
      ['Rendering',                     'Per m²',     20,  45,  ''],
      ['Concreting',                    'Per m²',     50, 100,  ''],
      ['Skip hire (organised by you)',  'Per skip',  200, 400,  ''],
    ]
  },
  {
    name: 'Roofer',
    jobs: [
      ['Roof inspection',               'Per inspection',50,100,''],
      ['Tile replacement',              'Per tile',   20,  50,  ''],
      ['Flat roof repair',              'Per m²',     30,  70,  ''],
      ['Flat roof replacement',         'Per m²',     50, 100,  ''],
      ['Pitched roof repair',           'Per job',   200, 500,  ''],
      ['Full re-roof (3 bed)',          'Per job',  5000,10000, ''],
      ['Chimney repointing',            'Per job',   300, 800,  ''],
      ['Gutter cleaning',               'Per job',    80, 150,  ''],
      ['Gutter replacement',            'Per m',      20,  40,  ''],
      ['Fascia & soffit replacement',   'Per m',      40,  80,  ''],
      ['Velux window installation',     'Per window', 500,1000,  ''],
      ['Lead flashing repair',          'Per m',      80, 150,  ''],
      ['Ridge tile repointing',         'Per m',      15,  30,  ''],
      ['EPDM rubber roof',              'Per m²',     60, 120,  ''],
      ['Emergency roof repair',         'Per call',  150, 350,  ''],
    ]
  },
  {
    name: 'Tiler',
    jobs: [
      ['Wall tiling',                   'Per m²',     25,  50,  'Labour only'],
      ['Floor tiling',                  'Per m²',     30,  60,  'Labour only'],
      ['Bathroom tiling (full)',        'Per job',   500,1500,  'Labour only'],
      ['Kitchen splashback',            'Per job',   150, 400,  ''],
      ['Grouting / regrouting',         'Per m²',     10,  20,  ''],
      ['Mosaic tiling',                 'Per m²',     50, 100,  ''],
      ['Wet room tiling',               'Per job',   800,2000,  ''],
      ['Tile removal',                  'Per m²',     10,  25,  ''],
      ['Tile repair',                   'Per tile',   30,  80,  ''],
      ['Underfloor heating install',    'Per m²',     50, 100,  ''],
      ['Large format tile laying',      'Per m²',     40,  80,  ''],
      ['Outdoor / porcelain paving',    'Per m²',     35,  70,  ''],
      ['Waterproofing / tanking',       'Per m²',     20,  40,  ''],
      ['Shower tray installation',      'Per job',   150, 300,  ''],
      ['Tile prep / levelling',         'Per m²',     10,  20,  ''],
    ]
  },
  {
    name: 'Gas Engineer',
    jobs: [
      ['Boiler service',                'Per service', 80, 120, 'Annual recommended'],
      ['Boiler installation (combi)',   'Per job',  1500,3000,  'Supply & fit'],
      ['Boiler repair',                 'Per job',   150, 400,  ''],
      ['Gas hob installation',          'Per job',   100, 200,  ''],
      ['Gas safety certificate (CP12)', 'Per property',60,120,  'Landlord certificate'],
      ['Radiator bleeding',             'Per job',    50, 100,  ''],
      ['Radiator replacement',          'Per radiator',150,300, ''],
      ['Thermostat installation',       'Per job',   100, 200,  ''],
      ['Power flush',                   'Per job',   300, 600,  ''],
      ['Gas pipework',                  'Per hour',   60,  90,  ''],
      ['Emergency call out',            'Per call',  100, 150,  ''],
      ['Magnetic filter installation',  'Per job',   100, 200,  ''],
      ['Smart thermostat (e.g. Nest)',  'Per job',   150, 300,  'Supply & fit'],
      ['Unvented cylinder service',     'Per service',100, 150,  ''],
      ['Gas fire service',              'Per service', 80, 120,  ''],
    ]
  },
  {
    name: 'Locksmith',
    jobs: [
      ['Lock picking / opening',        'Per job',    60, 100,  ''],
      ['Lock replacement (standard)',   'Per lock',   80, 150,  ''],
      ['Lock upgrade (British Standard)','Per lock',  100, 200,  ''],
      ['Deadlock installation',         'Per lock',  100, 200,  ''],
      ['Multipoint lock repair',        'Per job',   100, 300,  ''],
      ['Emergency lockout',             'Per call',   80, 150,  ''],
      ['UPVC door lock replacement',    'Per lock',  100, 200,  ''],
      ['Window lock installation',      'Per window', 40,  80,  ''],
      ['Safe opening',                  'Per job',   100, 300,  ''],
      ['Key cutting',                   'Per key',     5,  20,  ''],
      ['Security assessment',           'Per property',50,100,  ''],
      ['Door reinforcement',            'Per door',  150, 400,  ''],
      ['Access control installation',   'Per job',   200, 500,  ''],
      ['Night latch installation',      'Per lock',   80, 150,  ''],
      ['Padlock supply & fit',          'Per job',    40,  80,  ''],
    ]
  },
];

// ── Helper: apply border to a cell ───────────────────────────────────────────
function applyBorder(cell, color = BORDER_COL) {
  const border = { style: 'thin', color: { argb: 'FF' + color } };
  cell.border = { top: border, left: border, bottom: border, right: border };
}

// ── Build Instructions tab ───────────────────────────────────────────────────
const instructions = workbook.addWorksheet('📋 How to Use');
instructions.views = [{ showGridLines: false }];
instructions.getColumn('A').width = 4;
instructions.getColumn('B').width = 70;

// Title
const titleCell = instructions.getCell('B2');
titleCell.value = 'Lexi\'s Suggested Job Prices';
titleCell.font = { size: 22, bold: true, color: { argb: 'FF' + WALNUT } };

// Subtitle
const subCell = instructions.getCell('B3');
subCell.value = 'A starting point for tradespeople — edit these to match what you actually charge.';
subCell.font = { size: 12, color: { argb: 'FF555555' }, italic: true };

instructions.getRow(4).height = 10;

// How to use box
const steps = [
  ['How to use this spreadsheet:', true],
  ['', false],
  ['1.  Click the tab at the bottom that matches your trade (e.g. "Electrician", "Plumber" etc.)', false],
  ['', false],
  ['2.  Look at the suggested Low and High prices — these are typical UK rates for 2025.', false],
  ['', false],
  ['3.  Fill in the "Your Price" column with what you actually charge.', false],
  ['    (You can set a single price, or leave the low/high as your range)', false],
  ['', false],
  ['4.  Once you\'re happy, copy all the rows in the "Job Name" and "Your Price" columns.', false],
  ['', false],
  ['5.  Go to Lexi Handles It → Price List → "Bulk Add" and paste them in.', false],
  ['', false],
  ['6.  Lexi will add them all to your price list in one go!', false],
  ['', false],
  ['💡  Tip: Prices vary by region. A plumber in London charges more than one in rural Wales.', false],
  ['    Use the suggested prices as a guide, not gospel.', false],
  ['', false],
  ['💡  Tip: Add a call-out fee or minimum charge — most tradespeople have one!', false],
];

let row = 5;
for (const [text, bold] of steps) {
  const cell = instructions.getCell(`B${row}`);
  cell.value = text;
  cell.font = { size: 11, bold, color: { argb: bold ? 'FF' + WALNUT : 'FF333333' } };
  cell.alignment = { wrapText: true };
  row++;
}

instructions.getColumn('B').width = 75;

// ── Build each trade tab ──────────────────────────────────────────────────────
for (const trade of trades) {
  const ws = workbook.addWorksheet(trade.name);
  ws.views = [{ showGridLines: false }];

  // Column widths
  ws.getColumn('A').width = 3;
  ws.getColumn('B').width = 38;
  ws.getColumn('C').width = 14;
  ws.getColumn('D').width = 14;
  ws.getColumn('E').width = 14;
  ws.getColumn('F').width = 14;
  ws.getColumn('G').width = 28;

  // ── Trade title ──
  ws.mergeCells('B2:G2');
  const tradeTitle = ws.getCell('B2');
  tradeTitle.value = trade.name + ' — Suggested Job Prices';
  tradeTitle.font = { size: 16, bold: true, color: { argb: 'FF' + WHITE } };
  tradeTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + WALNUT } };
  tradeTitle.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  ws.getRow(2).height = 32;

  // ── Sub note ──
  ws.mergeCells('B3:G3');
  const note = ws.getCell('B3');
  note.value = 'Fill in "Your Price" then copy Job Name + Your Price into Lexi\'s Bulk Add. Prices are typical UK rates for 2025.';
  note.font = { size: 10, italic: true, color: { argb: 'FF666666' } };
  note.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + CREAM } };
  note.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  ws.getRow(3).height = 20;

  ws.getRow(4).height = 8;

  // ── Column headers ──
  const headers = ['Job Name', 'Unit', 'Low Price (£)', 'High Price (£)', 'Your Price (£)', 'Notes'];
  const headerCols = ['B', 'C', 'D', 'E', 'F', 'G'];
  ws.getRow(5).height = 22;

  headerCols.forEach((col, i) => {
    const cell = ws.getCell(`${col}5`);
    cell.value = headers[i];
    cell.font = { bold: true, color: { argb: 'FF' + WHITE }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + SAGE } };
    cell.alignment = { horizontal: i === 0 ? 'left' : 'center', vertical: 'middle', indent: i === 0 ? 1 : 0 };
    applyBorder(cell);
  });

  // ── Job rows ──
  trade.jobs.forEach(([name, unit, low, high, notes], idx) => {
    const r = 6 + idx;
    const rowData = [name, unit, low, high, '', notes];
    const bg = idx % 2 === 0 ? 'FFFFFFFF' : 'FF' + CREAM;

    headerCols.forEach((col, i) => {
      const cell = ws.getCell(`${col}${r}`);
      cell.value = rowData[i];
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      cell.font = { size: 10, color: { argb: 'FF333333' } };
      cell.alignment = {
        horizontal: i === 0 ? 'left' : i === 1 ? 'center' : i === 5 ? 'left' : 'center',
        vertical: 'middle',
        indent: i === 0 || i === 5 ? 1 : 0
      };
      applyBorder(cell, BORDER_COL);

      // Format price columns as currency
      if (i >= 2 && i <= 4) {
        cell.numFmt = i === 4 ? '"£"#,##0.00' : '"£"#,##0.00';
        if (i === 4) {
          // Your price column — light highlight
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + LIGHT_SAGE } };
          cell.font = { size: 10, bold: true, color: { argb: 'FF' + SAGE } };
        }
      }
    });
    ws.getRow(r).height = 18;
  });

  // ── Freeze panes at row 6 ──
  ws.views = [{ state: 'frozen', ySplit: 5, showGridLines: false }];
}

// ── Save ──────────────────────────────────────────────────────────────────────
const outPath = path.join('C:\\Users\\samcl\\Documents\\Lexi App 3', 'Lexi-Suggested-Prices.xlsx');
workbook.xlsx.writeFile(outPath).then(() => {
  console.log('✅ Spreadsheet created: ' + outPath);
}).catch(err => {
  console.error('❌ Error:', err);
});
