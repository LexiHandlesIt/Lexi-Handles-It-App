'use strict';

/* ===== CONFIG ===== */
const FORMSPREE_URL = 'YOUR_FORM_ID'; // Replace with your Formspree endpoint
const SUPABASE_URL = 'https://dwiqqtutsjainpvdizgt.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_c0HS04ZbqIBPrbXvzNdPXw_IpeKBzHN';
const LIVE_APP_URL = 'https://app.lexihandlesit.com';
const lexiSupabase = (
  window.supabase &&
  SUPABASE_PUBLISHABLE_KEY !== 'PASTE_YOUR_SUPABASE_PUBLISHABLE_KEY_HERE'
)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
  : null;
let authMode = 'login';
let lexiAuthSession = null;
let priceListSyncTimer = null;

// ── PWA INSTALL PROMPT ────────────────────────────────────────
let _pwaInstallPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _pwaInstallPrompt = e;
  // Show the button in the nav menu
  const btn = document.getElementById('menuAddToHome');
  if (btn) btn.style.display = '';
});

window.addEventListener('appinstalled', () => {
  _pwaInstallPrompt = null;
  const btn = document.getElementById('menuAddToHome');
  if (btn) btn.style.display = 'none';
  toast('Lexi has been added to your home screen!', 'success', 3000);
});

function handleAddToHomeScreen() {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isInStandaloneMode = window.navigator.standalone === true;

  if (isInStandaloneMode) {
    toast('Lexi is already installed on your home screen.', 'success');
    return;
  }

  if (_pwaInstallPrompt) {
    // Android / Chrome - native prompt
    _pwaInstallPrompt.prompt();
    _pwaInstallPrompt.userChoice.then(choice => {
      if (choice.outcome === 'accepted') {
        _pwaInstallPrompt = null;
      }
    });
  } else if (isIos) {
    // iOS - show step-by-step instructions
    document.getElementById('iosInstallModal').style.display = 'flex';
  } else {
    toast('Open Lexi in Chrome on your phone to add it to your home screen.', 'info', 5000);
  }
}
let customerSyncTimer = null;
let savedDocsSyncTimer = null;
let savedDocsSyncReady = false;

/* ===== STORAGE KEYS ===== */
const KEY_CO   = 'tq_co';
const KEY_PL   = 'tq_pl';
const KEY_SAVED = 'tq_saved';
const KEY_CUSTOMERS = 'tq_customers';
const KEY_REF   = 'tq_refseq';
const KEY_INV   = 'tq_invseq';
const KEY_REC   = 'tq_recseq';
const KEY_ONBOARDED    = 'tq_onboarded';
const KEY_PL_ONBOARDED = 'tq_pl_onboarded';
const KEY_PREVIEW_FIRST_SUPPRESSED = 'tq_preview_first_suppressed';
const KEY_CUST_DATA    = 'lexi_cust_data';  // { "david okafor": { note, recurringDays } }
const KEY_TRIAL_START  = 'lexi_trial_start';
const KEY_TRIAL_END    = 'lexi_trial_end';
const KEY_AUTH_REMEMBER_EMAIL = 'lexi_auth_remember_email';
const TRIAL_DAYS       = 90;

function custKey(name) { return (name || '').trim().toLowerCase(); }
function getCustData(name)           { const d = lsGet(KEY_CUST_DATA) || {}; return d[custKey(name)] || {}; }
function saveCustData(name, updates) {
  const all = lsGet(KEY_CUST_DATA) || {};
  const k = custKey(name);
  all[k] = { ...(all[k] || {}), ...updates };
  localStorage.setItem(KEY_CUST_DATA, JSON.stringify(all));
}

function ensureTrialStarted() {
  let start = localStorage.getItem(KEY_TRIAL_START);
  let end = localStorage.getItem(KEY_TRIAL_END);
  if (!start || !end) {
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + TRIAL_DAYS);
    start = startDate.toISOString();
    end = endDate.toISOString();
    localStorage.setItem(KEY_TRIAL_START, start);
    localStorage.setItem(KEY_TRIAL_END, end);
  }
  return { start: new Date(start), end: new Date(end) };
}

function getTrialDaysRemaining() {
  const { end } = ensureTrialStarted();
  const ms = end.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
}

/* ===== DEFAULT COLOURS ===== */
const DEFAULT_COLOURS = { primary: '#1a1a1a', accent: '#555555', bg: '#ffffff' };

// Tracks which state each obo tab is in so switchOboGrid and showPage can restore correctly
const oboState = { svc: 'prompt', mat: 'prompt' }; // 'prompt' | 'postfill' | 'manual'
let _switchOboGrid = null; // assigned inside DOMContentLoaded so showPage() can re-render the obo tab

/* ===== TRADE AUTO-FILL DATA ===== */
const TRADE_DATA = {
  Builder: {
    rates: { rateHourly: 40, rateHalfDay: 150, rateDay: 250, rateCallout: 60 },
    services: [
      { name: 'Brickwork repairs',       price: 40,   unit: 'hr'  },
      { name: 'Block paving',            price: 35,   unit: 'm²'  },
      { name: 'Concrete laying',         price: 80,   unit: 'm²'  },
      { name: 'Partition wall build',    price: 350,  unit: ''    },
      { name: 'Chimney repointing',      price: 450,  unit: ''    },
      { name: 'Damp proofing survey',    price: 150,  unit: ''    },
      { name: 'Extension groundwork',    price: 55,   unit: 'hr'  },
      { name: 'Fence installation',      price: 250,  unit: ''    },
      { name: 'Garden wall build',       price: 200,  unit: ''    },
      { name: 'General labouring',       price: 40,   unit: 'hr'  },
    ],
    materials: [
      { name: 'Cement (25kg bag)',       price: 8,    unit: 'bag' },
      { name: 'Sand (bulk bag)',         price: 40,   unit: 'bag' },
      { name: 'Concrete blocks',         price: 2,    unit: 'each'},
      { name: 'Bricks (per 100)',        price: 50,   unit: '100' },
      { name: 'Timber (2×4 per metre)', price: 3,    unit: 'm'   },
      { name: 'Plywood sheet (8×4ft)',   price: 20,   unit: 'sheet'},
      { name: 'DPC membrane (roll)',     price: 15,   unit: 'roll'},
      { name: 'PVA bonding agent (5L)',  price: 10,   unit: 'tin' },
    ],
  },
  Carpenter: {
    rates: { rateHourly: 35, rateHalfDay: 130, rateDay: 220, rateCallout: 55 },
    services: [
      { name: 'Door hanging',            price: 150,  unit: ''    },
      { name: 'Skirting boards',         price: 12,   unit: 'm'   },
      { name: 'Staircase installation',  price: 1200, unit: ''    },
      { name: 'Kitchen fitting',         price: 60,   unit: 'hr'  },
      { name: 'Loft boarding',           price: 400,  unit: ''    },
      { name: 'Built-in wardrobe',       price: 800,  unit: ''    },
      { name: 'Decking installation',    price: 45,   unit: 'm²'  },
      { name: 'Fascia & soffit replacement', price: 80, unit: 'm' },
      { name: 'Fence panel installation',price: 180,  unit: ''    },
      { name: 'Timber frame repair',     price: 50,   unit: 'hr'  },
    ],
    materials: [
      { name: 'Timber batten (3×2 per m)', price: 3, unit: 'm'   },
      { name: 'MDF sheet (8×4ft)',       price: 25,   unit: 'sheet'},
      { name: 'Decking board',           price: 6,    unit: 'm'   },
      { name: 'Screws assorted (200 box)',price: 5,   unit: 'box' },
      { name: 'Wood stain (1L)',         price: 12,   unit: 'tin' },
      { name: 'Decking oil (2.5L)',      price: 18,   unit: 'tin' },
      { name: 'Sandpaper pack',          price: 4,    unit: 'pack'},
      { name: 'Hardwood dowel',          price: 2,    unit: 'm'   },
    ],
  },
  Decorator: {
    rates: { rateHourly: 25, rateHalfDay: 100, rateDay: 180, rateCallout: 40 },
    services: [
      { name: 'Interior painting (room)',price: 150,  unit: 'room'},
      { name: 'Exterior painting (elevation)', price: 200, unit: '' },
      { name: 'Wallpaper hanging',       price: 100,  unit: 'roll'},
      { name: 'Coving installation',     price: 10,   unit: 'm'   },
      { name: 'Masonry painting',        price: 18,   unit: 'm²'  },
      { name: 'Wood staining',           price: 25,   unit: 'hr'  },
      { name: 'Gloss painting (room)',   price: 150,  unit: 'room'},
      { name: 'Fence painting / staining', price: 5, unit: 'm²'  },
      { name: 'Spray painting',          price: 40,   unit: 'hr'  },
      { name: 'Feature wall',            price: 120,  unit: ''    },
    ],
    materials: [
      { name: 'Emulsion paint (5L)',     price: 20,   unit: 'tin' },
      { name: 'Gloss paint (2.5L)',      price: 18,   unit: 'tin' },
      { name: 'Masonry paint (5L)',      price: 30,   unit: 'tin' },
      { name: 'Wallpaper paste (pack)',  price: 5,    unit: 'pack'},
      { name: 'Filler (500g)',           price: 4,    unit: 'tub' },
      { name: 'Primer (5L)',             price: 20,   unit: 'tin' },
      { name: 'Caulk (cartridge)',       price: 3,    unit: 'each'},
      { name: 'Dust sheets (pack of 3)', price: 8,    unit: 'pack'},
    ],
  },
  Electrician: {
    rates: { rateHourly: 50, rateHalfDay: 180, rateDay: 300, rateCallout: 75 },
    services: [
      { name: 'Consumer unit replacement', price: 450, unit: ''  },
      { name: 'Socket installation',     price: 80,   unit: ''    },
      { name: 'Light fitting',           price: 65,   unit: ''    },
      { name: 'Rewire (per room)',        price: 200,  unit: 'room'},
      { name: 'EV charger installation', price: 900,  unit: ''    },
      { name: 'CCTV installation',       price: 350,  unit: ''    },
      { name: 'Smoke alarm installation',price: 60,   unit: ''    },
      { name: 'Security lighting',       price: 90,   unit: ''    },
      { name: 'Fault finding',           price: 75,   unit: 'hr'  },
      { name: 'Outdoor power socket',    price: 150,  unit: ''    },
    ],
    materials: [
      { name: 'Cable (twin & earth, m)', price: 1.50, unit: 'm'   },
      { name: 'Single socket',           price: 5,    unit: 'each'},
      { name: 'Double socket',           price: 8,    unit: 'each'},
      { name: 'Light fitting (basic)',   price: 15,   unit: 'each'},
      { name: 'MCB breaker',             price: 10,   unit: 'each'},
      { name: 'Consumer unit',           price: 80,   unit: 'each'},
      { name: 'Conduit (2m)',            price: 3,    unit: 'length'},
      { name: 'LED bulb',                price: 4,    unit: 'each'},
    ],
  },
  Gardener: {
    rates: { rateHourly: 25, rateHalfDay: 90, rateDay: 160, rateCallout: 40 },
    services: [
      { name: 'Lawn mowing',             price: 40,   unit: ''    },
      { name: 'Hedge trimming',          price: 80,   unit: ''    },
      { name: 'Garden clearance',        price: 150,  unit: ''    },
      { name: 'Tree pruning',            price: 120,  unit: ''    },
      { name: 'Turf laying',             price: 12,   unit: 'm²'  },
      { name: 'Pressure washing',        price: 80,   unit: ''    },
      { name: 'Planting service',        price: 25,   unit: 'hr'  },
      { name: 'Fence repair',            price: 100,  unit: ''    },
      { name: 'Leaf clearance',          price: 50,   unit: ''    },
      { name: 'Weeding',                 price: 25,   unit: 'hr'  },
    ],
    materials: [
      { name: 'Topsoil (bulk bag)',      price: 45,   unit: 'bag' },
      { name: 'Grass seed (5kg)',        price: 18,   unit: 'bag' },
      { name: 'Garden fertiliser (5kg)', price: 12,   unit: 'bag' },
      { name: 'Bark chippings (bulk bag)', price: 40, unit: 'bag' },
      { name: 'Fence post',              price: 8,    unit: 'each'},
      { name: 'Fence panel',             price: 35,   unit: 'each'},
      { name: 'Weed membrane (10m roll)', price: 12,  unit: 'roll'},
      { name: 'Plant food (liquid 1L)',  price: 6,    unit: 'bottle'},
    ],
  },
  'Gas Engineer': {
    rates: { rateHourly: 60, rateHalfDay: 200, rateDay: 350, rateCallout: 90 },
    services: [
      { name: 'Boiler service',          price: 80,   unit: ''    },
      { name: 'Boiler repair',           price: 120,  unit: ''    },
      { name: 'Boiler installation',     price: 2000, unit: ''    },
      { name: 'Gas safety certificate',  price: 65,   unit: ''    },
      { name: 'Radiator replacement',    price: 200,  unit: ''    },
      { name: 'Thermostat installation', price: 120,  unit: ''    },
      { name: 'Power flush',             price: 400,  unit: ''    },
      { name: 'Gas leak investigation',  price: 90,   unit: ''    },
      { name: 'Landlord gas safety record', price: 70, unit: ''   },
      { name: 'Unvented cylinder service', price: 150, unit: ''   },
    ],
    materials: [
      { name: 'Boiler flue kit',         price: 40,   unit: 'each'},
      { name: 'Room thermostat',         price: 60,   unit: 'each'},
      { name: 'Radiator valve (pair)',   price: 15,   unit: 'pair'},
      { name: 'Pipe (15mm per metre)',   price: 3,    unit: 'm'   },
      { name: 'Compression fitting',     price: 4,    unit: 'each'},
      { name: 'Solder ring fitting',     price: 2,    unit: 'each'},
      { name: 'PTFE tape (roll)',        price: 2,    unit: 'roll'},
      { name: 'Gas jointing compound',   price: 8,    unit: 'tube'},
    ],
  },
  Plasterer: {
    rates: { rateHourly: 35, rateHalfDay: 130, rateDay: 220, rateCallout: 55 },
    services: [
      { name: 'Skimming (per room)',     price: 350,  unit: 'room'},
      { name: 'Artex removal',           price: 30,   unit: 'm²'  },
      { name: 'Dry lining',             price: 20,   unit: 'm²'  },
      { name: 'Coving installation',     price: 12,   unit: 'm'   },
      { name: 'External rendering',      price: 35,   unit: 'm²'  },
      { name: 'Patch plaster repair',   price: 100,  unit: ''    },
      { name: 'Sand & cement render',   price: 40,   unit: 'm²'  },
      { name: 'Pebbledash removal',     price: 25,   unit: 'm²'  },
      { name: 'Ceiling repair',         price: 200,  unit: ''    },
      { name: 'Bonding coat',           price: 25,   unit: 'm²'  },
    ],
    materials: [
      { name: 'Plasterboard (8×4ft)',   price: 8,    unit: 'sheet'},
      { name: 'Finishing plaster (25kg)', price: 12, unit: 'bag' },
      { name: 'Bonding coat (25kg)',    price: 14,   unit: 'bag' },
      { name: 'Sand & cement (25kg)',   price: 6,    unit: 'bag' },
      { name: 'Corner bead (2.4m)',     price: 3,    unit: 'length'},
      { name: 'Scrim tape (roll)',      price: 3,    unit: 'roll'},
      { name: 'Drywall screws (box)',   price: 5,    unit: 'box' },
      { name: 'PVA bonding agent (5L)', price: 10,   unit: 'tin' },
    ],
  },
  Plumber: {
    rates: { rateHourly: 55, rateHalfDay: 190, rateDay: 320, rateCallout: 80 },
    services: [
      { name: 'Tap replacement',        price: 100,  unit: ''    },
      { name: 'Toilet installation',    price: 150,  unit: ''    },
      { name: 'Leak repair',            price: 120,  unit: ''    },
      { name: 'Bathroom installation',  price: 2500, unit: ''    },
      { name: 'Radiator installation',  price: 200,  unit: ''    },
      { name: 'Shower installation',    price: 350,  unit: ''    },
      { name: 'Pipe lagging',           price: 30,   unit: 'hr'  },
      { name: 'Blocked drain clearance',price: 80,   unit: ''    },
      { name: 'Stopcock replacement',   price: 100,  unit: ''    },
      { name: 'Outdoor tap installation', price: 150, unit: ''   },
    ],
    materials: [
      { name: 'Copper pipe (15mm per m)', price: 4,  unit: 'm'   },
      { name: 'Push-fit fitting',       price: 3,    unit: 'each'},
      { name: 'Compression fitting',    price: 4,    unit: 'each'},
      { name: 'PTFE tape (roll)',       price: 2,    unit: 'roll'},
      { name: 'Silicone sealant',       price: 5,    unit: 'tube'},
      { name: 'Tap valve',              price: 6,    unit: 'each'},
      { name: 'Radiator valve (pair)',  price: 15,   unit: 'pair'},
      { name: 'Flexi hose',            price: 8,    unit: 'each'},
    ],
  },
  Roofer: {
    rates: { rateHourly: 40, rateHalfDay: 150, rateDay: 260, rateCallout: 65 },
    services: [
      { name: 'Tile replacement',       price: 150,  unit: ''    },
      { name: 'Ridge tile re-bedding',  price: 350,  unit: ''    },
      { name: 'Flat roof repair',       price: 400,  unit: ''    },
      { name: 'Gutter cleaning',        price: 80,   unit: ''    },
      { name: 'Felt replacement',       price: 30,   unit: 'm²'  },
      { name: 'Lead flashing replacement', price: 200, unit: ''  },
      { name: 'Chimney repointing',     price: 500,  unit: ''    },
      { name: 'Roofline replacement',   price: 80,   unit: 'm'   },
      { name: 'Moss removal & treatment', price: 200, unit: ''   },
      { name: 'Skylight installation',  price: 1200, unit: ''    },
    ],
    materials: [
      { name: 'Roof tile',              price: 2,    unit: 'each'},
      { name: 'Mortar (25kg)',          price: 8,    unit: 'bag' },
      { name: 'Lead sheet',             price: 45,   unit: 'm²'  },
      { name: 'Roofing felt (roll)',    price: 25,   unit: 'roll'},
      { name: 'Fascia board',           price: 8,    unit: 'm'   },
      { name: 'Gutter (per metre)',     price: 6,    unit: 'm'   },
      { name: 'Gutter bracket',         price: 3,    unit: 'each'},
      { name: 'Ridge tile',             price: 8,    unit: 'each'},
    ],
  },
  Tiler: {
    rates: { rateHourly: 35, rateHalfDay: 130, rateDay: 220, rateCallout: 55 },
    services: [
      { name: 'Wall tiling',            price: 40,   unit: 'm²'  },
      { name: 'Floor tiling',           price: 45,   unit: 'm²'  },
      { name: 'Bathroom tiling',        price: 800,  unit: ''    },
      { name: 'Kitchen backsplash',     price: 350,  unit: ''    },
      { name: 'Wet room tiling',        price: 60,   unit: 'm²'  },
      { name: 'Grout replacement',      price: 15,   unit: 'm²'  },
      { name: 'Tile removal',           price: 20,   unit: 'm²'  },
      { name: 'Mosaic tiling',          price: 80,   unit: 'm²'  },
      { name: 'External tiling',        price: 50,   unit: 'm²'  },
      { name: 'Tile repair',            price: 80,   unit: ''    },
    ],
    materials: [
      { name: 'Tile adhesive (20kg)',   price: 12,   unit: 'bag' },
      { name: 'Grout (5kg)',            price: 8,    unit: 'bag' },
      { name: 'Tile spacers (pack)',    price: 2,    unit: 'pack'},
      { name: 'Waterproof membrane (1L)', price: 15, unit: 'tin' },
      { name: 'Tile silicone',          price: 5,    unit: 'tube'},
      { name: 'Corner trim (2.4m)',     price: 4,    unit: 'length'},
      { name: 'Levelling system (50 clips)', price: 10, unit: 'pack'},
      { name: 'Primer (5L)',            price: 12,   unit: 'tin' },
    ],
  },
};

/* ===== COLOUR HELPERS ===== */
// Returns true when a hex colour is perceptually light (text should be dark)
function isColorLight(hex) {
  try {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const r = parseInt(full.substr(0, 2), 16);
    const g = parseInt(full.substr(2, 2), 16);
    const b = parseInt(full.substr(4, 2), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55;
  } catch { return false; }
}

/* ===== STATE ===== */
let state = {
  company: {
    firstName: '', lastName: '', businessName: '',
    trade: '',
    phone: '', email: '', website: '', address: '', postcode: '',
    companyNumber: '',
    vatNumber: '',
    logo: '',
    socialLinks: { facebook: '', instagram: '', twitter: '' },
    payMethods: [],
    bankAccHolder: '', bankName: '', bankSort: '', bankAcc: '',
    paypalRef: '', payOther: '',
    brandPrimary: DEFAULT_COLOURS.primary,
    brandAccent:  DEFAULT_COLOURS.accent,
    brandBg:      DEFAULT_COLOURS.bg
  },
  priceList: [],
  customers: [],
  quote: {
    type: '',
    custTitle: '', custFirstName: '', custLastName: '',
    custAddr: '', custPostcode: '', custPhone: '', custEmail: '',
    date: '', validFor: '14', validCustom: '',
    ref: '',
    items: [],
    vatRate: '20', vatCustom: '',
    discount: '0',
    notes: '', privateNotes: '',
    selectedTerms: [], customTerms: '',
    authSig: '', custSig: '', sigDate: ''
  },
  saved: [],
  editingDocId: null,       // when editing a saved doc
  editingFromTerms: false   // true when edit was launched from Job Terms in customer dashboard
};

/* ===== ACTIVE MODAL CONTEXT ===== */
let activeDocId = null;   // for invoice/receipt modals
let editingJobId = null;  // tracks inline edit to prevent search from blowing it away
let pendingRefNum = null; // ref number held in memory until quote is actually saved
let pendingReceiptDocId = null;
let pendingPreviewSend = null;
let activePhotoDocId = null;
let activeEditChoiceDocId = null;
let activeCustomerGroup = null;   // group object while customer dashboard is open
let receiptPreviewed = false;
let quotePreviewed = false;
let activeQuoteDraftDoc = null;
let pendingQrReturnContext = null;
let voiceRecogniser = null;
let voiceRecording = false;
/* ===== PAYMENT HELPERS ===== */
// Sorts a payments array in-place by date ascending (Payment 1 = earliest)
function sortPaymentsByDate(payments) {
  payments.sort((a, b) => {
    const da = a.date || '';
    const db = b.date || '';
    return da < db ? -1 : da > db ? 1 : 0;
  });
}

// Returns doc.payments array, synthesising one entry from legacy paidAmount/paidDate if needed
function getDocPayments(doc) {
  // If doc.payments array exists and is authoritative, always use it (even if empty -empty means no payments)
  if (Array.isArray(doc.payments)) return doc.payments;
  // Legacy docs that only have paidAmount scalar
  if (doc.paidAmount > 0) return [{ amount: doc.paidAmount, date: doc.paidDate || todayStr() }];
  return [];
}
// Recalculates doc.paidAmount / doc.paid / doc.paidDate from doc.payments array
function recalcDocPayments(doc) {
  const payments = Array.isArray(doc.payments) ? doc.payments : [];
  doc.payments   = payments;
  doc.paidAmount = payments.reduce((s, p) => s + (p.amount || 0), 0);
  // Only mark paid if there is a real total > 0 AND paidAmount covers it
  doc.paid       = doc.total > 0 && doc.paidAmount >= doc.total;
  doc.paidDate   = payments.length ? payments[payments.length - 1].date : '';
}

function businessNameCompliment(name) {
  return "All saved. Let's make some money.";
}

function traderFirstName() {
  return (state.company.preferredName || state.company.firstName || '').trim() || 'there';
}

function hasRequiredSetup() {
  return (state.company.firstName || '').trim() !== '' &&
         (state.company.lastName  || '').trim() !== '';
}

function hasReturningAccountData() {
  const c = state.company || {};
  const businessFields = [
    c.firstName,
    c.lastName,
    c.businessName,
    c.trade,
    c.phone,
    c.email,
    c.address,
    c.postcode
  ];
  return businessFields.some(value => (value || '').trim() !== '') ||
         (state.priceList || []).length > 0 ||
         (state.customers || []).length > 0 ||
         (state.saved || []).length > 0;
}

function canUseMainApp() {
  return hasRequiredSetup() || hasReturningAccountData();
}

function requireSetupGuard() {
  toast('Please enter your first and last name to continue.', 'error');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page1')?.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  const el = document.getElementById('p1FirstName');
  if (el) { el.focus(); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('error'); }
}

function personaliseText() {
  const first = traderFirstName();
  const p1Sub = document.getElementById('page1Sub');
  if (p1Sub && document.getElementById('page1')?.classList.contains('active')) {
    const hasSetUp = (state.company.lastName || '').trim() !== '';
    p1Sub.textContent = hasSetUp
      ? `Brilliant ${first}, your business is progressing. Let's keep it up to date.`
      : `Right then. Tell me about your business and I'll get your documents looking the part.`;
  }
  const p3Sub = document.getElementById('page3Sub');
  if (p3Sub) {
    p3Sub.textContent = `Hey ${first}, who is this for?`;
  }
  const pageJobsSub = document.getElementById('pageJobsSub');
  if (pageJobsSub) {
    const custFirst = (state.quote.custFirstName || '').trim();
    pageJobsSub.textContent = custFirst
      ? `What work are you doing for ${custFirst}?`
      : 'What work are you doing for this customer?';
  }
  const savedTitle = document.getElementById('savedJobsTitle');
  if (savedTitle) savedTitle.textContent = `${first}'s Jobs`;
}

/* ===== BACK BUTTON INTERCEPT ===== */
// On mobile, pressing the phone's back button closes the topmost modal
// instead of leaving the app entirely.
(function setupBackButtonIntercept() {
  // Push a sentinel state so we always have something to pop back to
  history.replaceState({ lexiBase: true }, '');

  // When any modal/overlay becomes visible, push a history entry
  const _modalSelectors = [
    '#quoteModal', '#previewModal', '#customerModal', '#bookingContactModal',
    '#emailComposeModal', '#priceListModal', '#settingsModal', '#authModal',
    '#calendarModal', '#photoModal'
  ];

  // MutationObserver watches every element that could be a modal/overlay
  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      if (m.type !== 'attributes' || m.attributeName !== 'style') continue;
      const el = m.target;
      const isModal =
        el.id && _modalSelectors.includes('#' + el.id) ||
        el.classList.contains('modal') ||
        (el.style.position === 'fixed' && el.style.zIndex >= 1000);
      if (!isModal) continue;
      const nowVisible = el.style.display !== 'none' && el.style.display !== '';
      if (nowVisible && !el._lexiHistoryPushed) {
        el._lexiHistoryPushed = true;
        history.pushState({ lexiModal: el.id || 'overlay' }, '');
      } else if (!nowVisible) {
        el._lexiHistoryPushed = false;
      }
    }
  });
  observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['style'] });

  // On back button press: close the topmost visible modal/overlay instead of leaving
  window.addEventListener('popstate', e => {
    // Find all visible modals / fixed overlays, close the topmost one
    const allModals = [
      ...document.querySelectorAll('.modal-overlay'),
      ...document.querySelectorAll('.modal')
    ].filter(el => {
      const d = el.style.display;
      return d && d !== 'none';
    });

    if (allModals.length === 0) {
      // Nothing to close — push the base state back so the app doesn't exit
      history.pushState({ lexiBase: true }, '');
      return;
    }

    // Close the last (topmost z-order) visible modal
    const top = allModals[allModals.length - 1];
    top.style.display = 'none';
    top._lexiHistoryPushed = false;

    // Also fire any close button inside it so cleanup logic runs
    const closeBtn = top.querySelector(
      '[id$="CloseBtn"], [id$="closeBtn"], [id$="Close"], .modal-close, [aria-label="Close"]'
    );
    if (closeBtn) closeBtn.click();
  });
})();

/* ===== INIT ===== */
document.addEventListener('DOMContentLoaded', async () => {
  // About You -show more toggle
  const aboutYouMoreBtn = document.getElementById('aboutYouMoreBtn');
  const aboutYouExtra   = document.getElementById('aboutYouExtra');
  if (aboutYouMoreBtn && aboutYouExtra) {
    aboutYouMoreBtn.addEventListener('change', () => {
      const open = aboutYouMoreBtn.checked;
      aboutYouExtra.style.display = open ? 'block' : 'none';
      const lbl = document.getElementById('aboutYouToggleLabel');
      if (lbl) lbl.textContent = open ? 'Hide extra details' : 'Show more details';
    });
  }

  setupAuthScreen();
  const canOpenApp = await initialiseAuth();
  if (!canOpenApp) return;

  loadFromStorage();

  // ── Render immediately from local cache so the app is usable at once ──
  setupOnboarding();
  setupNewJobPicker();
  setupDescriptionHelp();
  setupJobTermsEdit();
  setupBizChoiceModal();
  setupNavigation();
  setupCalendar();
  setupNavHint();
  setupPage1();
  setupPage2();
  setupPage3();
  setupPageJobs();
  setupPageCompletion();
  initQuoteBuilderTabs();
  setupPage4();
  setupExitConfirm();
  setupModals();
  setupSendChoice();
  setupChaseAndPause();
  setupJobSearch();
  setupReviewModal();
  setupEarnings();
  updateSavedBadge();
  populatePage1Fields();
  updateQrMenuLabel();
  refreshPriceList();
  refreshSavedDocs();
  setTodayDate();
  generateRef();
  updateJobPicker();
  updateColourPreview();
  populateAuthSig();
  personaliseText();
  updateNotifToggleBtn();
  document.getElementById('jobsSpreadsheetToggle')?.addEventListener('change', e => {
    const lbl = document.getElementById('ssToggleLabel');
    if (e.target.checked) {
      if (lbl) lbl.textContent = 'View List';
      openSpreadsheetView();
    } else {
      if (lbl) lbl.textContent = 'View Spreadsheet';
      closeSpreadsheetView();
    }
  });

  document.getElementById('notifToggleBtn')?.addEventListener('change', e => {
    // Prevent toggle visually jumping — let updateNotifToggleBtn set the real state
    e.target.checked = ('Notification' in window) && Notification.permission === 'granted';
    openNotificationSettings();
  });

  // Show the app NOW — no waiting for Supabase
  if (canUseMainApp()) {
    showPage('page4');
  } else {
    showPage('page1');
  }

  // ── Sync with Supabase in the background — never blocks UI ──
  Promise.all([
    loadBusinessFromSupabase(),
    loadPriceListFromSupabase(),
    loadCustomersFromSupabase(),
    loadSavedDocsFromSupabase(),
  ]).then(() => {
    savedDocsSyncReady = true;
    // Refresh UI with any data that changed after the Supabase sync
    refreshPriceList();
    refreshSavedDocs();
    updateSavedBadge();
    updateJobPicker();
    populatePage1Fields();
    updateColourPreview();
    syncAllLocalCustomersToSupabase();
    queueSavedDocsSync();
  }).catch(err => {
    console.warn('Background Supabase sync failed:', err);
    savedDocsSyncReady = true; // still allow local saves to queue
  });

});

/* ===== AUTH ===== */
function setAuthMode(mode) {
  authMode = mode;
  const signupTab = document.getElementById('authSignupTab');
  const loginTab = document.getElementById('authLoginTab');
  const submitBtn = document.getElementById('authSubmitBtn');
  const password = document.getElementById('authPassword');
  const hint = document.getElementById('authHint');
  signupTab?.classList.toggle('active', mode === 'signup');
  loginTab?.classList.toggle('active', mode === 'login');
  if (submitBtn) submitBtn.textContent = mode === 'signup' ? 'Create my free account' : 'Log in';
  if (password) password.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  if (hint) {
    hint.textContent = mode === 'signup'
      ? "Use uppercase, lowercase and a number. I'll send a confirmation email before you log in."
      : 'Log in with the email and password you used to create your Lexi account.';
  }
  const forgotBtn = document.getElementById('forgotPasswordBtn');
  if (forgotBtn) forgotBtn.style.display = mode === 'login' ? 'block' : 'none';
  setAuthMessage('');
}

function setAuthMessage(message, type = '') {
  const el = document.getElementById('authMessage');
  if (!el) return;
  el.textContent = message || '';
  el.classList.remove('success', 'error');
  if (type) el.classList.add(type);
}

function setupAuthScreen() {
  const rememberedEmail = localStorage.getItem(KEY_AUTH_REMEMBER_EMAIL) || '';
  const emailInput = document.getElementById('authEmail');
  const rememberInput = document.getElementById('authRemember');
  if (emailInput && rememberedEmail) emailInput.value = rememberedEmail;
  if (rememberInput) rememberInput.checked = !!rememberedEmail;

  document.getElementById('authSignupTab')?.addEventListener('click', () => setAuthMode('signup'));
  document.getElementById('authLoginTab')?.addEventListener('click', () => setAuthMode('login'));
  document.getElementById('authSubmitBtn')?.addEventListener('click', handleEmailAuth);
  document.getElementById('forgotPasswordBtn')?.addEventListener('click', handleForgotPassword);
  document.getElementById('authPassword')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') handleEmailAuth();
  });
  document.getElementById('authPasswordToggle')?.addEventListener('click', () => {
    const password = document.getElementById('authPassword');
    const toggle = document.getElementById('authPasswordToggle');
    if (!password || !toggle) return;
    const showPassword = password.type === 'password';
    password.type = showPassword ? 'text' : 'password';
    toggle.classList.toggle('is-visible', showPassword);
    toggle.setAttribute('aria-pressed', showPassword ? 'true' : 'false');
    toggle.setAttribute('aria-label', showPassword ? 'Hide password' : 'Show password');
  });
  document.getElementById('authGoogleBtn')?.addEventListener('click', handleGoogleAuth);
  setAuthMode('login');
}

async function initialiseAuth() {
  if (!lexiSupabase) {
    console.warn('Supabase is not configured. Opening Lexi in local-only mode.');
    return true;
  }
  const authScreen = document.getElementById('authScreen');
  const overlay = document.getElementById('appLoadingOverlay');

  let data, error;
  try {
    // Race getSession against a 12-second timeout so a paused/unreachable
    // Supabase project never leaves the user stuck on the loading screen.
    const result = await Promise.race([
      lexiSupabase.auth.getSession(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Supabase did not respond in time. Check your connection or try again.')), 12000)
      )
    ]);
    data  = result.data;
    error = result.error;
  } catch (e) {
    // Network failure or timeout — show login screen, let user try again
    if (authScreen) authScreen.style.display = 'flex';
    if (overlay) overlay.style.display = 'none';
    setAuthMessage(
      (e.message || 'Could not reach the server.') +
      ' If this keeps happening, your account may need a moment to wake up — wait 30 seconds and refresh.',
      'error'
    );
    return false;
  }

  if (error) {
    if (authScreen) authScreen.style.display = 'flex';
    if (overlay) overlay.style.display = 'none';
    setAuthMessage(error.message || 'I could not check your login. Try again.', 'error');
    return false;
  }
  lexiAuthSession = data?.session || null;
  if (!lexiAuthSession) {
    if (authScreen) authScreen.style.display = 'flex';
    if (overlay) overlay.style.display = 'none';
    return false;
  }
  // If localStorage belongs to a different user (or is untagged), clear it so data doesn't bleed across
  const storedUserId = localStorage.getItem('lexi_user_id');
  const currentUserId = lexiAuthSession.user.id;
  if (storedUserId !== currentUserId) {
    const keysToKeep = [KEY_AUTH_REMEMBER_EMAIL];
    Object.keys(localStorage).forEach(k => { if (!keysToKeep.includes(k)) localStorage.removeItem(k); });
  }
  localStorage.setItem('lexi_user_id', currentUserId);

  // Fire-and-forget - profile upsert doesn't block app load
  ensureSupabaseProfile(lexiAuthSession.user).catch(e => console.warn('Profile sync:', e));
  if (authScreen) authScreen.style.display = 'none';
  return true;
}

async function handleEmailAuth() {
  if (!lexiSupabase) {
    setAuthMessage('Supabase is not configured yet.', 'error');
    return;
  }
  const email = document.getElementById('authEmail')?.value.trim();
  const password = document.getElementById('authPassword')?.value;
  const submitBtn = document.getElementById('authSubmitBtn');
  if (!email || !password) {
    setAuthMessage('Add your email and password first.', 'error');
    return;
  }
  if (document.getElementById('authRemember')?.checked) {
    localStorage.setItem(KEY_AUTH_REMEMBER_EMAIL, email);
  } else {
    localStorage.removeItem(KEY_AUTH_REMEMBER_EMAIL);
  }
  if (authMode === 'signup' && password.length < 8) {
    setAuthMessage('Use at least 8 characters.', 'error');
    return;
  }
  submitBtn.disabled = true;
  submitBtn.textContent = authMode === 'signup' ? 'Creating account...' : 'Logging in...';
  try {
    if (authMode === 'signup') {
      const { data, error } = await lexiSupabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin + window.location.pathname }
      });
      if (error) throw error;
      if (data?.session) {
        lexiAuthSession = data.session;
        ensureSupabaseProfile(data.user).catch(e => console.warn('Profile sync:', e));
        location.reload();
        return;
      }
      setAuthMessage('Check your email to confirm your account, then come back and log in.', 'success');
      setAuthMode('login');
    } else {
      const { data, error } = await lexiSupabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      lexiAuthSession = data?.session || null;
      ensureSupabaseProfile(data?.user).catch(e => console.warn('Profile sync:', e));
      location.reload();
    }
  } catch (error) {
    setAuthMessage(authErrorMessage(error), 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = authMode === 'signup' ? 'Create my free account' : 'Log in';
  }
}

async function handleForgotPassword() {
  if (!lexiSupabase) { setAuthMessage('Not connected.', 'error'); return; }
  const email = document.getElementById('authEmail')?.value.trim();
  if (!email) { setAuthMessage('Enter your email address first, then tap Forgot password.', 'error'); return; }
  const btn = document.getElementById('forgotPasswordBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
  try {
    const { error } = await lexiSupabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname + '?reset=true'
    });
    if (error) throw error;
    setAuthMessage(`Password reset email sent to ${email}. Check your inbox.`, 'success');
  } catch (err) {
    const msg = err?.message || err?.error_description || (typeof err === 'string' ? err : null) || 'Could not send reset email — check your SMTP settings in Supabase.';
    setAuthMessage(msg, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Forgot password?'; }
  }
}

async function handleGoogleAuth() {
  if (!lexiSupabase) {
    setAuthMessage('Supabase is not configured yet.', 'error');
    return;
  }
  const { error } = await lexiSupabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname }
  });
  if (error) setAuthMessage(authErrorMessage(error), 'error');
}

function authErrorMessage(error) {
  const msg = error?.message || String(error || '');
  if (/invalid login/i.test(msg)) return 'Those login details do not match. Check your email and password.';
  if (/email not confirmed/i.test(msg)) return 'Check your email and confirm your account first.';
  if (/password/i.test(msg) && /weak|short|characters/i.test(msg)) return 'Use at least 8 characters with uppercase, lowercase and a number.';
  return msg || 'Something went wrong. Try again.';
}

async function ensureSupabaseProfile(user) {
  if (!lexiSupabase || !user?.id) return;
  const now = new Date();
  const trialEnd = new Date(now);
  trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS);
  await lexiSupabase.from('profiles').upsert({
    id: user.id,
    email: user.email || '',
    trial_started_at: now.toISOString(),
    trial_ends_at: trialEnd.toISOString()
  }, { onConflict: 'id', ignoreDuplicates: true });

  const { data: existingSub } = await lexiSupabase
    .from('subscriptions')
    .select('id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();
  if (!existingSub) {
    await lexiSupabase.from('subscriptions').insert({
      user_id: user.id,
      plan_name: 'trial',
      status: 'trialing',
      trial_started_at: now.toISOString(),
      trial_ends_at: trialEnd.toISOString()
    });
  }
  if (!localStorage.getItem(KEY_TRIAL_START)) {
    localStorage.setItem(KEY_TRIAL_START, now.toISOString());
    localStorage.setItem(KEY_TRIAL_END, trialEnd.toISOString());
  }
}

async function signOutOfLexi() {
  if (lexiSupabase) await lexiSupabase.auth.signOut();
  localStorage.removeItem(KEY_ONBOARDED);
  localStorage.removeItem(KEY_PL_ONBOARDED);
  location.reload();
}

function businessRowToCompany(row) {
  if (!row) return {};
  const payment = row.payment_details || {};
  return {
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    preferredName: row.preferred_name || '',
    businessName: row.business_name || '',
    trade: row.trade || '',
    phone: row.phone || '',
    email: row.email || '',
    website: row.website || '',
    address: row.address || '',
    postcode: row.postcode || '',
    companyNumber: row.company_number || '',
    vatNumber: row.vat_number || '',
    logo: row.logo_url || '',
    qrCode: row.qr_code_url || '',
    socialLinks: row.social_links || { facebook: '', instagram: '', twitter: '' },
    payMethods: payment.payMethods || [],
    bankAccHolder: payment.bankAccHolder || '',
    bankName: payment.bankName || '',
    bankSort: payment.bankSort || '',
    bankAcc: payment.bankAcc || '',
    paypalRef: payment.paypalRef || '',
    payOther: payment.payOther || '',
    brandPrimary: row.brand_primary || DEFAULT_COLOURS.primary,
    brandAccent: row.brand_accent || DEFAULT_COLOURS.accent,
    brandBg: row.brand_background || DEFAULT_COLOURS.bg,
    rateHourly:  row.hourly_rate   != null ? Number(row.hourly_rate)   : null,
    rateHalfDay: row.half_day_rate != null ? Number(row.half_day_rate) : null,
    rateDay:     row.day_rate      != null ? Number(row.day_rate)      : null,
    rateCallout: row.callout_charge != null ? Number(row.callout_charge) : null
  };
}

function companyToBusinessRow(company) {
  return {
    first_name: company.firstName || '',
    last_name: company.lastName || '',
    preferred_name: company.preferredName || '',
    business_name: company.businessName || '',
    trade: company.trade || '',
    phone: company.phone || '',
    email: company.email || '',
    website: company.website || '',
    address: company.address || '',
    postcode: company.postcode || '',
    company_number: company.companyNumber || '',
    vat_number: company.vatNumber || '',
    logo_url: company.logo || '',
    qr_code_url: company.qrCode || '',
    social_links: {
      facebook: company.socialLinks?.facebook || '',
      instagram: company.socialLinks?.instagram || '',
      twitter: company.socialLinks?.twitter || ''
    },
    brand_primary: company.brandPrimary || DEFAULT_COLOURS.primary,
    brand_accent: company.brandAccent || DEFAULT_COLOURS.accent,
    brand_background: company.brandBg || DEFAULT_COLOURS.bg,
    payment_details: {
      payMethods: company.payMethods || [],
      bankAccHolder: company.bankAccHolder || '',
      bankName: company.bankName || '',
      bankSort: company.bankSort || '',
      bankAcc: company.bankAcc || '',
      paypalRef: company.paypalRef || '',
      payOther: company.payOther || ''
    },
    hourly_rate:    company.rateHourly   != null ? Number(company.rateHourly)  : null,
    half_day_rate:  company.rateHalfDay  != null ? Number(company.rateHalfDay) : null,
    day_rate:       company.rateDay      != null ? Number(company.rateDay)      : null,
    callout_charge: company.rateCallout  != null ? Number(company.rateCallout)  : null
  };
}

// ── Sync resilience helpers ──────────────────────────────────────
// Supabase free-tier can briefly stall ("canceling statement due to statement
// timeout", Postgres code 57014), especially on a cold connection or when two
// syncs overlap. These helpers auto-retry transient timeouts and stop the same
// sync from running twice at once (which made delete+insert calls deadlock).
function _isTimeoutError(err) {
  const m = String(err?.message || err?.error_description || err?.code || err || '');
  return /statement timeout|canceling statement|\b57014\b|timeout/i.test(m);
}
async function withSyncRetry(fn, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      if (!_isTimeoutError(err) || i === attempts - 1) throw err;
      await new Promise(r => setTimeout(r, 700 * (i + 1))); // 0.7s, 1.4s back-off
    }
  }
  throw lastErr;
}
let _businessSyncInFlight = false;

async function loadBusinessFromSupabase() {
  if (!lexiSupabase || !lexiAuthSession?.user?.id) return false;
  const { data, error } = await lexiSupabase
    .from('businesses')
    .select('*')
    .eq('user_id', lexiAuthSession.user.id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('Could not load business from Supabase:', error);
    return false;
  }
  if (!data) return false;

  state.company = { ...state.company, ...businessRowToCompany(data) };
  save();
  return true;
}

async function saveBusinessToSupabase() {
  if (!lexiSupabase || !lexiAuthSession?.user?.id) return;
  // Coalesce overlapping saves and auto-retry transient timeouts.
  if (_businessSyncInFlight) return;
  _businessSyncInFlight = true;
  try {
    return await withSyncRetry(_doSaveBusinessToSupabase);
  } finally {
    _businessSyncInFlight = false;
  }
}

async function _doSaveBusinessToSupabase() {
  const payload = companyToBusinessRow(state.company);
  const { data: existing, error: existingError } = await lexiSupabase
    .from('businesses')
    .select('id')
    .eq('user_id', lexiAuthSession.user.id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) throw existingError;

  const result = existing?.id
    ? await lexiSupabase.from('businesses').update(payload).eq('id', existing.id)
    : await lexiSupabase.from('businesses').insert({
        ...payload,
        user_id: lexiAuthSession.user.id
      });

  if (result.error && String(result.error.message || '').includes('social_links')) {
    const fallbackPayload = { ...payload };
    delete fallbackPayload.social_links;
    const fallbackResult = existing?.id
      ? await lexiSupabase.from('businesses').update(fallbackPayload).eq('id', existing.id)
      : await lexiSupabase.from('businesses').insert({
          ...fallbackPayload,
          user_id: lexiAuthSession.user.id
        });
    if (fallbackResult.error) throw fallbackResult.error;
    console.warn('Business synced without social links. Add the social_links column in Supabase to sync social accounts.');
    return;
  }

  if (result.error) throw result.error;
}

function priceItemRowToJob(row) {
  return {
    id:        row.local_id || row.id || uid(),
    name:      row.name || '',
    price:     Number(row.price || 0),
    unit:      row.unit || '',
    category:  row.category || '',
    costPrice: row.cost_price != null ? Number(row.cost_price) : null
  };
}

function jobToPriceItemRow(job) {
  return {
    local_id:   job.id || uid(),
    name:       job.name || '',
    price:      Number(job.price || 0),
    unit:       job.unit || '',
    category:   job.category || '',
    cost_price: job.costPrice != null ? Number(job.costPrice) : null
  };
}

async function loadPriceListFromSupabase() {
  if (!lexiSupabase || !lexiAuthSession?.user?.id) return false;
  const { data, error } = await lexiSupabase
    .from('price_items')
    .select('*')
    .eq('user_id', lexiAuthSession.user.id)
    .order('created_at', { ascending: true });

  if (error) {
    console.warn('Could not load price list from Supabase:', error);
    return false;
  }

  if (Array.isArray(data) && data.length) {
    state.priceList = data.map(priceItemRowToJob).filter(job => job.name);
    save();
    return true;
  }

  if (state.priceList.length) {
    queuePriceListSync();
  }
  return false;
}

let _priceListSyncInFlight = false;
let _priceListSyncPending = false;

async function savePriceListToSupabase() {
  if (!lexiSupabase || !lexiAuthSession?.user?.id) return;
  // Never let two price-list syncs run at once — concurrent delete+insert on the
  // same user_id rows was deadlocking and tripping the statement timeout. If a
  // change lands mid-sync, flag it and re-run once with the latest data.
  if (_priceListSyncInFlight) { _priceListSyncPending = true; return; }
  _priceListSyncInFlight = true;
  try {
    do {
      _priceListSyncPending = false;
      await withSyncRetry(_doSavePriceListToSupabase);
    } while (_priceListSyncPending);
  } finally {
    _priceListSyncInFlight = false;
  }
}

async function _doSavePriceListToSupabase() {
  const userId = lexiAuthSession.user.id;
  const rows = state.priceList.map(job => ({
    ...jobToPriceItemRow(job),
    user_id: userId
  }));

  const deleteResult = await lexiSupabase
    .from('price_items')
    .delete()
    .eq('user_id', userId);
  if (deleteResult.error) throw deleteResult.error;
  if (!rows.length) return;

  const insertResult = await lexiSupabase.from('price_items').insert(rows);
  if (insertResult.error && String(insertResult.error.message || '').includes('local_id')) {
    const fallbackRows = rows.map(({ local_id, ...row }) => row);
    const fallbackResult = await lexiSupabase.from('price_items').insert(fallbackRows);
    if (fallbackResult.error) throw fallbackResult.error;
    console.warn('Price list synced without local_id. Add local_id to price_items for stronger cross-device matching.');
    return;
  }
  if (insertResult.error) throw insertResult.error;
}

function queuePriceListSync(showError = false) {
  if (!lexiSupabase || !lexiAuthSession?.user?.id) return;
  clearTimeout(priceListSyncTimer);
  priceListSyncTimer = setTimeout(() => {
    savePriceListToSupabase().catch(error => {
      console.warn('Price list saved locally but did not sync to Supabase:', error);
      if (showError) toast('Price list saved here. Supabase sync needs another try.', 'error');
    });
  }, 250);
}

function normalisePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function customerQuoteFromForm() {
  return {
    custTitle:     getVal('custTitle'),
    custFirstName: getVal('custFirstName'),
    custLastName:  getVal('custLastName'),
    custAddr:      getVal('custAddr'),
    custPostcode:  getVal('custPostcode'),
    custPhone:     getVal('custPhone'),
    custEmail:     getVal('custEmail')
  };
}

function customerHasUsefulData(q = {}) {
  return !![
    q.custTitle,
    q.custFirstName,
    q.custLastName,
    q.custAddr,
    q.custPostcode,
    q.custPhone,
    q.custEmail
  ].some(value => String(value || '').trim());
}

function customerToRow(q = {}) {
  return {
    title:      q.custTitle || '',
    first_name: q.custFirstName || '',
    last_name:  q.custLastName || '',
    address:    q.custAddr || '',
    postcode:   q.custPostcode || '',
    phone:      q.custPhone || '',
    email:      q.custEmail || ''
  };
}

function customerRowToQuote(row = {}) {
  return {
    supabaseId:    row.id || '',
    custTitle:     row.title || '',
    custFirstName: row.first_name || '',
    custLastName:  row.last_name || '',
    custAddr:      row.address || '',
    custPostcode:  row.postcode || '',
    custPhone:     row.phone || '',
    custEmail:     row.email || ''
  };
}

function customerLocalKey(q = {}) {
  const email = String(q.custEmail || '').trim().toLowerCase();
  if (email) return `email:${email}`;
  const phone = normalisePhone(q.custPhone);
  if (phone) return `phone:${phone}`;
  return [
    q.custFirstName,
    q.custLastName,
    q.custPostcode
  ].map(value => String(value || '').trim().toLowerCase()).join('|');
}

function upsertLocalCustomer(q = {}, saveAfter = true) {
  if (!customerHasUsefulData(q)) return null;
  const quote = {
    custTitle:     q.custTitle || '',
    custFirstName: q.custFirstName || '',
    custLastName:  q.custLastName || '',
    custAddr:      q.custAddr || '',
    custPostcode:  q.custPostcode || '',
    custPhone:     q.custPhone || '',
    custEmail:     q.custEmail || ''
  };
  const key = customerLocalKey(quote);
  const name = buildCustName(quote) || 'Customer';
  let existingIdx = state.customers.findIndex(customer => customer.key === key);
  // Fallback: if key changed (e.g. email added later), find by name to avoid duplicating
  if (existingIdx === -1 && name && name !== 'Customer') {
    existingIdx = state.customers.findIndex(customer =>
      (customer.name || '').toLowerCase() === name.toLowerCase()
    );
  }
  const row = {
    id: existingIdx > -1 ? state.customers[existingIdx].id : uid(),
    supabaseId: q.supabaseId || q.id || (existingIdx > -1 ? state.customers[existingIdx].supabaseId : '') || '',
    key,
    name,
    quote,
    updatedAt: new Date().toISOString()
  };
  if (existingIdx > -1) state.customers[existingIdx] = { ...state.customers[existingIdx], ...row };
  else state.customers.unshift(row);
  if (saveAfter) save();
  return row;
}

async function loadCustomersFromSupabase() {
  if (!lexiSupabase || !lexiAuthSession?.user?.id) return false;
  const { data, error } = await lexiSupabase
    .from('customers')
    .select('*')
    .eq('user_id', lexiAuthSession.user.id)
    .order('updated_at', { ascending: false });

  if (error) {
    console.warn('Could not load customers from Supabase:', error);
    return false;
  }

  if (Array.isArray(data) && data.length) {
    data.forEach(row => upsertLocalCustomer(customerRowToQuote(row), false));
    save();
    return true;
  }
  return false;
}

function customerMatchesQuote(row, q = {}) {
  const email = String(q.custEmail || '').trim().toLowerCase();
  const phone = normalisePhone(q.custPhone);
  const first = String(q.custFirstName || '').trim().toLowerCase();
  const last = String(q.custLastName || '').trim().toLowerCase();
  const postcode = String(q.custPostcode || '').trim().toLowerCase();

  if (email && String(row.email || '').trim().toLowerCase() === email) return true;
  if (phone && normalisePhone(row.phone) === phone) return true;
  return !!(
    first &&
    last &&
    String(row.first_name || '').trim().toLowerCase() === first &&
    String(row.last_name || '').trim().toLowerCase() === last &&
    (!postcode || String(row.postcode || '').trim().toLowerCase() === postcode)
  );
}

async function saveCustomerToSupabase(q = {}) {
  if (!lexiSupabase || !lexiAuthSession?.user?.id || !customerHasUsefulData(q)) return;
  const userId = lexiAuthSession.user.id;
  const payload = customerToRow(q);
  // Build a targeted OR filter so we don't fetch every customer row on each call
  const email = String(q.custEmail || '').trim().toLowerCase();
  const phone = normalisePhone(q.custPhone || '');
  const first = String(q.custFirstName || '').trim();
  const last  = String(q.custLastName  || '').trim();
  let query = lexiSupabase.from('customers').select('*').eq('user_id', userId);
  if (email) query = query.eq('email', email);
  else if (phone) query = query.eq('phone', phone);
  else if (first && last) query = query.eq('first_name', first).eq('last_name', last);
  const { data: existingRows, error: findError } = await query.limit(5);

  if (findError) throw findError;

  const existing = (existingRows || []).find(row => customerMatchesQuote(row, q));
  const result = existing?.id
    ? await lexiSupabase.from('customers').update(payload).eq('id', existing.id)
    : await lexiSupabase.from('customers').insert({
        ...payload,
        user_id: userId
      });

  if (result.error && /title|address|postcode/i.test(String(result.error.message || ''))) {
    const fallbackPayload = {
      first_name: payload.first_name,
      last_name: payload.last_name,
      phone: payload.phone,
      email: payload.email
    };
    const fallbackResult = existing?.id
      ? await lexiSupabase.from('customers').update(fallbackPayload).eq('id', existing.id)
      : await lexiSupabase.from('customers').insert({
          ...fallbackPayload,
          user_id: userId
        });
    if (fallbackResult.error) throw fallbackResult.error;
    console.warn('Customer synced with basic contact fields. Add title/address/postcode columns to sync full customer details.');
    return;
  }

  if (result.error) throw result.error;
}

// One-per-sync cache so we fetch all customers once and reuse across all docs
let _custIdCache = null;
let _custIdCacheUserId = null;
function _clearCustIdCache() { _custIdCache = null; }

async function _getCustIdCache(userId) {
  if (_custIdCache && _custIdCacheUserId === userId) return _custIdCache;
  const { data } = await lexiSupabase.from('customers').select('id,email,phone,first_name,last_name,postcode').eq('user_id', userId);
  _custIdCache = data || [];
  _custIdCacheUserId = userId;
  return _custIdCache;
}

async function getSupabaseCustomerId(q = {}) {
  if (!lexiSupabase || !lexiAuthSession?.user?.id || !customerHasUsefulData(q)) return null;
  const userId = lexiAuthSession.user.id;
  const existingRows = await _getCustIdCache(userId);
  const existing = existingRows.find(row => customerMatchesQuote(row, q));
  if (existing?.id) return existing.id;

  const payload = customerToRow(q);
  const { data, error } = await lexiSupabase
    .from('customers')
    .insert({
      ...payload,
      user_id: userId
    })
    .select('id')
    .maybeSingle();

  if (error && /title|address|postcode/i.test(String(error.message || ''))) {
    const fallbackPayload = {
      first_name: payload.first_name,
      last_name: payload.last_name,
      phone: payload.phone,
      email: payload.email
    };
    const fallback = await lexiSupabase
      .from('customers')
      .insert({
        ...fallbackPayload,
        user_id: userId
      })
      .select('id')
      .maybeSingle();
    if (fallback.error) throw fallback.error;
    return fallback.data?.id || null;
  }

  if (error) throw error;
  return data?.id || null;
}

function queueCustomerSync(q, showError = false) {
  if (!lexiSupabase || !lexiAuthSession?.user?.id || !customerHasUsefulData(q)) return;
  clearTimeout(customerSyncTimer);
  customerSyncTimer = setTimeout(() => {
    saveCustomerToSupabase(q).catch(error => {
      console.warn('Customer saved locally but did not sync to Supabase:', error);
      if (showError) toast('Customer saved here. Supabase sync needs another try.', 'error');
    });
  }, 250);
}

async function syncAllLocalCustomersToSupabase() {
  if (!lexiSupabase || !lexiAuthSession?.user?.id) return;
  const customers = new Map();

  (state.customers || []).forEach(customer => {
    const q = customer.quote || {};
    if (customerHasUsefulData(q)) customers.set(customerLocalKey(q), q);
  });

  (state.saved || []).forEach(doc => {
    const q = doc.quote || {};
    if (!customerHasUsefulData(q)) return;
    upsertLocalCustomer(q, false);
    customers.set(customerLocalKey(q), q);
  });

  if (!customers.size) return;
  save();

  for (const q of customers.values()) {
    try {
      await saveCustomerToSupabase(q);
    } catch (error) {
      console.warn('Could not backfill customer to Supabase:', error);
    }
  }
}

function documentJsonFromRow(row = {}) {
  return row.document_data || row.payload || row.data || row.content || row.document_json || null;
}

function savedDocRowToDoc(row = {}) {
  const stored = documentJsonFromRow(row);
  const doc = stored && typeof stored === 'object' ? { ...stored } : {};
  doc.id = doc.id || row.local_id || row.id || uid();
  doc.createdAt = doc.createdAt || row.created_at || row.inserted_at || '';
  doc.updatedAt = doc.updatedAt || row.updated_at || '';
  doc.type = doc.type || row.type || row.document_type || doc.quote?.type || 'Estimate';
  doc.ref = doc.ref || row.document_number || row.ref || row.reference || doc.quote?.ref || '';
  if (doc.quote && !doc.quote.ref && doc.ref) doc.quote.ref = doc.ref;
  doc.custName = doc.custName || buildCustName(doc.quote || {}) || row.customer_name || '';
  // If the stored quote has no customer name but the row's customer_name column does, rescue it
  if (doc.custName && doc.quote && !doc.quote.custFirstName && !doc.quote.custLastName) {
    const parts = doc.custName.includes(',')
      ? doc.custName.split(',').map(s => s.trim())
      : doc.custName.split(' ');
    if (parts.length >= 2 && doc.custName.includes(',')) {
      doc.quote.custLastName  = parts[0] || '';
      doc.quote.custFirstName = parts[1] || '';
    } else {
      doc.quote.custFirstName = parts[0] || '';
      doc.quote.custLastName  = parts.slice(1).join(' ') || '';
    }
  }
  if ((!doc.quote || !customerHasUsefulData(doc.quote)) && row.customer_id) {
    const linkedCustomer = (state.customers || []).find(customer => customer.supabaseId === row.customer_id);
    if (linkedCustomer?.quote) {
      doc.quote = restoreCustomerFieldsFromDocQuote({ ...(doc.quote || {}) }, linkedCustomer.quote);
      if (!doc.quote.ref && doc.ref) doc.quote.ref = doc.ref;
      doc.custName = doc.custName || linkedCustomer.name || buildCustName(doc.quote);
    }
  }
  doc.total = Number(doc.total ?? row.total ?? 0);
  doc.date = doc.date || row.document_date || row.date || doc.quote?.date || '';
  return doc;
}

const CUST_FIELDS = ['custTitle','custFirstName','custLastName','custAddr','custPostcode','custPhone','custEmail'];

// Supabase is the source of truth.
// localDocs  = from localStorage (fast startup cache -may be stale)
// remoteDocs = from Supabase      (authoritative)
// Strategy:
//   1. Start with localDocs so any NEW docs not yet synced are included.
//   2. Remote then overwrites every shared ID -Supabase always wins.
//   3. Customer fields are rescued from local only if remote has them empty
//      (covers the brief window between creation and first sync completing).
function mergeSavedDocs(localDocs = [], remoteDocs = []) {
  const byId = new Map();

  // Pass 1: seed with local (cache) -gives us docs created but not yet synced
  localDocs.forEach(doc => {
    if (!doc?.id) return;
    byId.set(doc.id, doc);
  });

  // Pass 2: remote (Supabase) overwrites -it is authoritative for every doc it knows about
  remoteDocs.forEach(doc => {
    if (!doc?.id) return;
    const local = byId.get(doc.id) || {};
    const localQ  = local.quote  || {};
    const remoteQ = doc.quote    || {};
    // Remote wins on all fields; local only rescues customer fields remote has empty
    const mergedQ = { ...localQ, ...remoteQ };
    CUST_FIELDS.forEach(field => {
      if (!mergedQ[field] && localQ[field]) mergedQ[field] = localQ[field];
    });
    const mergedName = buildCustName(mergedQ) || doc.custName || local.custName || '';
    byId.set(doc.id, { ...local, ...doc, quote: mergedQ, custName: mergedName });
  });

  return [...byId.values()].sort((a, b) => (b.date || b.quote?.date || '').localeCompare(a.date || a.quote?.date || ''));
}

function getDocStatus(doc = {}) {
  if (doc.paid) return 'paid';
  if (doc.acceptStatus === 'accepted' || doc.jobAccepted) return 'accepted';
  if (doc.invoiceSent || doc.type === 'Invoice') return 'sent';
  return 'draft';
}

function getDocTypeForSupabase(doc = {}) {
  const type = String(doc.type || doc.quote?.type || 'Estimate').trim().toLowerCase();
  if (['estimate', 'quote', 'invoice', 'receipt'].includes(type)) return type;
  return 'estimate';
}

function savedDocRowBase(doc = {}) {
  const q = doc.quote || {};
  return {
    local_id: doc.id || uid(),
    type: doc.type || q.type || 'Estimate',
    status: getDocStatus(doc),
    ref: doc.ref || q.ref || '',
    customer_name: buildCustName(q) || doc.custName || '',
    total: Number(doc.total || calcTotal(q) || 0),
    document_date: doc.date || q.date || null
  };
}

function toSupabaseDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function savedDocStandardRow(userId, doc = {}, customerId = null) {
  const q = doc.quote || {};
  const docType = getDocTypeForSupabase(doc);
  const ref = doc.ref || q.ref || '';
  const subtotal = Number((q.items || []).reduce((sum, item) => sum + (Number(item.unitPrice) || 0) * (Number(item.qty) || 1), 0));
  const total = Number(doc.total || calcTotal(q) || 0);
  const issueDate = toSupabaseDate(doc.date || q.date);
  const dueDate = toSupabaseDate(doc.invoiceDueDate);
  return {
    user_id: userId,
    local_id: doc.id || uid(),
    customer_id: customerId,
    customer_name: buildCustName(q) || doc.custName || '',
    document_type: docType,
    document_number: ref,
    status: getDocStatus(doc),
    subtotal,
    tax_amount: 0,
    vat_amount: 0,
    total,
    total_amount: total,
    issue_date: issueDate,
    document_date: issueDate,
    due_date: dueDate,
    notes: q.notes || '',
    terms: Array.isArray(q.selectedTerms) ? q.selectedTerms.join(', ') : '',
    document_data: doc
  };
}

function omitKeys(row, keys) {
  const copy = { ...row };
  keys.forEach(key => delete copy[key]);
  return copy;
}

function savedDocInsertCandidates(userId, doc = {}, customerId = null) {
  const standard = savedDocStandardRow(userId, doc, customerId);
  return [
    standard,
    omitKeys(standard, ['vat_amount', 'total', 'document_date']),
    omitKeys(standard, ['tax_amount', 'total_amount', 'issue_date', 'due_date', 'notes', 'terms']),
    omitKeys(standard, ['vat_amount', 'total', 'document_date', 'due_date', 'notes', 'terms', 'document_data']),
    {
      user_id: userId,
      customer_id: customerId,
      document_type: standard.document_type,
      document_number: standard.document_number,
      status: standard.status,
      subtotal: standard.subtotal,
      tax_amount: 0,
      total_amount: standard.total_amount,
      issue_date: standard.issue_date,
      document_data: doc
    }
  ];
}

function getDocLineItems(doc = {}) {
  const q = doc.quote || {};
  if (Array.isArray(q.items) && q.items.length) return q.items;
  if (Array.isArray(doc.items) && doc.items.length) return doc.items;
  return [];
}

function getJobSummaryTitle(doc = {}) {
  const firstItem = getDocLineItems(doc)[0];
  return (firstItem?.name || 'Job details not saved').trim();
}

function isServiceNameList(text = '', doc = {}) {
  const cleaned = String(text || '').trim();
  if (!cleaned) return false;
  if (/[.!?]\s|[\r\n]/.test(cleaned)) return false;
  const knownNames = new Set([
    ...getDocLineItems(doc).map(item => item.name),
    ...(state.priceList || []).map(item => item.name)
  ].filter(Boolean).map(name => String(name).trim().toLowerCase()));
  if (!knownNames.size) return false;
  const parts = cleaned.split(',').map(part => part.trim().toLowerCase()).filter(Boolean);
  return parts.length > 0 && parts.every(part => knownNames.has(part));
}

function getJobSummaryDescription(doc = {}) {
  const q = doc.quote || {};
  if (q.notes && !isServiceNameList(q.notes, doc)) return q.notes.trim();
  return '';
}

function getJobSummaryStatus(doc = {}) {
  if (doc.paid) return 'paid';
  if (doc.invoiceSent || doc.type === 'Invoice') return 'invoiced';
  if (doc.jobCompleted) return 'completed';
  if (doc.jobAccepted || doc.acceptStatus === 'accepted') return 'accepted';
  const type = String(doc.type || doc.quote?.type || '').toLowerCase();
  if (type === 'quote') return 'quote';
  return 'estimate';
}

function getDocOutstandingAmount(doc = {}) {
  const total = Number(doc.total || calcTotal(doc.quote || {}) || 0);
  const paid = getDocPayments(doc).reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  return Math.max(0, total - paid);
}

function jobSummaryRowBase(userId, doc = {}, customerId = null) {
  ensureDocumentRefAndDate(doc);
  const q = doc.quote || {};
  const total = Number(doc.total || calcTotal(q) || 0);
  const title = getJobSummaryTitle(doc);
  return {
    user_id: userId,
    customer_id: customerId,
    local_id: doc.id || uid(),
    document_number: doc.ref || q.ref || '',
    document_type: getDocTypeForSupabase(doc),
    job_title: title,
    job_description: getJobSummaryDescription(doc),
    status: getJobSummaryStatus(doc),
    total_amount: total,
    outstanding_amount: getDocOutstandingAmount(doc),
    start_date: toSupabaseDate(doc.jobStartDate),
    completed_date: toSupabaseDate(doc.jobCompletedDate),
    job_data: doc
  };
}

function jobSummaryInsertCandidates(userId, doc = {}, customerId = null) {
  const standard = jobSummaryRowBase(userId, doc, customerId);
  return [
    standard,
    omitKeys(standard, ['job_data', 'completed_date', 'outstanding_amount']),
    omitKeys(standard, ['job_data', 'completed_date', 'outstanding_amount', 'document_type', 'document_number']),
    {
      user_id: userId,
      customer_id: customerId,
      status: standard.status,
      job_title: standard.job_title,
      job_description: standard.job_description,
      total_amount: standard.total_amount,
      start_date: standard.start_date
    },
    {
      user_id: userId,
      customer_id: customerId,
      status: standard.status,
      job_title: standard.job_title
    }
  ];
}

function savedDocRowsWithJsonColumn(userId, jsonColumn) {
  return (state.saved || []).map(doc => ({
    user_id: userId,
    ...savedDocRowBase(doc),
    [jsonColumn]: doc
  }));
}

async function loadSavedDocsFromSupabase() {
  if (!lexiSupabase || !lexiAuthSession?.user?.id) return false;
  let { data, error } = await lexiSupabase
    .from('documents')
    .select('*')
    .eq('user_id', lexiAuthSession.user.id)
    .order('created_at', { ascending: false });

  if (error && /created_at/i.test(String(error.message || ''))) {
    const retry = await lexiSupabase
      .from('documents')
      .select('*')
      .eq('user_id', lexiAuthSession.user.id);
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    console.warn('Could not load saved documents from Supabase:', error);
    return false;
  }

  if (Array.isArray(data) && data.length) {
    const remoteDocs = data.map(savedDocRowToDoc).filter(doc => doc.id);
    state.saved = mergeSavedDocs(state.saved, remoteDocs);
    state.saved.forEach(doc => {
      const q = doc.quote || {};
      if (customerHasUsefulData(q)) upsertLocalCustomer(q, false);
    });
    save();
    return true;
  }
  return false;
}

async function upsertSingleDocToSupabase(userId, doc, customerId) {
  const localId = doc.id;
  if (!localId) return;
  const candidates = savedDocInsertCandidates(userId, doc, customerId);
  for (const row of candidates) {
    // Try true upsert first (requires unique constraint on user_id, local_id)
    const { error } = await lexiSupabase
      .from('documents')
      .upsert(row, { onConflict: 'user_id,local_id', ignoreDuplicates: false });
    if (!error) return; // success
    const msg = String(error.message || '');
    // If upsert fails due to missing constraint, fall back to delete + insert
    if (/unique constraint|duplicate|conflict/i.test(msg)) {
      await lexiSupabase.from('documents').delete().eq('user_id', userId).eq('local_id', localId);
      const { error: insertErr } = await lexiSupabase.from('documents').insert(row);
      if (!insertErr) return;
      const insertMsg = String(insertErr.message || '');
      if (/column|schema cache|relationship|violates/i.test(insertMsg)) continue;
      throw insertErr;
    }
    if (/column|schema cache|relationship|violates/i.test(msg)) continue; // try next candidate shape
    throw error;
  }
}

async function saveSavedDocsToSupabase() {
  if (!lexiSupabase || !lexiAuthSession?.user?.id) return;
  const userId = lexiAuthSession.user.id;

  // Safety gate: if ALL in-memory docs lack customer data, recover from localStorage
  if (state.saved.length > 0) {
    const docsWithNames = state.saved.filter(d => buildCustName(d.quote || '') || d.custName);
    if (docsWithNames.length === 0) {
      const localBackup = lsGet(KEY_SAVED) || [];
      if (localBackup.some(d => buildCustName(d.quote || '') || d.custName)) {
        state.saved = mergeSavedDocs(localBackup, state.saved);
        console.warn('saveSavedDocsToSupabase: recovered customer names from localStorage before sync');
      }
    }
  }

  // Step 1: find remote IDs — only select the lightweight local_id column
  const currentLocalIds = new Set((state.saved || []).map(d => d.id).filter(Boolean));
  const { data: remoteRows } = await lexiSupabase
    .from('documents')
    .select('local_id')
    .eq('user_id', userId);
  const toDelete = (remoteRows || []).map(r => r.local_id).filter(lid => lid && !currentLocalIds.has(lid));
  // Delete stale rows in one batch if possible
  if (toDelete.length) {
    await lexiSupabase.from('documents').delete().eq('user_id', userId).in('local_id', toDelete);
  }

  if (!state.saved.length) return;

  // Step 2: upsert each doc — customer cache is loaded once for all docs
  _clearCustIdCache();
  const docsWithCustomers = [];
  for (const doc of state.saved) {
    const customerId = await getSupabaseCustomerId(doc.quote || {});
    docsWithCustomers.push({ doc, customerId });
    try {
      await upsertSingleDocToSupabase(userId, doc, customerId);
    } catch (err) {
      const message = String(err?.message || '');
      if (/document_data|schema cache|column/i.test(message)) {
        throw new Error('Documents table needs a document_data JSONB column before Lexi can sync saved jobs.');
      }
      throw err;
    }
  }
  _clearCustIdCache(); // release memory

  // Step 3: sync job summaries (best-effort — skip if jobs table not set up)
  try {
    await saveJobSummariesToSupabase(userId, docsWithCustomers);
    localStorage.removeItem('lexi_last_jobs_sync_error');
  } catch (error) {
    console.warn('Documents synced, but job summaries did not sync to Supabase:', error);
    localStorage.setItem('lexi_last_jobs_sync_error', error?.message || String(error || 'Unknown jobs sync error'));
    // Don't toast — this is a background sync, silent failure is fine here
  }
}

async function insertJobSummaryRows(rows) {
  let lastError = null;
  for (const rowSet of rows) {
    const result = await lexiSupabase.from('jobs').insert(rowSet);
    if (!result.error) return true;
    lastError = result.error;
    const message = String(result.error.message || '');
    if (!/column|schema cache|relationship|foreign key|violates/i.test(message)) throw result.error;
  }
  if (lastError) throw lastError;
  return false;
}

async function saveJobSummariesToSupabase(userId, docsWithCustomers = []) {
  if (!lexiSupabase || !userId) return;
  if (!docsWithCustomers.length) return;

  const currentLocalIds = docsWithCustomers.map(d => d.doc.id).filter(Boolean);

  // Single upsert for all job summaries — one round-trip instead of delete+insert per doc
  const rows = [];
  for (const { doc, customerId } of docsWithCustomers) {
    if (!doc.id) continue;
    const candidates = jobSummaryInsertCandidates(userId, doc, customerId);
    if (candidates.length) rows.push(candidates[0]);
  }

  if (rows.length) {
    const { error } = await lexiSupabase.from('jobs').upsert(rows, { onConflict: 'user_id,local_id', ignoreDuplicates: false });
    if (error) {
      const msg = String(error.message || '');
      // If upsert fails due to schema mismatch, fall back silently — don't throw for column errors
      if (!/column|schema cache|relationship|foreign key|violates/i.test(msg)) throw error;
    }
  }

  // Remove rows for docs no longer in local storage — only fetch local_id column
  const { data: remoteJobs, error: fetchErr } = await lexiSupabase
    .from('jobs').select('local_id').eq('user_id', userId);
  if (fetchErr) return; // non-fatal — skip cleanup this cycle

  const localIdSet = new Set(currentLocalIds);
  const orphanIds = (remoteJobs || []).map(r => r.local_id).filter(lid => lid && !localIdSet.has(lid));
  if (orphanIds.length) {
    // Delete orphans in one call using in-filter
    await lexiSupabase.from('jobs').delete().eq('user_id', userId).in('local_id', orphanIds);
  }
}

// Sync ONE document instead of re-uploading the whole library every save.
// The full saveSavedDocsToSupabase() loops over every saved doc, which is what
// was hitting "canceling statement due to statement timeout" once a tradesman
// had a few jobs. This touches a single row, so it stays well under the limit.
async function syncSingleDocToSupabase(doc) {
  if (!lexiSupabase || !lexiAuthSession?.user?.id || !doc?.id) return;
  const userId = lexiAuthSession.user.id;
  _clearCustIdCache();
  try {
    const customerId = await getSupabaseCustomerId(doc.quote || {});
    await upsertSingleDocToSupabase(userId, doc, customerId);
    // Best-effort single job-summary upsert (no orphan cleanup — that would
    // wrongly delete every other job since we only know about this one doc).
    try {
      const candidates = jobSummaryInsertCandidates(userId, doc, customerId);
      if (candidates.length) {
        await lexiSupabase.from('jobs')
          .upsert(candidates[0], { onConflict: 'user_id,local_id', ignoreDuplicates: false });
      }
    } catch (e) { /* job summary is non-essential */ }
  } finally {
    _clearCustIdCache();
  }
}

// Persist the current quote-builder form (Customer/Work/Terms) as a saved job.
// Returns the saved doc so the caller can preview it or jump to the list.
function persistCurrentQuoteFromTerms() {
  const q = collectQuoteState();
  q.items = [...state.quote.items];
  if (!q.custLastName && !q.custFirstName) {
    toast('Please add a customer name.', 'error');
    showPage('page3');
    document.getElementById('custFirstName')?.focus();
    return null;
  }

  let doc;
  if (activeDocId) {
    // Update the existing saved job in place (no duplicate)
    doc = state.saved.find(d => d.id === activeDocId);
    if (doc) {
      doc.quote = q;
      doc.company = { ...state.company };
      doc.custName = buildCustName(q);
      doc.total = calcTotal(q);
      doc.type = q.type;
      doc.date = q.date;
      doc.ref = q.ref || doc.ref;
      doc.updatedAt = new Date().toISOString();
    }
  }
  if (!doc) {
    const newId = uid();
    doc = {
      id: newId,
      quote: q,
      company: { ...state.company },
      custName: buildCustName(q),
      total: calcTotal(q),
      type: q.type,
      date: q.date,
      ref: q.ref || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      invoiceSent: false, paid: false, paidAmount: 0, paidDate: '', payments: []
    };
    state.saved.unshift(doc);
    activeDocId = newId;
  }

  save();
  upsertLocalCustomer(q);
  updateSavedBadge();
  refreshSavedDocs();
  if (savedDocsSyncReady && lexiSupabase && lexiAuthSession?.user?.id) {
    syncSingleDocToSupabase(doc).catch(err => {
      console.warn('Single-doc sync failed:', err);
      localStorage.setItem('lexi_last_documents_sync_error', err?.message || String(err));
      toast(`Saved here, but cloud sync failed: ${err?.message || 'check connection'}`, 'error', 7000);
    });
  }
  return doc;
}

function queueSavedDocsSync(showError = false) {
  if (!savedDocsSyncReady || !lexiSupabase || !lexiAuthSession?.user?.id) return;
  clearTimeout(savedDocsSyncTimer);
  savedDocsSyncTimer = setTimeout(() => {
    saveSavedDocsToSupabase().then(() => {
      localStorage.removeItem('lexi_last_documents_sync_error');
    }).catch(error => {
      console.warn('Saved jobs saved locally but did not sync to Supabase:', error);
      localStorage.setItem('lexi_last_documents_sync_error', error?.message || String(error || 'Unknown document sync error'));
      toast(`Document sync failed: ${error?.message || 'check Supabase table setup'}`, 'error', 9000);
      if (showError) toast('Jobs saved here. Supabase sync needs another try.', 'error');
    });
  }, 30000); // 30s debounce — saves are local-first, cloud syncs in the background
}

window.lexiCheckDocumentSync = async function lexiCheckDocumentSync() {
  try {
    await saveSavedDocsToSupabase();
    localStorage.removeItem('lexi_last_documents_sync_error');
    toast(`Document sync worked. ${state.saved.length} job${state.saved.length === 1 ? '' : 's'} sent to Supabase.`, 'success', 8000);
    return { ok: true, count: state.saved.length };
  } catch (error) {
    const message = error?.message || String(error || 'Unknown document sync error');
    localStorage.setItem('lexi_last_documents_sync_error', message);
    toast(`Document sync failed: ${message}`, 'error', 12000);
    return { ok: false, message, error };
  }
};

/* ===== STORAGE ===== */
// Strip bulky fields from docs before writing to localStorage.
// company is already stored separately in KEY_CO and is restored on load.
// This prevents localStorage from filling up when company has a logo (base64 image).
function slimDocForStorage(doc) {
  // Strip bulky fields: company (stored separately), HTML cache, and photos
  // (base64 images can be hundreds of KB each — Supabase holds the full data)
  // eslint-disable-next-line no-unused-vars
  const { company, _html, photos, ...rest } = doc;
  // Also strip photos from nested quote object if present
  if (rest.quote && rest.quote.photos) {
    const { photos: _p, ...slimQ } = rest.quote;
    rest.quote = slimQ;
  }
  return rest;
}

function save() {
  try {
    ls(KEY_CO,    state.company);
    ls(KEY_PL,    state.priceList);
    ls(KEY_SAVED, (state.saved || []).map(slimDocForStorage));
    ls(KEY_CUSTOMERS, state.customers);
    queueSavedDocsSync();
  } catch(e) {
    // localStorage full — clear the saved docs cache (Supabase holds everything)
    // then retry with just company + price list + customers
    console.warn('localStorage full, clearing saved docs cache and retrying:', e);
    try {
      localStorage.removeItem(KEY_SAVED);
      ls(KEY_CO,    state.company);
      ls(KEY_PL,    state.priceList);
      ls(KEY_CUSTOMERS, state.customers);
    } catch(e2) {
      // Still full — only essential data matters; Supabase has everything
      console.error('localStorage save failed even after clearing cache:', e2);
    }
  }
}

function loadFromStorage() {
  // One-time cleanup: if old saved docs are bloated (company embedded in every doc),
  // clear the cache now so it stops filling localStorage. Supabase will reload everything.
  try {
    const raw = localStorage.getItem(KEY_SAVED);
    if (raw && raw.length > 200000) {
      // Over ~200KB of saved docs in localStorage — clear it to free up space
      localStorage.removeItem(KEY_SAVED);
      console.warn('loadFromStorage: cleared oversized saved docs from localStorage — Supabase will restore them');
    }
  } catch(e) { /* ignore */ }

  state.company   = lsGet(KEY_CO)    || state.company;
  state.priceList = lsGet(KEY_PL)    || [];
  // Restore company snapshot into each doc (it was stripped on save to save space)
  const rawSaved  = lsGet(KEY_SAVED) || [];
  state.saved     = rawSaved.map(doc => ({ company: { ...state.company }, ...doc }));
  state.customers = lsGet(KEY_CUSTOMERS) || [];
  // Migrate: ensure every price list item has an id
  let needsSave = false;
  state.priceList.forEach(j => {
    if (!j.id) { j.id = uid(); needsSave = true; }
  });
  if (needsSave) ls(KEY_PL, state.priceList);
}

function ls(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
function lsGet(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

function nextRef(prefix, key) {
  const n = parseInt(localStorage.getItem(key) || '0') + 1;
  localStorage.setItem(key, n);
  const now = new Date();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dateStr = `${String(now.getDate()).padStart(2,'0')}${months[now.getMonth()]}${String(now.getFullYear()).slice(-2)}`;
  return `LEXI-${String(n).padStart(3, '0')}-${dateStr}`;
}

/* ===== TOAST ===== */
function toast(msg, type = '', duration = 3000) {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast${type ? ' ' + type : ''}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 350);
  }, duration);
}

function showSavedPopup(label, onDone, duration = 2500) {
  const overlay = document.createElement('div');
  overlay.className = 'saved-popup-overlay';
  overlay.innerHTML = `
    <div class="saved-popup-box">
      <div class="saved-popup-tick">✓</div>
      <div class="saved-popup-msg">${label || "I've saved that for you."}</div>
    </div>`;
  document.body.appendChild(overlay);

  function dismiss() {
    clearTimeout(timer);
    overlay.classList.add('fade-out');
    setTimeout(() => {
      overlay.remove();
      if (onDone) onDone();
    }, 350);
  }

  overlay.addEventListener('click', dismiss);
  const timer = setTimeout(dismiss, duration);
}

const KEY_NAV_HINT   = 'tq_nav_hint_suppressed';
const KEY_DRAFT_QUOTE = 'lexi_draft_quote'; // in-progress quote, survives refresh

function showNavHint() {
  if (localStorage.getItem(KEY_NAV_HINT)) return;
  const popup = document.getElementById('navHintPopup');
  const msg = popup?.querySelector('.nav-hint-msg');
  if (msg) {
    msg.innerHTML = `What would you like to do next ${traderFirstName()}? Use the menu <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" style="vertical-align:-2px;display:inline-block" aria-hidden="true"><circle cx="12" cy="5" r="2.5" fill="currentColor"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/><circle cx="12" cy="19" r="2.5" fill="currentColor"/></svg> above to explore everything Lexi can help you with.`;
  }
  if (popup) popup.style.display = 'block';
}

function setupNavHint() {
  const popup    = document.getElementById('navHintPopup');
  const closeBtn = document.getElementById('navHintClose');
  const suppress = document.getElementById('navHintSuppress');
  if (!popup || !closeBtn || !suppress) return;

  function closeNavHint() {
    if (suppress.checked) localStorage.setItem(KEY_NAV_HINT, '1');
    popup.style.display = 'none';
  }

  closeBtn.addEventListener('click', closeNavHint);

  // Click anywhere outside the card to dismiss
  document.addEventListener('click', e => {
    if (popup.style.display === 'none') return;
    if (!popup.contains(e.target)) closeNavHint();
  });

  suppress.addEventListener('change', () => {
    if (suppress.checked) localStorage.setItem(KEY_NAV_HINT, '1');
    else localStorage.removeItem(KEY_NAV_HINT);
  });
}

/* ===== PAGE NAVIGATION ===== */
/* ===== QUOTE BUILDER TABS ===== */
const QB_PAGES = ['page3', 'page-jobs', 'page-completion'];
const QB_TAB_ORDER = ['page3', 'page-jobs', 'page-completion', 'qb-preview'];

function _updateQBTabs(activePageId) {
  document.querySelectorAll('.qb-tab').forEach(btn => {
    const tab = btn.dataset.qbtab;
    btn.classList.toggle('active', tab === activePageId);
    const idx = QB_TAB_ORDER.indexOf(tab);
    const activeIdx = QB_TAB_ORDER.indexOf(activePageId);
    btn.classList.toggle('done', idx < activeIdx);
  });
}

function _saveCustomerQuiet() {
  const first = (getVal('custFirstName') || '').trim();
  if (!first) return; // nothing to save yet
  Object.assign(state.quote, customerQuoteFromForm());
  upsertLocalCustomer(state.quote);
  queueCustomerSync(state.quote, false);
  queueDraftSave();
}

function initQuoteBuilderTabs() {
  // Tab click handler
  document.querySelectorAll('.qb-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.qbtab;
      if (target === 'qb-preview') {
        // Auto-save then open preview
        _saveCustomerQuiet();
        recalcTotals();
        if (typeof openQuoteModalFromCurrentForm === 'function') openQuoteModalFromCurrentForm();
        return;
      }
      // Moving forward from customer tab: save quietly
      if (target === 'page-jobs' || target === 'page-completion') {
        _saveCustomerQuiet();
      }
      if (target === 'page-jobs') {
        setVal('jobPickerSearch', '');
        updateJobPicker();
        renderQuoteItems();
      }
      if (target === 'page-completion') recalcTotals();
      showPage(target);
    });
  });

  // Auto-save customer fields on blur
  ['custFirstName','custLastName','custPhone','custEmail','custAddr','custPostcode'].forEach(id => {
    document.getElementById(id)?.addEventListener('blur', _saveCustomerQuiet);
  });

  // One-off service add
  document.getElementById('addCustomServiceBtn')?.addEventListener('click', addCustomService);

  // Back button: within QB pages go to previous tab; on first tab show exit prompt
  const _origPopstate = window._lexiQBPopstateAdded;
  if (!_origPopstate) {
    window._lexiQBPopstateAdded = true;
    window.addEventListener('popstate', () => {
      const activePage = document.querySelector('.page.active');
      if (!activePage) return;
      const pageId = activePage.id;
      if (!QB_PAGES.includes(pageId)) return;
      const idx = QB_TAB_ORDER.indexOf(pageId);
      if (idx <= 0) {
        // First QB page — ask if they want to exit
        history.pushState({}, '');
        if (confirm('Do you want to exit without finishing your quote?')) {
          showPage('page4');
        }
        return;
      }
      history.pushState({}, '');
      showPage(QB_TAB_ORDER[idx - 1]);
    }, { capture: false });
  }
}

function showPage(pageId) {
  if (pageId !== 'page1' && !canUseMainApp()) {
    requireSetupGuard();
    return;
  }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pg = document.getElementById(pageId);
  if (pg) {
    pg.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Show/hide quote builder tab bar
  const tabBar = document.getElementById('quoteBuilderTabs');
  const inQB = QB_PAGES.includes(pageId) || pageId === 'qb-preview';
  if (tabBar) tabBar.style.display = inQB ? 'block' : 'none';
  document.body.classList.toggle('qb-mode', inQB);
  if (inQB) _updateQBTabs(pageId);
  // Hide loading overlay once the correct page is shown
  const overlay = document.getElementById('appLoadingOverlay');
  if (overlay) overlay.style.display = 'none';

  // Update page1 title if business already set up
  if (pageId === 'page1') {
    const hasSetUp = (state.company.lastName || '').trim() !== '';
    const p1Title = document.getElementById('page1Title');
    const p1Sub   = document.getElementById('page1Sub');
    if (p1Title) {
      if (hasSetUp) {
        p1Title.innerHTML = 'Edit My Business';
      } else {
        p1Title.innerHTML = '<span class="page-num">1.</span> Set Up Your Business';
      }
    }
    if (p1Sub) {
      if (hasSetUp) {
        p1Sub.textContent = `Brilliant ${traderFirstName()}, your business is progressing. Let's keep it up to date.`;
        p1Sub.style.display = '';
        p1Sub.style.textAlign = 'left';
      } else {
        p1Sub.textContent = `Right then. Tell me about your business and I'll get your documents looking the part.`;
        p1Sub.style.display = '';
        p1Sub.style.textAlign = '';
      }
    }
  }

  // Update page1 footer button based on whether price list exists
  if (pageId === 'page1') {
    updatePriceListBtn();
  }

  // Update page2 header based on whether price list already has content
  if (pageId === 'page2') {
    updatePage2Header();
    // Restore obo tab states based on what's already in the price list
    const hasSvc = state.priceList.some(j => j.category !== 'materials');
    const hasMat = state.priceList.some(j => j.category === 'materials');
    if (hasSvc && oboState.svc === 'prompt') oboState.svc = 'postfill';
    if (hasMat && oboState.mat === 'prompt') oboState.mat = 'postfill';
    // Re-render the active obo tab so the visible panel matches oboState
    if (typeof _switchOboGrid === 'function') {
      const activeTab = document.querySelector('#jobCatSelector .obo-tab.active')?.dataset?.cat || 'service';
      _switchOboGrid(activeTab);
    }
  }

  personaliseText();

  // Update page3 title
  if (pageId === 'page3') {
    const titleEl = document.getElementById('page3Title');
    if (titleEl) titleEl.textContent = 'Add Customer';
  }

  // Render calendar when navigating to it
  if (pageId === 'page-calendar') {
    renderCalendar();
  }

  // Ensure signature preview is always populated when reaching the completion page
  if (pageId === 'page-completion') {
    const authSig = document.getElementById('authSig');
    const custSigText = document.getElementById('custSigText');
    const sigAutoToggle = document.getElementById('sigAutoToggle');
    const isAuto = sigAutoToggle ? sigAutoToggle.checked : false;
    const sigAutoLabel = document.getElementById('sigAutoLabel');
    if (sigAutoLabel) sigAutoLabel.textContent = isAuto ? 'Auto' : 'Manual';
    if (custSigText) {
      custSigText.readOnly = isAuto;
      if (isAuto) {
        custSigText.value = formatSigFromName(authSig?.value) || defaultAuthSig();
      } else if (!custSigText.value) {
        custSigText.value = '';
      }
    }
    // Personalise the intro text with the customer's first name
    const introEl = document.getElementById('completionIntroText');
    if (introEl) {
      const first = (state.quote.custFirstName || '').trim();
      introEl.textContent = first ? `${first}, is this an estimate or a quote?` : 'Is this an estimate or a quote?';
    }
    // Close tooltip if it was left open
    const tooltip = document.getElementById('estQuoteTooltip');
    if (tooltip) tooltip.style.display = 'none';
  }
}

function updatePriceListBtn() {
  const btn = document.getElementById('goToPriceListBtn');
  if (!btn) return;
  if (state.priceList.length > 0) {
    btn.innerHTML = 'My Rates &amp; Services';
  } else {
    btn.innerHTML = 'My Rates &amp; Services';
  }
}

function updatePage2Header() {
  const title = document.getElementById('page2Title');
  const sub   = document.getElementById('page2Sub');
  if (title) title.textContent = 'My Rates, Services & Materials';
  if (sub) {
    sub.textContent = `Your jobs, your prices. Make sure you're charging what you're worth.`;
    sub.style.display = '';
  }
}

function setupNavigation() {
  const hamburger = document.getElementById('hamburgerBtn');
  const navMenu   = document.getElementById('navMenu');
  const overlay   = document.getElementById('navMenuOverlay');

  function openMenu() {
    hamburger.classList.add('open');
    navMenu.classList.add('open');
    overlay.classList.add('open');
    hamburger.setAttribute('aria-expanded', 'true');
    navMenu.setAttribute('aria-hidden', 'false');
  }

  function closeMenu() {
    hamburger.classList.remove('open');
    navMenu.classList.remove('open');
    overlay.classList.remove('open');
    hamburger.setAttribute('aria-expanded', 'false');
    navMenu.setAttribute('aria-hidden', 'true');
  }
  // Expose globally so other modules (Chase Payments, Pause, Quals) can close the menu
  window.closeMenu = closeMenu;

  hamburger.addEventListener('click', () => {
    if (!canUseMainApp()) { requireSetupGuard(); return; }
    const onCompletion = document.getElementById('page-completion')?.classList.contains('active');
    if (onCompletion && !state.quote.type) { docTypeGuard(); return; }
    navMenu.classList.contains('open') ? closeMenu() : openMenu();
  });
  overlay.addEventListener('click', closeMenu);

  // Menu items + any other [data-target] elements (e.g. what-next-bar)
  document.querySelectorAll('[data-target]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      const onCompletion = document.getElementById('page-completion')?.classList.contains('active');
      if (onCompletion && !state.quote.type) {
        closeMenu();
        docTypeGuard();
        return;
      }
      closeMenu();
      if (target === 'page3') {
        if (quietSeasonGuard()) return;
        prepareNewQuote();
      }
      showPage(target);
    });
  });

  // Submenu toggle helper
  function setupSubmenu(triggerId, submenuId) {
    const trigger = document.getElementById(triggerId);
    const submenu = document.getElementById(submenuId);
    if (!trigger || !submenu) return;
    trigger.addEventListener('click', e => {
      e.stopPropagation();
      // Close all other submenus first
      document.querySelectorAll('.nav-submenu.open').forEach(s => {
        if (s !== submenu) { s.classList.remove('open'); s.previousElementSibling?.classList.remove('open'); }
      });
      const isOpen = submenu.classList.contains('open');
      submenu.classList.toggle('open', !isOpen);
      trigger.classList.toggle('open', !isOpen);
    });
  }

  setupSubmenu('menuNewDoc',        'navNewDocSubmenu');
  setupSubmenu('menuManageJobs',    'navManageJobsSubmenu');
  setupSubmenu('menuManageBusiness','navManageBusinessSubmenu');
  setupSubmenu('menuSettings',      'navSettingsSubmenu');

  document.getElementById('menuQuickQr')?.addEventListener('click', () => {
    closeMenu();
    openQuickQrModal(false);
  });

  // Field info ? popup (CRN, VAT, etc.)
  document.querySelectorAll('.field-info-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      document.getElementById('fieldInfoTitle').textContent = btn.dataset.title || '';
      document.getElementById('fieldInfoBody').textContent  = btn.dataset.body  || '';
      document.getElementById('fieldInfoPopup').style.display = 'flex';
    });
  });
  document.getElementById('closeFieldInfoBtn')?.addEventListener('click', () => {
    document.getElementById('fieldInfoPopup').style.display = 'none';
  });
  document.getElementById('fieldInfoPopup')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) document.getElementById('fieldInfoPopup').style.display = 'none';
  });

  // Reference ? popup
  document.querySelectorAll('.ref-info-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      document.getElementById('refInfoPopup').style.display = 'flex';
    });
  });
  document.getElementById('closeRefInfoBtn')?.addEventListener('click', () => {
    document.getElementById('refInfoPopup').style.display = 'none';
  });
  document.getElementById('refInfoPopup')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) document.getElementById('refInfoPopup').style.display = 'none';
  });

  // New Invoice from menu
  document.getElementById('menuNewInvoice')?.addEventListener('click', () => {
    if (!canUseMainApp()) { requireSetupGuard(); return; }
    if (quietSeasonGuard()) { closeMenu(); return; }
    closeMenu();
    openClientPicker('invoice');
  });

  // New Receipt from menu
  document.getElementById('menuNewReceipt')?.addEventListener('click', () => {
    if (!canUseMainApp()) { requireSetupGuard(); return; }
    if (quietSeasonGuard()) { closeMenu(); return; }
    closeMenu();
    openClientPicker('receipt');
  });


  document.getElementById('menuBizInfo')?.addEventListener('click', () => {
    if (!canUseMainApp()) { requireSetupGuard(); return; }
    closeMenu();
    setTimeout(openSendChoiceModal, 180);
  });

  // Qualifications are now shared from within Send My Business Info -no separate menu item needed

  document.getElementById('menuAddToHome')?.addEventListener('click', () => {
    closeMenu();
    handleAddToHomeScreen();
  });

  // Also show the button if already on iOS (can't detect beforeinstallprompt on iOS)
  if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone) {
    const btn = document.getElementById('menuAddToHome');
    if (btn) btn.style.display = '';
  }

  document.getElementById('menuShareLexi')?.addEventListener('click', () => {
    if (!canUseMainApp()) { requireSetupGuard(); return; }
    closeMenu();
    shareLexiApp();
  });

  // Backup & Restore menu item
  const backupBtn = document.getElementById('menuBackupRestore');
  if (backupBtn) {
    backupBtn.addEventListener('click', () => {
      if (!canUseMainApp()) { requireSetupGuard(); return; }
      closeMenu();
      document.getElementById('backupRestoreModal').style.display = 'flex';
    });
  }

  document.getElementById('menuTrialPlans')?.addEventListener('click', () => {
    closeMenu();
    openTrialPlansModal();
  });
  document.getElementById('closeTrialPlansBtn')?.addEventListener('click', closeTrialPlansModal);
  document.getElementById('trialKeepGoingBtn')?.addEventListener('click', closeTrialPlansModal);
  document.getElementById('trialPlansModal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeTrialPlansModal();
  });

  // Sign Out
  const signOutBtn = document.getElementById('menuSignOut');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', () => {
      closeMenu();
      if (confirm('Sign out? Your saved jobs will remain on this device.')) {
        signOutOfLexi();
      }
    });
  }

  // Delete account — multi-step offboarding
  const daShowStep = step => {
    ['daStep1','daStep2','daStep3'].forEach(id => {
      document.getElementById(id).style.display = id === step ? '' : 'none';
    });
  };
  const daClose = () => {
    document.getElementById('deleteAccountModal').style.display = 'none';
    daShowStep('daStep1'); // reset for next time
    const r = document.getElementById('daReason');
    if (r) r.value = '';
  };

  document.getElementById('menuDeleteAccount')?.addEventListener('click', () => {
    closeMenu();
    daShowStep('daStep1');
    document.getElementById('deleteAccountModal').style.display = 'flex';
  });

  // Step 1 — reason selected, move to quiet season offer
  document.getElementById('daStep1NextBtn')?.addEventListener('click', () => {
    daShowStep('daStep2');
  });
  document.getElementById('daStep1CancelBtn')?.addEventListener('click', daClose);

  // Step 2 — quiet season offer
  document.getElementById('daQuietSeasonYesBtn')?.addEventListener('click', () => {
    daClose();
    // Open quiet season mode
    document.getElementById('menuQuietSeason')?.click();
  });
  document.getElementById('daQuietSeasonNoBtn')?.addEventListener('click', () => {
    daShowStep('daStep3');
  });

  // Step 3 — final confirmation
  document.getElementById('deleteAccountCancelBtn')?.addEventListener('click', daClose);
  document.getElementById('deleteAccountConfirmBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('deleteAccountConfirmBtn');
    btn.textContent = 'Deleting...';
    btn.disabled = true;
    try {
      if (lexiSupabase && lexiAuthSession?.user?.id) {
        const uid = lexiAuthSession.user.id;
        await lexiSupabase.from('documents').delete().eq('user_id', uid);
        await lexiSupabase.from('jobs').delete().eq('user_id', uid);
        await lexiSupabase.from('quote_acceptances').delete().eq('user_id', uid);
        await lexiSupabase.rpc('delete_own_account');
      }
    } catch(e) {
      console.warn('Account deletion error:', e);
    }
    localStorage.clear();
    daClose();
    window.location.reload();
  });

  // Page footer nav buttons
  document.getElementById('goToPriceListBtn').addEventListener('click', () => {
    if (!saveBusinessDetails(false)) return;
    showPage('page2');
  });
  document.getElementById('goToQuoteBtn').addEventListener('click', () => {
    if (state.priceList.length === 0) {
      showSavedPopup("Add at least one job to your price list first, then we're good to go.");
      return;
    }
    showPage('page4');
  });
  document.getElementById('saveCustomerGoToJobsBtn')?.addEventListener('click', () => {
    const first = (getVal('custFirstName') || '').trim();
    const last  = (getVal('custLastName')  || '').trim();
    if (!first && !last) {
      toast('Please enter the customer\'s first or last name.', 'error');
      document.getElementById('custFirstName').focus();
      return;
    }
    Object.assign(state.quote, customerQuoteFromForm());
    upsertLocalCustomer(state.quote);
    queueCustomerSync(state.quote, true);
    showPage('page-jobs');
    setVal('jobPickerSearch', '');
    updateJobPicker();
    renderQuoteItems();
    setTimeout(() => document.getElementById('jobPickerSearch')?.focus(), 300);
  });
  document.getElementById('backToSetupBtn').addEventListener('click', () => showPage('page1'));
  document.getElementById('createFirstQuoteBtn')?.addEventListener('click', () => {
    prepareNewQuote();
    showPage('page3');
  });
}

/* ===== ONBOARDING ===== */
function setupOnboarding() {
  const modal = document.getElementById('onboardingModal');
  const onboarded = localStorage.getItem(KEY_ONBOARDED);
  if (onboarded || canUseMainApp()) {
    localStorage.setItem(KEY_ONBOARDED, '1');
    if (modal) modal.style.display = 'none';
    return;
  }

  modal.style.display = 'flex';
  modal.classList.add('for-onboarding');

  // Populate trial countdown badge
  const badgeDays = document.getElementById('obTrialDays');
  if (badgeDays) badgeDays.textContent = getTrialDaysRemaining() || TRIAL_DAYS;

  document.getElementById('startBtn').addEventListener('click', () => {
    const source = document.getElementById('referralSource').value;
    submitReferral(source);
    ensureTrialStarted();
    localStorage.setItem(KEY_ONBOARDED, '1');
    modal.style.display = 'none';
    showPage(canUseMainApp() ? 'page4' : 'page1');
  });
}

function openTrialPlansModal() {
  const days = getTrialDaysRemaining();
  const title = document.getElementById('trialStatusTitle');
  const copy = document.getElementById('trialStatusCopy');
  if (title && copy) {
    if (days > 0) {
      title.textContent = `${days} day${days === 1 ? '' : 's'} left in your free trial.`;
      copy.textContent = 'No card needed today. Keep using Lexi and choose a plan near the end if she is earning her keep.';
    } else {
      title.textContent = 'Your free trial has ended.';
      copy.textContent = 'You can still view your saved work. Choose a plan when you are ready to keep creating new documents.';
    }
  }
  const modal = document.getElementById('trialPlansModal');
  if (modal) modal.style.display = 'flex';
}

function closeTrialPlansModal() {
  const modal = document.getElementById('trialPlansModal');
  if (modal) modal.style.display = 'none';
}

async function submitReferral(source) {
  if (!FORMSPREE_URL || FORMSPREE_URL === 'YOUR_FORM_ID') return;
  try {
    await fetch(`https://formspree.io/f/${FORMSPREE_URL}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ referral: source })
    });
  } catch {}
}

/* ===== PAGE 1 -BUSINESS SETUP ===== */
function setupPage1() {
  // Logo upload
  const logoArea   = document.getElementById('logoUploadArea');
  const logoFile   = document.getElementById('logoFile');
  const changeBtn  = document.getElementById('changeLogoBtn');
  const removeBtn  = document.getElementById('removeLogoBtn');

  logoArea.addEventListener('click', (e) => {
    if (!e.target.closest('.logo-actions')) logoFile.click();
  });
  logoArea.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') logoFile.click(); });
  logoFile.addEventListener('change', handleLogoUpload);
  changeBtn.addEventListener('click', (e) => { e.stopPropagation(); logoFile.click(); });
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    state.company.logo = '';
    showLogoState();
    save();
  });

  // QR code upload
  const qrArea      = document.getElementById('qrUploadArea');
  const qrFile      = document.getElementById('qrFile');
  const changeQrBtn = document.getElementById('changeQrBtn');
  const removeQrBtn = document.getElementById('removeQrBtn');
  if (qrArea && qrFile) {
    qrArea.addEventListener('click', e => {
      if (!e.target.closest('.logo-actions')) qrFile.click();
    });
    qrArea.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') qrFile.click(); });
    qrFile.addEventListener('change', handleQRUpload);
    changeQrBtn?.addEventListener('click', e => { e.stopPropagation(); qrFile.click(); });
    removeQrBtn?.addEventListener('click', e => {
      e.stopPropagation();
      state.company.qrCode = '';
      showQRState();
      save();
      saveBusinessToSupabase().catch(error => {
        console.warn('QR code removed locally but did not sync to Supabase:', error);
      });
    });
  }

  // Qualifications upload
  const qualsArea    = document.getElementById('qualsUploadArea');
  const qualsFile    = document.getElementById('qualsFile');
  const qualsAddMore = document.getElementById('qualsAddMoreBtn');
  if (qualsArea && qualsFile) {
    qualsArea.addEventListener('click', e => {
      if (!e.target.closest('.quals-file-list') && !e.target.closest('.quals-add-more-btn')) qualsFile.click();
    });
    qualsArea.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') qualsFile.click(); });
    qualsFile.addEventListener('change', handleQualUpload);
  }
  qualsAddMore?.addEventListener('click', e => { e.stopPropagation(); qualsFile.click(); });

  document.querySelectorAll('.social-link-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const fieldId = btn.getAttribute('aria-controls');
      const field = document.getElementById(fieldId);
      if (!field) return;
      const open = field.hidden;
      field.hidden = !open;
      btn.classList.toggle('active', open);
      btn.setAttribute('aria-expanded', String(open));
      if (open) field.querySelector('input')?.focus();
    });
  });

  // Payment method toggles
  document.getElementById('payBankTransfer').addEventListener('change', e => {
    document.getElementById('bankDetails').style.display = e.target.checked ? 'block' : 'none';
  });

  // Sort code auto-format: XX-XX-XX
  document.getElementById('bankSort').addEventListener('input', function () {
    const pos = this.selectionStart;
    let digits = this.value.replace(/\D/g, '').slice(0, 6);
    let formatted = digits;
    if (digits.length > 4) formatted = digits.slice(0, 2) + '-' + digits.slice(2, 4) + '-' + digits.slice(4);
    else if (digits.length > 2) formatted = digits.slice(0, 2) + '-' + digits.slice(2);
    this.value = formatted;
    // Restore cursor position (accounting for inserted hyphens)
    const err = document.getElementById('bankSortError');
    if (err) err.style.display = 'none';
    this.classList.remove('error');
  });
  document.getElementById('payPaypal').addEventListener('change', e => {
    document.getElementById('paypalDetails').style.display = e.target.checked ? 'block' : 'none';
  });
  document.getElementById('payOther').addEventListener('change', e => {
    document.getElementById('payOtherDetails').style.display = e.target.checked ? 'block' : 'none';
  });

  // Colour pickers
  setupColourPicker('header', 'colourHeader', DEFAULT_COLOURS.primary);
  setupColourPicker('accent', 'colourAccent', DEFAULT_COLOURS.accent);
  setupColourPicker('bg',     'colourBg',     DEFAULT_COLOURS.bg);

  // Logo colour extraction checkbox
  document.getElementById('useLogoColours').addEventListener('change', e => {
    if (e.target.checked) {
      extractLogoColours();
    } else {
      setColour('header', DEFAULT_COLOURS.primary);
      setColour('accent', DEFAULT_COLOURS.accent);
      setColour('bg',     DEFAULT_COLOURS.bg);
      updateColourPreview();
    }
  });

  // Brand tooltip
  document.getElementById('brandTooltipBtn').addEventListener('click', () => {
    const t = document.getElementById('brandTooltip');
    t.style.display = t.style.display === 'none' ? 'block' : 'none';
  });

  // Reset colour menu
  document.getElementById('resetColourMenu').addEventListener('click', () => {
    const dd = document.getElementById('resetColourDropdown');
    dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
  });

  document.querySelectorAll('[data-reset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = btn.dataset.reset;
      if (r === 'all' || r === 'header') { setColour('header', DEFAULT_COLOURS.primary); }
      if (r === 'all' || r === 'accent') { setColour('accent', DEFAULT_COLOURS.accent); }
      if (r === 'all' || r === 'bg')     { setColour('bg',     DEFAULT_COLOURS.bg); }
      document.getElementById('useLogoColours').checked = false;
      document.getElementById('resetColourDropdown').style.display = 'none';
      updateColourPreview();
    });
  });

  // Close dropdown on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('.colour-reset-row')) {
      document.getElementById('resetColourDropdown').style.display = 'none';
    }
  });

  // Save button
  document.getElementById('saveBusinessBtn').addEventListener('click', () => saveBusinessDetails(true));

  // Backup/restore modal (from menu)
  document.getElementById('exportDataBtn2').addEventListener('click', exportData);
  document.getElementById('importDataBtn2').addEventListener('click', () => document.getElementById('importDataFile2').click());
  document.getElementById('importDataFile2').addEventListener('change', importData);
  document.getElementById('closeBackupModal').addEventListener('click', () => {
    document.getElementById('backupRestoreModal').style.display = 'none';
  });
  document.getElementById('backupRestoreModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
  });
}

/* ===== UNIVERSAL BACKDROP-CLICK-TO-CLOSE ===== */
// Any .modal-overlay click on the backdrop (not its children) closes the modal.
// Modals that need extra cleanup are handled with special cases.
document.addEventListener('click', e => {
  if (!e.target.classList.contains('modal-overlay')) return;
  const id = e.target.id;
  if (id === 'photosModal') { closePhotosAndReturn(); return; }
  if (id === 'markPaidModal') { e.target.style.display = 'none'; reopenDashboardAfterMoneyIn(); return; }
  if (id === 'customerDashboardModal') { e.target.style.display = 'none'; activeCustomerGroup = null; return; }
  if (id === 'previewModal') { closePreview(); return; }
  if (id === 'quoteModal' || id === 'invoiceModal' || id === 'receiptModal') {
    e.target.style.display = 'none';
    setShareBackButtons(false);
    if (document.getElementById('page4')?.classList.contains('active')) window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  // Default: hide the overlay
  e.target.style.display = 'none';
});

function handleLogoUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('Please upload an image file.', 'error'); return; }
  if (file.size > 5 * 1024 * 1024) { toast('Image must be under 5MB.', 'error'); return; }
  const reader = new FileReader();
  reader.onload = ev => {
    state.company.logo = ev.target.result;
    state.company.bizChoiceMade = null; // reset so docs are prompted to use new logo
    showLogoState();
    save();
    if (document.getElementById('useLogoColours')?.checked) {
      extractLogoColours();
    } else {
      showSavedPopup("Great Logo, you'll really stand out!", null, 5000);
    }
  };
  reader.readAsDataURL(file);
}

function showLogoState() {
  const haslLogo = !!state.company.logo;
  document.getElementById('logoPlaceholder').style.display = haslLogo ? 'none' : 'flex';
  document.getElementById('logoPreview').style.display     = haslLogo ? 'flex' : 'none';
  if (haslLogo) document.getElementById('logoImg').src = state.company.logo;
}

function handleQRUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('Please upload an image file.', 'error'); return; }
  if (file.size > 5 * 1024 * 1024) { toast('Image must be under 5MB.', 'error'); return; }
  const reader = new FileReader();
  reader.onload = ev => {
    state.company.qrCode = ev.target.result;
    showQRState();
    save();
    saveBusinessToSupabase().catch(error => {
      console.warn('QR code saved locally but did not sync to Supabase:', error);
      toast('QR saved on this device. Supabase sync needs another try.', 'error');
    });
    returnToPendingQrView();
    showSavedPopup('QR code saved -it will appear on all your documents.', null, 3500);
  };
  reader.readAsDataURL(file);
}

function showQRState() {
  const hasQR = !!state.company.qrCode;
  const placeholder = document.getElementById('qrPlaceholder');
  const preview     = document.getElementById('qrPreview');
  const img         = document.getElementById('qrImg');
  if (placeholder) placeholder.style.display = hasQR ? 'none' : 'flex';
  if (preview)     preview.style.display     = hasQR ? 'flex' : 'none';
  if (hasQR && img) img.src = state.company.qrCode;
}

/* ===== QUALIFICATIONS ===== */
function handleQualUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const allowed = ['image/jpeg','image/png','image/gif','image/webp','application/pdf'];
  if (!allowed.includes(file.type)) { toast('Please upload a PDF or image file.', 'error'); return; }
  if (file.size > 10 * 1024 * 1024) { toast('File must be under 10 MB.', 'error'); return; }
  const reader = new FileReader();
  reader.onload = ev => {
    if (!state.company.qualifications) state.company.qualifications = [];
    state.company.qualifications.push({ name: file.name, type: file.type, data: ev.target.result });
    showQualsState();
    save();
    showSavedPopup('Qualification saved.', null, 2500);
  };
  reader.readAsDataURL(file);
  // Reset so same file can be re-uploaded
  e.target.value = '';
}

function showQualsState() {
  const quals       = state.company.qualifications || [];
  const placeholder = document.getElementById('qualsPlaceholder');
  const fileList    = document.getElementById('qualsFileList');
  const addMore     = document.getElementById('qualsAddMoreBtn');
  if (!placeholder || !fileList) return;

  if (quals.length === 0) {
    placeholder.style.display = 'flex';
    fileList.style.display    = 'none';
    if (addMore) addMore.style.display = 'none';
  } else {
    placeholder.style.display = 'none';
    fileList.style.display    = 'block';
    if (addMore) addMore.style.display = 'block';
    fileList.innerHTML = quals.map((q, i) => `
      <div class="quals-file-row">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="14" height="18" rx="2"/><path d="M10 3h8l4 4v14a2 2 0 0 1-2 2h-6"/></svg>
        <span class="quals-file-name" title="${esc(q.name)}">${esc(q.name)}</span>
        <button type="button" class="quals-remove-btn" onclick="removeQual(${i})" aria-label="Remove">&#x2715;</button>
      </div>`).join('');
  }
}

function removeQual(index) {
  if (!state.company.qualifications) return;
  state.company.qualifications.splice(index, 1);
  showQualsState();
  save();
}

function openQualsModal() {
  const quals = state.company.qualifications || [];
  const listEl = document.getElementById('qualsModalList');
  const emptyEl = document.getElementById('qualsModalEmpty');
  if (quals.length === 0) {
    if (listEl) listEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
  } else {
    if (emptyEl) emptyEl.style.display = 'none';
    if (listEl) listEl.innerHTML = quals.map((q, i) => {
      const isPdf = q.type === 'application/pdf';
      return `
        <div class="quals-modal-row">
          <div class="quals-modal-row-info">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="14" height="18" rx="2"/><path d="M10 3h8l4 4v14a2 2 0 0 1-2 2h-6"/></svg>
            <span>${esc(q.name)}</span>
          </div>
          <div class="quals-modal-row-btns">
            <button type="button" class="btn btn-sm btn-outline" onclick="viewQual(${i})">View</button>
            <button type="button" class="btn btn-sm btn-primary" onclick="shareQual(${i})">Share</button>
          </div>
        </div>`;
    }).join('');
  }
  document.getElementById('qualsModal').style.display = 'flex';
}

function viewQual(index) {
  const q = (state.company.qualifications || [])[index];
  if (!q) return;
  const w = window.open('', '_blank');
  if (!w) return;
  if (q.type === 'application/pdf') {
    w.document.write(`<html><body style="margin:0"><embed src="${q.data}" type="application/pdf" width="100%" height="100%" style="position:fixed;inset:0"></body></html>`);
  } else {
    w.document.write(`<html><body style="margin:0;background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh"><img src="${q.data}" style="max-width:100%;max-height:100vh;object-fit:contain"></body></html>`);
  }
}

function shareQual(index) {
  const q = (state.company.qualifications || [])[index];
  if (!q) return;
  if (navigator.share) {
    fetch(q.data)
      .then(r => r.blob())
      .then(blob => {
        const file = new File([blob], q.name, { type: q.type });
        navigator.share({ files: [file], title: q.name }).catch(() => {});
      });
  } else {
    // Fallback: open for download
    const a = document.createElement('a');
    a.href = q.data;
    a.download = q.name;
    a.click();
  }
}

function populatePage1Fields() {
  const c = state.company;
  setVal('p1FirstName',    c.firstName);
  setVal('p1LastName',     c.lastName);
  setVal('p1PreferredName', c.preferredName || '');
  setVal('p1BusinessName', c.businessName);
  setVal('p1Address',      c.address);
  setVal('p1Postcode',      c.postcode);
  setVal('p1Phone',         c.phone);
  setVal('p1Email',         c.email);
  setVal('p1Website',       c.website);
  setVal('p1ReviewLink',    c.reviewLink || '');
  setVal('p1CompanyNumber', c.companyNumber || '');
  setVal('p1VatNumber',     c.vatNumber || '');
  setVal('p1Trade',         c.trade || '');
  setVal('p1Facebook',      c.socialLinks?.facebook || '');
  setVal('p1Instagram',     c.socialLinks?.instagram || '');
  setVal('p1Twitter',       c.socialLinks?.twitter || '');

  // Auto-expand "Show more" if any hidden fields already have data
  const extraFields = [c.phone, c.address, c.postcode, c.email, c.website, c.reviewLink, c.companyNumber, c.vatNumber, c.trade, c.socialLinks?.facebook, c.socialLinks?.instagram, c.socialLinks?.twitter];
  if (extraFields.some(v => v && String(v).trim())) {
    const extra = document.getElementById('aboutYouExtra');
    const btn   = document.getElementById('aboutYouMoreBtn');
    if (extra) extra.style.display = 'block';
    if (btn) {
      btn.checked = true;
      const lbl = document.getElementById('aboutYouToggleLabel');
      if (lbl) lbl.textContent = 'Hide extra details';
    }
  }
  ['facebook', 'instagram', 'twitter'].forEach(name => {
    const value = c.socialLinks?.[name];
    const btn = document.querySelector(`.social-link-toggle[data-social="${name}"]`);
    const field = document.getElementById(`social${name.charAt(0).toUpperCase() + name.slice(1)}Field`);
    const open = !!(value && String(value).trim());
    if (field) field.hidden = !open;
    if (btn) {
      btn.classList.toggle('active', open);
      btn.setAttribute('aria-expanded', String(open));
    }
  });

  showLogoState();
  showQRState();
  showQualsState();

  // Payment methods
  const methods = c.payMethods || [];
  const bankCk = document.getElementById('payBankTransfer');
  const paypalCk = document.getElementById('payPaypal');
  const otherCk  = document.getElementById('payOther');
  bankCk.checked  = methods.includes('bank');
  paypalCk.checked = methods.includes('paypal');
  document.getElementById('payCash').checked = methods.includes('cash');
  otherCk.checked = methods.includes('other');

  document.getElementById('bankDetails').style.display    = bankCk.checked  ? 'block' : 'none';
  document.getElementById('paypalDetails').style.display  = paypalCk.checked ? 'block' : 'none';
  document.getElementById('payOtherDetails').style.display = otherCk.checked ? 'block' : 'none';

  setVal('bankAccHolder', c.bankAccHolder);
  setVal('bankName',      c.bankName);
  setVal('bankSort',      c.bankSort);
  setVal('bankAcc',       c.bankAcc);
  setVal('paypalRef',     c.paypalRef);
  setVal('payOtherText',  c.payOther);

  // Colours
  setColour('header', c.brandPrimary || DEFAULT_COLOURS.primary);
  setColour('accent', c.brandAccent  || DEFAULT_COLOURS.accent);
  setColour('bg',     c.brandBg      || DEFAULT_COLOURS.bg);
  updateColourPreview();

  // Preferences
  const autoHoldingEl = document.getElementById('prefAutoHolding');
  if (autoHoldingEl) autoHoldingEl.checked = !!(c.autoHoldingMessage);

  // My Rates — display as 2dp (e.g. 11 -> 11.00, 2.5 -> 2.50)
  const fmtRate = v => (v != null && v !== '') ? Number(v).toFixed(2) : '';
  setVal('rateHourly',  fmtRate(c.rateHourly));
  setVal('rateHalfDay', fmtRate(c.rateHalfDay));
  setVal('rateDay',     fmtRate(c.rateDay));
  setVal('rateCallout', fmtRate(c.rateCallout));
  // If rates already saved, skip the prompt and show the fields directly
  if (c.rateHourly || c.rateHalfDay || c.rateDay || c.rateCallout) {
    const prompt = document.getElementById('autoFillRatesPrompt');
    const manual = document.getElementById('ratesManualSection');
    if (prompt) prompt.style.display = 'none';
    if (manual) manual.style.display = '';
  }
}

function saveBusinessDetails(showToast = true) {
  const firstName = getVal('p1FirstName').trim();
  const lastName = getVal('p1LastName').trim();
  if (!firstName) {
    document.getElementById('p1FirstName').classList.add('error');
    document.getElementById('p1FirstName').scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (showToast) toast('First name is required.', 'error');
    return false;
  }
  document.getElementById('p1FirstName').classList.remove('error');
  if (!lastName) {
    document.getElementById('p1LastName').classList.add('error');
    document.getElementById('p1LastName').scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (showToast) toast('Last name is required.', 'error');
    return false;
  }
  document.getElementById('p1LastName').classList.remove('error');

  // Sort code validation: must be empty OR exactly 6 digits (XX-XX-XX)
  const sortVal = getVal('bankSort').trim();
  if (sortVal) {
    const digits = sortVal.replace(/\D/g, '');
    if (digits.length !== 6) {
      const sortEl = document.getElementById('bankSort');
      const sortErr = document.getElementById('bankSortError');
      sortEl.classList.add('error');
      if (sortErr) sortErr.style.display = 'block';
      sortEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (showToast) toast('Sort code must be 6 digits.', 'error');
      return false;
    }
    document.getElementById('bankSort').classList.remove('error');
    const sortErr = document.getElementById('bankSortError');
    if (sortErr) sortErr.style.display = 'none';
  }

  const colourChanged =
    (state.company.brandPrimary || DEFAULT_COLOURS.primary) !== document.getElementById('colourHeader').value ||
    (state.company.brandAccent  || DEFAULT_COLOURS.accent)  !== document.getElementById('colourAccent').value ||
    (state.company.brandBg      || DEFAULT_COLOURS.bg)      !== document.getElementById('colourBg').value;

  const methods = [];
  if (document.getElementById('payBankTransfer').checked) methods.push('bank');
  if (document.getElementById('payCash').checked)         methods.push('cash');
  if (document.getElementById('payPaypal').checked)       methods.push('paypal');
  if (document.getElementById('payOther').checked)        methods.push('other');

  state.company = {
    ...state.company,
    bizChoiceMade: null,   // reset so modal appears again for any docs that differ from new details
    firstName:    firstName,
    lastName:     lastName,
    preferredName: getVal('p1PreferredName').trim(),
    businessName: getVal('p1BusinessName'),
    trade:        getVal('p1Trade'),
    address:      getVal('p1Address'),
    postcode:     getVal('p1Postcode'),
    phone:        getVal('p1Phone'),
    email:        getVal('p1Email'),
    website:       getVal('p1Website'),
    reviewLink:    getVal('p1ReviewLink').trim(),
    companyNumber: getVal('p1CompanyNumber'),
    vatNumber:     getVal('p1VatNumber'),
    socialLinks: {
      facebook: getVal('p1Facebook').trim(),
      instagram: getVal('p1Instagram').trim(),
      twitter: getVal('p1Twitter').trim()
    },
    payMethods:    methods,
    bankAccHolder: getVal('bankAccHolder'),
    bankName:     getVal('bankName'),
    bankSort:     getVal('bankSort'),
    bankAcc:      getVal('bankAcc'),
    paypalRef:    getVal('paypalRef'),
    payOther:     getVal('payOtherText'),
    brandPrimary: document.getElementById('colourHeader').value,
    brandAccent:  document.getElementById('colourAccent').value,
    brandBg:      document.getElementById('colourBg').value,
    qrCode:       state.company.qrCode || '',
    qualifications: state.company.qualifications || [],
    autoHoldingMessage: document.getElementById('prefAutoHolding')?.checked || false,
    rateHourly:   parseFloat(getVal('rateHourly'))   || null,
    rateHalfDay:  parseFloat(getVal('rateHalfDay'))  || null,
    rateDay:      parseFloat(getVal('rateDay'))       || null,
    rateCallout:  parseFloat(getVal('rateCallout'))   || null
  };
  save();
  saveBusinessToSupabase().catch(error => {
    console.warn('Business details saved locally but did not sync to Supabase:', error);
    if (showToast) toast('Saved on this device. Supabase sync needs another try.', 'error');
  });
  updateColourPreview();
  personaliseText();
  updateQrMenuLabel();
  if (showToast) showSavedPopup(
    businessNameCompliment(getVal('p1BusinessName') || (firstName + ' ' + lastName)),
    null,
    2500
  );
  return true;
}

/* ===== COLOUR PICKER ===== */
// HSV helpers
function hsvToRgb(h, s, v) {
  const i = Math.floor(h / 60) % 6;
  const f = h / 60 - Math.floor(h / 60);
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]][i];
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: h * 360, s: max ? d / max : 0, v: max };
}

function setupColourPicker(name, hexId, defaultVal) {
  const hexEl = document.getElementById(hexId);
  if (!hexEl) return;
  // Always use our custom picker -same UI on every device
  hexEl.addEventListener('pointerdown', e => { e.preventDefault(); openCustomColorPicker(hexEl); });
  hexEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCustomColorPicker(hexEl); }
  });
}

function openCustomColorPicker(inputEl) {
  document.querySelector('.ccp-overlay')?.remove();

  const startHex = inputEl.value || '#000000';
  const rgb0 = hexToRgb(startHex);
  const hsv0 = rgbToHsv(rgb0.r, rgb0.g, rgb0.b);
  let H = hsv0.h, S = hsv0.s, V = hsv0.v;

  const overlay = document.createElement('div');
  overlay.className = 'ccp-overlay';
  overlay.innerHTML = `
    <div class="ccp-panel" role="dialog" aria-label="Colour picker">
      <div class="ccp-header">
        <span class="ccp-title">Pick a colour</span>
        <button type="button" class="ccp-close" aria-label="Cancel">✕</button>
      </div>
      <div class="ccp-sv-wrap">
        <canvas class="ccp-sv-canvas"></canvas>
        <div class="ccp-sv-thumb"></div>
      </div>
      <div class="ccp-hue-wrap">
        <canvas class="ccp-hue-canvas"></canvas>
        <div class="ccp-hue-thumb"></div>
      </div>
      <div class="ccp-bottom">
        <div class="ccp-swatch"></div>
        <span class="ccp-hash">#</span>
        <input class="ccp-hex-input" type="text" maxlength="6" spellcheck="false">
        <button type="button" class="btn btn-primary ccp-done">Done</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const panel    = overlay.querySelector('.ccp-panel');
  const svCanvas = overlay.querySelector('.ccp-sv-canvas');
  const hueCanvas= overlay.querySelector('.ccp-hue-canvas');
  const svThumb  = overlay.querySelector('.ccp-sv-thumb');
  const hueThumb = overlay.querySelector('.ccp-hue-thumb');
  const swatch   = overlay.querySelector('.ccp-swatch');
  const hexInput = overlay.querySelector('.ccp-hex-input');

  // Size canvases to match CSS layout
  function sizeCanvases() {
    const svW = svCanvas.offsetWidth   || 264;
    const svH = svCanvas.offsetHeight  || 160;
    const huW = hueCanvas.offsetWidth  || 264;
    const huH = hueCanvas.offsetHeight || 20;
    svCanvas.width  = svW;  svCanvas.height = svH;
    hueCanvas.width = huW; hueCanvas.height = huH;
  }

  function drawSV() {
    const ctx = svCanvas.getContext('2d');
    const W = svCanvas.width, H = svCanvas.height;
    const { r, g, b } = hsvToRgb(H, 1, 1);
    const gradX = ctx.createLinearGradient(0, 0, W, 0);
    gradX.addColorStop(0, '#fff');
    gradX.addColorStop(1, `rgb(${r},${g},${b})`);
    ctx.fillStyle = gradX; ctx.fillRect(0, 0, W, H);
    const gradY = ctx.createLinearGradient(0, 0, 0, H);
    gradY.addColorStop(0, 'rgba(0,0,0,0)');
    gradY.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = gradY; ctx.fillRect(0, 0, W, H);
  }

  function drawHue() {
    const ctx = hueCanvas.getContext('2d');
    const W = hueCanvas.width, H = hueCanvas.height;
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    for (let i = 0; i <= 6; i++) {
      const { r, g, b } = hsvToRgb(i * 60, 1, 1);
      grad.addColorStop(i / 6, `rgb(${r},${g},${b})`);
    }
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
  }

  function positionThumbs() {
    const svW = svCanvas.offsetWidth, svH = svCanvas.offsetHeight;
    const huW = hueCanvas.offsetWidth;
    svThumb.style.left  = (S * svW) + 'px';
    svThumb.style.top   = ((1 - V) * svH) + 'px';
    hueThumb.style.left = (H / 360 * huW) + 'px';
  }

  function applyColour() {
    const { r, g, b } = hsvToRgb(H, S, V);
    const hex = rgbToHex(r, g, b);
    swatch.style.background = hex;
    hexInput.value = hex.replace('#', '');
    inputEl.value  = hex;
    updateColourPreview();
  }

  function canvasXY(canvas, e) {
    const rect = canvas.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX);
    const cy = (e.touches ? e.touches[0].clientY : e.clientY);
    return {
      x: Math.max(0, Math.min(1, (cx - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (cy - rect.top)  / rect.height))
    };
  }

  // SV drag
  let svDragging = false;
  function onSV(e) {
    e.preventDefault();
    const { x, y } = canvasXY(svCanvas, e);
    S = x; V = 1 - y;
    positionThumbs(); applyColour();
  }
  svCanvas.addEventListener('pointerdown', e => { svDragging = true; svCanvas.setPointerCapture(e.pointerId); onSV(e); });
  svCanvas.addEventListener('pointermove', e => { if (svDragging) onSV(e); });
  svCanvas.addEventListener('pointerup',   () => { svDragging = false; });

  // Hue drag
  let hueDragging = false;
  function onHue(e) {
    e.preventDefault();
    const { x } = canvasXY(hueCanvas, e);
    H = x * 360;
    drawSV(); positionThumbs(); applyColour();
  }
  hueCanvas.addEventListener('pointerdown', e => { hueDragging = true; hueCanvas.setPointerCapture(e.pointerId); onHue(e); });
  hueCanvas.addEventListener('pointermove', e => { if (hueDragging) onHue(e); });
  hueCanvas.addEventListener('pointerup',   () => { hueDragging = false; });

  // Hex input
  hexInput.addEventListener('input', () => {
    const v = '#' + hexInput.value.replace(/[^0-9a-f]/gi, '');
    if (/^#[0-9a-f]{6}$/i.test(v)) {
      const rgb = hexToRgb(v);
      const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      H = hsv.h; S = hsv.s; V = hsv.v;
      drawSV(); positionThumbs();
      swatch.style.background = v;
      inputEl.value = v; updateColourPreview();
    }
  });

  // Done / cancel
  overlay.querySelector('.ccp-done').addEventListener('click', () => overlay.remove());
  overlay.querySelector('.ccp-close').addEventListener('click', () => {
    inputEl.value = startHex; updateColourPreview(); overlay.remove();
  });
  overlay.addEventListener('pointerdown', e => { if (e.target === overlay) { inputEl.value = startHex; updateColourPreview(); overlay.remove(); } });

  // Init -wait one frame for layout so offsetWidth is accurate
  requestAnimationFrame(() => {
    sizeCanvases();
    drawSV();
    drawHue();
    positionThumbs();
    applyColour();
  });
}

function hexToRgb(hex) {
  const clean = String(hex || '#000000').replace('#', '');
  const n = parseInt(clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => clampRgb(v).toString(16).padStart(2, '0')).join('');
}

function clampRgb(v) {
  return Math.max(0, Math.min(255, parseInt(v, 10) || 0));
}

function setColour(name, hex) {
  const map = { header: 'colourHeader', accent: 'colourAccent', bg: 'colourBg' };
  const el = document.getElementById(map[name]);
  if (el) el.value = hex;
}

function updateColourPreview() {
  const primary = document.getElementById('colourHeader').value;
  const accent  = document.getElementById('colourAccent').value;
  const bg      = document.getElementById('colourBg').value;

  const cpHeader = document.getElementById('cpHeader');
  const cpBody   = document.getElementById('cpBody');
  const cpLabel  = document.getElementById('cpAccentSample');

  if (cpHeader) cpHeader.style.backgroundColor = primary;
  if (cpBody)   cpBody.style.backgroundColor   = bg;
  if (cpLabel)  cpLabel.style.color            = accent;

  const bizName = getVal('p1BusinessName') || getVal('p1LastName') || 'Ace Trades';
  const cpBiz = document.getElementById('cpBusinessName');
  if (cpBiz) cpBiz.textContent = bizName;
}

function extractLogoColours() {
  const logo = state.company.logo;
  if (!logo) {
    showSavedPopup('Sure, upload your logo so I can extract the colours');
    setTimeout(() => document.getElementById('logoFile').click(), 4000);
    return;
  }

  const img = new Image();
  // Do NOT set crossOrigin for data URLs — it taints the canvas in Safari/Chrome
  if (!logo.startsWith('data:')) img.crossOrigin = 'anonymous';
  img.onload = () => {
    // Draw onto a small canvas for speed
    const canvas = document.createElement('canvas');
    const MAX = 100;
    const scale = Math.min(1, MAX / Math.max(img.width || 1, img.height || 1));
    canvas.width  = Math.max(1, Math.round(img.width  * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    let data;
    try { data = ctx.getImageData(0, 0, canvas.width, canvas.height).data; }
    catch (e) {
      console.warn('Logo colour extraction failed (canvas tainted):', e);
      showSavedPopup("Couldn't read colours from this logo. Try saving it as a PNG and re-uploading.");
      document.getElementById('useLogoColours').checked = false;
      return;
    }

    // Helper: RGB → HSL hue (0-360) and saturation (0-1)
    const rgbToHsl = (r, g, b) => {
      r /= 255; g /= 255; b /= 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const l = (max + min) / 2;
      if (max === min) return { h: 0, s: 0, l };
      const d = max - min;
      const s = d / (1 - Math.abs(2 * l - 1));
      let h = 0;
      if (max === r) h = ((g - b) / d + 6) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      return { h: h * 60, s, l };
    };

    // Tally colours — quantize RGB to 32 levels per channel.
    // Score = frequency × saturation² so vivid brand colours beat washed-out
    // grey edge-blends even when they appear in fewer pixels.
    const tally = {};
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;                         // skip transparent
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r > 230 && g > 230 && b > 230) continue;             // skip near-white
      if (r < 50  && g < 50  && b < 50)  continue;             // skip dark/shadow pixels

      const { s } = rgbToHsl(r, g, b);
      const key = `${r >> 3},${g >> 3},${b >> 3}`;
      // Weight each pixel by sat² so grey pixels contribute almost nothing
      tally[key] = (tally[key] || 0) + 1 + s * s * 8;
    }

    const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);

    // Pick up to 3 visually distinct colours — use hue distance so that
    // blue and green (very different hues) are always treated as distinct
    // even if their RGB values happen to be close in Manhattan distance.
    const picked = [];
    for (const [key] of sorted) {
      if (picked.length >= 3) break;
      const [rq, gq, bq] = key.split(',').map(Number);
      const r = (rq << 3) + 4, g = (gq << 3) + 4, b = (bq << 3) + 4;
      const { h: hue, s: sat } = rgbToHsl(r, g, b);
      const isDistinct = picked.every(p => {
        const hueDiff = Math.min(Math.abs(p.hue - hue), 360 - Math.abs(p.hue - hue));
        const rgbDiff = Math.abs(p.r - r) + Math.abs(p.g - g) + Math.abs(p.b - b);
        // Distinct if hues are >30° apart OR colours differ enough in RGB
        return hueDiff > 30 || rgbDiff > 80;
      });
      if (picked.length === 0 || isDistinct) picked.push({ r, g, b, hue, sat });
    }

    if (!picked.length) {
      document.getElementById('useLogoColours').checked = false;
      showSavedPopup("Hmm, couldn't pull colours from this logo. Try adjusting manually.");
      return;
    }

    // Sort by luminance: darkest → header, next → accent
    picked.sort((a, b) => {
      const lum = c => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
      return lum(a) - lum(b);
    });

    const header = picked[0];
    const accent = picked.length > 1 ? picked[1] : picked[0];

    // Background: very light tint derived from the header colour
    const bgR = Math.round(header.r * 0.12 + 242 * 0.88);
    const bgG = Math.round(header.g * 0.12 + 242 * 0.88);
    const bgB = Math.round(header.b * 0.12 + 242 * 0.88);

    const hHex = rgbToHex(header.r, header.g, header.b);
    const aHex = rgbToHex(accent.r, accent.g, accent.b);
    const bHex = rgbToHex(bgR, bgG, bgB);
    setColour('header', hHex);
    setColour('accent', aHex);
    setColour('bg',     bHex);
    // Persist to state so colours survive reload without requiring Save My Business
    state.company.brandPrimary = hHex;
    state.company.brandAccent  = aHex;
    state.company.brandBg      = bHex;
    save();
    updateColourPreview();
    showSavedPopup("Done! I've extracted those great colours from your logo.");
  };
  img.src = logo;
}

/* ===== PAGE 2 -PRICE LIST ===== */
function setupPage2() {
  // ---- BULK: two-step category flow ----
  let bulkCategory = 'service'; // tracks chosen category for bulk import

  const showBulkStep = (step) => {
    document.getElementById('bulkStep1').style.display = step === 1 ? '' : 'none';
    document.getElementById('bulkStep2').style.display = step === 2 ? '' : 'none';
  };

  document.getElementById('bulkChooseService').addEventListener('click', () => {
    bulkCategory = 'service';
    document.getElementById('bulkCategoryLabel').textContent = 'Services';
    showBulkStep(2);
  });

  document.getElementById('bulkChooseMaterials').addEventListener('click', () => {
    bulkCategory = 'materials';
    document.getElementById('bulkCategoryLabel').textContent = 'Materials';
    showBulkStep(2);
  });

  document.getElementById('bulkBackBtn').addEventListener('click', () => {
    setVal('bulkPaste', '');
    showBulkStep(1);
  });

  // ---- CSV upload ----
  const csvZone = document.getElementById('csvUploadZone');
  const csvFile = document.getElementById('csvFile');

  csvZone.addEventListener('click', (e) => {
    if (!e.target.closest('button')) csvFile.click();
  });
  csvZone.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') csvFile.click(); });
  csvFile.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) readCSV(file, bulkCategory);
  });

  // Drag & drop
  csvZone.addEventListener('dragover', e => { e.preventDefault(); csvZone.classList.add('dragover'); });
  csvZone.addEventListener('dragleave', () => csvZone.classList.remove('dragover'));
  csvZone.addEventListener('drop', e => {
    e.preventDefault();
    csvZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) readCSV(file, bulkCategory);
  });

  document.getElementById('downloadTemplateBtn').addEventListener('click', e => {
    e.stopPropagation();
    downloadTemplate();
  });

  // Paste zone: accept text or screenshot image
  document.getElementById('bulkPaste').addEventListener('paste', e => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
          const zone = document.querySelector('.paste-zone');
          const old = zone.querySelector('.paste-img-preview');
          if (old) old.remove();
          const wrap = document.createElement('div');
          wrap.className = 'paste-img-preview';
          wrap.innerHTML = `<img src="${ev.target.result}" alt="Pasted price list">
            <button type="button" class="paste-img-clear" aria-label="Remove image">&#x2715;</button>`;
          zone.appendChild(wrap);
          wrap.querySelector('.paste-img-clear').addEventListener('click', () => wrap.remove());
        };
        reader.readAsDataURL(file);
        return;
      }
    }
  });

  // Bulk paste add button
  document.getElementById('parseBulkBtn').addEventListener('click', () => {
    const text = getVal('bulkPaste');
    if (!text.trim()) { toast('Paste some items first.', 'error'); return; }
    const { added, skipped } = parseJobLines(text, bulkCategory);
    setVal('bulkPaste', '');
    if (added) {
      const noun = bulkCategory === 'materials' ? 'material' : 'service';
      let msg = `${added} ${noun}${added===1?'':'s'} added.`;
      if (skipped) msg += ` ${skipped} skipped (already in your list).`;
      toast(msg, 'success');
      showBulkStep(1); // reset back to step 1 after success
    } else if (skipped) {
      toast('All items already in your list.', 'error');
    } else {
      toast("Can't read your input - remember format: name, price", 'error');
    }
  });

  // Save Rates button on page 2
  document.getElementById('saveRatesBtn')?.addEventListener('click', () => {
    ['rateHourly','rateHalfDay','rateDay','rateCallout'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const v = parseFloat(el.value);
      state.company[id] = isNaN(v) ? 0 : v;
      el.value = isNaN(v) ? '' : v.toFixed(2);
    });
    save();
    if (typeof saveBusinessToSupabase === 'function') saveBusinessToSupabase().catch(() => {});
    updateJobPicker();
    showSavedPopup('Rates saved.');
  });

  // Trade auto-fill buttons
  document.getElementById('autoFillRatesBtn')?.addEventListener('click', () => {
    forceOpenTradePicker(autoFillRates, true, true);
  });
  document.getElementById('autoFillRatesNoBtn')?.addEventListener('click', () => {
    document.getElementById('autoFillRatesPrompt').style.display = 'none';
    document.getElementById('ratesManualSection').style.display = '';
  });

  document.getElementById('changeTradeBtnRates')?.addEventListener('click', () => {
    const tradeLabel = document.getElementById('ratesTradeLabel');
    if (tradeLabel) tradeLabel.style.display = 'none';
    forceOpenTradePicker(autoFillRates, true, true);
  });

  document.getElementById('autoFillServicesBtn')?.addEventListener('click', () => {
    openTradePickerForAutoFill(trades => { oboState.svc = 'postfill'; autoFillServices(trades); });
  });
  document.getElementById('autoFillMaterialsBtn')?.addEventListener('click', () => {
    openTradePickerForAutoFill(trades => { oboState.mat = 'postfill'; autoFillMaterials(trades); });
  });

  const showManualSection = (promptId) => {
    document.getElementById(promptId).style.display = 'none';
    document.getElementById('oboManualSection').style.display = '';
  };
  document.getElementById('autoFillServicesNoBtn')?.addEventListener('click', () => {
    oboState.svc = 'manual'; showManualSection('autoFillServicesPrompt');
  });
  document.getElementById('autoFillMaterialsNoBtn')?.addEventListener('click', () => {
    oboState.mat = 'manual'; showManualSection('autoFillMaterialsPrompt');
  });

  // Post-autofill: "Add more manually"
  document.getElementById('addMoreServicesManuallytBtn')?.addEventListener('click', () => {
    oboState.svc = 'manual';
    document.getElementById('oboPostFillServices').style.display = 'none';
    document.getElementById('oboManualSection').style.display = '';
  });
  document.getElementById('addMoreMaterialsManuallyBtn')?.addEventListener('click', () => {
    oboState.mat = 'manual';
    document.getElementById('oboPostFillMaterials').style.display = 'none';
    document.getElementById('oboManualSection').style.display = '';
  });

  // Manual section "Back" — return to the prompt so they can auto-fill instead
  document.getElementById('oboManualBackBtn')?.addEventListener('click', () => {
    const isMat = document.querySelector('#jobCatSelector .obo-tab.active')?.dataset?.cat === 'materials';
    if (isMat) oboState.mat = 'prompt'; else oboState.svc = 'prompt';
    if (typeof _switchOboGrid === 'function') _switchOboGrid(isMat ? 'materials' : 'service');
  });

  // Post-autofill: "Change trade"
  document.getElementById('changeTradeBtnSvc')?.addEventListener('click', () => {
    oboState.svc = 'prompt';
    document.getElementById('oboPostFillServices').style.display = 'none';
    document.getElementById('autoFillServicesPrompt').style.display = '';
    forceOpenTradePicker(trades => { oboState.svc = 'postfill'; autoFillServices(trades); });
  });
  document.getElementById('changeTradeBtnMat')?.addEventListener('click', () => {
    oboState.mat = 'prompt';
    document.getElementById('oboPostFillMaterials').style.display = 'none';
    document.getElementById('autoFillMaterialsPrompt').style.display = '';
    forceOpenTradePicker(trades => { oboState.mat = 'postfill'; autoFillMaterials(trades); });
  });

  // Trade picker modal
  document.getElementById('tpmCancelBtn')?.addEventListener('click', closeTradePickerModal);
  document.getElementById('tpmCancelBtnFooter')?.addEventListener('click', closeTradePickerModal);
  document.getElementById('tpmConfirmBtn')?.addEventListener('click', () => {
    const activeBtns = [...document.querySelectorAll('.tpm-trade-btn.active')];
    if (!activeBtns.length) { toast('Please select at least one trade.', 'error'); return; }
    const trades = activeBtns.map(b => b.dataset.trade);
    const knownTrades = trades.filter(t => t !== 'Other' && TRADE_DATA[t]);
    const hasOther = trades.includes('Other');
    if (hasOther && !knownTrades.length) {
      // Only "Other" selected — need free-text input
      const otherWrap = document.getElementById('tpmOtherWrap');
      if (otherWrap) otherWrap.style.display = '';
      return;
    }
    closeTradePickerModal();
    const modal = document.getElementById('tradePickerModal');
    const cb = modal && modal._callback;
    // Only the Rates picker persists the company trade (it owns the pill).
    // Services/Materials can pick multiple trades without touching the Rates trade.
    if (modal && modal._persistTrade) {
      state.company.trade = knownTrades[0];
      setVal('p1Trade', knownTrades[0]);
      save();
      if (typeof saveBusinessToSupabase === 'function') saveBusinessToSupabase().catch(() => {});
    }
    if (cb) cb(knownTrades);
  });
  document.getElementById('tpmOtherConfirmBtn')?.addEventListener('click', () => {
    const label = (document.getElementById('tpmOtherInput')?.value || '').trim();
    if (!label) { toast('Please enter your trade.', 'error'); return; }
    closeTradePickerModal();
    toast(`Got it! We don't have auto-fill data for "${label}" yet — but you can add your services and materials manually using the forms below.`, 'info', 6000);
    state.company.trade = label;
    setVal('p1Trade', 'Other');
    save();
    if (typeof saveBusinessToSupabase === 'function') saveBusinessToSupabase().catch(() => {});
  });
  document.querySelectorAll('.tpm-trade-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = document.getElementById('tradePickerModal');
      const singleSelect = modal && modal._singleSelect;
      if (singleSelect) {
        document.querySelectorAll('.tpm-trade-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      } else {
        btn.classList.toggle('active');
      }
      const otherWrap = document.getElementById('tpmOtherWrap');
      const otherActive = document.querySelector('.tpm-trade-btn[data-trade="Other"].active');
      if (otherWrap) otherWrap.style.display = otherActive ? '' : 'none';
    });
  });

  // Category tabs — Services / Materials
  const oboServiceGrid  = document.getElementById('oboServiceGrid');
  const oboMaterialGrid = document.getElementById('oboMaterialGrid');
  // oboState is declared at module scope (below) so showPage() can also access it
  const switchOboGrid = (cat) => {
    const isMat = cat === 'materials';
    if (oboServiceGrid)  oboServiceGrid.style.display  = isMat ? 'none' : '';
    if (oboMaterialGrid) oboMaterialGrid.style.display = isMat ? '' : 'none';
    // Hide all state panels first
    document.getElementById('autoFillServicesPrompt').style.display  = 'none';
    document.getElementById('autoFillMaterialsPrompt').style.display = 'none';
    document.getElementById('oboPostFillServices').style.display     = 'none';
    document.getElementById('oboPostFillMaterials').style.display    = 'none';
    document.getElementById('oboManualSection').style.display        = 'none';
    // Restore correct state for the active tab
    const tabState = isMat ? oboState.mat : oboState.svc;
    if (tabState === 'prompt') {
      document.getElementById(isMat ? 'autoFillMaterialsPrompt' : 'autoFillServicesPrompt').style.display = '';
    } else if (tabState === 'postfill') {
      document.getElementById(isMat ? 'oboPostFillMaterials' : 'oboPostFillServices').style.display = '';
    } else if (tabState === 'manual') {
      document.getElementById('oboManualSection').style.display = '';
    }
    // Bulk section
    const bulkHeading = document.getElementById('bulkHeading');
    if (bulkHeading) bulkHeading.textContent = isMat ? 'Add Materials in Bulk' : 'Add Services in Bulk';
    const bulkChooseService   = document.getElementById('bulkChooseService');
    const bulkChooseMaterials = document.getElementById('bulkChooseMaterials');
    if (bulkChooseService)   bulkChooseService.style.display   = isMat ? 'none' : '';
    if (bulkChooseMaterials) bulkChooseMaterials.style.display = isMat ? '' : 'none';
  };
  document.querySelectorAll('#jobCatSelector .obo-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#jobCatSelector .obo-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      switchOboGrid(btn.dataset.cat);
    });
  });
  // Expose so showPage() can re-render the active obo tab to match oboState
  _switchOboGrid = switchOboGrid;
  // Start on Service grid
  switchOboGrid('service');

  // Individual add — service grid
  document.getElementById('addJobBtn').addEventListener('click', addIndividualJob);
  document.getElementById('jobName').addEventListener('keydown', e => { if (e.key==='Enter') addIndividualJob(); });
  document.getElementById('jobPrice').addEventListener('keydown', e => { if (e.key==='Enter') addIndividualJob(); });

  // Individual add — material grid
  document.getElementById('addJobBtnMat').addEventListener('click', addIndividualJob);
  document.getElementById('jobNameMat').addEventListener('keydown', e => { if (e.key==='Enter') addIndividualJob(); });
  document.getElementById('jobPriceMat').addEventListener('keydown', e => { if (e.key==='Enter') addIndividualJob(); });

  // Search - skip rebuild if an inline edit is active
  document.getElementById('priceListSearch').addEventListener('input', () => {
    if (!editingJobId) refreshPriceList();
  });
  document.getElementById('priceListSort')?.addEventListener('change', () => refreshPriceList());

  // Category filter tabs
  document.querySelectorAll('.jobs-added-card .obo-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.jobs-added-card .obo-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      refreshPriceList();
    });
  });

  // Select all
  document.getElementById('selectAllJobs').addEventListener('change', e => {
    document.querySelectorAll('.job-check').forEach(cb => cb.checked = e.target.checked);
    document.getElementById('deleteSelectedBtn').style.display = e.target.checked ? 'flex' : 'none';
  });

  // Delete selected -no confirm() as it is unreliable on mobile
  document.getElementById('deleteSelectedBtn').addEventListener('click', () => {
    const checked = [...document.querySelectorAll('.job-check:checked')].map(cb => cb.dataset.id);
    if (!checked.length) return;
    state.priceList = state.priceList.filter(j => !checked.includes(j.id));
    document.getElementById('selectAllJobs').checked = false;
    document.getElementById('deleteSelectedBtn').style.display = 'none';
    save();
    queuePriceListSync(true);
    syncOboStateWithPriceList();
    refreshPriceList();
    updateJobPicker();
    toast(`Deleted ${checked.length} job${checked.length===1?'':'s'}.`);
  });

  // My Rates — format to 2dp on blur and auto-save to state
  ['rateHourly','rateHalfDay','rateDay','rateCallout'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('blur', () => {
      const v = parseFloat(el.value);
      if (!isNaN(v)) el.value = v.toFixed(2);
      // Auto-save rates into state so quote builder picks them up immediately
      state.company.rateHourly   = parseFloat(getVal('rateHourly'))   || null;
      state.company.rateHalfDay  = parseFloat(getVal('rateHalfDay'))  || null;
      state.company.rateDay      = parseFloat(getVal('rateDay'))       || null;
      state.company.rateCallout  = parseFloat(getVal('rateCallout'))   || null;
      save();
      saveBusinessToSupabase().catch(() => {});
      updateQrMenuLabel();
    });
  });
}

function readCSV(file, category = 'service') {
  const reader = new FileReader();
  reader.onload = e => {
    const { added, skipped } = parseJobLines(e.target.result, category);
    const noun = category === 'materials' ? 'material' : 'service';
    if (added) {
      let msg = `${added} ${noun}${added===1?'':'s'} added from file.`;
      if (skipped) msg += ` ${skipped} skipped (already in your list).`;
      toast(msg, 'success');
    } else if (skipped) {
      toast('All items already in your list.', 'error');
    } else {
      toast("Can't read your input - remember format: name, price", 'error');
    }
  };
  reader.readAsText(file);
}

function parseJobLines(text, category = 'service') {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let added = 0, skipped = 0;
  lines.forEach(line => {
    let name, rest;
    const commaIdx = line.indexOf(',');
    if (commaIdx !== -1) {
      name = line.slice(0, commaIdx).trim();
      rest = line.slice(commaIdx + 1).trim();
    } else {
      const noCommaMatch = line.match(/^(.*)\s+[£$€]?([\d]+(?:\.\d{1,2})?)\s*$/);
      if (!noCommaMatch) { skipped++; return; }
      name = noCommaMatch[1].trim();
      rest = noCommaMatch[2];
    }
    const priceMatch = rest.match(/[£$€]?([\d,]+(?:\.\d+)?)/);
    if (!priceMatch) { skipped++; return; }
    const price = parseFloat(priceMatch[1].replace(/,/g, ''));
    const afterPrice = rest.slice(priceMatch.index + priceMatch[0].length).replace(/^\s*,\s*/, '').trim();
    const unit = afterPrice || '';
    if (!name || isNaN(price)) { skipped++; return; }
    const duplicate = state.priceList.find(j => j.name.toLowerCase() === name.toLowerCase());
    if (duplicate) { skipped++; return; }
    addJob(name, price, unit, category);
    added++;
  });
  if (added) { save(); queuePriceListSync(true); refreshPriceList(); updateJobPicker(); }
  return { added, skipped };
}

function downloadTemplate() {
  const csv = 'Job Name,Price,Unit (optional)\nFit door handle,45,each\nHang door,85,\nRepair fence panel,60,per panel';
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'lexi-price-list-template.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

function addIndividualJob() {
  const activeBtn = document.querySelector('#jobCatSelector .obo-tab.active');
  const category  = activeBtn ? activeBtn.dataset.cat : 'service';
  const isMat     = category === 'materials';

  // Read from the correct grid
  const nameId  = isMat ? 'jobNameMat'  : 'jobName';
  const priceId = isMat ? 'jobPriceMat' : 'jobPrice';
  const unitId  = isMat ? 'jobUnitMat'  : 'jobUnit';

  const name      = getVal(nameId).trim();
  const price     = parseFloat(getVal(priceId));
  const unit      = getVal(unitId).trim();
  const costRaw   = isMat ? getVal('jobCost') : '';
  const costPrice = costRaw !== '' ? parseFloat(costRaw) : null;

  if (!name)        { document.getElementById(nameId).classList.add('error');  return; }
  if (isNaN(price)) { document.getElementById(priceId).classList.add('error'); return; }
  document.getElementById(nameId).classList.remove('error');
  document.getElementById(priceId).classList.remove('error');

  const reset = () => {
    setVal('jobName',''); setVal('jobNameMat','');
    setVal('jobPrice',''); setVal('jobPriceMat','');
    setVal('jobCost','');
    setVal('jobUnit',''); setVal('jobUnitMat','');
  };

  const duplicate = state.priceList.find(j => j.name.toLowerCase() === name.toLowerCase());
  if (duplicate) {
    showDuplicatePrompt(name, () => {
      addJob(name, price, unit, category, costPrice);
      save(); queuePriceListSync(true); reset();
      refreshPriceList(); updateJobPicker();
      showSavedPopup('On the list.', null, 3000);
    });
    return;
  }

  addJob(name, price, unit, category, costPrice);
  save(); queuePriceListSync(true); reset();
  refreshPriceList(); updateJobPicker();
  showSavedPopup('Added', null, 3000);
}

/* ===== TRADE AUTO-FILL FUNCTIONS ===== */

function forceOpenTradePicker(callback, singleSelect = false, persistTrade = false) {
  const modal = document.getElementById('tradePickerModal');
  if (!modal) return;
  modal.style.display = 'flex';
  modal._callback = callback;
  modal._singleSelect = singleSelect;
  modal._persistTrade = persistTrade;
  const otherWrap = document.getElementById('tpmOtherWrap');
  if (otherWrap) otherWrap.style.display = 'none';
  document.getElementById('tpmOtherInput') && (document.getElementById('tpmOtherInput').value = '');
  document.querySelectorAll('.tpm-trade-btn').forEach(b => b.classList.remove('active'));
}

// Used by Services/Materials. Inherits the Rates trade if one is set; otherwise asks.
// Never persists the chosen trade as the company trade (so it can't change the Rates pill).
function openTradePickerForAutoFill(callback) {
  const modal = document.getElementById('tradePickerModal');
  if (!modal) return;
  modal.style.display = 'flex';
  modal._callback = callback;
  modal._singleSelect = false;   // Services/Materials can have multiple trades
  modal._persistTrade = false;   // never overwrite the Rates trade/pill
  const otherWrap = document.getElementById('tpmOtherWrap');
  if (otherWrap) otherWrap.style.display = 'none';
  document.getElementById('tpmOtherInput') && (document.getElementById('tpmOtherInput').value = '');
  // Pre-select the Rates trade (if any) as a sensible default — but still let
  // them add more trades, which is essential for multi-skilled tradespeople.
  const trade = state.company && state.company.trade;
  document.querySelectorAll('.tpm-trade-btn').forEach(b => {
    b.classList.toggle('active', !!trade && trade !== 'Other' && TRADE_DATA[trade] && b.dataset.trade === trade);
  });
}

function closeTradePickerModal() {
  const modal = document.getElementById('tradePickerModal');
  if (modal) modal.style.display = 'none';
}

function autoFillRates(trades) {
  const tradeList = Array.isArray(trades) ? trades : [trades];
  const data = TRADE_DATA[tradeList[0]];
  if (!data) return;
  const { rateHourly, rateHalfDay, rateDay, rateCallout } = data.rates;
  setVal('rateHourly',  rateHourly.toFixed(2));
  setVal('rateHalfDay', rateHalfDay.toFixed(2));
  setVal('rateDay',     rateDay.toFixed(2));
  setVal('rateCallout', rateCallout.toFixed(2));
  state.company.rateHourly  = rateHourly;
  state.company.rateHalfDay = rateHalfDay;
  state.company.rateDay     = rateDay;
  state.company.rateCallout = rateCallout;
  save();
  if (typeof saveBusinessToSupabase === 'function') saveBusinessToSupabase().catch(() => {});
  updateJobPicker();
  // Show the rates fields so user can see and adjust what was filled in
  const prompt = document.getElementById('autoFillRatesPrompt');
  const manual = document.getElementById('ratesManualSection');
  if (prompt) prompt.style.display = 'none';
  if (manual) manual.style.display = '';
  const tradeLabel = document.getElementById('ratesTradeLabel');
  if (tradeLabel) { tradeLabel.textContent = `${tradeList[0]} Rates`; tradeLabel.style.display = 'inline-block'; }
  showSavedPopup(`Average ${tradeList[0]} rates filled in. Adjust anything that doesn't fit your area.`);
}

function autoFillServices(trades) {
  const tradeList = Array.isArray(trades) ? trades : [trades];
  let added = 0;
  tradeList.forEach(trade => {
    const data = TRADE_DATA[trade];
    if (!data) return;
    data.services.forEach(s => {
      const exists = state.priceList.some(j => j.name.toLowerCase() === s.name.toLowerCase());
      if (!exists) { addJob(s.name, s.price, s.unit, 'service', null); added++; }
    });
  });
  const svcPrompt = document.getElementById('autoFillServicesPrompt');
  if (svcPrompt) svcPrompt.style.display = 'none';
  document.getElementById('oboPostFillServices').style.display = '';
  if (added > 0) {
    save(); queuePriceListSync(true); refreshPriceList(); updateJobPicker();
    const tradeLabel = tradeList.length === 1 ? tradeList[0] : tradeList.join(' & ');
    showSavedPopup(`${added} (${tradeLabel}) service${added > 1 ? 's' : ''} added. Adjust prices if necessary.`);
  } else {
    showSavedPopup('All those services are already on your list!');
  }
}

function autoFillMaterials(trades) {
  const tradeList = Array.isArray(trades) ? trades : [trades];
  let added = 0;
  tradeList.forEach(trade => {
    const data = TRADE_DATA[trade];
    if (!data) return;
    data.materials.forEach(m => {
      const exists = state.priceList.some(j => j.name.toLowerCase() === m.name.toLowerCase());
      if (!exists) { addJob(m.name, m.price, m.unit, 'materials', null); added++; }
    });
  });
  const matPrompt = document.getElementById('autoFillMaterialsPrompt');
  if (matPrompt) matPrompt.style.display = 'none';
  document.getElementById('oboPostFillMaterials').style.display = '';
  if (added > 0) {
    save(); queuePriceListSync(true); refreshPriceList(); updateJobPicker();
    const tradeLabel = tradeList.length === 1 ? tradeList[0] : tradeList.join(' & ');
    showSavedPopup(`${added} (${tradeLabel}) material${added > 1 ? 's' : ''} added. Update prices to what you actually pay.`);
  } else {
    showSavedPopup('All those materials are already on your list!');
  }
}

function saveTradeThenCallback(trade, callback) {
  state.company.trade = trade;
  setVal('p1Trade', trade);
  save();
  if (typeof saveBusinessToSupabase === 'function') saveBusinessToSupabase().catch(() => {});
  callback(trade);
}

function showDuplicatePrompt(name, onConfirm) {
  // Remove any existing duplicate prompt
  document.getElementById('dupPrompt')?.remove();
  const el = document.createElement('div');
  el.id = 'dupPrompt';
  el.className = 'dup-prompt';
  el.innerHTML = `
    <span>"${esc(name)}" is already in your list. Add as an alternative?</span>
    <div class="dup-prompt-btns">
      <button class="btn btn-sm btn-sage" id="dupYes">Yes, add it</button>
      <button class="btn btn-sm btn-outline" id="dupNo">Cancel</button>
    </div>
  `;
  const individual = document.querySelector('.individual-add');
  individual.appendChild(el);
  el.querySelector('#dupYes').addEventListener('click', () => { el.remove(); onConfirm(); });
  el.querySelector('#dupNo').addEventListener('click', () => el.remove());
}

function addJob(name, price, unit, category = '', costPrice = null) {
  state.priceList.push({ id: uid(), name, price, unit, category, costPrice });
}

function refreshPriceList() {
  const q    = getVal('priceListSearch').toLowerCase();
  const activeTab = document.querySelector('.jobs-added-card .obo-tab.active')?.dataset?.cat || 'all';
  let filtered = state.priceList.filter(j => {
    const matchesSearch = j.name.toLowerCase().includes(q);
    if (!matchesSearch) return false;
    if (activeTab === 'materials') return j.category === 'materials';
    if (activeTab === 'service')   return j.category !== 'materials';
    return true;
  });

  const sort = document.getElementById('priceListSort')?.value || 'default';
  if (sort === 'default' || sort === 'alpha-asc') filtered.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'alpha-desc')  filtered.sort((a, b) => b.name.localeCompare(a.name));
  else if (sort === 'price-asc')   filtered.sort((a, b) => (a.price || 0) - (b.price || 0));
  else if (sort === 'price-desc')  filtered.sort((a, b) => (b.price || 0) - (a.price || 0));
  const container = document.getElementById('priceListContainer');
  const empty     = document.getElementById('priceListEmpty');
  const badge     = document.getElementById('priceListBadge');

  badge.textContent = state.priceList.length;
  const bulkCount = document.getElementById('bulkJobCount');
  if (bulkCount) bulkCount.textContent = state.priceList.length;

  // Keep page1 button and page2 header in sync as the list changes
  updatePriceListBtn();
  updatePage2Header();

  // Remove job rows but keep #priceListEmpty so it is never destroyed by innerHTML
  Array.from(container.children).forEach(child => {
    if (child !== empty) child.remove();
  });

  if (!state.priceList.length) {
    if (empty) empty.style.display = 'flex';
    return;
  }
  if (empty) empty.style.display = 'none';

  filtered.forEach(job => {
    const row = document.createElement('div');
    row.className = 'price-item';
    row.dataset.id = job.id;
    row.innerHTML = `
      <div class="price-item-check">
        <input type="checkbox" class="job-check" data-id="${job.id}" aria-label="Select ${esc(job.name)}">
      </div>
      <div class="price-item-info">
        <div class="price-item-name">${esc(job.name)}${job.category === 'materials' ? `<span class="cat-pill cat-pill-materials">Material</span>` : (job.category ? `<span class="cat-pill cat-pill-labour">Service</span>` : '')}</div>
        ${job.unit ? `<div class="price-item-meta">${esc(job.unit)}</div>` : ''}
        ${job.category === 'materials' && job.costPrice != null ? `<div class="price-item-cost">Your cost: ${fmtPrice(job.costPrice)}</div>` : ''}
      </div>
      <div class="price-item-price">${fmtPrice(job.price)}</div>
      <div class="price-item-actions">
        <button class="icon-btn edit" data-id="${job.id}" title="Edit" aria-label="Edit ${esc(job.name)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="icon-btn delete" data-id="${job.id}" title="Delete" aria-label="Delete ${esc(job.name)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>
    `;
    container.appendChild(row);

    row.querySelector('.job-check').addEventListener('change', () => {
      const anyChecked = container.querySelectorAll('.job-check:checked').length > 0;
      document.getElementById('deleteSelectedBtn').style.display = anyChecked ? 'flex' : 'none';
    });

    row.querySelector('.edit').addEventListener('click', () => editJobInline(row, job), { once: true });
    row.querySelector('.delete').addEventListener('click', () => deleteJob(job.id));
  });
}

function editJobInline(row, job) {
  if (editingJobId === job.id) return;  // prevent re-entry on rapid taps
  editingJobId = job.id;

  const currentCat = job.category === 'materials' ? 'materials' : 'service';
  const catOpts = ['service','materials'].map(c =>
    `<button type="button" class="cat-btn${currentCat === c ? ' active' : ''} edit-cat-btn" data-cat="${c}">${c === 'service' ? 'Service' : 'Material'}</button>`
  ).join('');
  row.innerHTML = `
    <div class="price-item-edit-row">
      <div class="pie-row1">
        <div class="cat-selector edit-cat-selector">${catOpts}</div>
        <input type="text" class="edit-name" value="${esc(job.name)}" placeholder="Description">
      </div>
      <div class="pie-row2">
        <input type="number" class="edit-price" value="${job.price}" placeholder="Sell price" min="0" step="0.01">
        <input type="number" class="edit-cost" value="${job.costPrice != null ? job.costPrice : ''}" placeholder="Cost price (optional)" min="0" step="0.01">
        <input type="text" class="edit-unit" value="${esc(job.unit||'')}" placeholder="Unit">
      </div>
      <div class="pie-row3">
        <button class="btn btn-sm btn-primary save-edit">Save</button>
        <button class="btn btn-sm btn-outline cancel-edit">Cancel</button>
      </div>
    </div>
  `;
  row.querySelectorAll('.edit-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      row.querySelectorAll('.edit-cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  row.querySelector('.edit-name').focus();

  const done = () => { editingJobId = null; };

  const saveEdit = () => {
    const name      = row.querySelector('.edit-name').value.trim();
    const price     = parseFloat(row.querySelector('.edit-price').value);
    const unit      = row.querySelector('.edit-unit').value.trim();
    const costRaw   = row.querySelector('.edit-cost').value;
    const costPrice = costRaw !== '' ? parseFloat(costRaw) : null;
    const activeBtn = row.querySelector('.edit-cat-btn.active');
    const category  = activeBtn ? activeBtn.dataset.cat : (job.category || '');
    if (!name || isNaN(price)) { toast('Name and price are required.', 'error'); return; }
    const idx = state.priceList.findIndex(j => j.id === job.id);
    if (idx > -1) state.priceList[idx] = { ...job, name, price, unit, category, costPrice };
    done();
    save();
    queuePriceListSync(true);
    refreshPriceList();
    updateJobPicker();
    showSavedPopup("Updated. Good to go.");
  };

  row.querySelector('.save-edit').addEventListener('click', saveEdit);
  row.querySelector('.cancel-edit').addEventListener('click', () => { done(); refreshPriceList(); });
  row.querySelector('.edit-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveEdit();
    if (e.key === 'Escape') { done(); refreshPriceList(); }
  });
}

function deleteJob(id) {
  state.priceList = state.priceList.filter(j => j.id !== id);
  save();
  queuePriceListSync(true);
  syncOboStateWithPriceList();
  refreshPriceList();
  updateJobPicker();
  toast('Job deleted.');
}

// If a category has no items left, reset its Add tab back to the auto-fill /
// manual prompt so the user can regenerate or add their own.
function syncOboStateWithPriceList() {
  const hasSvc = state.priceList.some(j => j.category !== 'materials');
  const hasMat = state.priceList.some(j => j.category === 'materials');
  if (!hasSvc) oboState.svc = 'prompt';
  if (!hasMat) oboState.mat = 'prompt';
  if (typeof _switchOboGrid === 'function') {
    const activeTab = document.querySelector('#jobCatSelector .obo-tab.active')?.dataset?.cat || 'service';
    _switchOboGrid(activeTab);
  }
}

/* ===== PAGE 3 -CUSTOMER DETAILS ===== */
function setupPage3() {
  // Expand/collapse extra customer fields
  document.getElementById('custMoreToggle')?.addEventListener('change', (e) => {
    const extra = document.getElementById('custExtraFields');
    const label = document.getElementById('custMoreLabel');
    const open  = e.target.checked;
    if (extra) extra.style.display = open ? 'block' : 'none';
    if (label) label.textContent = open ? 'Hide extra details' : 'Add more details';
  });
}

// Expand extra fields if any hidden values are already populated (e.g. when editing)
function syncCustMoreToggle() {
  const extra  = document.getElementById('custExtraFields');
  const toggle = document.getElementById('custMoreToggle');
  const label  = document.getElementById('custMoreLabel');
  if (!extra) return;
  const hasExtra = ['custTitle','custAddr','custPostcode','custEmail'].some(id => {
    const el = document.getElementById(id);
    return el && el.value && el.value.trim() !== '';
  });
  extra.style.display = hasExtra ? 'block' : 'none';
  if (toggle) toggle.checked = hasExtra;
  if (label)  label.textContent = hasExtra ? 'Hide extra details' : 'Add more details';
}

/* ===== PAGE JOBS -ADD JOBS ===== */
function setupPageJobs() {
  // Services / Materials tab switching
  document.querySelectorAll('#pjCatSelector .obo-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#pjCatSelector .obo-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const isMat = btn.dataset.pjtab === 'materials';
      document.getElementById('pjServicePanel').style.display  = isMat ? 'none' : '';
      document.getElementById('pjMaterialsPanel').style.display = isMat ? '' : 'none';
    });
  });

  // Services picker search
  document.getElementById('jobPickerSearch').addEventListener('input', () => updateServicesPicker());

  // Materials picker search
  document.getElementById('materialsPickerSearch')?.addEventListener('input', () => updateMaterialsPicker());

  // One-off material add (always tagged as material)
  document.getElementById('addCustomItemBtn').addEventListener('click', addCustomItem);

  // Mic / voice button
  document.getElementById('voiceBtn')?.addEventListener('click', toggleVoice);
  document.getElementById('voiceBtnMaterials')?.addEventListener('click', toggleVoiceMaterials);

  // Description of Work help toggle
  document.getElementById('descOfWorkHelpBtn')?.addEventListener('click', () => {
    const panel = document.getElementById('descOfWorkHelp');
    if (panel) panel.hidden = !panel.hidden;
  });

  // Back to customer details
  document.getElementById('backToCustomerBtn')?.addEventListener('click', () => {
    showPage('page3');
  });

  // Save and go to completion
  document.getElementById('saveJobsGoToCompletionBtn')?.addEventListener('click', () => {
    recalcTotals();
    showPage('page-completion');
  });
}

/* ===== PAGE COMPLETION -TOTALS, SIGNATURE & SAVE ===== */
function setupPageCompletion() {
  // Back → The Work
  document.getElementById('backToWorkBtn')?.addEventListener('click', () => showPage('page-jobs'));

  // Save → save quote then open preview
  // Save & Preview: persist the job to My Jobs, then open the preview so they
  // can send it. Because it's saved, closing the preview no longer loops back.
  document.getElementById('saveTermsGoToPreviewBtn')?.addEventListener('click', () => {
    recalcTotals();
    const doc = persistCurrentQuoteFromTerms();
    if (!doc) return;
    populateQuoteSendModal(doc, { show: false }); // prime send fields silently
    quotePreviewed = true;
    openPreview(buildDocHtml(doc, 'quote'), 'quote', doc.id);
  });

  // Save to My Jobs: persist and go straight to the jobs list (not ready to send yet)
  document.getElementById('saveTermsToListBtn')?.addEventListener('click', () => {
    recalcTotals();
    const doc = persistCurrentQuoteFromTerms();
    if (!doc) return;
    clearDraftQuote();
    showSavedPopup("Done. I've got it.");
    showPage('page4');
  });

  // Doc type radio checkboxes
  document.getElementById('dtEstimate').addEventListener('change', () => setDocType('Estimate'));
  document.getElementById('dtQuote').addEventListener('change',    () => setDocType('Quote'));

  // Signature auto/manual toggle
  document.getElementById('sigAutoToggle')?.addEventListener('change', e => {
    const auto = e.target.checked;
    const label = document.getElementById('sigAutoLabel');
    const sigText = document.getElementById('custSigText');
    if (label) label.textContent = auto ? 'Auto' : 'Manual';
    if (auto) {
      sigText.value = formatSigFromName(document.getElementById('authSig')?.value) || defaultAuthSig();
      sigText.readOnly = true;
      sigText.style.color = '';
    } else {
      sigText.value = '';
      sigText.readOnly = false;
      sigText.focus();
    }
  });

  // Estimate vs Quote tooltip
  document.getElementById('estQuoteTooltipBtn').addEventListener('click', () => {
    const t = document.getElementById('estQuoteTooltip');
    t.style.display = t.style.display === 'none' ? 'block' : 'none';
  });

  // Valid for
  document.getElementById('docValidFor').addEventListener('change', e => {
    document.getElementById('validCustomGroup').style.display = e.target.value === 'custom' ? 'block' : 'none';
  });

  // VAT
  document.getElementById('vatSelect').addEventListener('change', e => {
    document.getElementById('vatCustom').style.display = e.target.value === 'custom' ? 'inline-block' : 'none';
    recalcTotals();
  });
  document.getElementById('vatCustom').addEventListener('input', recalcTotals);

  // Discount
  document.getElementById('discountPct').addEventListener('change', e => {
    document.getElementById('discountCustom').style.display = e.target.value === 'custom' ? 'inline-block' : 'none';
    recalcTotals();
  });
  document.getElementById('discountCustom').addEventListener('input', recalcTotals);

  // Sync signature preview whenever the Authorised Signature name changes
  document.getElementById('authSig').addEventListener('input', () => {
    const sigText = document.getElementById('custSigText');
    // Only auto-sync if the user hasn't manually edited the preview
    if (!sigText.dataset.userEdited) {
      sigText.value = formatSigFromName(document.getElementById('authSig').value);
    }
  });
  document.getElementById('custSigText').addEventListener('input', () => {
    // Mark as manually edited so auto-sync stops overwriting it
    document.getElementById('custSigText').dataset.userEdited = '1';
  });

  // Quote footer buttons (optional — some may not exist depending on page variant)
  document.getElementById('previewQuoteBtn')?.addEventListener('click', () => { if (docTypeGuard()) openPreview(buildQuoteDoc(), 'quote'); });
  document.getElementById('saveQuoteBtn')?.addEventListener('click', saveQuote);
  document.getElementById('printQuoteBtn')?.addEventListener('click', () => { if (docTypeGuard()) printDoc(buildQuoteDoc()); });
  document.getElementById('sendQuoteBtn')?.addEventListener('click', () => { if (docTypeGuard()) openQuoteModalFromCurrentForm(); });

  // Signature canvas
  setupSignatureCanvas();
}

function setDocType(type) {
  state.quote.type = type;
  const estEl = document.getElementById('dtEstimate');
  const quoteEl = document.getElementById('dtQuote');
  if (estEl) estEl.checked = (type === 'Estimate');
  if (quoteEl) quoteEl.checked = (type === 'Quote');
  generateRef();
  personaliseText();
}

/* ── DRAFT QUOTE (survives refresh) ─────────────────────── */
let _draftSaveTimer = null;
function queueDraftSave() {
  clearTimeout(_draftSaveTimer);
  _draftSaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY_DRAFT_QUOTE, JSON.stringify(state.quote));
    } catch(e) { /* storage full — ignore */ }
  }, 800);
}
function clearDraftQuote() {
  clearTimeout(_draftSaveTimer);
  localStorage.removeItem(KEY_DRAFT_QUOTE);
}
function hasDraftQuote() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY_DRAFT_QUOTE) || 'null');
    return d && (d.custFirstName || d.custLastName || (d.items && d.items.length));
  } catch(e) { return false; }
}
function restoreDraftQuote() {
  try {
    return JSON.parse(localStorage.getItem(KEY_DRAFT_QUOTE) || 'null');
  } catch(e) { return null; }
}

function prepareNewQuote() {
  if (state.editingDocId) {
    const doc = state.saved.find(d => d.id === state.editingDocId);
    if (doc) {
      loadQuoteFromDoc(doc);
      return;
    }
  }

  // Restore draft if one exists (customer or items were entered)
  const draft = restoreDraftQuote();
  if (draft && (draft.custFirstName || draft.custLastName || (draft.items && draft.items.length))) {
    state.quote = draft;
    state.editingDocId = null;
    const saveBtn = document.getElementById('saveQuoteBtn');
    if (saveBtn) saveBtn.textContent = '✓ Save';
    populateQuoteForm();
    toast('Draft restored — carry on where you left off.', 'info');
    return;
  }

  // Fresh quote
  const stored = parseInt(localStorage.getItem(KEY_REF) || '100');
  pendingRefNum = Math.max(stored, 100) + 1;
  state.quote = {
    type: '',
    custTitle: '', custFirstName: '', custLastName: '',
    custAddr: '', custPostcode: '', custPhone: '', custEmail: '',
    date: todayStr(), validFor: '14', validCustom: '',
    ref: buildRef(pendingRefNum),
    items: [],
    vatRate: '20', vatCustom: '',
    discount: '0',
    notes: '', privateNotes: '',
    selectedTerms: [], customTerms: '',
    authSig: '', custSig: '', sigDate: ''
  };
  state.editingDocId = null;
  const saveBtn = document.getElementById('saveQuoteBtn');
  if (saveBtn) saveBtn.textContent = '✓ Save';
  populateQuoteForm();
}

function loadQuoteFromDoc(doc) {
  const q = doc.quote || {};
  state.quote = {
    ...q,
    ref: q.ref || doc.ref || '',
    // Deep-copy items so editing never mutates the stored doc's array
    items: (q.items || []).map(i => ({ ...i }))
  };
  populateQuoteForm();
}

function populateQuoteForm() {
  const q = state.quote;
  setDocType(q.type || '');
  setVal('custTitle',     q.custTitle);
  setVal('custFirstName', q.custFirstName);
  setVal('custLastName',  q.custLastName);
  setVal('custAddr',      q.custAddr);
  setVal('custPostcode',  q.custPostcode);
  setVal('custPhone',     q.custPhone);
  setVal('custEmail',     q.custEmail);
  syncCustMoreToggle(); // expand extra fields if any have values
  setVal('docRef',        q.ref);
  setVal('docDate',       q.date || todayStr());
  setVal('docValidFor',   q.validFor || '14');
  setVal('docValidCustom',q.validCustom || '');
  setVal('quoteNotes',    q.notes);
  setVal('quotePrivateNotes', q.privateNotes);
  setVal('customTerms',   q.customTerms || '');
  const sigName = q.authSig || defaultAuthName();
  setVal('authSig', sigName);
  // Signature preview: only pre-fill if the toggle is set to Auto.
  // Manual mode always starts blank so the tradesman types their own signature.
  const sigAutoOn = document.getElementById('sigAutoToggle')?.checked;
  const sigPreview = sigAutoOn
    ? (q.custSigText || (q.authSig ? formatSigFromName(q.authSig) : defaultAuthSig()))
    : '';
  setVal('custSigText', sigPreview);
  const sigEl = document.getElementById('custSigText');
  if (sigEl) {
    sigEl.readOnly = !!sigAutoOn;
    delete sigEl.dataset.userEdited;
  }
  // Set discount select (backwards-compat: old docs stored any number, new ones use preset or 'custom')
  const savedDisc = String(q.discount || '0');
  const discPresets = ['0', '5', '10', '20'];
  if (discPresets.includes(savedDisc)) {
    document.getElementById('discountPct').value = savedDisc;
    document.getElementById('discountCustom').style.display = 'none';
    setVal('discountCustom', '');
  } else {
    document.getElementById('discountPct').value = 'custom';
    setVal('discountCustom', savedDisc);
    document.getElementById('discountCustom').style.display = 'inline-block';
  }
  setVal('vatCustom',     q.vatCustom || '');
  document.getElementById('vatSelect').value = q.vatRate || '20';
  document.getElementById('vatCustom').style.display = q.vatRate === 'custom' ? 'inline-block' : 'none';
  document.getElementById('validCustomGroup').style.display = q.validFor === 'custom' ? 'block' : 'none';

  // Terms
  document.querySelectorAll('[name="terms"]').forEach(cb => {
    cb.checked = (q.selectedTerms || []).includes(cb.value);
  });

  clearCanvas();
  renderQuoteItems();
  recalcTotals();
  updateJobPicker();
}

/* Returns the full printed name: "Samantha Clarke" */
function defaultAuthName() {
  const first = (state.company.firstName || '').trim();
  const last  = (state.company.lastName  || '').trim();
  return (first + ' ' + last).trim() || state.company.businessName || '';
}

/* Returns the formatted signature: "S.Clarke" */
function defaultAuthSig() {
  const first = (state.company.firstName || '').trim();
  const last  = (state.company.lastName  || '').trim();
  if (first && last) return first.charAt(0).toUpperCase() + '.' + last;
  return first || last || state.company.businessName || '';
}

/* Formats any "First Last" string into "F.Last" -used when the name field changes */
function formatSigFromName(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return name || '';
  return parts[0].charAt(0).toUpperCase() + '.' + parts.slice(1).join(' ');
}

function populateAuthSig() {
  const authSigEl = document.getElementById('authSig');
  if (authSigEl && !authSigEl.value) authSigEl.value = defaultAuthName();
  const custSigEl = document.getElementById('custSigText');
  if (custSigEl && !custSigEl.value && !custSigEl.dataset.userEdited) custSigEl.value = defaultAuthSig();
}

function setTodayDate() {
  const el = document.getElementById('docDate');
  if (el && !el.value) el.value = todayStr();
}

function buildRef(num) {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  return `LEXI-${num}-${dd}${mm}${yy}`;
}

function generateRef() {
  if (state.editingDocId) return; // keep original ref when editing
  const el = document.getElementById('docRef');
  if (!el) return;
  const stored = parseInt(localStorage.getItem(KEY_REF) || '100');
  pendingRefNum = Math.max(stored, 100) + 1;
  el.value = buildRef(pendingRefNum);
}

function ensureDocumentRefAndDate(doc = {}) {
  if (!doc.quote) doc.quote = {};
  if (!doc.ref && doc.quote.ref) doc.ref = doc.quote.ref;
  if (!doc.quote.ref && doc.ref) doc.quote.ref = doc.ref;
  if (!doc.ref && !doc.quote.ref) {
    const stored = parseInt(localStorage.getItem(KEY_REF) || '100');
    const next = Math.max(stored, 100) + 1;
    const ref = buildRef(next);
    localStorage.setItem(KEY_REF, next);
    doc.ref = ref;
    doc.quote.ref = ref;
    doc.updatedAt = new Date().toISOString();
  }
  if (!doc.date && doc.quote.date) doc.date = doc.quote.date;
  if (!doc.quote.date && doc.date) doc.quote.date = doc.date;
  if (!doc.date && !doc.quote.date) {
    const date = toSupabaseDate(doc.createdAt) || todayStr();
    doc.date = date;
    doc.quote.date = date;
    doc.updatedAt = new Date().toISOString();
  }
  return doc;
}

// Shared helper: build a single pick-item element
function makePickItem(item, category) {
  const quoteItem = (state.quote.items || []).find(qi => qi.id === item.id || qi.name === item.name);
  const inQuote = !!quoteItem;
  const qty = quoteItem ? quoteItem.qty : 0;
  const el = document.createElement('div');
  el.className = 'pick-item' + (inQuote ? ' added' : '');

  if (inQuote) {
    // Show inline stepper so they can adjust without scrolling
    el.innerHTML = `
      <div class="pick-name">${esc(item.name)}${item.unit ? `<span class="pick-unit">(${esc(item.unit)})</span>` : ''}</div>
      <span class="pick-price">${fmtPrice(item.price)}</span>
      <div class="pick-stepper">
        <button type="button" class="qty-btn qty-minus" aria-label="Remove one">−</button>
        <span class="qty-value">${qty}</span>
        <button type="button" class="qty-btn qty-plus" aria-label="Add one">+</button>
      </div>
    `;
    el.querySelector('.qty-minus').addEventListener('click', e => {
      e.stopPropagation();
      if (quoteItem.qty > 1) { quoteItem.qty--; } else { state.quote.items.splice(state.quote.items.indexOf(quoteItem), 1); }
      renderQuoteItems(); recalcTotals(); updateJobPicker();
    });
    el.querySelector('.qty-plus').addEventListener('click', e => {
      e.stopPropagation();
      quoteItem.qty++;
      renderQuoteItems(); recalcTotals(); updateJobPicker();
    });
  } else {
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', 'Add ' + (item.name || '') + ' to quote');
    el.innerHTML = `
      <div class="pick-name">${esc(item.name)}${item.unit ? `<span class="pick-unit">(${esc(item.unit)})</span>` : ''}</div>
      <span class="pick-price">${fmtPrice(item.price)}</span>
      <span class="pick-add-btn">+</span>
    `;
    const doAdd = () => addJobToQuote(item.id || item.name, category);
    el.addEventListener('click', doAdd);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doAdd(); } });
  }
  return el;
}

function updateJobPicker() {
  updateServicesPicker();
  updateMaterialsPicker();
  updateRatesSection();
}

function updateServicesPicker() {
  const q = getVal('jobPickerSearch').toLowerCase();
  // Services = items tagged 'service' OR 'labour' (legacy) OR no category at all
  const services = state.priceList.filter(j =>
    (!j.category || j.category === 'service' || j.category === 'labour') &&
    j.name.toLowerCase().includes(q)
  );
  const container = document.getElementById('jobPickerList');
  if (!container) return;
  container.innerHTML = '';
  if (!services.length) {
    const msg = document.createElement('p');
    msg.style.cssText = 'color:#888;font-size:0.85rem;padding:8px 0';
    msg.textContent = q ? 'No services match your search.' : 'No services added yet - go to My Services & Materials to build your list.';
    container.appendChild(msg);
    return;
  }
  services.forEach(item => container.appendChild(makePickItem(item, 'service')));
}

function updateMaterialsPicker() {
  const q = (document.getElementById('materialsPickerSearch')?.value || '').toLowerCase();
  const materials = state.priceList.filter(j =>
    j.category === 'materials' &&
    j.name.toLowerCase().includes(q)
  );
  const wrap = document.getElementById('materialsPickerWrap');
  const container = document.getElementById('materialsPickerList');
  if (!wrap || !container) return;

  if (!materials.length) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';
  container.innerHTML = '';
  materials.forEach(item => container.appendChild(makePickItem(item, 'materials')));
}

function updateRatesSection() {
  const section = document.getElementById('myRatesSection');
  const row = document.getElementById('myRatesBtns');
  if (!section || !row) return;

  const c = state.company;
  // Order: col1 row1, col2 row1, col1 row2, col2 row2
  const rates = [
    { label: 'Hourly Rate',     key: 'rateHourly',  value: c.rateHourly,  unit: 'hr'  },
    { label: 'Call-out Charge', key: 'rateCallout', value: c.rateCallout, unit: ''    },
    { label: 'Half Day Rate',   key: 'rateHalfDay', value: c.rateHalfDay, unit: 'day' },
    { label: 'Day Rate',        key: 'rateDay',     value: c.rateDay,     unit: 'day' },
  ].filter(r => r.value != null && r.value > 0);

  if (!rates.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  row.innerHTML = '';
  row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px';

  rates.forEach(r => {
    const existing = state.quote.items.find(i => i.name === r.label && i.category === 'rate');
    const checked = !!existing;
    const currentPrice = existing ? existing.unitPrice : r.value;
    const currentQty   = existing ? existing.qty       : 1;
    const qtyLabel = r.unit === 'hr' ? 'Hours' : r.unit === 'day' ? 'Days' : 'Qty';

    const row2 = document.createElement('div');
    row2.className = 'rate-row' + (checked ? ' rate-row-active' : '');
    row2.innerHTML = `
      <label class="rate-row-check-label">
        <input type="checkbox" class="rate-row-check" ${checked ? 'checked' : ''}>
        <span class="rate-row-name">${esc(r.label)}</span>
      </label>
      <div class="rate-row-fields" style="${checked ? '' : 'display:none'}">
        <div class="rate-row-field">
          <label>Rate (£)</label>
          <input type="number" class="rate-row-price" value="${currentPrice}" min="0" step="any">
        </div>
        <div class="rate-row-field">
          <label>${qtyLabel}</label>
          <input type="number" class="rate-row-qty" value="${currentQty}" min="1" step="1">
        </div>
      </div>
    `;

    const checkbox  = row2.querySelector('.rate-row-check');
    const fields    = row2.querySelector('.rate-row-fields');
    const priceInput = row2.querySelector('.rate-row-price');
    const qtyInput  = row2.querySelector('.rate-row-qty');

    function applyRateItem() {
      const price = parseFloat(priceInput.value) || r.value;
      const qty   = parseInt(qtyInput.value, 10)  || 1;
      const idx   = state.quote.items.findIndex(i => i.name === r.label && i.category === 'rate');
      if (idx >= 0) {
        state.quote.items[idx].unitPrice = price;
        state.quote.items[idx].qty       = qty;
      } else {
        state.quote.items.push({ id: uid(), name: r.label, unitPrice: price, unit: r.unit, qty, category: 'rate' });
      }
      renderQuoteItems(); recalcTotals();
    }

    function removeRateItem() {
      const idx = state.quote.items.findIndex(i => i.name === r.label && i.category === 'rate');
      if (idx >= 0) state.quote.items.splice(idx, 1);
      renderQuoteItems(); recalcTotals();
    }

    checkbox.addEventListener('change', () => {
      row2.classList.toggle('rate-row-active', checkbox.checked);
      fields.style.display = checkbox.checked ? '' : 'none';
      if (checkbox.checked) applyRateItem(); else removeRateItem();
    });

    priceInput.addEventListener('change', () => { if (checkbox.checked) applyRateItem(); });
    qtyInput.addEventListener('change',   () => { if (checkbox.checked) applyRateItem(); });

    row.appendChild(row2);
  });
}


function addJobToQuote(jobId, category) {
  // Match by id first, fall back to name (handles legacy items without ids)
  const job = state.priceList.find(j => j.id === jobId) || state.priceList.find(j => j.name === jobId);
  if (!job) return;
  // Ensure the job has an id going forward
  if (!job.id) { job.id = uid(); ls(KEY_PL, state.priceList); }
  const existing = state.quote.items.find(i => i.id === job.id || i.name === job.name);
  const resolvedCategory = category || job.category || 'service';
  if (existing) {
    existing.qty++;
  } else {
    state.quote.items.push({ id: job.id, name: job.name, unitPrice: job.price, unit: job.unit, qty: 1, category: resolvedCategory });
  }
  renderQuoteItems();
  recalcTotals();
  updateJobPicker();
}

function addCustomItem() {
  const name  = getVal('customItemName').trim();
  const price = parseFloat(getVal('customItemPrice'));
  if (!name)        { document.getElementById('customItemName').classList.add('error');  return; }
  if (isNaN(price)) { document.getElementById('customItemPrice').classList.add('error'); return; }
  document.getElementById('customItemName').classList.remove('error');
  document.getElementById('customItemPrice').classList.remove('error');

  state.quote.items.push({ id: uid(), name, unitPrice: price, unit: 'each', qty: 1, category: 'materials' });
  setVal('customItemName',''); setVal('customItemPrice','');
  renderQuoteItems();
  recalcTotals();
}

function addCustomService() {
  const name  = getVal('customServiceName').trim();
  const price = parseFloat(getVal('customServicePrice'));
  if (!name)        { document.getElementById('customServiceName').classList.add('error');  return; }
  if (isNaN(price)) { document.getElementById('customServicePrice').classList.add('error'); return; }
  document.getElementById('customServiceName').classList.remove('error');
  document.getElementById('customServicePrice').classList.remove('error');

  state.quote.items.push({ id: uid(), name, unitPrice: price, unit: '', qty: 1, category: 'service' });
  setVal('customServiceName',''); setVal('customServicePrice','');
  renderQuoteItems();
  recalcTotals();
}

function renderQuoteItems() {
  queueDraftSave(); // persist any item changes for refresh survival
  const container = document.getElementById('quoteItemsContainer');
  const empty     = document.getElementById('quoteItemsEmpty');

  if (!Array.isArray(state.quote.items)) state.quote.items = [];

  Array.from(container.children).forEach(child => {
    if (child !== empty) child.remove();
  });

  if (!state.quote.items.length) {
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  const makeRow = (item, idx) => {
    const row = document.createElement('div');
    row.className = 'quote-item';
    const lineTotal = item.unitPrice * item.qty;
    row.innerHTML = `
      <div class="quote-item-info">
        <div class="quote-item-name">${esc(item.name)}</div>
        <div class="quote-item-unit-price">${fmtPrice(item.unitPrice)}${item.unit ? ' / ' + esc(item.unit) : ''}</div>
      </div>
      <div class="qty-stepper">
        <button type="button" class="qty-btn qty-minus" aria-label="Decrease quantity">−</button>
        <span class="qty-value">${item.qty}</span>
        <button type="button" class="qty-btn qty-plus" aria-label="Increase quantity">+</button>
      </div>
      <div class="quote-item-total">${fmtPrice(lineTotal)}</div>
      <button type="button" class="icon-btn delete" aria-label="Remove ${esc(item.name)}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;
    row.querySelector('.qty-minus').addEventListener('click', () => {
      if (item.qty > 1) { item.qty--; } else { state.quote.items.splice(idx, 1); }
      renderQuoteItems(); recalcTotals();
    });
    row.querySelector('.qty-plus').addEventListener('click', () => {
      item.qty++; renderQuoteItems(); recalcTotals();
    });
    row.querySelector('.delete').addEventListener('click', () => {
      state.quote.items.splice(idx, 1); renderQuoteItems(); recalcTotals();
    });
    return row;
  };

  const indexed = state.quote.items.map((item, idx) => ({ item, idx }));
  const rates    = indexed.filter(({ item }) => item.category === 'rate');
  const services = indexed.filter(({ item }) => !item.category || item.category === 'service' || item.category === 'labour');
  const materials = indexed.filter(({ item }) => item.category === 'materials');

  const groupCount = [rates, services, materials].filter(g => g.length > 0).length;
  const showLabels = groupCount > 1;

  const appendGroup = (label, group) => {
    if (!group.length) return;
    if (showLabels) {
      const lbl = document.createElement('div');
      lbl.className = 'quote-group-label';
      lbl.textContent = label;
      container.appendChild(lbl);
    }
    group.forEach(({ item, idx }) => container.appendChild(makeRow(item, idx)));
  };

  appendGroup('Rates', rates);
  appendGroup('Services', services);
  appendGroup('Materials', materials);
}

function recalcTotals() {
  const subtotal  = (state.quote.items || []).reduce((s, i) => s + i.unitPrice * i.qty, 0);
  const vatSel    = document.getElementById('vatSelect').value;
  const vatRate   = vatSel === 'custom' ? parseFloat(getVal('vatCustom')) || 0 : parseFloat(vatSel) || 0;
  const discSel   = document.getElementById('discountPct').value;
  const discPct   = discSel === 'custom' ? parseFloat(getVal('discountCustom')) || 0 : parseFloat(discSel) || 0;
  const discount  = subtotal * discPct / 100;
  const afterDisc = subtotal - discount;
  const vatAmt    = afterDisc * vatRate / 100;
  const total     = afterDisc + vatAmt;

  document.getElementById('qSubtotal').textContent  = fmtPrice(subtotal);
  document.getElementById('qVatAmount').textContent  = fmtPrice(vatAmt);
  document.getElementById('qDiscount').textContent   = `-${fmtPrice(discount)}`;
  document.getElementById('qTotal').textContent      = fmtPrice(total);

  // Show/hide discount and VAT rows in the totals block
  const discountRow = document.getElementById('discountRow');
  const vatRow = document.getElementById('vatRow');
  if (discountRow) discountRow.style.display = discount > 0 ? '' : 'none';
  if (vatRow) vatRow.style.display = vatAmt > 0 ? '' : 'none';
}

function collectQuoteState() {
  const vatSel  = document.getElementById('vatSelect').value;
  const discSel = document.getElementById('discountPct').value;
  const discount = discSel === 'custom' ? getVal('discountCustom') : discSel;
  const selectedTerms = [...document.querySelectorAll('[name="terms"]:checked')].map(cb => cb.value);
  return {
    type:          state.quote.type,
    custTitle:     getVal('custTitle'),
    custFirstName: getVal('custFirstName'),
    custLastName:  getVal('custLastName'),
    custAddr:      getVal('custAddr'),
    custPostcode:  getVal('custPostcode'),
    custPhone:     getVal('custPhone'),
    custEmail:     getVal('custEmail'),
    ref:           getVal('docRef'),
    date:          getVal('docDate'),
    validFor:      getVal('docValidFor'),
    validCustom:   getVal('docValidCustom'),
    items:         [...state.quote.items],
    vatRate:       vatSel,
    vatCustom:     getVal('vatCustom'),
    discount:      discount,
    notes:         getVal('quoteNotes'),
    privateNotes:  getVal('quotePrivateNotes'),
    selectedTerms,
    customTerms:   getVal('customTerms'),
    authSig:       getVal('authSig'),
    custSigText:   getVal('custSigText'),
    custSig:       '',
    sigDate:       todayStr()
  };
}

function docTypeGuard() {
  if (!state.quote.type) {
    const first = (state.quote.custFirstName || '').trim();
    showSavedPopup(`Before we move on${first ? ' ' + first : ''}, is this a fixed quote or an estimate?`, null, 5000);
    document.getElementById('dtEstimate')?.closest('.doc-type-chooser')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  }
  return true;
}

function saveQuote() {
  if (!docTypeGuard()) return;
  const q = collectQuoteState();
  // Always use the live items array directly from state
  q.items = [...state.quote.items];
  if (!q.custLastName && !q.custFirstName) {
    toast('Please add a customer name.', 'error');
    document.getElementById('custFirstName').focus();
    return;
  }

  const isEditing = !!state.editingDocId;
  const returningFromTerms = !!state.editingFromTerms;
  const docType   = q.type || 'Document';

  if (state.editingDocId) {
    const idx = state.saved.findIndex(d => d.id === state.editingDocId);
    if (idx > -1) {
      restoreCustomerFieldsFromDocQuote(q, state.saved[idx].quote || {});
      if (!q.ref && (state.saved[idx].ref || state.saved[idx].quote?.ref)) {
        q.ref = state.saved[idx].ref || state.saved[idx].quote.ref;
      }
      state.saved[idx] = {
        ...state.saved[idx],
        quote: q,
        company: { ...state.company },
        custName: buildCustName(q),
        total: calcTotal(q),
        type: q.type,
        updatedAt: new Date().toISOString(),
        invoiceSent: q.type === 'Invoice' || q.type === 'Receipt'
      };
    }
    state.editingDocId = null;
    state.editingFromTerms = false;
    // Reset save button label
    const saveBtn = document.getElementById('saveQuoteBtn');
    if (saveBtn) saveBtn.textContent = '✓ Save';
  } else {
    state.saved.unshift({
      id: uid(),
      quote: q,
      company: { ...state.company },
      custName: buildCustName(q),
      total: calcTotal(q),
      type: q.type,
      date: q.date,
      ref: q.ref,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      invoiceSent: q.type === 'Invoice' || q.type === 'Receipt',
      paid: false,
      paidAmount: 0,
      paidDate: '',
      payments: []
    });
    // Commit the pending ref number to storage (only on actual save, never on abandon)
    if (pendingRefNum !== null) {
      const stored = parseInt(localStorage.getItem(KEY_REF) || '100');
      if (pendingRefNum > stored) localStorage.setItem(KEY_REF, pendingRefNum);
      pendingRefNum = null;
    }
  }

  clearDraftQuote(); // quote saved to jobs — draft no longer needed
  save();
  // Sync immediately -don't rely on the debounced timer in case of a quick refresh
  if (savedDocsSyncReady && lexiSupabase && lexiAuthSession?.user?.id) {
    saveSavedDocsToSupabase().catch(err => {
      console.warn('Save sync failed:', err);
      localStorage.setItem('lexi_last_documents_sync_error', err?.message || String(err));
      toast(`Saved here, but cloud sync failed: ${err?.message || 'check connection'}`, 'error', 8000);
    });
  } else {
    queueSavedDocsSync(true);
  }
  upsertLocalCustomer(q);
  queueCustomerSync(q, true);
  updateSavedBadge();
  refreshSavedDocs();
  const popupLabel = isEditing ? "Changes saved. Nice one." : `${docType} saved. Another one sorted.`;

  if (returningFromTerms && activeCustomerGroup) {
    // Came from Job Terms edit via customer dashboard -go back to dashboard
    showSavedPopup(popupLabel, () => {
      try {
        const groups = buildCustomerGroups();
        const updated = groups.find(g => g.docs.some(d =>
          activeCustomerGroup.docs.some(ad => ad.id === d.id)
        )) || activeCustomerGroup;
        activeCustomerGroup = updated;
        renderSingleCustomerDashboard(updated, groups);
        document.getElementById('customerDashboardModal').style.display = 'flex';
      } catch(e) { console.error('Dashboard reopen error:', e); }
    });
  } else {
    showSavedPopup(popupLabel);
    showPage('page4');
    scrollMyJobsToTop();
    showNavHint();
  }
}

function buildCustName(q) {
  // Display format: Last, First Title  (e.g. "Jones, James Dr")
  const last  = (q.custLastName  || '').trim();
  const first = (q.custFirstName || '').trim();
  const title = (q.custTitle     || '').trim();
  if (last && first) return last + ', ' + first + (title ? ' ' + title : '');
  if (last)          return last + (title ? ' ' + title : '');
  if (first)         return first + (title ? ' ' + title : '');
  return title || '';
}

function calcTotal(q) {
  const sub    = (q.items || []).reduce((s, i) => s + i.unitPrice * i.qty, 0);
  const vatRate = q.vatRate === 'custom' ? parseFloat(q.vatCustom) || 0 : parseFloat(q.vatRate) || 0;
  const disc   = parseFloat(q.discount) || 0;
  const after  = sub - sub * disc / 100;
  return after + after * vatRate / 100;
}

function restoreCustomerFieldsFromDocQuote(targetQuote = {}, sourceQuote = {}) {
  ['custTitle', 'custFirstName', 'custLastName', 'custAddr', 'custPostcode', 'custPhone', 'custEmail', 'privateNotes'].forEach(key => {
    if (!String(targetQuote[key] || '').trim() && String(sourceQuote[key] || '').trim()) {
      targetQuote[key] = sourceQuote[key];
    }
  });
  return targetQuote;
}

async function jobsRefresh() {
  const btn = document.getElementById('jobsRefreshBtn');
  if (btn) btn.style.opacity = '0.5';
  // 1. Close any stuck modals
  ['customerDashboardModal','quoteModal','invoiceModal','receiptModal',
   'editChoiceModal','previewModal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  activeCustomerGroup = null;
  // 2. Scroll to top of jobs list
  scrollMyJobsToTop();
  // 3. Re-render the jobs list
  refreshSavedDocs();
  // 4. Check for new acceptances
  await checkQuoteAcceptances();
  if (btn) btn.style.opacity = '';
  toast('Jobs list refreshed.', 'success', 2000);
}

function scrollMyJobsToTop() {
  requestAnimationFrame(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    document.getElementById('page4')?.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
  });
}

function timestampFromLexiId(id) {
  const text = String(id || '');
  if (text.length <= 8) return 0;
  const parsed = parseInt(text.slice(8), 36);
  return Number.isFinite(parsed) ? parsed : 0;
}

function docAddedTime(doc = {}) {
  const created = doc.createdAt || doc.created_at || '';
  const parsed = created ? Date.parse(created) : 0;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  const idTime = timestampFromLexiId(doc.id || doc.local_id);
  if (idTime > 0) return idTime;
  const docDate = doc.date || doc.quote?.date || '';
  const dateParsed = docDate ? Date.parse(docDate) : 0;
  return Number.isFinite(dateParsed) ? dateParsed : 0;
}

function docDocumentTime(doc = {}) {
  const value = doc.date || doc.quote?.date || '';
  const parsed = value ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function docJobTime(doc = {}) {
  const value = doc.jobStartDate || doc.jobCompletedDate || '';
  const parsed = value ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

/* ===== SIGNATURE CANVAS ===== */
function setupSignatureCanvas() {
  const canvas = document.getElementById('sigCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let drawing = false, lastX = 0, lastY = 0;

  const getPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    const src  = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - rect.left) * (canvas.width / rect.width), y: (src.clientY - rect.top) * (canvas.height / rect.height) };
  };

  const start = (e) => { e.preventDefault(); drawing = true; const p = getPos(e); lastX = p.x; lastY = p.y; };
  const draw  = (e) => {
    if (!drawing) return; e.preventDefault();
    const p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = '#2C2C2C';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    lastX = p.x; lastY = p.y;
    setVal('custSigText', '');
  };
  const stop  = () => { drawing = false; };

  canvas.addEventListener('mousedown',  start);
  canvas.addEventListener('mousemove',  draw);
  canvas.addEventListener('mouseup',    stop);
  canvas.addEventListener('mouseleave', stop);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove',  draw,  { passive: false });
  canvas.addEventListener('touchend',   stop);
}

function clearCanvas() {
  const canvas = document.getElementById('sigCanvas');
  if (!canvas) return;
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

function getCanvasDataURL() {
  const canvas = document.getElementById('sigCanvas');
  if (!canvas) return '';
  const ctx = canvas.getContext('2d');
  const px  = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const hasDrawing = px.some(v => v !== 0);
  return hasDrawing ? canvas.toDataURL() : '';
}

/* ===== VOICE RECOGNITION ===== */
function toggleVoice() {
  const isSR = ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
  if (!isSR) {
    toast('Voice input needs Chrome or Edge.', 'error');
    return;
  }
  if (voiceRecording) {
    voiceRecogniser && voiceRecogniser.stop();
    stopVoiceUI();
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  voiceRecogniser = new SR();
  voiceRecogniser.continuous     = false;
  voiceRecogniser.interimResults = false;
  voiceRecogniser.lang           = 'en-GB';
  voiceRecogniser.maxAlternatives = 1;

  voiceRecogniser.onstart = () => {
    voiceRecording = true;
    document.getElementById('voiceBtn')?.classList.add('recording');
    showVoiceBox('Listening… speak a job name.');
  };
  voiceRecogniser.onresult = e => {
    const transcript = e.results[0][0].transcript;
    showVoiceBox(`Heard: "${transcript}"`);
    matchVoiceToJob(transcript);
  };
  voiceRecogniser.onerror = e => {
    const msgs = {
      'not-allowed':  'Microphone access denied. Please allow mic access in your browser settings.',
      'no-speech':    'No speech detected. Tap the mic and try again.',
      'network':      'Voice needs an internet connection and HTTPS to work.',
      'audio-capture':'No microphone found. Check your device settings.',
      'aborted':      ''
    };
    const msg = msgs[e.error] || `Voice error: ${e.error}. Try using the search instead.`;
    if (msg) toast(msg, 'error');
    stopVoiceUI();
  };
  voiceRecogniser.onend = () => stopVoiceUI();
  voiceRecogniser.start();
}

function stopVoiceUI() {
  voiceRecording = false;
  document.getElementById('voiceBtn')?.classList.remove('recording');
}

function showVoiceBox(msg) {
  const box = document.getElementById('voiceBox');
  if (!box) return;
  box.textContent = msg;
  box.classList.remove('hidden');
}

function matchVoiceToJob(transcript) {
  const t = transcript.toLowerCase().trim();
  // Find all matches
  const matches = state.priceList.filter(j => j.name.toLowerCase().includes(t) || t.includes(j.name.toLowerCase()));

  if (matches.length === 1) {
    // Exactly one match -add it directly
    addJobToQuote(matches[0].id || matches[0].name);
    showVoiceBox(`Added: ${matches[0].name}`);
    setTimeout(() => document.getElementById('voiceBox')?.classList.add('hidden'), 2500);
    return;
  }

  if (matches.length > 1) {
    // Multiple matches -ask which one
    document.getElementById('voiceBox')?.classList.add('hidden');
    const list = document.getElementById('voicePickList');
    list.innerHTML = '';
    matches.forEach(j => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vpick-btn';
      btn.innerHTML = `<span>${esc(j.name)}</span><span class="vpick-btn-price">${fmtPrice(j.price)}</span>`;
      btn.addEventListener('click', () => {
        addJobToQuote(j.id || j.name);
        document.getElementById('voicePickModal').style.display = 'none';
      });
      list.appendChild(btn);
    });
    document.getElementById('voicePickModal').style.display = 'flex';
    return;
  }

  // No match -open the "not found" modal pre-filled with what was heard
  document.getElementById('voiceBox')?.classList.add('hidden');
  setVal('vnfName', transcript);
  setVal('vnfPrice', '');
  setVal('vnfUnit', '');
  document.getElementById('voiceNotFoundModal').style.display = 'flex';
  setTimeout(() => document.getElementById('vnfPrice')?.focus(), 150);
}

function toggleVoiceMaterials() {
  const isSR = ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
  if (!isSR) { toast('Voice input needs Chrome or Edge.', 'error'); return; }
  if (voiceRecording) { voiceRecogniser && voiceRecogniser.stop(); stopVoiceMaterialsUI(); return; }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  voiceRecogniser = new SR();
  voiceRecogniser.continuous = false;
  voiceRecogniser.interimResults = false;
  voiceRecogniser.lang = 'en-GB';
  voiceRecogniser.maxAlternatives = 1;

  voiceRecogniser.onstart = () => {
    voiceRecording = true;
    document.getElementById('voiceBtnMaterials')?.classList.add('recording');
    const box = document.getElementById('voiceBoxMaterials');
    if (box) { box.textContent = 'Listening… speak a material name.'; box.classList.remove('hidden'); }
  };
  voiceRecogniser.onresult = e => {
    const transcript = e.results[0][0].transcript;
    const box = document.getElementById('voiceBoxMaterials');
    if (box) box.textContent = `Heard: "${transcript}"`;
    // Match against materials only
    const t = transcript.toLowerCase().trim();
    const matches = state.priceList.filter(j =>
      j.category === 'materials' &&
      (j.name.toLowerCase().includes(t) || t.includes(j.name.toLowerCase()))
    );
    if (matches.length === 1) {
      addJobToQuote(matches[0].id || matches[0].name, 'materials');
      if (box) box.textContent = `Added: ${matches[0].name}`;
      setTimeout(() => box?.classList.add('hidden'), 2500);
    } else if (matches.length > 1) {
      if (box) box.classList.add('hidden');
      // Reuse the voice pick modal
      const list = document.getElementById('voicePickList');
      list.innerHTML = '';
      matches.forEach(j => {
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'vpick-btn';
        btn.innerHTML = `<span>${esc(j.name)}</span><span class="vpick-btn-price">${fmtPrice(j.price)}</span>`;
        btn.addEventListener('click', () => { addJobToQuote(j.id || j.name, 'materials'); document.getElementById('voicePickModal').style.display = 'none'; });
        list.appendChild(btn);
      });
      document.getElementById('voicePickModal').style.display = 'flex';
    } else {
      if (box) box.textContent = `"${transcript}" not found — try the search above.`;
      setTimeout(() => box?.classList.add('hidden'), 3000);
    }
  };
  voiceRecogniser.onerror = e => {
    const msgs = { 'not-allowed': 'Microphone access denied.', 'no-speech': 'No speech detected. Try again.', 'aborted': '' };
    const msg = msgs[e.error] || `Voice error: ${e.error}.`;
    if (msg) toast(msg, 'error');
    stopVoiceMaterialsUI();
  };
  voiceRecogniser.onend = () => stopVoiceMaterialsUI();
  voiceRecogniser.start();
}

function stopVoiceMaterialsUI() {
  voiceRecording = false;
  document.getElementById('voiceBtnMaterials')?.classList.remove('recording');
}

function closeVoiceNotFoundModal() {
  document.getElementById('voiceNotFoundModal').style.display = 'none';
}

function vnfSubmit(saveToList) {
  const name  = (getVal('vnfName') || '').trim();
  const price = parseFloat(getVal('vnfPrice'));
  const unit  = (getVal('vnfUnit') || '').trim();
  if (!name) { document.getElementById('vnfName').classList.add('error'); return; }
  if (isNaN(price) || price < 0) { document.getElementById('vnfPrice').classList.add('error'); return; }
  document.getElementById('vnfName').classList.remove('error');
  document.getElementById('vnfPrice').classList.remove('error');

  if (saveToList) {
    // Add to price list
    state.priceList.push({ id: uid(), name, price, unit });
    save();
    queuePriceListSync(true);
    refreshPriceList();
  }

  // Add to current quote as a one-off item
  state.quote.items.push({ id: uid(), name, unitPrice: price, unit, qty: 1 });
  renderQuoteItems();
  recalcTotals();
  updateJobPicker();
  closeVoiceNotFoundModal();
  toast(saveToList ? 'Added to your price list and this job.' : 'Added to this job.', 'success');
}

/* ===== DESCRIPTION HELP POPUP ===== */
function setupDescriptionHelp() {
  const btn   = document.getElementById('descHelpBtn');
  const popup = document.getElementById('descHelpPopup');
  const close = document.getElementById('descHelpClose');
  if (!btn || !popup) return;

  btn.addEventListener('click', e => {
    e.stopPropagation();
    popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
  });
  close?.addEventListener('click', () => { popup.style.display = 'none'; });
  document.addEventListener('click', e => {
    if (!popup.contains(e.target) && e.target !== btn) {
      popup.style.display = 'none';
    }
  });
}

/* ===== NEW JOB CUSTOMER PICKER ===== */
function openNewJobPicker() {
  document.getElementById('newJobPickerModal').style.display = 'flex';
}
function closeNewJobPicker() {
  document.getElementById('newJobPickerModal').style.display = 'none';
}
function openExistingCustPicker() {
  closeNewJobPicker();
  const modal = document.getElementById('existingCustPickerModal');
  modal.style.display = 'flex';
  renderExistingCustList('');
  const search = document.getElementById('existingCustSearch');
  if (search) { search.value = ''; search.focus(); }
}
function closeExistingCustPicker() {
  document.getElementById('existingCustPickerModal').style.display = 'none';
}

function startJobForCustomer(quote = {}) {
  const q = quote || {};
  prepareNewQuote();
  state.quote.custTitle     = q.custTitle     || '';
  state.quote.custFirstName = q.custFirstName || '';
  state.quote.custLastName  = q.custLastName  || '';
  state.quote.custAddr      = q.custAddr      || '';
  state.quote.custPostcode  = q.custPostcode  || '';
  state.quote.custPhone     = q.custPhone     || '';
  state.quote.custEmail     = q.custEmail     || '';
  populateQuoteForm();
  showPage('page-jobs');
}

function renderExistingCustList(query) {
  const q = (query || '').toLowerCase().trim();
  // Collect unique customers from saved customer records and saved docs.
  const seen = new Map();
  (state.customers || []).forEach(customer => {
    const quote = customer.quote || {};
    const name = buildCustName(quote) || customer.name || '';
    if (!name) return;
    const key = customer.key || customerLocalKey(quote) || name.toLowerCase();
    if (!seen.has(key)) seen.set(key, { name, quote });
  });
  state.saved.forEach(doc => {
    const quote = doc.quote || {};
    const name  = buildCustName(quote) || doc.custName || '';
    if (!name) return;
    const key = customerLocalKey(quote) || name.toLowerCase();
    if (!seen.has(key)) seen.set(key, { name, quote });
  });
  let entries = [...seen.values()];
  if (q) entries = entries.filter(e => e.name.toLowerCase().includes(q));
  entries.sort((a, b) => a.name.localeCompare(b.name));

  const list  = document.getElementById('existingCustList');
  const empty = document.getElementById('existingCustEmpty');
  list.innerHTML = '';

  if (!entries.length) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  entries.forEach(({ name, quote }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-outline';
    btn.style.cssText = 'text-align:left;padding:10px 14px;font-size:0.88rem;border-radius:10px';
    btn.textContent = name;
    btn.addEventListener('click', () => {
      closeExistingCustPicker();
      startJobForCustomer(quote);
    });
    list.appendChild(btn);
  });
}

function setupNewJobPicker() {
  document.getElementById('closeNewJobPickerBtn')?.addEventListener('click', closeNewJobPicker);
  document.getElementById('newJobExistingBtn')?.addEventListener('click', openExistingCustPicker);
  document.getElementById('newJobNewBtn')?.addEventListener('click', () => {
    closeNewJobPicker();
    prepareNewQuote();
    showPage('page3');
  });
  document.getElementById('closeExistingCustPickerBtn')?.addEventListener('click', closeExistingCustPicker);
  document.getElementById('existingCustSearch')?.addEventListener('input', e => renderExistingCustList(e.target.value));
  // Close on backdrop click
  document.getElementById('newJobPickerModal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeNewJobPicker();
  });
  document.getElementById('existingCustPickerModal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeExistingCustPicker();
  });
}

/* ===== PAGE 4 -SAVED DOCS ===== */
function setupPage4() {
  // Filter & Sort toggle
  document.getElementById('filterToggleBtn')?.addEventListener('click', () => {
    const bar     = document.getElementById('savedFilterBar');
    const chevron = document.getElementById('filterToggleChevron');
    const label   = document.getElementById('filterToggleLabel');
    const isOpen  = bar.style.display !== 'none';
    bar.style.display = isOpen ? 'none' : 'flex';
    document.getElementById('filterToggleBtn').setAttribute('aria-expanded', String(!isOpen));
    if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
    if (label)   label.textContent = isOpen ? 'Filter & Sort' : 'Filter & Sort';
  });

  // Quick Quote banner -goes straight to a blank quote form, one tap
  document.getElementById('quickQuoteBtn')?.addEventListener('click', () => {
    if (!canUseMainApp()) { requireSetupGuard(); return; }
    if (quietSeasonGuard()) return;
    prepareNewQuote();
    showPage('page3');
    // Collapse extra customer fields for a clean start
    const extra   = document.getElementById('custExtraFields');
    const toggle  = document.getElementById('custMoreToggle');
    const chevron = document.getElementById('custMoreChevron');
    const label   = document.getElementById('custMoreLabel');
    if (extra)  extra.style.display = 'none';
    if (toggle) toggle.checked = false;
    if (label)  label.textContent = 'Add more details';
  });


  const sel = document.getElementById('savedFilterSelect');
  if (sel) sel.addEventListener('change', () => refreshSavedDocs());

  const sortSel = document.getElementById('savedSortSelect');
  if (sortSel) sortSel.addEventListener('change', () => refreshSavedDocs());

  const expSel = document.getElementById('exportSelect');
  if (expSel) {
    expSel.addEventListener('change', () => {
      const val = expSel.value;
      if (!val) return;
      exportDocsCSV(val);
    });
  }
}

function renderAttentionWidget() {
  const wrap = document.getElementById('attentionWidget');
  if (!wrap) return;
  const today = todayStr();
  const items = [];

  (state.saved || []).forEach(d => {
    const q = d.quote || {};
    const custName = [q.custFirstName, q.custLastName].filter(Boolean).join(' ') || 'Customer';
    const ref = d.invoiceRef || q.ref || d.ref || '';
    const payments = getDocPayments(d);
    const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
    const outstanding = Math.max(0, (d.total || 0) - totalPaid);

    if (d.paid) return;

    // Overdue invoice
    if (d.invoiceSent && d.invoiceDueDate && today > d.invoiceDueDate) {
      const days = Math.floor((new Date(today) - new Date(d.invoiceDueDate)) / 86400000);
      items.push({ docId: d.id, custName, ref, msg: `Invoice ${days}d overdue - payment not received`, action: 'chase', color: '#c0392b' });

    // Job complete but invoice not raised
    } else if (d.jobCompleted && !d.invoiceSent) {
      items.push({ docId: d.id, custName, ref, msg: 'Job complete - invoice not raised yet', action: 'invoice', color: '#e67e22' });

    // Quote/estimate accepted but no start date booked
    } else if ((d.jobAccepted || d.acceptStatus === 'accepted') && !d.jobStartDate && !d.jobCompleted) {
      items.push({ docId: d.id, custName, ref, msg: 'Quote accepted - job not yet booked in', action: 'book', color: '#2980b9' });

    // Quote/estimate sent but no reply after 14 days
    } else if (!d.invoiceSent && !d.paid && !d.jobAccepted && d.acceptStatus !== 'accepted') {
      const docDate = d.sentAt || d.sharedAt || null;
      const qType = (q.type || '').toLowerCase();
      if ((qType === 'estimate' || qType === 'quote') && docDate && d.acceptToken) {
        const age = Math.floor((new Date(today) - new Date(docDate)) / 86400000);
        if (age >= 14) {
          items.push({ docId: d.id, custName, ref, msg: `${qType === 'quote' ? 'Quote' : 'Estimate'} sent ${age} days ago - no reply`, action: 'send', color: '#f39c12' });
        }
      }
    }
  });

  // Recurring customers -check if they're overdue for a visit
  const groups = buildCustomerGroups();
  const today2 = todayStr();
  groups.forEach(g => {
    const data = getCustData(g.name);
    if (!data.recurringDays) return;
    // Find the most recent job date for this customer
    const lastJobDate = g.docs
      .map(d => d.jobCompletedDate || d.quote?.date || d.date || '')
      .filter(Boolean).sort().pop();
    if (!lastJobDate) return;
    const daysSince = Math.floor((new Date(today2) - new Date(lastJobDate)) / 86400000);
    if (daysSince >= data.recurringDays) {
      const overdueDays = daysSince - data.recurringDays;
      items.push({
        docId: g.docs[0].id, custName: g.name, ref: '',
        msg: `Regular visit ${overdueDays === 0 ? 'due today' : `${overdueDays}d overdue`} (every ${data.recurringDays === 7 ? 'week' : data.recurringDays === 14 ? '2 weeks' : data.recurringDays === 28 ? 'month' : data.recurringDays + ' days'})`,
        action: 'recurring', color: '#8e44ad'
      });
    }
  });

  if (items.length === 0) { wrap.innerHTML = ''; return; }

  wrap.innerHTML = `
    <div class="attn-widget">
      <button type="button" class="attn-widget-header" id="attnWidgetHeader" aria-expanded="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span>${items.length} thing${items.length > 1 ? 's' : ''} need${items.length === 1 ? 's' : ''} your attention</span>
        <svg class="attn-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left:auto;transform:rotate(180deg)"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="attn-widget-body" id="attnWidgetBody">
        ${items.map(item => `
          <div class="attn-widget-row">
            <div class="attn-widget-dot" style="background:${item.color}"></div>
            <div class="attn-widget-info">
              <span class="attn-widget-name">${esc(item.custName)}</span>
              <span class="attn-widget-msg">${esc(item.msg)}</span>
            </div>
            ${item.action === 'chase'
              ? `<button type="button" class="attn-action-btn attn-chase" onclick="openChaseForDoc('${esc(item.docId)}')">Chase</button>`
              : item.action === 'invoice'
                ? `<button type="button" class="attn-action-btn attn-invoice" onclick="previewInvoice('${esc(item.docId)}')">Invoice</button>`
                : item.action === 'book'
                  ? `<button type="button" class="attn-action-btn attn-book" onclick="showBookingContactModal(state.saved.find(d=>d.id==='${esc(item.docId)}'))">Book In</button>`
                  : item.action === 'recurring'
                    ? `<button type="button" class="attn-action-btn attn-recurring" onclick="openCustomerDashboardForDoc('${esc(item.docId)}')">Book In</button>`
                    : `<button type="button" class="attn-action-btn attn-send" onclick="openQuoteModal('${esc(item.docId)}')">Follow Up</button>`
            }
          </div>`).join('')}
      </div>
    </div>`;

  // Toggle collapse
  document.getElementById('attnWidgetHeader')?.addEventListener('click', () => {
    const body    = document.getElementById('attnWidgetBody');
    const chevron = wrap.querySelector('.attn-chevron');
    const isOpen  = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
  });
}

// ── SPREADSHEET VIEW ───────────────────────────────────────────
const SS_COL_KEY = 'lexi_ss_cols';

const SS_ALL_COLS = [
  { key:'ref',           label:'Reference',       sticky:true,  visible:true,  locked:true  },
  { key:'lastName',      label:'Last Name',       sticky:true,  visible:true,  locked:true  },
  { key:'firstName',     label:'First Name',      sticky:true,  visible:true,  locked:true  },
  { key:'phone',         label:'Phone',           sticky:false, visible:true,  locked:false },
  { key:'jobs',          label:'Jobs',            sticky:false, visible:true,  locked:false },
  { key:'stage',         label:'Stage',           sticky:false, visible:true,  locked:false },
  { key:'startDate',     label:'Start Date',      sticky:false, visible:true,  locked:false },
  { key:'total',         label:'Total',           sticky:false, visible:true,  locked:false },
  { key:'outstanding',   label:'Outstanding',     sticky:false, visible:true,  locked:false },
  { key:'repeat',        label:'Repeat?',         sticky:false, visible:true,  locked:false },
  { key:'address',       label:'Address',         sticky:false, visible:false, locked:false },
  { key:'postcode',      label:'Postcode',        sticky:false, visible:false, locked:false },
  { key:'custNotes',     label:'Customer Notes',  sticky:false, visible:false, locked:false },
  { key:'privNotes',     label:'Private Notes',   sticky:false, visible:false, locked:false },
  { key:'completedDate', label:'Completed',       sticky:false, visible:false, locked:false },
  { key:'invoiceDue',    label:'Invoice Due',     sticky:false, visible:false, locked:false },
  { key:'paidAmount',    label:'Amount Paid',     sticky:false, visible:false, locked:false },
];

let _ssCols     = null;  // active column config
let _ssSortKey  = 'ref';
let _ssSortDir  = 'asc';
let _ssFilter   = 'all';

function getSsCols() {
  if (_ssCols) return _ssCols;
  try {
    const saved = JSON.parse(localStorage.getItem(SS_COL_KEY) || 'null');
    if (Array.isArray(saved)) {
      _ssCols = SS_ALL_COLS.map(c => {
        const s = saved.find(x => x.key === c.key);
        return { ...c, visible: c.locked ? true : (s ? s.visible : c.visible) };
      });
      return _ssCols;
    }
  } catch(e) {}
  _ssCols = SS_ALL_COLS.map(c => ({ ...c }));
  return _ssCols;
}

function saveSsCols() {
  localStorage.setItem(SS_COL_KEY, JSON.stringify(_ssCols.map(c => ({ key: c.key, visible: c.visible }))));
}

function ssStageLabel(d) {
  if (d.paid) return 'Paid';
  if (d.receiptRef || (d.quote?.type||'').toLowerCase() === 'receipt') return 'Receipt';
  if (d.invoiceSent || (d.quote?.type||'').toLowerCase() === 'invoice') {
    if (d.invoiceDueDate && d.invoiceDueDate < todayStr()) return 'Overdue';
    return 'Invoiced';
  }
  if (d.jobCompleted) return 'Complete';
  if (d.jobStarted || (d.jobStartDate && d.jobStartDate <= todayStr())) return 'Job Started';
  if (d.jobStartDate) return 'Job Booked';
  if (d.jobAccepted || d.acceptStatus === 'accepted') return 'Accepted';
  const t = (d.quote?.type || d.type || '').toLowerCase();
  if (t === 'quote') return 'Quote';
  if (t === 'estimate') return 'Estimate';
  return 'Draft';
}

const SS_STAGE_CLS = { 'Paid':'ss-paid','Overdue':'ss-overdue','Invoiced':'ss-invoiced',
  'Accepted':'ss-accepted','Job Booked':'ss-booked','Job Started':'ss-started','Complete':'ss-complete',
  'Quote':'ss-quote','Estimate':'ss-estimate','Receipt':'ss-paid','Draft':'ss-draft' };

function ssGetCellValue(key, d, q, totalPaid, total, outstanding, isRepeat) {
  switch(key) {
    case 'ref':          return { text: d.ref || d.invoiceRef || q.ref || '-', html: null };
    case 'lastName':     return { text: q.custLastName || '-', html: null };
    case 'firstName':    return { text: q.custFirstName || '-', html: null };
    case 'phone':        return { text: q.custPhone || '-', html: null };
    case 'jobs':         return { text: (q.items||[]).map(i=>i.name).filter(Boolean).join(', ') || '-', html: null, wrap: true };
    case 'stage': {
      const s = ssStageLabel(d);
      return { text: s, html: `<span class="ss-stage ${SS_STAGE_CLS[s]||''}">${s}</span>` };
    }
    case 'startDate':    return { text: d.jobStartDate ? formatDate(d.jobStartDate) : '-', html: null };
    case 'total':        return { text: fmtPrice(total), html: null };
    case 'outstanding':  return { text: outstanding > 0 ? fmtPrice(outstanding) : '-', html: null };
    case 'repeat':       return { text: isRepeat ? 'Yes' : '-', html: isRepeat ? '<span class="ss-repeat">Yes</span>' : '-' };
    case 'address':      return { text: q.custAddr || '-', html: null };
    case 'postcode':     return { text: q.custPostcode || '-', html: null };
    case 'custNotes':    return { text: q.notes || '-', html: null, wrap: true };
    case 'privNotes':    return { text: q.privateNotes || '-', html: null, wrap: true };
    case 'completedDate':return { text: d.jobCompletedDate ? formatDate(d.jobCompletedDate) : '-', html: null };
    case 'invoiceDue':   return { text: d.invoiceDueDate ? formatDate(d.invoiceDueDate) : '-', html: null };
    case 'paidAmount':   return { text: totalPaid > 0 ? fmtPrice(totalPaid) : '-', html: null };
    default:             return { text: '-', html: null };
  }
}

function buildSsRows() {
  const custCounts = {};
  (state.saved || []).forEach(d => {
    const q = d.quote || {};
    const k = `${(q.custLastName||'').toLowerCase()}|${(q.custFirstName||'').toLowerCase()}|${(q.custPhone||'').trim()}`;
    custCounts[k] = (custCounts[k] || 0) + 1;
  });

  let docs = [...(state.saved || [])];

  // Filter
  if (_ssFilter === 'paid')     docs = docs.filter(d => d.paid);
  else if (_ssFilter === 'invoiced') docs = docs.filter(d => d.invoiceSent && !d.paid);
  else if (_ssFilter === 'overdue')  docs = docs.filter(d => d.invoiceSent && !d.paid && d.invoiceDueDate && d.invoiceDueDate < todayStr());
  else if (_ssFilter === 'accepted') docs = docs.filter(d => d.jobAccepted || d.acceptStatus === 'accepted');
  else if (_ssFilter === 'Quote')    docs = docs.filter(d => (d.quote?.type||d.type||'').toLowerCase() === 'quote');
  else if (_ssFilter === 'Estimate') docs = docs.filter(d => (d.quote?.type||d.type||'').toLowerCase() === 'estimate');

  // Sort
  docs.sort((a, b) => {
    const qa = a.quote || {}, qb = b.quote || {};
    let va = '', vb = '';
    switch(_ssSortKey) {
      case 'ref':       va = a.ref||''; vb = b.ref||''; break;
      case 'lastName':  va = qa.custLastName||''; vb = qb.custLastName||''; break;
      case 'firstName': va = qa.custFirstName||''; vb = qb.custFirstName||''; break;
      case 'stage':     va = ssStageLabel(a); vb = ssStageLabel(b); break;
      case 'total':     return _ssSortDir === 'asc' ? (a.total||0)-(b.total||0) : (b.total||0)-(a.total||0);
      case 'startDate': va = a.jobStartDate||''; vb = b.jobStartDate||''; break;
      case 'outstanding': {
        const pa = getDocPayments(a).reduce((s,p)=>s+(p.amount||0),0);
        const pb = getDocPayments(b).reduce((s,p)=>s+(p.amount||0),0);
        const oa = a.paid ? 0 : Math.max(0,(a.total||0)-pa);
        const ob = b.paid ? 0 : Math.max(0,(b.total||0)-pb);
        return _ssSortDir === 'asc' ? oa-ob : ob-oa;
      }
      default: va = a.createdAt||a.date||''; vb = b.createdAt||b.date||''; break;
    }
    const cmp = String(va).localeCompare(String(vb), undefined, { numeric: true });
    return _ssSortDir === 'asc' ? cmp : -cmp;
  });

  const cols = getSsCols().filter(c => c.visible);
  const body = document.getElementById('ssBody');
  if (!body) return;

  body.innerHTML = docs.map(d => {
    const q = d.quote || {};
    const payments = getDocPayments(d);
    const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
    const total = Number(d.total || q.total || 0);
    const outstanding = d.paid ? 0 : Math.max(0, total - totalPaid);
    const custKey = `${(q.custLastName||'').toLowerCase()}|${(q.custFirstName||'').toLowerCase()}|${(q.custPhone||'').trim()}`;
    const isRepeat = (custCounts[custKey] || 0) > 1;

    const cells = cols.map((c, i) => {
      const { html, text, wrap } = ssGetCellValue(c.key, d, q, totalPaid, total, outstanding, isRepeat);
      const leftPx = i===0 ? 0 : i===1 ? 90 : 200;
      const minW = i===0 ? 'min-width:90px;' : i===1 ? 'min-width:110px;' : '';
      const stickyStyle = c.sticky ? `position:sticky;left:${leftPx}px;z-index:1;${minW}` : '';
      const stickyClass = c.sticky ? ' ss-td-sticky' : '';
      return `<td class="ss-td${stickyClass}${wrap?' ss-td-wrap':''}" style="${stickyStyle}">${html !== null ? html : esc(String(text))}</td>`;
    });
    // Open button after first 3 sticky cols (col 4)
    const openCell = `<td class="ss-td ss-td-open"><button type="button" class="ss-open-btn" data-id="${d.id}">Open</button></td>`;
    cells.splice(3, 0, openCell);

    return `<tr class="ss-row">${cells.join('')}</tr>`;
  }).join('') || `<tr><td class="ss-td" colspan="${cols.length + 1}" style="text-align:center;color:#999;padding:20px">No jobs found.</td></tr>`;

  // Wire Open buttons
  body.querySelectorAll('.ss-open-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      closeSpreadsheetView();
      openCustomerDashboardForDoc(btn.dataset.id);
    });
  });
}

function buildSsHead() {
  const head = document.getElementById('ssHead');
  if (!head) return;
  const cols = getSsCols().filter(c => c.visible);
  const sortIcon = (key) => {
    if (_ssSortKey !== key) return '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.3"><polyline points="6 9 12 3 18 9"/><polyline points="6 15 12 21 18 15"/></svg>';
    return _ssSortDir === 'asc'
      ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 3 18 9"/></svg>'
      : '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 15 12 21 18 15"/></svg>';
  };
  const sortableCols = new Set(['ref','lastName','firstName','stage','total','startDate','outstanding']);
  const thCells = cols.map((c, i) => {
      const sortable = sortableCols.has(c.key);
      const leftPx = i===0 ? 0 : i===1 ? 90 : 200;
      const minW = i===0 ? 'min-width:90px;' : i===1 ? 'min-width:110px;' : '';
      const stickyStyle = c.sticky ? `position:sticky;left:${leftPx}px;z-index:3;${minW}` : '';
      return `<th class="ss-th${sortable?' ss-th-sort':''}" style="${stickyStyle}" data-sort="${c.key}">
        ${esc(c.label)} ${sortable ? sortIcon(c.key) : ''}
      </th>`;
    });
  // Insert Open header after first 3 sticky cols
  thCells.splice(3, 0, `<th class="ss-th" style="min-width:70px"></th>`);
  head.innerHTML = `<tr>${thCells.join('')}</tr>`;

  head.querySelectorAll('.ss-th-sort').forEach(th => {
    th.addEventListener('click', () => {
      const k = th.dataset.sort;
      if (_ssSortKey === k) _ssSortDir = _ssSortDir === 'asc' ? 'desc' : 'asc';
      else { _ssSortKey = k; _ssSortDir = 'asc'; }
      buildSsHead();
      buildSsRows();
    });
  });
}

function openSsColPanel() {
  const existing = document.getElementById('ssColPanel');
  if (existing) { existing.remove(); return; }

  const cols = getSsCols().filter(c => !c.locked);
  const panel = document.createElement('div');
  panel.id = 'ssColPanel';
  panel.className = 'ss-col-panel';
  panel.innerHTML = `
    <div class="ss-col-panel-title">Show / hide columns</div>
    ${cols.map(c => `
      <label class="ss-col-check-row">
        <input type="checkbox" data-key="${c.key}" ${c.visible ? 'checked' : ''}>
        ${esc(c.label)}
      </label>`).join('')}
    <button type="button" class="btn btn-walnut btn-sm" id="ssColApplyBtn" style="margin-top:10px;width:100%">Apply</button>
  `;
  document.getElementById('spreadsheetModal').appendChild(panel);

  document.getElementById('ssColApplyBtn').addEventListener('click', () => {
    panel.querySelectorAll('input[data-key]').forEach(cb => {
      const col = _ssCols.find(c => c.key === cb.dataset.key);
      if (col) col.visible = cb.checked;
    });
    saveSsCols();
    panel.remove();
    buildSsHead();
    buildSsRows();
  });
}

function ssCsvDownload() {
  if (typeof XLSX === 'undefined') { toast('Spreadsheet library not loaded yet - try again in a moment.'); return; }

  // ── Sheet 1: My Jobs ──────────────────────────────────────────
  const cols = getSsCols().filter(c => c.visible);
  const custCounts = {};
  (state.saved || []).forEach(d => {
    const q = d.quote || {};
    const k = `${(q.custLastName||'').toLowerCase()}|${(q.custFirstName||'').toLowerCase()}|${(q.custPhone||'').trim()}`;
    custCounts[k] = (custCounts[k] || 0) + 1;
  });
  const jobsData = [cols.map(c => c.label)];
  (state.saved || []).forEach(d => {
    const q = d.quote || {};
    const payments = getDocPayments(d);
    const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
    const total = Number(d.total || q.total || 0);
    const outstanding = d.paid ? 0 : Math.max(0, total - totalPaid);
    const custKey = `${(q.custLastName||'').toLowerCase()}|${(q.custFirstName||'').toLowerCase()}|${(q.custPhone||'').trim()}`;
    const isRepeat = (custCounts[custKey] || 0) > 1;
    jobsData.push(cols.map(c => ssGetCellValue(c.key, d, q, totalPaid, total, outstanding, isRepeat).text));
  });
  const wsJobs = XLSX.utils.aoa_to_sheet(jobsData);

  // ── Sheet 2: Average Rates by Trade ──────────────────────────
  const ratesData = [
    ['Trade / Job Type', 'Avg Hourly Rate', 'Avg Half Day', 'Avg Day Rate', 'Avg Call-out', 'Notes'],
    ['General Plumber',        '£55-£80',  '£190-£250',  '£350-£450',  '£75-£100', 'Higher in London/SE'],
    ['Gas Engineer (domestic)','£65-£90',  '£220-£290',  '£400-£520',  '£85-£110', 'Gas Safe cert required'],
    ['Boiler Installer',       '£70-£100', '£240-£320',  '£420-£560',  '£90-£120', 'Combi installs command premium'],
    ['Heating Engineer',       '£60-£85',  '£200-£270',  '£370-£480',  '£80-£105', ''],
    ['Electrician',            '£50-£80',  '£180-£250',  '£330-£450',  '£70-£100', 'Part P certification'],
    ['Bathroom Fitter',        '£55-£80',  '£190-£260',  '£350-£460',  '£75-£100', 'Supply & fit vs labour only'],
    ['Kitchen Fitter',         '£55-£85',  '£200-£280',  '£360-£480',  '£75-£100', ''],
    ['Tiler (wall & floor)',    '£40-£60',  '£150-£210',  '£280-£380',  '£60-£85',  'Per m2 rates also common'],
    ['Plasterer',              '£35-£55',  '£130-£200',  '£250-£360',  '£55-£80',  'Day rate most common'],
    ['Painter & Decorator',    '£30-£50',  '£110-£180',  '£210-£330',  '£50-£75',  ''],
    ['Carpenter / Joiner',     '£45-£70',  '£160-£230',  '£300-£420',  '£65-£90',  ''],
    ['Roofer',                 '£50-£75',  '£175-£250',  '£320-£440',  '£70-£95',  'Scaffolding extra'],
    ['Handyman (general)',      '£30-£45',  '£110-£160',  '£200-£290',  '£45-£70',  'Lower for non-specialist work'],
    [],
    ['Source: industry averages 2025. Rates vary by region, experience and job complexity.'],
    ['Use these as a guide when setting your own rates in Lexi.'],
  ];
  const wsRates = XLSX.utils.aoa_to_sheet(ratesData);
  wsRates['!cols'] = [{ wch: 28 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 36 }];

  // ── Build workbook ─────────────────────────────────────────────
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsJobs, 'My Jobs');
  XLSX.utils.book_append_sheet(wb, wsRates, 'Average Rates');
  XLSX.writeFile(wb, `Lexi-Jobs-${todayStr()}.xlsx`);
}

function openSpreadsheetView() {
  const modal = document.getElementById('spreadsheetModal');
  if (!modal) return;

  // Reset sort/filter if opening fresh
  _ssFilter = 'all';

  // Build filter bar
  const filterSel = document.getElementById('ssFilterSel');
  if (filterSel) filterSel.value = 'all';

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  // Title = trader's name + "'s Jobs" (preferred name, else first name)
  const titleEl = document.getElementById('spreadsheetTitle');
  if (titleEl) {
    const name = (state.company.preferredName || state.company.firstName || '').trim();
    titleEl.textContent = name ? `${name}'s Jobs` : 'All Jobs';
  }

  // "View as list" toggle returns to the list (same as the close button)
  const backToggle = document.getElementById('ssBackToListToggle');
  if (backToggle) {
    backToggle.checked = false;
    backToggle.onchange = () => { closeSpreadsheetView(); };
  }

  buildSsHead();
  buildSsRows();

  const hint = document.getElementById('ssRotateHint');
  if (hint) hint.style.display = window.innerHeight > window.innerWidth ? 'flex' : 'none';

  document.getElementById('closeSpreadsheetBtn').onclick = closeSpreadsheetView;
  document.getElementById('ssColsBtn')?.addEventListener('click', openSsColPanel);
  document.getElementById('ssCsvBtn')?.addEventListener('click', ssCsvDownload);
  document.getElementById('ssFilterSel')?.addEventListener('change', e => {
    _ssFilter = e.target.value; buildSsRows();
  });
}

function closeSpreadsheetView() {
  const modal = document.getElementById('spreadsheetModal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
  document.getElementById('ssColPanel')?.remove();
  // Reset toggle
  const tog = document.getElementById('jobsSpreadsheetToggle');
  const lbl = document.getElementById('ssToggleLabel');
  if (tog) tog.checked = false;
  if (lbl) lbl.textContent = 'View Spreadsheet';
}

function refreshSavedDocs() {
  updateChasePaymentsBadge();
  renderAttentionWidget();
  const sel    = document.getElementById('savedFilterSelect');
  const filter = sel ? sel.value : 'all';
  const sortSel = document.getElementById('savedSortSelect');
  const sort   = sortSel ? sortSel.value : 'added-newest';
  const container = document.getElementById('savedDocsList');
  const empty     = document.getElementById('savedDocsEmpty');

  let docs = [...state.saved];
  let repairedDocs = false;
  docs.forEach(doc => {
    const beforeRef = doc.ref || doc.quote?.ref || '';
    const beforeDate = doc.date || doc.quote?.date || '';
    ensureDocumentRefAndDate(doc);
    if ((doc.ref || doc.quote?.ref || '') !== beforeRef || (doc.date || doc.quote?.date || '') !== beforeDate) {
      repairedDocs = true;
    }
  });
  if (repairedDocs) {
    save();
    queueSavedDocsSync(true);
  }
  if      (filter === 'Estimate') docs = docs.filter(d => d.type === 'Estimate');
  else if (filter === 'Quote')    docs = docs.filter(d => d.type === 'Quote');
  else if (filter === 'invoiced') docs = docs.filter(d => d.invoiceSent && !d.paid);
  else if (filter === 'overdue')  docs = docs.filter(d => !d.paid && d.invoiceSent && d.invoiceDueDate && todayStr() > d.invoiceDueDate);
  else if (filter === 'paid')     docs = docs.filter(d => d.paid);
  else if (filter === 'unpaid')   docs = docs.filter(d => !d.paid);
  else if (filter === 'accepted') docs = docs.filter(d => d.acceptStatus === 'accepted' || d.jobAccepted);

  // Search filter
  const q = getJobSearchQuery();
  if (q) {
    docs = docs.filter(d => {
      const quote = d.quote || {};
      const name = [quote.custFirstName, quote.custLastName].filter(Boolean).join(' ').toLowerCase();
      return name.includes(q) || (d.ref || quote.ref || '').toLowerCase().includes(q);
    });
  }

  const savedCustomerKeys = new Set(
    (state.saved || [])
      .map(d => customerLocalKey(d.quote || {}))
      .filter(Boolean)
  );
  const savedCustomerNames = new Set(
    (state.saved || [])
      .map(d => (buildCustName(d.quote || '') || '').toLowerCase())
      .filter(Boolean)
  );
  let standaloneCustomers = filter === 'all'
    ? (state.customers || []).filter(customer => {
        const quote = customer.quote || {};
        const key = customer.key || customerLocalKey(quote);
        const name = (buildCustName(quote) || customer.name || '').toLowerCase();
        return key && !savedCustomerKeys.has(key) && !savedCustomerNames.has(name);
      })
    : [];
  if (q) {
    standaloneCustomers = standaloneCustomers.filter(customer => {
      const quote = customer.quote || {};
      const name = (buildCustName(quote) || customer.name || '').toLowerCase();
      return name.includes(q) ||
        String(quote.custEmail || '').toLowerCase().includes(q) ||
        String(quote.custPhone || '').toLowerCase().includes(q);
    });
  }
  standaloneCustomers.sort((a, b) => {
    if (sort === 'added-oldest') return (a.updatedAt || '').localeCompare(b.updatedAt || '');
    if (sort === 'name-az') return (a.name || '').localeCompare(b.name || '');
    if (sort === 'name-za') return (b.name || '').localeCompare(a.name || '');
    return (b.updatedAt || '').localeCompare(a.updatedAt || '');
  });

  // Sort
  const sortKey = d => {
    const q = d.quote || {};
    const last  = (q.custLastName  || '').toLowerCase();
    const first = (q.custFirstName || '').toLowerCase();
    return last + ' ' + first;
  };
  if (sort === 'name-az') {
    docs.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  } else if (sort === 'name-za') {
    docs.sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
  } else if (sort === 'added-oldest') {
    docs.sort((a, b) => docAddedTime(a) - docAddedTime(b));
  } else if (sort === 'document-newest' || sort === 'date-newest') {
    docs.sort((a, b) => docDocumentTime(b) - docDocumentTime(a));
  } else if (sort === 'document-oldest' || sort === 'date-oldest') {
    docs.sort((a, b) => docDocumentTime(a) - docDocumentTime(b));
  } else if (sort === 'job-soonest' || sort === 'next-job') {
    // Jobs with start/completion dates first (soonest), then no-date docs at end
    docs.sort((a, b) => {
      const aTime = docJobTime(a) || Number.MAX_SAFE_INTEGER;
      const bTime = docJobTime(b) || Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });
  } else if (sort === 'job-latest') {
    docs.sort((a, b) => {
      const aTime = docJobTime(a) || -1;
      const bTime = docJobTime(b) || -1;
      return bTime - aTime;
    });
  } else {
    // added-newest (default): newest entry first
    docs.sort((a, b) => docAddedTime(b) - docAddedTime(a));
  }

  // Remove all doc cards but keep the empty-state element in the DOM
  Array.from(container.children).forEach(child => {
    if (child !== empty) child.remove();
  });

  if (!docs.length && !standaloneCustomers.length) {
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';

  standaloneCustomers.forEach(customer => {
    const quote = customer.quote || {};
    const name = buildCustName(quote) || customer.name || 'Customer';
    const card = document.createElement('div');
    card.className = 'saved-doc-card status-estimate';
    card.innerHTML = `
      <div class="saved-doc-header">
        <div>
          <span class="saved-doc-name">${esc(name)}</span>
          <div class="saved-doc-ref">No job yet</div>
        </div>
        <div class="saved-doc-total">${fmtPrice(0)}</div>
      </div>
      <div class="job-card-actions">
        <button type="button" class="jca-open">Start Job</button>
        <button type="button" class="jca-primary jca-send">Add Jobs</button>
        <span class="type-badge estimate jca-badge">Customer</span>
      </div>
      <div class="saved-doc-payment-tally">
        <span class="sdpt-payment-info">Saved customer. No paperwork created yet.</span>
      </div>
    `;
    const start = () => startJobForCustomer(quote);
    card.querySelector('.jca-open')?.addEventListener('click', start);
    card.querySelector('.jca-send')?.addEventListener('click', start);
    container.appendChild(card);
  });

  docs.forEach(doc => {
    const card = document.createElement('div');
    const docType = doc.type || (doc.quote && doc.quote.type) || 'Estimate';
    const displayRef = doc.ref || doc.quote?.ref || '';
    const displayDate = doc.date || doc.quote?.date || '';
    const isOverdue = !doc.paid && doc.invoiceSent && doc.invoiceDueDate && todayStr() > doc.invoiceDueDate;
    const isAccepted = doc.acceptStatus === 'accepted' || doc.jobAccepted;
    const statusBadge = doc.paid ? 'paid' : isAccepted ? 'accepted' : isOverdue ? 'overdue' : doc.invoiceSent ? 'invoiced' : docType.toLowerCase();
    card.className = `saved-doc-card status-${statusBadge}`;
    const statusLabel = doc.paid ? 'Paid' : isAccepted ? 'Accepted' : isOverdue ? `Overdue since ${formatDate(doc.invoiceDueDate)}` : doc.invoiceSent ? 'Invoiced' : docType;

    // Payment totals for card status only (history shown in modal, not on card)
    const payments   = getDocPayments(doc);
    const totalPaid  = payments.reduce((s, p) => s + (p.amount || 0), 0);

    card.innerHTML = `
      <div class="saved-doc-header">
        <div>
          <span class="saved-doc-name">${esc(buildCustName(doc.quote || {}) || doc.custName || 'Unknown Customer')}</span>
          <div class="saved-doc-ref">${esc(displayRef)} &bull; ${formatDate(displayDate)}</div>
        </div>
        <div style="text-align:right">
          <div class="saved-doc-total">${fmtPrice(doc.total || 0)}</div>
        </div>
      </div>
      <div class="job-card-actions">
        <button type="button" class="jca-open" data-id="${doc.id}">Open</button>
        ${statusBadge === 'overdue'
          ? `<button type="button" class="jca-primary jca-chase" data-id="${doc.id}">£ Chase Payment</button>`
          : statusBadge === 'paid'
            ? `<button type="button" class="jca-primary jca-paid" data-id="${doc.id}">View Receipt</button>`
            : (statusBadge === 'invoiced')
              ? `<button type="button" class="jca-primary jca-invoice" data-id="${doc.id}">Send Invoice</button>`
              : `<button type="button" class="jca-primary jca-send" data-id="${doc.id}">Send</button>`
        }
        <button type="button" class="type-badge ${statusBadge} jca-badge" data-badge-id="${doc.id}" data-badge-status="${statusBadge}">${statusLabel}</button>
      </div>
      <div class="saved-doc-payment-tally">
        <span class="sdpt-payment-info">
          ${totalPaid > 0
            ? `<span class="sdpt-paid">Paid ${fmtPrice(totalPaid)}</span>${totalPaid < (doc.total || 0) ? `<span class="sdpt-outstanding">&middot; ${fmtPrice(Math.max(0, (doc.total || 0) - totalPaid))} outstanding</span>` : '<span class="sdpt-full">&#10003; Paid in full</span>'}`
            : ''}
        </span>
      </div>
    `;

    container.appendChild(card);

    // Open → customer dashboard
    card.querySelector('.jca-open')?.addEventListener('click', () => openCustomerDashboardForDoc(doc.id));
    // Contextual primary actions
    card.querySelector('.jca-chase')?.addEventListener('click',   () => openChaseForDoc(doc.id));
    card.querySelector('.jca-send')?.addEventListener('click',    () => openQuoteModal(doc.id));
    card.querySelector('.jca-invoice')?.addEventListener('click', () => previewInvoice(doc.id));
    card.querySelector('.jca-paid')?.addEventListener('click',    () => handleReceiptRequest(doc.id));

    card.querySelector('.type-badge')?.addEventListener('click', () => {
      const status = statusBadge;
      if      (status === 'accepted')                    showBookingContactModal(doc);
      else if (status === 'estimate')                    openQuoteModal(doc.id);
      else if (status === 'quote')                       openQuoteModal(doc.id);
      else if (status === 'invoiced' || status === 'invoice' || status === 'overdue') previewInvoice(doc.id);
      else if (status === 'paid')                        handleReceiptRequest(doc.id);
      else if (status === 'receipt')                     handleReceiptRequest(doc.id);
    });
  });
}

function exportDocsCSV(filter) {
  // Apply the same filter logic as refreshSavedDocs
  let docs = [...state.saved];
  if      (filter === 'Estimate') docs = docs.filter(d => d.type === 'Estimate');
  else if (filter === 'Quote')    docs = docs.filter(d => d.type === 'Quote');
  else if (filter === 'invoiced') docs = docs.filter(d => d.invoiceSent && !d.paid);
  else if (filter === 'overdue')  docs = docs.filter(d => !d.paid && d.invoiceSent && d.invoiceDueDate && todayStr() > d.invoiceDueDate);
  else if (filter === 'paid')     docs = docs.filter(d => d.paid);
  else if (filter === 'unpaid')   docs = docs.filter(d => !d.paid);

  if (!docs.length) {
    toast('No jobs match that filter to export.', 'error');
    return;
  }

  // CSV helper -wraps a value in quotes and escapes internal quotes
  const csv = v => {
    const s = String(v == null ? '' : v).replace(/"/g, '""');
    return `"${s}"`;
  };

  const headers = [
    'Reference', 'Type', 'Date', 'Valid For',
    'Title', 'First Name', 'Last Name',
    'Address', 'Postcode', 'Phone', 'Email',
    'Jobs', 'Subtotal (£)', 'Discount (%)', 'VAT (%)', 'Total (£)',
    'Invoice Sent', 'Paid', 'Amount Paid (£)', 'Date Paid',
    'Notes'
  ];

  const rows = docs.map(doc => {
    const q   = doc.quote || {};
    const items = (q.items || []).map(i => `${i.name} x${i.qty} @ £${(i.unitPrice||0).toFixed(2)}`).join('; ');

    const sub     = (q.items || []).reduce((s, i) => s + (i.unitPrice || 0) * (i.qty || 1), 0);
    const vatRate = q.vatRate === 'custom' ? parseFloat(q.vatCustom) || 0 : parseFloat(q.vatRate) || 0;
    const disc    = parseFloat(q.discount) || 0;
    const after   = sub - sub * disc / 100;
    const total   = after + after * vatRate / 100;

    const validFor = q.validFor === 'custom'
      ? (q.validCustom ? q.validCustom + ' days' : '')
      : (q.validFor ? q.validFor + ' days' : '');

    return [
      csv(doc.ref      || q.ref      || ''),
      csv(doc.type     || q.type     || ''),
      csv(doc.date     || q.date     || ''),
      csv(validFor),
      csv(q.custTitle     || ''),
      csv(q.custFirstName || ''),
      csv(q.custLastName  || ''),
      csv(q.custAddr      || ''),
      csv(q.custPostcode  || ''),
      csv(q.custPhone     || ''),
      csv(q.custEmail     || ''),
      csv(items),
      csv(sub.toFixed(2)),
      csv(disc || '0'),
      csv(vatRate || '0'),
      csv((doc.total != null ? doc.total : total).toFixed(2)),
      csv(doc.invoiceSent ? 'Yes' : 'No'),
      csv(doc.paid ? 'Yes' : (doc.paidAmount > 0 ? 'Partial' : 'No')),
      csv(doc.paidAmount ? doc.paidAmount.toFixed(2) : ''),
      csv(getDocPayments(doc).map(p => `${fmtPrice(p.amount)} on ${formatDate(p.date)}`).join('; ') || ''),
      csv(q.notes || '')
    ].join(',');
  });

  const csvContent = [headers.map(h => csv(h)).join(','), ...rows].join('\r\n');
  const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const filterLabel = { all: 'All', Estimate: 'Estimates', Quote: 'Quotes', invoiced: 'Invoiced', overdue: 'Overdue', paid: 'Paid', unpaid: 'Unpaid' }[filter] || filter;
  a.href     = url;
  a.download = `Lexi-Jobs-${filterLabel}-${todayStr()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast(`Exported ${docs.length} job${docs.length !== 1 ? 's' : ''} to spreadsheet.`, 'success');
}

function editDoc(id) {
  state.editingDocId = id;
  const doc = state.saved.find(d => d.id === id);
  if (!doc) { state.editingDocId = null; return; }
  loadQuoteFromDoc(doc);
  setVal('jobPickerSearch', '');
  updateJobPicker();
  renderQuoteItems();
  showPage('page-jobs');
  // Update save button to reflect edit mode
  const saveBtn = document.getElementById('saveQuoteBtn');
  if (saveBtn) saveBtn.textContent = '✓ Save Changes';
}

function deleteDoc(id) {
  if (!confirm('Lexi says: Are you sure you want to delete this? Once it\'s gone, it\'s gone!')) return;
  state.saved = state.saved.filter(d => d.id !== id);
  save();
  updateSavedBadge();
  refreshSavedDocs();
  toast('Document deleted.');
}

function openCustomerDeleteChoice(group) {
  const hasMultipleDocs = group.docs.length > 1;
  // Build a simple overlay with two choices
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'display:flex;z-index:10000';
  overlay.innerHTML = `
    <div class="modal-card modal-card-sm" style="padding:24px;text-align:center">
      <h2 class="modal-title" style="margin-bottom:8px">What would you like to delete?</h2>
      <p style="color:#555;font-size:0.88rem;margin:0 0 20px;line-height:1.5">Choose carefully - deleted data cannot be recovered.</p>
      <button type="button" id="_delDocBtn" class="btn btn-outline btn-full" style="margin-bottom:10px;border-color:#c0392b;color:#c0392b">
        Delete document only<br><small style="font-weight:400;font-size:0.78rem">${esc(group.name)} stays in your app</small>
      </button>
      <button type="button" id="_delCustBtn" class="btn btn-outline btn-full" style="margin-bottom:16px;border-color:#c0392b;color:#c0392b">
        Delete entire customer<br><small style="font-weight:400;font-size:0.78rem">All ${group.docs.length} document${group.docs.length > 1 ? 's' : ''} and all records removed</small>
      </button>
      <button type="button" id="_delCancelBtn" class="btn btn-outline btn-full">Cancel</button>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };

  overlay.querySelector('#_delCancelBtn').onclick = close;

  overlay.querySelector('#_delDocBtn').onclick = () => {
    // If multiple docs, pick which one first
    if (hasMultipleDocs) {
      close();
      // Show a picker - use the existing job picker approach
      const docNames = group.docs.map(d => `${d.ref || d.quote?.ref || 'Doc'} - ${fmtPrice(d.total || 0)}`).join('\n');
      const picked = group.docs.find((d, i) => {
        // Simple: just delete the most recent doc with another confirm
        return false;
      });
      // For multiple docs, just confirm delete of first / show which one
      const pickerOverlay = document.createElement('div');
      pickerOverlay.className = 'modal-overlay';
      pickerOverlay.style.cssText = 'display:flex;z-index:10001';
      pickerOverlay.innerHTML = `
        <div class="modal-card modal-card-sm" style="padding:20px">
          <h2 class="modal-title" style="margin-bottom:12px">Which document?</h2>
          ${group.docs.map(d => `
            <button type="button" class="_pick-del-doc btn btn-outline btn-full" data-id="${esc(d.id)}" style="margin-bottom:8px;text-align:left">
              <strong>${esc(d.ref || d.quote?.ref || 'No ref')}</strong> &nbsp; ${fmtPrice(d.total || 0)}
            </button>`).join('')}
          <button type="button" id="_pickDelCancel" class="btn btn-outline btn-full" style="margin-top:4px">Cancel</button>
        </div>`;
      document.body.appendChild(pickerOverlay);
      pickerOverlay.querySelector('#_pickDelCancel').onclick = () => pickerOverlay.remove();
      pickerOverlay.querySelectorAll('._pick-del-doc').forEach(btn => {
        btn.onclick = () => {
          const docId = btn.dataset.id;
          pickerOverlay.remove();
          if (!confirm('Are you sure you want to delete this document? This cannot be undone.')) return;
          state.saved = state.saved.filter(d => d.id !== docId);
          save(); updateSavedBadge(); refreshSavedDocs();
          document.getElementById('customerDashboardModal').style.display = 'none';
          toast('Document deleted.');
        };
      });
    } else {
      const docId = group.docs[0].id;
      close();
      if (!confirm(`Are you sure you want to delete this document for ${group.name}? This cannot be undone.`)) return;
      state.saved = state.saved.filter(d => d.id !== docId);
      save(); updateSavedBadge(); refreshSavedDocs();
      document.getElementById('customerDashboardModal').style.display = 'none';
      toast('Document deleted.');
    }
  };

  overlay.querySelector('#_delCustBtn').onclick = () => {
    close();
    if (!confirm(`Are you sure you want to delete ${group.name} and ALL their documents? This cannot be undone.`)) return;
    const docIds = group.docs.map(d => d.id);
    state.saved = state.saved.filter(d => !docIds.includes(d.id));
    save(); updateSavedBadge(); refreshSavedDocs();
    document.getElementById('customerDashboardModal').style.display = 'none';
    // Also remove from Supabase if connected
    if (lexiSupabase && lexiAuthSession?.user?.id) {
      docIds.forEach(id => {
        lexiSupabase.from('documents').delete().eq('local_id', id).eq('user_id', lexiAuthSession.user.id)
          .then(() => {}).catch(() => {});
      });
    }
    toast(`${group.name} and all their documents have been removed.`);
  };
}

function updateSavedBadge() {
  const badge = document.getElementById('savedBadge');
  const count = state.saved.length;
  badge.textContent = count;
  badge.style.display = count > 0 ? 'flex' : 'none';
}

/* ===== EXIT CONFIRMATION (system back button) ===== */
function setupExitConfirm() {
  // Push a dummy state so the first back-press doesn't immediately leave the PWA
  history.pushState({ lexi: true }, '');

  window.addEventListener('popstate', (e) => {
    // Only intercept when My Jobs (page4) is active and no modal is open
    const page4 = document.getElementById('page4');
    const anyModalOpen = [...document.querySelectorAll('.modal-overlay')].some(
      m => m.id !== 'exitConfirmModal' && m.style.display !== 'none'
    );
    if (!page4?.classList.contains('active') || anyModalOpen) {
      // Not on My Jobs or a modal is open — re-push so next back is intercepted
      history.pushState({ lexi: true }, '');
      return;
    }
    // Show exit confirmation
    const modal = document.getElementById('exitConfirmModal');
    if (modal) modal.style.display = 'flex';
    // Re-push so the modal's own close doesn't trigger another popstate
    history.pushState({ lexi: true }, '');
  });

  document.getElementById('exitConfirmNo')?.addEventListener('click', () => {
    document.getElementById('exitConfirmModal').style.display = 'none';
  });

  document.getElementById('exitConfirmYes')?.addEventListener('click', () => {
    // Go back past our dummy states to actually leave the app
    history.go(-2);
  });
}

/* ===== MODALS ===== */
function setupModals() {
  // Voice disambiguation modal
  document.getElementById('closeVoicePickModal').addEventListener('click', () => {
    document.getElementById('voicePickModal').style.display = 'none';
  });
  document.getElementById('voicePickNoneBtn').addEventListener('click', () => {
    document.getElementById('voicePickModal').style.display = 'none';
    setVal('vnfName', '');
    setVal('vnfPrice', '');
    setVal('vnfUnit', '');
    document.getElementById('voiceNotFoundModal').style.display = 'flex';
    setTimeout(() => document.getElementById('vnfName')?.focus(), 150);
  });

  // Voice not-found modal
  document.getElementById('closeVoiceNotFoundModal').addEventListener('click', closeVoiceNotFoundModal);
  document.getElementById('vnfAddBothBtn').addEventListener('click', () => vnfSubmit(true));
  document.getElementById('vnfAddOnceBtn').addEventListener('click', () => vnfSubmit(false));

  document.getElementById('closePreviewBtn').addEventListener('click', closePreview);
  document.getElementById('closeQuoteBtn').addEventListener('click', () => {
    document.getElementById('quoteModal').style.display = 'none';
    setShareBackButtons(false);
  });
  document.getElementById('closeInvoiceBtn').addEventListener('click', () => {
    document.getElementById('invoiceModal').style.display = 'none';
    setShareBackButtons(false);
    if (document.getElementById('page4')?.classList.contains('active')) window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  document.getElementById('closeReceiptBtn').addEventListener('click', () => {
    document.getElementById('receiptModal').style.display = 'none';
    setShareBackButtons(false);
    if (document.getElementById('page4')?.classList.contains('active')) window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  document.getElementById('closeMarkPaidBtn').addEventListener('click', () => { document.getElementById('markPaidModal').style.display = 'none'; reopenDashboardAfterMoneyIn(); });
  document.getElementById('cancelMarkPaidBtn').addEventListener('click', () => { document.getElementById('markPaidModal').style.display = 'none'; reopenDashboardAfterMoneyIn(); });
  document.getElementById('mpAmount').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('confirmMarkPaidBtn').click(); } });
  document.getElementById('closeEditPaymentsBtn').addEventListener('click', () => document.getElementById('editPaymentsModal').style.display = 'none');
  document.getElementById('doneEditPaymentsBtn').addEventListener('click', () => document.getElementById('editPaymentsModal').style.display = 'none');
  document.getElementById('closeClientPickerBtn').addEventListener('click', () => document.getElementById('clientPickerModal').style.display = 'none');
  document.getElementById('closeEditChoiceBtn')?.addEventListener('click', () => document.getElementById('editChoiceModal').style.display = 'none');
  document.getElementById('closePhotosBtn')?.addEventListener('click', closePhotosAndReturn);
  document.getElementById('savePhotosBtn')?.addEventListener('click', closePhotosAndReturn);
  document.getElementById('closeOutstandingBtn')?.addEventListener('click', closeOutstandingReceipt);
  document.getElementById('outstandingNoBtn')?.addEventListener('click', closeOutstandingReceipt);
  document.getElementById('outstandingYesBtn')?.addEventListener('click', () => {
    const docId = pendingReceiptDocId;
    closeOutstandingReceipt();
    document.getElementById('customerDashboardModal').style.display = 'none';
    if (docId) previewReceipt(docId);
  });
  document.getElementById('closePreviewFirstBtn')?.addEventListener('click', closePreviewFirstModal);
  document.getElementById('previewFirstYesBtn')?.addEventListener('click', () => {
    rememberPreviewChoice();
    const fn = pendingPreviewSend;
    closePreviewFirstModal();
    if (fn) fn(true);
  });
  document.getElementById('previewFirstNoBtn')?.addEventListener('click', () => {
    rememberPreviewChoice();
    const fn = pendingPreviewSend;
    closePreviewFirstModal();
    if (fn) fn(false);
  });
  document.getElementById('backPreviewBtn')?.addEventListener('click', backToSendChoiceModal);
  document.getElementById('backQuoteBtn')?.addEventListener('click', backToSendChoiceModal);
  document.getElementById('backInvoiceBtn')?.addEventListener('click', backToSendChoiceModal);
  document.getElementById('backReceiptBtn')?.addEventListener('click', backToSendChoiceModal);
  document.getElementById('closeBizInfoBtn')?.addEventListener('click', () => document.getElementById('bizInfoModal').style.display = 'none');
  document.getElementById('backBizInfoBtn')?.addEventListener('click', backToSendChoiceModal);
  document.getElementById('closeQuickQrBtn')?.addEventListener('click', () => document.getElementById('quickQrModal').style.display = 'none');
  document.getElementById('backQuickQrBtn')?.addEventListener('click', backToSendChoiceModal);
  const closeMissingQrPrompt = () => {
    pendingQrReturnContext = null;
    document.getElementById('missingQrModal').style.display = 'none';
  };
  document.getElementById('closeMissingQrBtn')?.addEventListener('click', closeMissingQrPrompt);
  document.getElementById('missingQrNoBtn')?.addEventListener('click', closeMissingQrPrompt);
  document.getElementById('missingQrYesBtn')?.addEventListener('click', goToQrUploadFromModal);
  document.getElementById('copyQrInfoBtn')?.addEventListener('click', copyQrInfo);
  document.getElementById('shareQrCodeBtn')?.addEventListener('click', shareQrCode);
  document.getElementById('bizInfoOptions')?.addEventListener('change', updateBizInfoPreview);
  document.getElementById('copyBizInfoBtn')?.addEventListener('click', copyBizInfo);
  document.getElementById('shareBizInfoBtn')?.addEventListener('click', shareBizInfo);
  document.getElementById('closeCustomerDashboardBtn')?.addEventListener('click', () => {
    document.getElementById('customerDashboardModal').style.display = 'none';
    activeCustomerGroup = null;
    if (document.getElementById('page4')?.classList.contains('active')) window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  document.getElementById('custEditDeleteBtn')?.addEventListener('click', () => {
    const docId = activeEditDocId || activeCustomerGroup?.docs[0]?.id;
    if (!docId) return;
    if (!confirm('Lexi says: Are you sure you want to delete this? Once it\'s gone, it\'s gone!')) return;
    document.getElementById('customerDashboardModal').style.display = 'none';
    state.saved = state.saved.filter(d => d.id !== docId);
    save();
    updateSavedBadge();
    refreshSavedDocs();
    toast('Document deleted.');
  });
  document.getElementById('closeCustDetailsEditBtn')?.addEventListener('click', () => document.getElementById('customerDetailsEditModal').style.display = 'none');
  document.getElementById('saveCustDetailsBtn')?.addEventListener('click', saveCustomerDetails);
  document.getElementById('nextToJobDetailsBtn')?.addEventListener('click', () => {
    persistCustomerDetailsForm();                                        // save before leaving
    document.getElementById('customerDetailsEditModal').style.display = 'none';
    const docId = activeEditDocId || (activeCustomerGroup?.docs[0]?.id);
    if (docId) openJobDetailsEdit(docId);
  });
  document.getElementById('closeJobDetailsEditBtn')?.addEventListener('click', () => document.getElementById('jobDetailsEditModal').style.display = 'none');
  document.getElementById('backToCustDetailsBtn')?.addEventListener('click', () => {
    persistJobDetailsForm();                                           // save before leaving
    document.getElementById('jobDetailsEditModal').style.display = 'none';
    if (activeJobDetailsDocId) openCustomerDetailsEdit(activeJobDetailsDocId);
  });
  document.getElementById('saveJobDetailsBtn')?.addEventListener('click', saveJobDetails);
  document.getElementById('nextToJobTermsBtn')?.addEventListener('click', () => {
    persistJobDetailsForm();                                           // save before leaving
    document.getElementById('jobDetailsEditModal').style.display = 'none';
    if (activeJobDetailsDocId) openJobTermsEdit(activeJobDetailsDocId);
  });
  document.getElementById('clientPickerNewCustomerBtn')?.addEventListener('click', createNewCustomerFromPicker);
  document.getElementById('editChoiceCustomerBtn')?.addEventListener('click', () => {
    const docId = activeEditChoiceDocId;
    document.getElementById('editChoiceModal').style.display = 'none';
    if (docId) openCustomerDetailsEditStandalone(docId);
  });
  document.getElementById('editChoiceMoneyBtn')?.addEventListener('click', () => {
    const docId = activeEditChoiceDocId;
    document.getElementById('editChoiceModal').style.display = 'none';
    if (docId) openEditPayments(docId);
  });
  document.getElementById('editChoiceJobBtn')?.addEventListener('click', () => {
    const docId = activeEditChoiceDocId;
    document.getElementById('editChoiceModal').style.display = 'none';
    if (docId) openJobDetailsEdit(docId);
  });
  document.getElementById('beforePhotosInput')?.addEventListener('change', e => handlePhotoUpload(e, 'before'));
  document.getElementById('afterPhotosInput')?.addEventListener('change', e => handlePhotoUpload(e, 'after'));

  // Close on overlay click
  [document.getElementById('previewModal'),
   document.getElementById('quoteModal'),
   document.getElementById('invoiceModal'),
   document.getElementById('receiptModal'),
   document.getElementById('markPaidModal'),
   document.getElementById('editPaymentsModal'),
   document.getElementById('clientPickerModal'),
   document.getElementById('editChoiceModal'),
   document.getElementById('photosModal'),
   document.getElementById('receiptOutstandingModal'),
   document.getElementById('previewFirstModal'),
   document.getElementById('bizInfoModal'),
   document.getElementById('customerDashboardModal'),
   document.getElementById('customerDetailsEditModal')].forEach(m => {
    m?.addEventListener('click', e => { if (e.target === m) m.style.display = 'none'; });
  });

  document.getElementById('previewEditBtn').addEventListener('click', () => {
    closePreview();
    const { type, docId } = previewContext;
    if (type === 'receipt' && docId) {
      openReceiptModal(docId);
      return;
    }
    if (type === 'invoice' && docId) {
      openInvoiceModal(docId);
      return;
    }
    // Load the quote into the builder for editing
    if (type === 'quote' && docId) {
      closePreview();
      loadQuoteIntoBuilder(docId);
    } else if (type === 'quote' && !docId) {
      closePreview();
      showPage('page3');
    }
  });

  document.getElementById('previewPrintBtn').addEventListener('click', () => {
    const html = document.getElementById('previewContent').innerHTML;
    printRaw(html);
  });

  document.getElementById('previewSaveBtn').addEventListener('click', () => {
    const { type, docId } = previewContext;
    if (type === 'quote' && !docId) {
      // Save the current page3 form state as a quote
      closePreview();
      saveQuote();
      return;
    }
    // Modal flows: save edits to doc without sending
    if (type === 'quote' && docId) {
      const doc = state.saved.find(d => d.id === docId);
      if (doc) {
        const quoteData = collectQuoteSendForm();
        Object.assign(doc, applyDocEdits(doc, quoteData));
        save();
        refreshSavedDocs();
      }
      document.getElementById('quoteModal').style.display = 'none';
    } else if (type === 'invoice') {
      const doc = state.saved.find(d => d.id === activeDocId);
      if (doc) {
        const invData = collectInvoiceForm();
        Object.assign(doc, applyDocEdits(doc, invData));
        doc.invoiceSent    = true;
        doc.invoiceRef     = invData.invRef;
        doc.invoiceDueDate = invData.dueDate || '';
        save();
        refreshSavedDocs();
      }
      document.getElementById('invoiceModal').style.display = 'none';
    } else if (type === 'receipt') {
      const doc = state.saved.find(d => d.id === activeDocId);
      if (doc) {
        const recData = collectReceiptForm();
        Object.assign(doc, applyDocEdits(doc, recData));
        if (recData.recRef) doc.receiptRef = recData.recRef;
        recordReceiptPayment(doc, recData);
        save();
        refreshSavedDocs();
      }
      document.getElementById('receiptModal').style.display = 'none';
    }
    closePreview();
    showSavedPopup("Saved. Another one off your plate.");
  });

  document.getElementById('previewSendBtn').addEventListener('click', () => {
    const { type } = previewContext;
    if (type === 'quote') {
      // Send via the modal function so the cover message is included
      closePreview();
      sendQuoteFromModal();
    } else if (type === 'invoice') {
      closePreview();
      sendInvoiceFromModal();
    } else if (type === 'receipt') {
      closePreview();
      sendReceiptFromModal();
    } else {
      const html = document.getElementById('previewContent').innerHTML;
      sendDocRaw(wrapDoc(html), 'document.html');
    }
  });

  // Quote modal
  document.getElementById('quotePreviewBtn').addEventListener('click', () => {
    const doc = getActiveQuoteDoc();
    if (!doc) return;
    const quoteData = collectQuoteSendForm();
    quotePreviewed = true;
    openPreview(buildDocHtml(applyDocEdits(doc, quoteData), 'quote', quoteData), 'quote', doc.id || null);
  });
  document.getElementById('quoteSendBtn').addEventListener('click', () => {
    // Always show preview first -user can Share or Edit from there
    document.getElementById('quotePreviewBtn').click();
  });

  function sendQuoteFromModal() {
    const doc = getActiveQuoteDoc();
    if (!doc) return;
    const quoteData = collectQuoteSendForm();
    const editedDoc = applyDocEdits(doc, quoteData);
    const html = buildDocHtml(editedDoc, 'quote', quoteData);
    if (activeDocId) {
      const savedDoc = state.saved.find(d => d.id === activeDocId);
      if (savedDoc) {
        Object.assign(savedDoc, editedDoc);
        save();
        refreshSavedDocs();
      }
    }
    document.getElementById('quoteModal').style.display = 'none';

    // Ensure the doc is saved so we can generate an acceptance token and use customer data
    let sendDocRef = activeDocId;
    if (!sendDocRef) {
      // Draft send (from form) -auto-save first so we have an ID and can token-sign it
      const newId = uid();
      const q = editedDoc.quote || {};
      const newDoc = {
        id: newId,
        quote: q,
        company: { ...state.company },
        custName: buildCustName(q),
        total: editedDoc.total || calcTotal(q),
        type: editedDoc.type || q.type || 'Estimate',
        date: editedDoc.date || q.date || todayStr(),
        ref: editedDoc.ref || q.ref || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        invoiceSent: false,
        paid: false,
        paidAmount: 0,
        paidDate: '',
        payments: []
      };
      state.saved.unshift(newDoc);
      save();  // writes to localStorage (now slim -should always succeed)
      upsertLocalCustomer(q);
      sendDocRef = newId;
      // Bind this form to the new doc so a second Send updates it instead of
      // creating a duplicate entry (was producing LEXI-106 AND LEXI-107).
      activeDocId = newId;
      updateSavedBadge();
      refreshSavedDocs();
      // Sync immediately to Supabase -do NOT rely on the debounced queue
      // so a quick refresh cannot lose the new document before it reaches the cloud
      if (savedDocsSyncReady && lexiSupabase && lexiAuthSession?.user?.id) {
        saveSavedDocsToSupabase().catch(err => {
          console.warn('Auto-save sync failed:', err);
          localStorage.setItem('lexi_last_documents_sync_error', err?.message || String(err));
          toast(`Estimate saved here, but cloud sync failed: ${err?.message || 'check connection'}`, 'error', 8000);
        });
      }
    }

    const savedDoc = state.saved.find(d => d.id === sendDocRef);
    if (savedDoc) {
      const baseMsg = quoteData.quoteNotes || '';
      const shareMessage = buildAcceptanceMessage(savedDoc, baseMsg);
      const custEmail = savedDoc.quote?.custEmail || savedDoc.custEmail || '';
      const custPhone = savedDoc.quote?.custPhone || '';
      const docTypeStr = savedDoc.quote?.type || savedDoc.type || 'Estimate';
      sendDoc(html, getDocFilenameFromRef(quoteData.ref || editedDoc.ref || savedDoc.ref || 'quote'), shareMessage, custEmail, custPhone, docTypeStr, savedDoc.acceptToken || '');
    } else {
      sendDoc(html, getDocFilenameFromRef(quoteData.ref || editedDoc.ref || 'quote'), quoteData.quoteNotes || '');
    }
    toast('Quote shared!', 'success');
  }

  // Invoice modal
  document.getElementById('invPreviewBtn').addEventListener('click', () => {
    const doc = state.saved.find(d => d.id === activeDocId);
    if (!doc) return;
    const invData = collectInvoiceForm();
    openPreview(buildDocHtml(applyDocEdits(doc, invData), 'invoice', invData), 'invoice');
  });
  document.getElementById('invSendBtn').addEventListener('click', () => {
    sendInvoiceFromModal();
  });

  function sendInvoiceFromModal() {
    const doc = state.saved.find(d => d.id === activeDocId);
    if (!doc) return;
    const invData = collectInvoiceForm();
    const editedDoc = applyDocEdits(doc, invData);
    const html = buildDocHtml(editedDoc, 'invoice', invData);
    Object.assign(doc, editedDoc);
    doc.invoiceSent    = true;
    doc.invoiceRef     = invData.invRef;
    doc.invoiceDueDate = invData.dueDate || '';   // persisted for overdue tracking
    save();
    refreshSavedDocs();
    document.getElementById('invoiceModal').style.display = 'none';
    sendDoc(html, getDocFilenameFromRef(invData.invRef || 'invoice'));
    toast('Invoice sent!', 'success');
  }

  // Receipt modal
  document.getElementById('recPreviewBtn').addEventListener('click', () => {
    const doc = state.saved.find(d => d.id === activeDocId);
    if (!doc) return;
    const recData = collectReceiptForm();
    receiptPreviewed = true;
    openPreview(buildDocHtml(applyDocEdits(doc, recData), 'receipt', recData), 'receipt');
  });
  document.getElementById('recSendBtn').addEventListener('click', () => {
    if (!receiptPreviewed && !localStorage.getItem(KEY_PREVIEW_FIRST_SUPPRESSED)) {
      pendingPreviewSend = previewFirst => {
        if (previewFirst) {
          document.getElementById('recPreviewBtn').click();
        } else {
          sendReceiptFromModal();
        }
      };
      document.getElementById('previewFirstModal').style.display = 'flex';
      return;
    }
    sendReceiptFromModal();
  });

  function sendReceiptFromModal() {
    const doc = state.saved.find(d => d.id === activeDocId);
    if (!doc) return;
    const recData = collectReceiptForm();
    const editedDoc = applyDocEdits(doc, recData);
    Object.assign(doc, editedDoc);
    // Persist the receipt ref so re-opens reuse the same number
    if (recData.recRef) doc.receiptRef = recData.recRef;
    recordReceiptPayment(doc, recData);
    const html = buildDocHtml(doc, 'receipt', recData);
    save();
    refreshSavedDocs();
    sendDoc(html, 'receipt.html');
    document.getElementById('receiptModal').style.display = 'none';
    toast('Receipt sent!', 'success');
  }

  // Quote modal -Edit opens full edit menu if in dashboard context, otherwise page3 builder
  document.getElementById('quoteEditBtn')?.addEventListener('click', () => {
    document.getElementById('quoteModal').style.display = 'none';
    if (activeCustomerGroup && activeDocId) {
      document.getElementById('customerDashboardModal').style.display = 'flex';
      openCustomerEditChoice(activeDocId);
    } else if (activeDocId) {
      openEditChoice(activeDocId);
    }
  });
  document.getElementById('quoteSaveBtn')?.addEventListener('click', () => {
    const doc = getActiveQuoteDoc();
    if (!doc) return;
    const quoteData = collectQuoteSendForm();
    const editedDoc = applyDocEdits(doc, quoteData);
    if (activeDocId) {
      const savedDoc = state.saved.find(d => d.id === activeDocId);
      if (savedDoc) {
        Object.assign(savedDoc, editedDoc);
        save();
        refreshSavedDocs();
      }
    }
    document.getElementById('quoteModal').style.display = 'none';
    showSavedPopup("Done. I've got it.");
  });

  // Invoice modal -Edit opens full edit menu if in dashboard context, otherwise quote modal
  document.getElementById('invEditBtn')?.addEventListener('click', () => {
    document.getElementById('invoiceModal').style.display = 'none';
    if (activeCustomerGroup && activeDocId) {
      document.getElementById('customerDashboardModal').style.display = 'flex';
      openCustomerEditChoice(activeDocId);
    } else if (activeDocId) {
      openQuoteModal(activeDocId);
    }
  });
  document.getElementById('invSaveBtn')?.addEventListener('click', () => {
    const doc = state.saved.find(d => d.id === activeDocId);
    if (!doc) return;
    const invData = collectInvoiceForm();
    Object.assign(doc, applyDocEdits(doc, invData));
    doc.invoiceRef      = invData.invRef;
    doc.invoiceDueDate  = invData.dueDate || '';
    doc.invoicePayMethods = invData.payMethods;
    save();
    refreshSavedDocs();
    document.getElementById('invoiceModal').style.display = 'none';
    // Return to preview with updated invoice
    const html = buildDocHtml(doc, 'invoice', invData);
    openPreview(html, 'invoice', activeDocId);
    showSavedPopup("Invoice saved. Nice one.");
  });

  // Receipt modal -Edit (open quoteModal for same doc) and Save (save without sending)
  document.getElementById('recEditBtn')?.addEventListener('click', () => {
    document.getElementById('receiptModal').style.display = 'none';
    if (activeDocId) openReceiptModal(activeDocId);
  });
  document.getElementById('recSaveBtn')?.addEventListener('click', () => {
    const doc = state.saved.find(d => d.id === activeDocId);
    if (!doc) return;
    const recData = collectReceiptForm();
    Object.assign(doc, applyDocEdits(doc, recData));
    if (recData.recRef)    doc.receiptRef    = recData.recRef;
    if (recData.date)      doc.receiptDate   = recData.date;
    if (recData.method)    doc.receiptMethod = recData.method;
    save();
    refreshSavedDocs();
    document.getElementById('receiptModal').style.display = 'none';
    // Return to preview with updated receipt
    const html = buildDocHtml(doc, 'receipt', recData);
    openPreview(html, 'receipt', activeDocId);
    showSavedPopup("Receipt saved. Job done.");
  });

  // Add Payment button inside editPaymentsModal
  document.getElementById('addPaymentBtn')?.addEventListener('click', () => {
    const doc = state.saved.find(d => d.id === activeDocId);
    if (!doc) return;
    const amount = parseFloat(document.getElementById('epAddAmount').value) || 0;
    const date   = document.getElementById('epAddDate').value || todayStr();
    const type   = _epPaymentType || 'standard';
    if (!amount) { toast('Please enter an amount.', 'error'); return; }
    if (!Array.isArray(doc.payments)) doc.payments = getDocPayments(doc);
    doc.payments.push({ amount, date, type });
    sortPaymentsByDate(doc.payments);
    recalcDocPayments(doc);
    save();
    queueSavedDocsSync(true);
    refreshSavedDocs();
    renderEditPaymentsList(doc);
    document.getElementById('epAddAmount').value = '';
    setVal('epAddDate', todayStr());
    toast('Payment added.', 'success');
  });

  // Money In -push new payment to payments array
  document.getElementById('confirmMarkPaidBtn').addEventListener('click', () => {
    const doc = state.saved.find(d => d.id === activeDocId);
    if (!doc) return;
    const amount      = parseFloat(getVal('mpAmount')) || 0;
    const date        = getVal('mpDate') || todayStr();
    const paymentType = getVal('mpPaymentType') || 'Full Payment';
    if (amount <= 0) { toast('Enter an amount received.', 'error'); return; }
    // Migrate legacy single-payment docs
    if (!Array.isArray(doc.payments)) doc.payments = getDocPayments(doc);
    doc.payments.push({ amount, date, type: paymentType });
    sortPaymentsByDate(doc.payments);
    recalcDocPayments(doc);
    save();
    queueSavedDocsSync(true);
    refreshSavedDocs();
    document.getElementById('markPaidModal').style.display = 'none';
    // Return to customer dashboard if it was open when Money In was triggered
    if (activeCustomerGroup) {
      try {
        const groups = buildCustomerGroups();
        const updatedGroup = groups.find(g => g.docs.some(d => d.id === activeDocId)) || activeCustomerGroup;
        activeCustomerGroup = updatedGroup;
        document.getElementById('customerDashboardModal').style.display = 'flex';
        renderSingleCustomerDashboard(updatedGroup, groups);
      } catch(e) { console.error('Dashboard re-render error:', e); }
    }
    if (doc.paid) {
      showSavedPopup('Get in. That one is paid in full.', () => {
        maybeAskForReview(doc);
      }, 2000);
    } else {
      showSavedPopup("Payment logged. I've got it.");
    }
  });
}

let previewContext = { type: 'quote', docId: null };

function openPreview(html, type, docId = null) {
  previewContext = { type, docId };
  document.getElementById('previewContent').innerHTML = html;
  const modal = document.getElementById('previewModal');
  modal.classList.add('modal-front');
  modal.style.display = 'flex';
}

function closePreview() {
  const modal = document.getElementById('previewModal');
  modal.style.display = 'none';
  modal.classList.remove('modal-front');
  setShareBackButtons(false);
  if (document.getElementById('page4')?.classList.contains('active')) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

/* ===== CLIENT PICKER (New Invoice / New Receipt from menu) ===== */
function openClientPicker(mode) {
  const titleEl   = document.getElementById('clientPickerTitle');
  const listEl    = document.getElementById('clientPickerList');
  const warningEl = document.getElementById('clientPickerWarning');

  titleEl.textContent = mode === 'invoice'
    ? `Who would you like to invoice ${traderFirstName()}?`
    : `Who is this receipt for ${traderFirstName()}?`;
  listEl.dataset.mode = mode;
  warningEl.style.display = 'none';
  warningEl.innerHTML = '';

  const docs = [...state.saved].sort((a, b) => {
    const aq = a.quote || {};
    const bq = b.quote || {};
    return (aq.custLastName || '').localeCompare(bq.custLastName || '') ||
      (aq.custFirstName || '').localeCompare(bq.custFirstName || '');
  });

  if (!docs.length) {
    listEl.innerHTML = '<p class="cp-empty">No saved jobs yet - create an estimate or quote first.</p>';
    document.getElementById('clientPickerModal').style.display = 'flex';
    return;
  }

  listEl.innerHTML = docs.map(doc => {
    const payments    = getDocPayments(doc);
    const totalPaid   = payments.reduce((s, p) => s + (p.amount || 0), 0);
    const statusClass = doc.paid ? 'paid' : doc.invoiceSent ? 'invoiced' : (doc.type || 'estimate').toLowerCase();
    const statusLabel = doc.paid ? 'Paid' : doc.invoiceSent ? 'Invoiced' : (doc.type || 'Estimate');
    const jobDesc     = doc.quote?.items?.[0]?.name || doc.ref || 'Job';
    return `
      <button type="button" class="cp-row" data-id="${doc.id}">
        <div class="cp-row-main">
          <span class="cp-name">${esc(doc.custName || 'Unknown')}</span>
          <span class="cp-job">${esc(jobDesc)}</span>
        </div>
        <div class="cp-row-right">
          <span class="cp-total">${fmtPrice(doc.total || 0)}</span>
          <span class="type-badge ${statusClass}">${statusLabel}</span>
        </div>
      </button>`;
  }).join('');

  listEl.querySelectorAll('.cp-row').forEach(btn => {
    btn.addEventListener('click', () => {
      const docId = btn.dataset.id;
      const doc   = state.saved.find(d => d.id === docId);
      if (!doc) return;

      if (mode === 'invoice') {
        document.getElementById('clientPickerModal').style.display = 'none';
        openInvoiceModal(docId);
      } else {
        // Receipt mode -warn if not fully paid
        const payments  = getDocPayments(doc);
        const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
        if (totalPaid === 0) {
          showPickerWarning(docId,
            `⚠️ No payment has been recorded for ${esc(doc.custName || 'this client')} yet. Do you still want to create a receipt?`);
        } else if (!doc.paid) {
          showPickerWarning(docId,
            `⚠️ ${esc(doc.custName || 'This client')} has only paid ${fmtPrice(totalPaid)} of ${fmtPrice(doc.total || 0)}. Do you still want to create a receipt?`);
        } else {
          document.getElementById('clientPickerModal').style.display = 'none';
          openReceiptModal(docId);
        }
      }
    });
  });

  document.getElementById('clientPickerModal').style.display = 'flex';
}

function showPickerWarning(docId, message) {
  const warningEl = document.getElementById('clientPickerWarning');
  warningEl.style.display = 'block';
  warningEl.innerHTML = `
    <p class="cp-warning-msg">${message}</p>
    <div class="cp-warning-actions">
      <button type="button" class="btn btn-outline btn-sm" id="cpWarnCancel">Cancel</button>
      <button type="button" class="btn btn-primary btn-sm" id="cpWarnConfirm">Create Receipt</button>
    </div>`;
  warningEl.querySelector('#cpWarnCancel').addEventListener('click', () => {
    warningEl.style.display = 'none';
  });
  warningEl.querySelector('#cpWarnConfirm').addEventListener('click', () => {
    document.getElementById('clientPickerModal').style.display = 'none';
    openReceiptModal(docId);
  });
  warningEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function previewReceipt(docId) {
  withBizCheck(docId, id => {
    activeDocId = id;
    const doc = state.saved.find(d => d.id === id);
    if (!doc) return;
    const payments  = getDocPayments(doc);
    const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
    const recRef = doc.receiptRef || nextRef('REC', KEY_REC);
    const html = buildDocHtml(doc, 'receipt', {
      recRef,
      date:   doc.receiptDate || todayStr(),
      amount: totalPaid > 0 ? totalPaid : (doc.total || 0),
      method: doc.receiptMethod || ''
    });
    openPreview(html, 'receipt', id);
  });
}

function handleReceiptRequest(docId) {
  const doc = state.saved.find(d => d.id === docId);
  if (!doc) return;
  if (doc.paid) {
    previewReceipt(docId);
    return;
  }
  // Not fully paid -warn with personalised message
  pendingReceiptDocId = docId;
  const first = (doc.quote?.custFirstName || '').trim();
  const msg = document.getElementById('outstandingMsg');
  if (msg) {
    msg.textContent = first
      ? `${first}, the payment history shows funds outstanding. Do you still wish to send a receipt anyway?`
      : 'The payment history shows funds outstanding. Do you still wish to send a receipt anyway?';
  }
  document.getElementById('receiptOutstandingModal').style.display = 'flex';
}

function closeOutstandingReceipt() {
  pendingReceiptDocId = null;
  document.getElementById('receiptOutstandingModal').style.display = 'none';
}

function openQuoteModalFromCurrentForm() {
  const q = collectQuoteState();
  q.items = [...state.quote.items];
  if (!q.custLastName && !q.custFirstName) {
    toast('Please add a customer name.', 'error');
    document.getElementById('custFirstName').focus();
    return;
  }
  activeDocId = null;
  activeQuoteDraftDoc = {
    id: null,
    quote: q,
    company: { ...state.company },
    custName: buildCustName(q),
    total: calcTotal(q),
    type: q.type,
    date: q.date,
    ref: q.ref,
    photos: { before: [], after: [] }
  };
  // Prime modal fields silently so Send from the preview works
  populateQuoteSendModal(activeQuoteDraftDoc, { show: false });
  // Go straight to the actual document preview — no intermediate form
  quotePreviewed = true;
  openPreview(buildDocHtml(activeQuoteDraftDoc, 'quote'), 'quote', null);
}

function populateQBPreviewPage(doc) {
  const q = doc.quote || {};
  const label = q.type || doc.type || 'Quote';
  const el = document.getElementById('qbpTitle');
  if (el) el.textContent = label + ' Preview';
  setVal('qbpCustFirst', q.custFirstName || '');
  setVal('qbpCustLast', q.custLastName || '');
  setVal('qbpRef', q.ref || doc.ref || '');
  setVal('qbpDate', q.date || doc.date || todayStr());
  setVal('qbpItems', (q.items || []).map(i => `${i.name}, ${Number(i.unitPrice || 0).toFixed(2)}`).join('\n'));
  setVal('qbpTotal', (doc.total || calcTotal(q) || 0).toFixed(2));
  const docTypeLower = (q.type || 'quote').toLowerCase();
  setVal('qbpNotes', `Thank you for allowing me to give you this free, no obligation ${docTypeLower} today. Please find below a full breakdown of the proposed work and costs. There is no pressure and no obligation to proceed. Please read through at your leisure, discuss it with anyone you need to, and let me know if you have any questions.`);
  const photosEl = document.getElementById('qbpIncludePhotos');
  if (photosEl) photosEl.checked = false;
}

function collectQBPreviewForm() {
  return {
    custFirstName: getVal('qbpCustFirst'),
    custLastName:  getVal('qbpCustLast'),
    ref:           getVal('qbpRef'),
    date:          getVal('qbpDate'),
    itemsText:     getVal('qbpItems'),
    totalOverride: getVal('qbpTotal'),
    quoteNotes:    getVal('qbpNotes'),
    includePhotos: document.getElementById('qbpIncludePhotos')?.checked || false
  };
}

function setupQBPreviewPage() {
  document.getElementById('qbpBackBtn')?.addEventListener('click', () => showPage('page-completion'));

  document.getElementById('qbpPreviewBtn')?.addEventListener('click', () => {
    const doc = getActiveQuoteDoc();
    if (!doc) return;
    const data = collectQBPreviewForm();
    // Sync back into the legacy modal fields so send flow works
    setVal('quoteCustFirst', data.custFirstName); setVal('quoteCustLast', data.custLastName);
    setVal('quoteRef', data.ref); setVal('quoteSendDate', data.date);
    setVal('quoteItemsText', data.itemsText); setVal('quoteTotalOverride', data.totalOverride);
    setVal('quoteSendNotes', data.quoteNotes);
    const qi = document.getElementById('quoteIncludePhotos'); if (qi) qi.checked = data.includePhotos;
    quotePreviewed = true;
    openPreview(buildDocHtml(applyDocEdits(doc, data), 'quote', data), 'quote', doc.id || null);
  });

  document.getElementById('qbpSendBtn')?.addEventListener('click', () => {
    document.getElementById('qbpPreviewBtn')?.click();
  });

  document.getElementById('qbpSaveBtn')?.addEventListener('click', () => {
    const doc = getActiveQuoteDoc();
    if (!doc) return;
    const data = collectQBPreviewForm();
    const editedDoc = applyDocEdits(doc, data);
    const newId = uid();
    const q = editedDoc.quote || {};
    const newDoc = {
      id: newId,
      quote: q,
      company: { ...state.company },
      custName: buildCustName(q),
      total: editedDoc.total || calcTotal(q),
      type: editedDoc.type || q.type || 'Estimate',
      date: editedDoc.date || q.date || todayStr(),
      ref: editedDoc.ref || q.ref || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      invoiceSent: false, paid: false, paidAmount: 0, paidDate: '', payments: []
    };
    state.saved.unshift(newDoc);
    save();
    upsertLocalCustomer(q);
    clearDraftQuote();
    updateSavedBadge();
    refreshSavedDocs();
    if (savedDocsSyncReady && lexiSupabase && lexiAuthSession?.user?.id) {
      saveSavedDocsToSupabase().catch(err => console.warn('Sync after save:', err));
    }
    showSavedPopup("Done. I've got it.");
    showPage('page4');
  });
}

function openQuoteModal(docId) {
  withBizCheck(docId, id => {
    activeDocId = id;
    activeQuoteDraftDoc = null;
    const doc = state.saved.find(d => d.id === id);
    if (!doc) return;
    // Silently prime the send form with this doc's data so collectQuoteSendForm()
    // never returns stale values from a different customer (modal stays hidden)
    populateQuoteSendModal(doc, { show: false });
    const html = buildDocHtml(doc, 'quote');
    openPreview(html, 'quote', id);
  });
}

function populateQuoteSendModal(doc, { show = true } = {}) {
  quotePreviewed = false;
  const q = doc.quote || {};
  const label = q.type || doc.type || 'Quote';
  document.getElementById('quoteModalTitle').textContent = label;
  setVal('quoteCustFirst', q.custFirstName || '');
  setVal('quoteCustLast', q.custLastName || '');
  setVal('quoteRef', q.ref || doc.ref || '');
  setVal('quoteSendDate', q.date || doc.date || todayStr());
  setVal('quoteItemsText', (q.items || []).map(i => `${i.name}, ${Number(i.unitPrice || 0).toFixed(2)}`).join('\n'));
  setVal('quoteTotalOverride', (doc.total || calcTotal(q) || 0).toFixed(2));
  // Pre-fill the send notes with the courtesy intro paragraph so it goes as the message body when sharing
  const docTypeLower = (q.type || doc.type || 'quote').toLowerCase();
  const introMsg = `Thank you for allowing me to give you this free, no obligation ${docTypeLower} today. Please find below a full breakdown of the proposed work and costs. There is no pressure and no obligation to proceed. Please read through at your leisure, discuss it with anyone you need to, and let me know if you have any questions.`;
  setVal('quoteSendNotes', introMsg);
  document.getElementById('quoteIncludePhotos').checked = false;
  if (show) document.getElementById('quoteModal').style.display = 'flex';
}

function getActiveQuoteDoc() {
  if (activeDocId) {
    return state.saved.find(d => d.id === activeDocId) || activeQuoteDraftDoc || null;
  }
  return activeQuoteDraftDoc || null;
}

function previewInvoice(docId) {
  withBizCheck(docId, id => {
    activeDocId = id;
    const doc = state.saved.find(d => d.id === id);
    if (!doc) return;
    const invRef     = doc.invoiceRef || doc.ref || nextRef('INV', KEY_INV);
    const _t         = (doc.quote?.selectedTerms || []);
    const _tDays     = _t.includes('payment30') ? 30 : _t.includes('payment14') ? 14 : _t.includes('payment7') ? 7 : 30;
    const _base      = doc.jobCompletedDate || todayStr();
    const dueDate    = doc.invoiceDueDate || addDays(_base, _tDays);
    const html = buildDocHtml(doc, 'invoice', { invRef, invDate: todayStr(), dueDate });
    openPreview(html, 'invoice', id);
  });
}

function openInvoiceModal(docId) {
  activeDocId = docId;
  const doc = state.saved.find(d => d.id === docId);
  if (!doc) return;
  const invRef = doc.invoiceRef || doc.ref || nextRef('INV', KEY_INV);
  const q = doc.quote || {};
  setVal('invRef',     invRef);
  setVal('invDate',    todayStr());
  // Auto-calculate due date: completion date + payment terms days (falls back to today + 30)
  const _terms      = (doc.quote?.selectedTerms || []);
  const _termDays   = _terms.includes('payment30') ? 30 : _terms.includes('payment14') ? 14 : _terms.includes('payment7') ? 7 : 30;
  const _baseDate   = doc.jobCompletedDate || todayStr();
  setVal('invDueDate', doc.invoiceDueDate || addDays(_baseDate, _termDays));
  setVal('invCustFirst', q.custFirstName || '');
  setVal('invCustLast', q.custLastName || '');
  const storedMethods = Array.isArray(doc.invoicePayMethods) ? doc.invoicePayMethods
    : (doc.invoicePayMethod ? [doc.invoicePayMethod] : []);
  document.querySelectorAll('input[name="invPayMethod"]').forEach(cb => {
    cb.checked = storedMethods.includes(cb.value);
  });
  document.getElementById('invIncludePhotos').checked = false;
  setVal('invNotes',   '');
  document.getElementById('invoiceModal').style.display = 'flex';
  renderInvJobPicker(doc);
}

function openReceiptModal(docId) {
  activeDocId = docId;
  receiptPreviewed = false;
  const doc = state.saved.find(d => d.id === docId);
  if (!doc) return;
  const payments  = getDocPayments(doc);
  const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const q = doc.quote || {};
  // Reuse existing receiptRef if the receipt was already sent; otherwise generate a new one
  const recRef = doc.receiptRef || nextRef('REC', KEY_REC);
  setVal('recRef',     recRef);
  setVal('recCustFirst', q.custFirstName || '');
  setVal('recCustLast', q.custLastName || '');
  setVal('recAmount', (totalPaid > 0 ? totalPaid : (doc.total || 0)).toFixed(2));
  setVal('recDate',   todayStr());
  // Pre-fill payment split checkboxes and amounts
  const storedSplit = Array.isArray(doc.receiptPaySplit) ? doc.receiptPaySplit
    : (doc.receiptMethod ? [{ method: doc.receiptMethod, amount: totalPaid || doc.total || 0 }] : []);
  document.querySelectorAll('input[name="recPayMethod"]').forEach(cb => {
    const entry = storedSplit.find(s => s.method === cb.value);
    cb.checked = !!entry;
    const amtEl = document.querySelector(`input[name="recPayAmt"][data-method="${cb.value}"]`);
    if (amtEl) amtEl.value = entry ? (entry.amount || '') : '';
  });
  document.getElementById('recIncludePhotos').checked = false;
  setVal('recNotes',  '');
  document.getElementById('receiptModal').style.display = 'flex';
}

function refreshActiveDashboard() {
  if (!activeCustomerGroup) return;
  try {
    const groups = buildCustomerGroups();
    const updated = groups.find(g => g.docs.some(d => d.id === activeDocId)) || activeCustomerGroup;
    activeCustomerGroup = updated;
    renderSingleCustomerDashboard(updated, groups);
  } catch(e) { console.error('Dashboard refresh error:', e); }
}

// Called when the Money In modal is closed without logging -re-shows the customer
// dashboard (which was hidden by executeCustomerEdit before opening Money In).
function reopenDashboardAfterMoneyIn() {
  if (!activeCustomerGroup) return;
  try {
    const groups = buildCustomerGroups();
    const updated = groups.find(g => g.docs.some(d => d.id === activeDocId)) || activeCustomerGroup;
    activeCustomerGroup = updated;
    renderSingleCustomerDashboard(updated, groups);
    document.getElementById('customerDashboardModal').style.display = 'flex';
  } catch(e) { console.error('Dashboard reopen error:', e); }
}

// Updates only the totals rows inside mpPrevInfo -does NOT replace the whole innerHTML,
// so edit inputs and delete buttons remain intact and clickable.
function refreshMpTotalsOnly(doc) {
  const payments  = doc.payments || [];
  const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const remaining = Math.max(0, (doc.total || 0) - totalPaid);
  const prevInfo  = document.getElementById('mpPrevInfo');
  if (!prevInfo) return;
  const totalStrong = prevInfo.querySelector('.mp-totals-divider strong');
  if (totalStrong) totalStrong.textContent = fmtPrice(totalPaid);
  const outstandingStrong = prevInfo.querySelector('.mp-prev-row:not(.mp-totals-divider) strong');
  if (outstandingStrong) outstandingStrong.textContent = fmtPrice(remaining);
  // Keep the new-payment prefill in sync
  setVal('mpAmount', remaining > 0 ? remaining.toFixed(2) : '');
}

function renderMpPrevInfo() {
  const doc = state.saved.find(d => d.id === activeDocId);
  if (!doc) return;
  // Ensure doc.payments is always a real array (migrate legacy scalar)
  if (!Array.isArray(doc.payments)) doc.payments = getDocPayments(doc);
  const payments  = doc.payments;
  sortPaymentsByDate(payments);
  const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const total     = doc.total || 0;
  const remaining = Math.max(0, total - totalPaid);
  const prevInfo  = document.getElementById('mpPrevInfo');
  if (!prevInfo) return;

  if (payments.length === 0) {
    prevInfo.style.display = 'none';
    const addLabel = document.getElementById('mpAddLabel');
    if (addLabel) addLabel.style.display = 'none';
    return;
  }

  prevInfo.style.display = 'block';
  prevInfo.innerHTML =
    payments.map((p, i) => `
      <div class="mp-edit-row">
        <span class="mp-edit-label">Payment ${i + 1}</span>
        <div class="mp-edit-fields">
          <div class="input-pfx mp-edit-pfx">
            <span class="pfx-symbol">£</span>
            <input type="number" class="mp-edit-val" data-idx="${i}" value="${p.amount != null ? p.amount : ''}" min="0" step="any" placeholder="0.00">
          </div>
          <input type="date" class="mp-edit-date" data-idx="${i}" value="${p.date || ''}">
          <button type="button" class="mp-delete-btn" data-idx="${i}" aria-label="Delete payment ${i + 1}">×</button>
        </div>
      </div>`).join('') +
    `<div class="mp-prev-row mp-totals-divider">
       <span>Total paid:</span><span><strong>${fmtPrice(totalPaid)}</strong></span>
     </div>
     <div class="mp-prev-row">
       <span>Still outstanding:</span><span><strong style="color:var(--walnut)">${fmtPrice(remaining)}</strong></span>
     </div>`;

  // Wire amount edits -update totals in-place (no innerHTML replace) so that
  // a pending click on the delete button is never interrupted by a DOM rebuild.
  prevInfo.querySelectorAll('.mp-edit-val').forEach(inp => {
    inp.addEventListener('change', () => {
      const freshDoc = state.saved.find(d => d.id === activeDocId);
      if (!freshDoc) return;
      const idx = parseInt(inp.dataset.idx);
      if (!freshDoc.payments[idx]) return;
      freshDoc.payments[idx].amount = parseFloat(inp.value) || 0;
      recalcDocPayments(freshDoc);
      save();
      refreshSavedDocs();
      refreshMpTotalsOnly(freshDoc);   // in-place totals update -keeps delete buttons alive
    });
  });

  // Wire date edits -same: in-place update only
  prevInfo.querySelectorAll('.mp-edit-date').forEach(inp => {
    inp.addEventListener('change', () => {
      const freshDoc = state.saved.find(d => d.id === activeDocId);
      if (!freshDoc) return;
      const idx = parseInt(inp.dataset.idx);
      if (!freshDoc.payments[idx]) return;
      freshDoc.payments[idx].date = inp.value;
      recalcDocPayments(freshDoc);
      save();
      refreshSavedDocs();
      refreshMpTotalsOnly(freshDoc);   // in-place totals update -keeps delete buttons alive
    });
  });

  // Wire delete buttons -full re-render is fine here since delete is the action
  prevInfo.querySelectorAll('.mp-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const freshDoc = state.saved.find(d => d.id === activeDocId);
      if (!freshDoc) return;
      const idx = parseInt(btn.dataset.idx);
      freshDoc.payments.splice(idx, 1);
      recalcDocPayments(freshDoc);
      save();
      refreshSavedDocs();
      renderMpPrevInfo();
      // Clear the "Add payment" form -the deletion is already saved.
      // Leaving it pre-filled risks the user accidentally logging a duplicate payment.
      setVal('mpAmount', '');
      showSavedPopup('Removed. All updated.');
    });
  });

  // Show "Add another payment" label whenever the history section is visible
  const addLabel = document.getElementById('mpAddLabel');
  if (addLabel) addLabel.style.display = 'block';
}

function openMarkPaid(docId) {
  activeDocId = docId;
  const doc = state.saved.find(d => d.id === docId);
  if (!doc) return;

  const titleEl = document.getElementById('markPaidTitle');
  if (titleEl) titleEl.textContent = 'Money In';

  renderMpPrevInfo();

  // Pre-fill the new-payment row with remaining balance (or total if no payments yet)
  if (!Array.isArray(doc.payments)) doc.payments = getDocPayments(doc);
  const totalPaid = doc.payments.reduce((s, p) => s + (p.amount || 0), 0);
  const total     = doc.total || 0;
  const remaining = Math.max(0, total - totalPaid);
  setVal('mpAmount', (remaining > 0 ? remaining : total).toFixed(2));
  setVal('mpDate', todayStr());
  document.getElementById('markPaidModal').style.display = 'flex';
}

function openEditPayments(docId) {
  activeDocId = docId;
  const doc = state.saved.find(d => d.id === docId);
  if (!doc) return;
  // Migrate legacy single-payment docs
  if (!Array.isArray(doc.payments)) doc.payments = getDocPayments(doc);
  renderEditPaymentsList(doc);
  // Pre-fill date and reset payment type toggle
  setVal('epAddDate', todayStr());
  resetEpType();
  document.getElementById('epAddAmount').value = '';
  document.getElementById('editPaymentsModal').style.display = 'flex';
}

function renderEditPaymentsList(doc) {
  const listEl = document.getElementById('editPaymentsList');
  if (!listEl) return;
  const payments    = doc.payments || [];
  sortPaymentsByDate(payments);
  const totalPaid   = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const outstanding = Math.max(0, (doc.total || 0) - totalPaid);

  if (!payments.length) {
    listEl.innerHTML = '<p style="text-align:center;opacity:0.5;padding:20px 0;font-size:0.9rem">No payments recorded.</p>';
    return;
  }

  listEl.innerHTML =
    payments.map((p, i) => `
      <div class="edit-payment-row">
        <span class="ep-amount">${fmtPrice(p.amount)}</span>
        <span class="ep-date">${formatDate(p.date)}</span>
        <button type="button" class="btn-delete-payment" data-idx="${i}" aria-label="Delete payment ${i + 1}">✕</button>
      </div>`).join('') +
    `<div class="ep-summary-row">
       <span>Total paid</span><strong>${fmtPrice(totalPaid)}</strong>
     </div>
     ${outstanding > 0 ? `<div class="ep-summary-row ep-outstanding">
       <span>Outstanding</span><strong>${fmtPrice(outstanding)}</strong>
     </div>` : ''}`;

  listEl.querySelectorAll('.btn-delete-payment').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      doc.payments.splice(idx, 1);
      recalcDocPayments(doc);
      save();
      queueSavedDocsSync(true);
      refreshSavedDocs();
      renderEditPaymentsList(doc);
    });
  });
}

function collectInvoiceForm() {
  const payMethods = [...document.querySelectorAll('input[name="invPayMethod"]:checked')].map(cb => cb.value);
  const items = [];
  document.querySelectorAll('#invItemsList .jde-item-row').forEach(row => {
    const name  = (row.querySelector('.jde-item-name')?.value || '').trim();
    const price = parseFloat(row.querySelector('.jde-item-price')?.value) || 0;
    if (name || price) items.push({ id: uid(), name, unitPrice: price, unit: '', qty: 1 });
  });
  return {
    invRef:    getVal('invRef'),
    invDate:   getVal('invDate'),
    dueDate:   getVal('invDueDate'),
    custFirstName: getVal('invCustFirst'),
    custLastName:  getVal('invCustLast'),
    items,
    totalOverride: getVal('invTotalOverride'),
    payMethods,
    payMethod: payMethods[0] || '',   // legacy single-value compat
    includePhotos: document.getElementById('invIncludePhotos')?.checked || false,
    notes:     getVal('invNotes')
  };
}

function collectQuoteSendForm() {
  return {
    custFirstName: getVal('quoteCustFirst'),
    custLastName:  getVal('quoteCustLast'),
    ref: getVal('quoteRef'),
    date: getVal('quoteSendDate'),
    itemsText: getVal('quoteItemsText'),
    totalOverride: getVal('quoteTotalOverride'),
    quoteNotes: getVal('quoteSendNotes'),
    includePhotos: document.getElementById('quoteIncludePhotos')?.checked || false
  };
}

function collectReceiptForm() {
  const paySplit = [];
  document.querySelectorAll('input[name="recPayMethod"]:checked').forEach(cb => {
    const amtEl = document.querySelector(`input[name="recPayAmt"][data-method="${cb.value}"]`);
    paySplit.push({ method: cb.value, amount: parseFloat(amtEl?.value) || 0 });
  });
  const method = paySplit.map(p => p.method).join(', ');
  return {
    recRef:        getVal('recRef'),
    custFirstName: getVal('recCustFirst'),
    custLastName:  getVal('recCustLast'),
    amount:        getVal('recAmount'),
    date:          getVal('recDate'),
    paySplit,
    method,        // flattened string for legacy compat
    includePhotos: document.getElementById('recIncludePhotos')?.checked || false,
    notes:         getVal('recNotes')
  };
}

function applyDocEdits(doc, data = {}) {
  const edited = {
    ...doc,
    quote: {
      ...(doc.quote || {}),
      items: ((doc.quote || {}).items || []).map(i => ({ ...i }))
    }
  };
  const q = edited.quote;
  // Only overwrite name if the new value is non-empty -empty form fields must never erase a saved name
  if ('custFirstName' in data) q.custFirstName = data.custFirstName || q.custFirstName || '';
  if ('custLastName'  in data) q.custLastName  = data.custLastName  || q.custLastName  || '';
  if ('ref' in data) {
    q.ref = data.ref || q.ref || doc.ref || doc.document_number || '';
    edited.ref = q.ref;
  }
  if ('date' in data) {
    q.date = data.date || q.date || doc.date || toSupabaseDate(doc.createdAt) || todayStr();
    edited.date = q.date;
  }
  // quoteNotes from the quote modal is the share message body only - do not overwrite document notes
  edited.custName = buildCustName(q);

  if (data.items != null && Array.isArray(data.items) && data.items.length) {
    q.items = data.items;
  } else if (data.itemsText != null) {
    const parsed = parseEditableItems(data.itemsText);
    if (parsed.length) q.items = parsed;
  }
  if (data.totalOverride !== undefined && data.totalOverride !== '') {
    const total = parseFloat(data.totalOverride);
    if (!isNaN(total)) edited.total = total;
  } else {
    edited.total = calcTotal(q);
  }
  return edited;
}

function parseEditableItems(text) {
  return String(text || '').split(/\r?\n/).map(line => {
    const parts = line.split(',');
    const name = (parts[0] || '').trim();
    const price = parseFloat((parts[1] || '').replace(/[£,]/g, '').trim());
    if (!name) return null;
    return { id: uid(), name, unitPrice: isNaN(price) ? 0 : price, unit: '', qty: 1 };
  }).filter(Boolean);
}

function recordReceiptPayment(doc, recData) {
  const amount = parseFloat(recData.amount) || 0;
  if (amount <= 0) return;
  if (!Array.isArray(doc.payments)) doc.payments = getDocPayments(doc);
  if (doc.total && amount >= doc.total) {
    doc.payments = [{ amount: doc.total, date: recData.date || todayStr(), method: recData.method || '' }];
    recalcDocPayments(doc);
    return;
  }
  const exists = doc.payments.some(p =>
    Math.abs((p.amount || 0) - amount) < 0.01 &&
    (p.date || '') === (recData.date || todayStr()) &&
    (p.method || '') === (recData.method || '')
  );
  if (!exists) doc.payments.push({ amount, date: recData.date || todayStr(), method: recData.method || '' });
  recalcDocPayments(doc);
}

function openEditChoice(docId) {
  // Always use the full customer edit choice modal so users get all options
  // regardless of whether they arrived from the dashboard or the send flow.
  activeEditChoiceDocId = docId;
  activeEditDocId = docId;
  // Ensure activeCustomerGroup is set so the full modal's handlers work
  if (!activeCustomerGroup) {
    const groups = buildCustomerGroups();
    const group  = groups.find(g => g.docs.some(d => d.id === docId));
    if (group) {
      activeCustomerGroup = group;
    } else {
      // Fallback: build a minimal group from the doc alone
      const doc = state.saved.find(d => d.id === docId);
      if (doc) activeCustomerGroup = { docs: [doc], key: docId };
    }
  }
  openCustomerEditChoice(docId);
}

/* Opens the customer details edit modal without needing a customer dashboard group */
function openCustomerDetailsEditStandalone(docId) {
  const doc = state.saved.find(d => d.id === docId);
  if (!doc) return;
  activeEditChoiceDocId = docId;
  // Temporarily set group so openCustomerDetailsEdit doesn't bail out
  const wasGroup = activeCustomerGroup;
  if (!activeCustomerGroup) {
    activeCustomerGroup = { docs: [doc], key: doc.id };
  }
  activeEditDocId = docId;
  openCustomerDetailsEdit(docId);
  if (!wasGroup) activeCustomerGroup = null; // restore after the modal opens
}

/* Payment type toggle for editPaymentsModal */
let _epPaymentType = 'full';

function resetEpType() {
  _epPaymentType = 'full';
  const sel = document.getElementById('epPaymentType');
  if (sel) sel.value = 'full';
}

function paymentTypeLabel(type) {
  if (type === 'deposit') return 'Deposit';
  if (type === 'part')    return 'Part Payment';
  return 'Payment';
}

function paymentTypeDocLabel(type) {
  if (type === 'deposit') return 'Deposit Received';
  if (type === 'part')    return 'Part Payment Received';
  return 'Payment Received';
}

function closePhotosAndReturn() {
  document.getElementById('photosModal').style.display = 'none';
  // If photos were opened from the customer dashboard, go back to it
  if (activeCustomerGroup) {
    const groups = buildCustomerGroups();
    const group = groups.find(g => g.docs.some(d => d.id === activePhotoDocId)) || activeCustomerGroup;
    activeCustomerGroup = group;
    document.getElementById('customerDashboardModal').style.display = 'flex';
    renderSingleCustomerDashboard(group, groups);
  }
}

function openPhotosModal(docId) {
  activePhotoDocId = docId;
  const doc = state.saved.find(d => d.id === docId);
  if (!doc) return;
  if (!doc.photos) doc.photos = { before: [], after: [] };
  document.getElementById('beforePhotosInput').value = '';
  document.getElementById('afterPhotosInput').value = '';
  renderPhotosPreview(doc);
  const pm = document.getElementById('photosModal');
  pm.style.display = 'flex';
  pm.style.zIndex  = '700';
}

function handlePhotoUpload(e, which) {
  const doc = state.saved.find(d => d.id === activePhotoDocId);
  if (!doc) return;
  if (!doc.photos) doc.photos = { before: [], after: [] };
  const files = [...(e.target.files || [])].slice(0, 3);
  Promise.all(files.map(fileToDataUrl)).then(urls => {
    doc.photos[which] = urls.slice(0, 3);
    save();
    renderPhotosPreview(doc);
  });
}

function fileToDataUrl(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = ev => resolve(ev.target.result);
    reader.readAsDataURL(file);
  });
}

function renderPhotosPreview(doc) {
  const render = (id, list) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = (list || []).map(src => `<img src="${src}" alt="Job photo">`).join('') ||
      '<p class="photo-empty">No photos added yet.</p>';
  };
  render('beforePhotosPreview', doc.photos?.before || []);
  render('afterPhotosPreview', doc.photos?.after || []);
}

function rememberPreviewChoice() {
  if (document.getElementById('dontShowPreviewFirst')?.checked) {
    localStorage.setItem(KEY_PREVIEW_FIRST_SUPPRESSED, '1');
  }
}

function closePreviewFirstModal() {
  pendingPreviewSend = null;
  document.getElementById('previewFirstModal').style.display = 'none';
}

function createNewCustomerFromPicker() {
  const mode = document.getElementById('clientPickerList')?.dataset.mode || 'invoice';
  document.getElementById('clientPickerModal').style.display = 'none';
  const q = {
    type: mode === 'invoice' ? 'Invoice' : 'Receipt',
    custTitle: '', custFirstName: '', custLastName: '',
    custAddr: '', custPostcode: '', custPhone: '', custEmail: '',
    date: todayStr(), validFor: '14', validCustom: '',
    ref: buildRef((parseInt(localStorage.getItem(KEY_REF) || '100') || 100) + 1),
    items: [{ id: uid(), name: 'Job', unitPrice: 0, unit: '', qty: 1 }],
    vatRate: '0', vatCustom: '', discount: '0',
    notes: '', privateNotes: '', selectedTerms: [], customTerms: '',
    authSig: '', custSig: '', sigDate: ''
  };
  const doc = {
    id: uid(),
    quote: q,
    company: { ...state.company },
    custName: '',
    total: 0,
    type: q.type,
    date: q.date,
    ref: q.ref,
    invoiceSent: false,
    paid: false,
    paidAmount: 0,
    paidDate: '',
    payments: [],
    photos: { before: [], after: [] }
  };
  state.saved.unshift(doc);
  save();
  updateSavedBadge();
  refreshSavedDocs();
  if (mode === 'receipt') openReceiptModal(doc.id);
  else openInvoiceModal(doc.id);
}

/* ===== SEND CHOICE ===== */
const BIZ_SECTIONS  = ['contact', 'phone', 'companyNum', 'vatNum'];
const PAY_SECTIONS  = ['bank', 'paypal', 'cash', 'other'];
const SOCIAL_SECTIONS = ['facebook', 'instagram', 'twitter'];
let shareBackActive = false;

function setShareBackButtons(active) {
  shareBackActive = !!active;
  document.querySelectorAll('.share-back-btn').forEach(btn => {
    btn.style.display = shareBackActive ? 'inline-flex' : 'none';
  });
}

function closeShareDetailModals() {
  document.getElementById('bizInfoModal').style.display = 'none';
  document.getElementById('quickQrModal').style.display = 'none';
}

function backToSendChoiceModal() {
  setShareBackButtons(false);
  closeShareDetailModals();
  document.getElementById('quoteModal').style.display = 'none';
  document.getElementById('invoiceModal').style.display = 'none';
  document.getElementById('receiptModal').style.display = 'none';
  const preview = document.getElementById('previewModal');
  if (preview) {
    preview.style.display = 'none';
    preview.classList.remove('modal-front');
  }
  openSendChoiceModal();
}

function goToEditMyBusinessFromModal() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none');
  activeCustomerGroup = null;
  showPage('page1');
}

function goToQrUploadFromModal() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none');
  if (typeof closeMenu === 'function') closeMenu();
  showPage('page1');
  setTimeout(() => {
    const qrArea = document.getElementById('qrUploadArea');
    if (qrArea) {
      qrArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
      qrArea.focus?.();
    }
    toast('Upload your QR code here, then I can show it or send it for you.', 'info');
  }, 250);
}

function returnToPendingQrView() {
  if (!pendingQrReturnContext) return;
  const { fromShare } = pendingQrReturnContext;
  pendingQrReturnContext = null;
  setTimeout(() => {
    openQuickQrModal(!!fromShare);
  }, 450);
}

function openMissingQrPrompt(fromShare = false) {
  pendingQrReturnContext = { fromShare: !!fromShare };
  document.getElementById('quickQrModal').style.display = 'none';
  document.getElementById('sendChoiceModal').style.display = 'none';
  const modal = document.getElementById('missingQrModal');
  if (modal) modal.style.display = 'flex';
}

function setupMissingHtml(typeLabel) {
  return `
    <div class="share-empty-setup">
      <p>No ${esc(typeLabel)} saved yet.</p>
      <small>Add it from Edit My Business and I'll keep it ready for next time.</small>
      <button type="button" class="btn btn-primary" onclick="goToEditMyBusinessFromModal()">Go to Edit My Business</button>
    </div>`;
}

function latestCustomerDocForShare(kind) {
  const docs = activeCustomerGroup?.docs?.length
    ? activeCustomerGroup.docs
    : (activeDocId ? state.saved.filter(d => d.id === activeDocId) : []);
  if (!docs.length) return null;
  const ordered = [...docs].sort((a, b) => getDocTimestamp(b) - getDocTimestamp(a));
  if (kind === 'estimate') {
    return ordered.find(d => {
      const type = String(d.type || d.quote?.type || '').toLowerCase();
      return type === 'estimate' || type === 'quote';
    }) || ordered[0];
  }
  if (kind === 'invoice') {
    return ordered.find(d => d.invoiceSent || String(d.type || '').toLowerCase() === 'invoice') || ordered[0];
  }
  if (kind === 'receipt') {
    return ordered.find(d => d.paid || String(d.type || '').toLowerCase() === 'receipt' || getDocPayments(d).length) || ordered[0];
  }
  return ordered[0];
}

function getDocTimestamp(doc) {
  const candidates = [
    doc.updatedAt, doc.updated_at, doc.createdAt, doc.created_at,
    doc.date, doc.quote?.date, doc.invoiceDate, doc.paidDate
  ].filter(Boolean);
  for (const value of candidates) {
    const time = new Date(value).getTime();
    if (!Number.isNaN(time)) return time;
  }
  return 0;
}

function openShareDocument(kind) {
  const doc = latestCustomerDocForShare(kind);
  document.getElementById('sendChoiceModal').style.display = 'none';
  if (!doc) {
    toast('No saved document found for this customer yet.', 'error');
    return;
  }
  setShareBackButtons(true);
  document.getElementById('customerDashboardModal').style.display = 'none';
  if (kind === 'estimate') openQuoteModal(doc.id);
  else if (kind === 'invoice') previewInvoice(doc.id);
  else if (kind === 'receipt') handleReceiptRequest(doc.id);
}

function openSendChoiceModal() {
  resetSendChoiceGroups();
  document.getElementById('sendChoiceModal').style.display = 'flex';
}

function resetSendChoiceGroups() {
  const categories = document.getElementById('sendChoiceCategories');
  if (categories) categories.hidden = false;
  document.getElementById('sendChoiceDocumentsGroup')?.setAttribute('hidden', '');
  document.getElementById('sendChoiceBusinessGroup')?.setAttribute('hidden', '');
  document.getElementById('sendChoiceCustomerDocuments')?.classList.remove('active');
  document.getElementById('sendChoiceBusinessInfo')?.classList.remove('active');
}

function revealSendChoiceGroup(groupId) {
  const docs = document.getElementById('sendChoiceDocumentsGroup');
  const biz = document.getElementById('sendChoiceBusinessGroup');
  const categories = document.getElementById('sendChoiceCategories');
  const docsBtn = document.getElementById('sendChoiceCustomerDocuments');
  const bizBtn = document.getElementById('sendChoiceBusinessInfo');
  if (categories) categories.hidden = true;
  if (docs) docs.hidden = groupId !== 'documents';
  if (biz) biz.hidden = groupId !== 'business';
  docsBtn?.classList.toggle('active', groupId === 'documents');
  bizBtn?.classList.toggle('active', groupId === 'business');
}

function setupSendChoice() {
  document.getElementById('closeSendChoiceBtn')?.addEventListener('click', () => {
    document.getElementById('sendChoiceModal').style.display = 'none';
    setShareBackButtons(false);
  });
  document.getElementById('sendChoiceModal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) {
      e.currentTarget.style.display = 'none';
      setShareBackButtons(false);
    }
  });
  document.getElementById('sendChoiceCustomerDocuments')?.addEventListener('click', () => {
    revealSendChoiceGroup('documents');
  });
  document.getElementById('sendChoiceBusinessInfo')?.addEventListener('click', () => {
    revealSendChoiceGroup('business');
  });
  document.querySelectorAll('[data-send-choice-back]').forEach(btn => {
    btn.addEventListener('click', resetSendChoiceGroups);
  });
  document.getElementById('sendChoiceEstimate')?.addEventListener('click', () => {
    openShareDocument('estimate');
  });
  document.getElementById('sendChoiceInvoice')?.addEventListener('click', () => {
    openShareDocument('invoice');
  });
  document.getElementById('sendChoiceReceipt')?.addEventListener('click', () => {
    openShareDocument('receipt');
  });
  document.getElementById('sendChoiceBusiness')?.addEventListener('click', () => {
    document.getElementById('sendChoiceModal').style.display = 'none';
    setShareBackButtons(false);
    openBizInfoModal('business');
  });
  document.getElementById('sendChoicePayment')?.addEventListener('click', () => {
    document.getElementById('sendChoiceModal').style.display = 'none';
    setShareBackButtons(false);
    openBizInfoModal('payment');
  });
  document.getElementById('sendChoiceSocialQr')?.addEventListener('click', () => {
    document.getElementById('sendChoiceModal').style.display = 'none';
    setShareBackButtons(false);
    openBizInfoModal('social');
  });
  document.getElementById('sendChoiceQr')?.addEventListener('click', () => {
    document.getElementById('sendChoiceModal').style.display = 'none';
    setShareBackButtons(true);
    openQuickQrModal(true);
  });
  document.getElementById('sendChoiceQuals')?.addEventListener('click', () => {
    document.getElementById('sendChoiceModal').style.display = 'none';
    setShareBackButtons(false);
    openBizInfoModal('qualifications');
  });
}

/* ===== SEND MY BUSINESS INFO ===== */

function bizInfoSections() {
  // Returns an array of section descriptors for all info the user has entered.
  // Each section: { id, label, text, checked }
  const c = state.company;
  const methods = c.payMethods || [];
  const bizName = (c.businessName || `${c.firstName || ''} ${c.lastName || ''}`.trim()).trim();
  const sections = [];

  // ── Business contact details ─────────────────────────────────
  const contactLines = [bizName];
  if (c.address)   contactLines.push(c.address);
  if (c.postcode)  contactLines.push(c.postcode);
  if (c.email)     contactLines.push(c.email);
  if (c.website)   contactLines.push(c.website);
  const cleanContactLines = contactLines.filter(Boolean);
  if (cleanContactLines.length) {
    sections.push({
      id: 'contact',
      label: `Business Name & Address${c.email ? ' / Email' : ''}${c.website ? ' / Website' : ''}`,
      text: cleanContactLines.join('\n'),
      checked: false
    });
  }

  // ── Phone ────────────────────────────────────────────────────
  if (c.phone) {
    sections.push({ id: 'phone', label: `Phone:  ${c.phone}`, text: `Phone: ${c.phone}`, checked: false });
  }

  // ── Company / Registration number ────────────────────────────
  if (c.companyNumber) {
    sections.push({ id: 'companyNum', label: `Company Number:  ${c.companyNumber}`, text: `Company / Registration Number: ${c.companyNumber}`, checked: false });
  }

  // ── VAT Registration number ──────────────────────────────────
  if (c.vatNumber) {
    sections.push({ id: 'vatNum', label: `VAT Reg No:  ${c.vatNumber}`, text: `VAT Registration Number: ${c.vatNumber}`, checked: false });
  }

  const socialLinks = c.socialLinks || {};
  if (socialLinks.facebook) {
    sections.push({ id: 'facebook', label: `Facebook:  ${socialLinks.facebook}`, text: `Facebook: ${socialLinks.facebook}`, checked: true });
  }
  if (socialLinks.instagram) {
    sections.push({ id: 'instagram', label: `Instagram:  ${socialLinks.instagram}`, text: `Instagram: ${socialLinks.instagram}`, checked: true });
  }
  if (socialLinks.twitter) {
    sections.push({ id: 'twitter', label: `X / Twitter:  ${socialLinks.twitter}`, text: `X / Twitter: ${socialLinks.twitter}`, checked: true });
  }
  if (c.qrCode) {
    sections.push({ id: 'qrCode', label: 'QR Code', text: 'I have a QR code ready to scan.', checked: false });
  }

  // ── Bank transfer ────────────────────────────────────────────
  if (methods.includes('bank') && c.bankAcc) {
    const bankLines = ['Bank Transfer'];
    if (c.bankAccHolder) bankLines.push(`Account Name: ${c.bankAccHolder}`);
    if (c.bankName)      bankLines.push(`Bank: ${c.bankName}`);
    if (c.bankSort)      bankLines.push(`Sort Code: ${c.bankSort}`);
    bankLines.push(`Account Number: ${c.bankAcc}`);
    sections.push({ id: 'bank', label: 'Bank Transfer details', text: bankLines.join('\n'), checked: false });
  }

  // ── PayPal ───────────────────────────────────────────────────
  if (methods.includes('paypal') && c.paypalRef) {
    sections.push({ id: 'paypal', label: `PayPal:  ${c.paypalRef}`, text: `PayPal: ${c.paypalRef}`, checked: false });
  }

  // ── Cash ─────────────────────────────────────────────────────
  if (methods.includes('cash')) {
    sections.push({ id: 'cash', label: 'Cash on Completion', text: 'Cash on Completion accepted', checked: false });
  }

  // ── Other payment method ─────────────────────────────────────
  if (methods.includes('other') && c.payOther) {
    sections.push({ id: 'other', label: c.payOther, text: c.payOther, checked: false });
  }

  return sections;
}

function buildBizInfoText() {
  const parts = [];
  document.querySelectorAll('#bizInfoOptions input[type="checkbox"]:checked').forEach(cb => {
    const text = cb.dataset.text;
    if (text) parts.push(text);
  });
  return parts.join('\n\n') || 'No items selected.';
}

function updateBizInfoPreview() {
  setVal('bizInfoShareText', buildBizInfoText());
}

function openBizInfoModal(filter) {
  // filter: 'business' | 'payment' | 'social' | 'qualifications' | undefined (all)
  const allSections = bizInfoSections();
  const container   = document.getElementById('bizInfoOptions');
  const titleEl     = document.querySelector('#bizInfoModal .modal-title');
  const previewWrap = document.getElementById('bizInfoPreviewWrap');
  const footerEl    = document.querySelector('#bizInfoModal .modal-footer');
  if (!container) return;

  // Qualifications-only view -no text preview needed
  if (filter === 'qualifications') {
    const quals = state.company.qualifications || [];
    if (titleEl) titleEl.textContent = 'My Qualifications';
    container.innerHTML = quals.length === 0
      ? setupMissingHtml('qualifications')
      : quals.map((q, i) => `
          <div class="biz-info-qual-row">
            <span class="biz-info-qual-name" title="${esc(q.name)}">${esc(q.name)}</span>
            <div class="biz-info-qual-btns">
              <button type="button" class="btn btn-sm btn-outline" onclick="viewQual(${i})">View</button>
              <button type="button" class="btn btn-sm btn-primary" onclick="shareQual(${i})">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>Share
              </button>
            </div>
          </div>`).join('');
    if (previewWrap) previewWrap.style.display = 'none';
    if (footerEl)    footerEl.style.display    = 'none';
    document.getElementById('bizInfoModal').style.display = 'flex';
    return;
  }

  // Text-based view -filter sections
  if (previewWrap) previewWrap.style.display = '';
  if (footerEl)    footerEl.style.display    = '';

  let sections = allSections;
  if (filter === 'business') {
    sections = allSections.filter(s => BIZ_SECTIONS.includes(s.id));
    if (titleEl) titleEl.textContent = 'Send Business Details';
  } else if (filter === 'payment') {
    sections = allSections.filter(s => PAY_SECTIONS.includes(s.id));
    if (titleEl) titleEl.textContent = 'Send Payment Details';
  } else if (filter === 'social') {
    sections = allSections.filter(s => SOCIAL_SECTIONS.includes(s.id));
    if (titleEl) titleEl.textContent = 'Send Social Media';
  } else {
    if (titleEl) titleEl.textContent = 'Send My Business Info';
  }

  if (sections.length === 0) {
    const detailType = filter === 'payment' ? 'payment details' : filter === 'social' ? 'social media links' : 'business details';
    container.innerHTML = setupMissingHtml(detailType);
    if (previewWrap) previewWrap.style.display = 'none';
    if (footerEl)    footerEl.style.display    = 'none';
    document.getElementById('bizInfoModal').style.display = 'flex';
    return;
  }

  container.innerHTML = `
    <label class="checkbox-label biz-info-check biz-info-select-all">
      <input type="checkbox" id="bizSelectAll"> Select All
    </label>
    <hr style="border:none;border-top:1px solid #eee;margin:4px 0 8px">
    ${sections.map(s => `
    <label class="checkbox-label biz-info-check">
      <input type="checkbox" name="bizInfo" value="${s.id}"
             data-text="${s.text.replace(/"/g, '&quot;')}"
             ${s.checked ? 'checked' : ''}>
      ${s.label}
    </label>`).join('')}`;

  const selectAll = document.getElementById('bizSelectAll');
  if (selectAll) {
    selectAll.addEventListener('change', () => {
      container.querySelectorAll('input[name="bizInfo"]').forEach(cb => cb.checked = selectAll.checked);
      updateBizInfoPreview();
    });
  }

  updateBizInfoPreview();
  document.getElementById('bizInfoModal').style.display = 'flex';
}

function getSocialShareText() {
  const sections = bizInfoSections().filter(s => SOCIAL_SECTIONS.includes(s.id));
  return sections.map(s => s.text).join('\n') || '';
}

async function dataUrlToFile(dataUrl, filename) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const ext = blob.type.includes('png') ? 'png' : blob.type.includes('jpeg') ? 'jpg' : 'png';
  return new File([blob], `${filename}.${ext}`, { type: blob.type || 'image/png' });
}

function updateQrMenuLabel() {
  // Menu label always stays "My QR Code" — business name only appears as the modal title
}

function openQuickQrModal(fromShare = false) {
  const modal = document.getElementById('quickQrModal');
  const content = document.getElementById('quickQrContent');
  const footer = document.getElementById('quickQrFooter');
  const backBtn = document.getElementById('backQuickQrBtn');
  if (!modal || !content) return;

  const qrSrc = state.company.qrCode || '';
  if (!qrSrc) {
    openMissingQrPrompt(fromShare);
    return;
  }

  // Modal title: business name first, owner name if no business name, fallback to My QR Code
  const c = state.company;
  const ownerName  = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  const modalTitle = c.businessName || ownerName || 'My QR Code';

  const titleEl = document.getElementById('quickQrTitle');
  if (titleEl) titleEl.textContent = modalTitle;

  content.innerHTML = `
    <div class="quick-qr-preview">
      <img src="${qrSrc}" alt="QR code">
    </div>`;
  if (footer) footer.style.display = '';
  if (backBtn) backBtn.style.display = fromShare ? '' : 'none';
  modal.style.display = 'flex';
}

async function copyQrInfo() {
  const text = getSocialShareText();
  if (!text) {
    toast('No social links saved yet.', 'error');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Social links copied.', 'success');
  } catch {
    toast('Select and copy your social links manually.', 'info');
  }
}

async function shareQrCode() {
  const qrSrc = state.company.qrCode || '';
  if (!qrSrc) {
    openQuickQrModal();
    return;
  }
  const text = getSocialShareText();
  try {
    const file = await dataUrlToFile(qrSrc, 'lexi-qr-code');
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'My QR Code', text: text || undefined });
      return;
    }
  } catch(e) {
    console.warn('QR share failed', e);
  }
  if (text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('QR shown. Social links copied too.', 'success');
      return;
    } catch(e) {}
  }
  toast('QR code is ready to scan from this screen.', 'success');
}

async function copyBizInfo() {
  const text = getVal('bizInfoShareText');
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard.', 'success');
  } catch {
    toast('Select the text and copy manually.', 'info');
  }
}

async function shareBizInfo() {
  const text = getVal('bizInfoShareText');
  if (navigator.share) {
    try { await navigator.share({ text, title: 'My Business Info' }); return; } catch(e) {}
  }
  copyBizInfo();
}

async function shareLexiApp() {
  const text = 'Hi - I\'m Lexi. I create estimates, quotes, invoices and receipts for tradespeople - faster than you can make a brew, right there on site. I match your brand, make you look professional, and I live on your phone. No faff. No spreadsheets. No more sitting at a laptop at 10pm. Worth two minutes of your time.';
  const url = 'https://www.lexihandlesit.com';
  if (navigator.share) {
    try { await navigator.share({ title: 'Lexi Handles It', text, url }); return; } catch(e) {}
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast('Link copied to clipboard.', 'success');
  } catch {
    toast('Share is not available on this device.', 'error');
  }
}

function openCustomerDashboardForDoc(docId) {
  const groups = buildCustomerGroups();
  const group = groups.find(g => g.docs.some(d => d.id === docId));
  if (!group) return;
  document.getElementById('customerDashboardModal').style.display = 'flex';
  renderSingleCustomerDashboard(group, groups);
}

function openCustomerDashboard() {
  const body = document.getElementById('customerDashboardBody');
  if (!state.saved.length) {
    body.innerHTML = '<p class="cp-empty">No saved customers yet.</p>';
  } else {
    renderCustomerSelector(buildCustomerGroups());
  }
  document.getElementById('customerDashboardModal').style.display = 'flex';
}

function getCustomerDisplayName(doc) {
  const q = doc.quote || {};
  const built = buildCustName(q).trim();
  // NOTE: do NOT fall back to doc.acceptedBy -that is the signer, not the customer
  return built || (doc.custName || '').trim() || 'Customer details missing';
}

function buildCustomerGroups() {
  const groups = new Map();
  state.saved.forEach(doc => {
    const q = doc.quote || {};
    const name = getCustomerDisplayName(doc);
    const contact = (q.custEmail || q.custPhone || q.custPostcode || '').trim().toLowerCase();
    const nameKey = name.toLowerCase();
    const hasRealName = name !== 'Customer details missing';
    const key = hasRealName ? `${nameKey}|${contact}` : `missing|${doc.ref || doc.id}`;
    if (!groups.has(key)) groups.set(key, { name, contact, docs: [] });
    groups.get(key).docs.push(doc);
  });
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function getCustomerTotals(docs) {
  const paid = docs.reduce((s, d) => s + getDocPayments(d).reduce((p, x) => p + (x.amount || 0), 0), 0);
  const total = docs.reduce((s, d) => s + (d.total || 0), 0);
  const refs = docs.map(d => d.invoiceRef || d.ref || d.quote?.ref || 'No ref').filter(Boolean).join(', ');
  return { paid, total, outstanding: Math.max(0, total - paid), refs };
}

function renderCustomerSelector(groups) {
  const body = document.getElementById('customerDashboardBody');
  body.innerHTML = `
    <div class="customer-selector-list">
      ${groups.map((group, idx) => {
        const totals = getCustomerTotals(group.docs);
        return `
          <button type="button" class="customer-selector-row" data-idx="${idx}">
            <span class="customer-selector-name">${esc(group.name)}</span>
            <span class="customer-selector-ref">${esc(totals.refs)}</span>
            <span class="customer-selector-paid">Paid ${fmtPrice(totals.paid)}</span>
            <span class="customer-selector-outstanding">Outstanding ${fmtPrice(totals.outstanding)}</span>
          </button>`;
      }).join('')}
    </div>`;
  body.querySelectorAll('.customer-selector-row').forEach(btn => {
    btn.addEventListener('click', () => renderSingleCustomerDashboard(groups[parseInt(btn.dataset.idx, 10)], groups));
  });
}

function buildCustomerJobSection(d, jobNum = 0) {
  ensureDocumentRefAndDate(d);
  const q = d.quote || {};
  // items may live in q.items or (legacy) d.items
  const items = (q.items && q.items.length ? q.items : null) || (d.items && d.items.length ? d.items : null) || [];
  const subtotal = items.reduce((s, i) => s + (i.unitPrice || 0) * (i.qty || 1), 0);
  const discPct  = parseFloat(q.discount) || 0;
  const discount = subtotal * discPct / 100;
  const afterDisc = subtotal - discount;
  const vatRate  = q.vatRate === 'custom' ? parseFloat(q.vatCustom) || 0 : parseFloat(q.vatRate) || 0;
  const vatAmt   = afterDisc * vatRate / 100;
  const payments = getDocPayments(d);
  const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const outstanding = Math.max(0, (d.total || 0) - totalPaid);
  const isOverdue = !d.paid && d.invoiceSent && d.invoiceDueDate && todayStr() > d.invoiceDueDate;
  const isAccepted = d.acceptStatus === 'accepted' || d.jobAccepted;
  const statusClass = d.paid ? 'paid' : isAccepted ? 'accepted' : isOverdue ? 'overdue' : d.invoiceSent ? 'invoiced' : (q.type || 'estimate').toLowerCase();
  const statusLabel = d.paid ? 'Paid' : isAccepted ? 'Accepted' : isOverdue ? 'Overdue' : d.invoiceSent ? 'Invoiced' : (q.type || 'Estimate');
  const ref = d.invoiceRef || d.receiptRef || q.ref || d.ref || '-';
  const docDate = q.date || d.date || '';
  const photos = d.photos || {};
  const beforePhotos = photos.before || [];
  const afterPhotos  = photos.after  || [];

  const itemsHtml = items.length
    ? items.map(i => `
        <div class="cdv-item-row">
          <span class="cdv-item-name">${esc(i.name)}${i.qty > 1 ? ` <span class="cdv-item-qty">×${i.qty}</span>` : ''}</span>
          <span class="cdv-item-price">${fmtPrice((i.unitPrice || 0) * (i.qty || 1))}</span>
        </div>`).join('')
    : '';

  const totalsHtml = `
    <div class="cdv-totals">
      ${items.length ? `<div class="cdv-total-row"><span>Subtotal</span><span>${fmtPrice(subtotal)}</span></div>` : ''}
      ${discount > 0 ? `<div class="cdv-total-row cdv-discount-row"><span>Discount (${discPct}%)</span><span>-${fmtPrice(discount)}</span></div>` : ''}
      ${vatAmt   > 0 ? `<div class="cdv-total-row cdv-vat-row"><span>VAT (${vatRate}%)</span><span>${fmtPrice(vatAmt)}</span></div>` : ''}
      <div class="cdv-total-row cdv-grand-total"><span>Total</span><span>${fmtPrice(d.total || 0)}</span></div>
    </div>`;

  // Payment due date & dynamic status badge
  const payTerms    = (q.selectedTerms || []);
  const payTermDays = payTerms.includes('payment30') ? 30 : payTerms.includes('payment14') ? 14 : payTerms.includes('payment7') ? 7 : 30;
  const payDueStr   = d.invoiceDueDate || (d.jobCompletedDate ? addDays(d.jobCompletedDate, payTermDays) : '');
  const todayNow    = todayStr();
  let payStatusHtml = '';
  if (outstanding === 0 && totalPaid > 0) {
    payStatusHtml = `<span class="cdv-pay-status cdv-pay-status-paid">Paid in full</span>`;
  } else if (payDueStr && todayNow > payDueStr) {
    payStatusHtml = `<span class="cdv-pay-status cdv-pay-status-overdue">Payment overdue</span>`;
  } else if (payDueStr) {
    payStatusHtml = `<span class="cdv-pay-status cdv-pay-status-due">Due ${formatDate(payDueStr)}</span>`;
  }

  const payIcon = `<svg class="cdv-icon cdv-icon-label" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`;
  const payLabelRow = `<div class="cdv-section-label cdv-section-label-row"><span>${payIcon} Payments <span class="nav-beta-badge">Beta</span></span>${payStatusHtml}</div>`;

  const paymentsHtml = payments.length ? `
    <div class="cdv-section">
      ${payLabelRow}
      ${payments.map((p, i) => `
        <div class="cdv-payment-row">
          <span class="cdv-pay-num">${p.type && p.type !== 'full' ? paymentTypeLabel(p.type) : `Payment ${i + 1}`}</span>
          <span class="cdv-pay-date">${formatDate(p.date)}</span>
          <span class="cdv-pay-amount">${fmtPrice(p.amount)}</span>
        </div>`).join('')}
      ${outstanding > 0
        ? `<div class="cdv-payment-row cdv-outstanding-row"><span class="cdv-pay-num">Outstanding</span><span></span><span class="cdv-pay-amount">${fmtPrice(outstanding)}</span></div>`
        : `<div class="cdv-paid-stamp">✓ Paid in full</div>`}
    </div>` : `
    <div class="cdv-section">
      ${payLabelRow}
      <p class="cdv-empty">No payment recorded yet. To update payment click Update.</p>
    </div>`;

  const notesHtml = q.notes ? `
    <div class="cdv-section">
      <div class="cdv-section-label"><svg class="cdv-icon cdv-icon-label" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> Notes to Customer</div>
      <p class="cdv-note-text">${esc(q.notes)}</p>
    </div>` : '';

  const privateHtml = q.privateNotes ? `
    <div class="cdv-section cdv-private">
      <div class="cdv-section-label"><svg class="cdv-icon cdv-icon-label" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Private Notes</div>
      <p class="cdv-note-text">${esc(q.privateNotes)}</p>
    </div>` : '';

  const photoGroup = (label, list) => list.length ? `
    <div class="cdv-photo-group">
      <div class="cdv-photo-label">${label}</div>
      <div class="cdv-photo-grid">${list.map(src => `<img src="${src}" class="cdv-photo-thumb" alt="${label} photo">`).join('')}</div>
    </div>` : '';
  const photosHtml = (beforePhotos.length || afterPhotos.length) ? `
    <div class="cdv-section">
      <div class="cdv-section-label"><svg class="cdv-icon cdv-icon-label" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> Photos</div>
      ${photoGroup('Before', beforePhotos)}
      ${photoGroup('After', afterPhotos)}
    </div>` : '';

  // Work out which stage rank this doc is currently at
  // Cross-check the saved flags AND q.type so docs created directly as Invoice/Receipt
  // still show the correct step even if the invoiceSent flag wasn't set via the modal.
  const qTypeLower = (q.type || 'Estimate').toLowerCase();
  // Ranks: 0=Estimate,1=Quote,2=Accepted,3=Job Booked,4=Job Started,5=Job Complete,6=Invoiced,7=Paid
  const isAcceptedFlag = d.jobAccepted || d.acceptStatus === 'accepted';
  // Job Started: manual flag OR auto when today has reached the booked start date
  const jobAutoStarted = d.jobStartDate && d.jobStartDate <= todayStr();
  const jobStarted = d.jobStarted || jobAutoStarted;
  const stageRank = d.paid || qTypeLower === 'receipt' || d.receiptRef ? 7
    : (d.invoiceSent || qTypeLower === 'invoice')             ? 6
    : (d.jobCompleted)                                        ? 5
    : jobStarted                                              ? 4
    : (isAcceptedFlag && d.jobStartDate)                      ? 3
    : isAcceptedFlag                                          ? 2
    : (qTypeLower === 'quote')                                ? 1
    :                                                           0;
  // 8 stages: 4 top (left→right), 4 bottom (right→left snake)
  const tubeStages = [
    { label: 'Estimate',      action: 'quote',   cls: 'stage-estimate',   row: 0, col: 0 },
    { label: 'Quote',         action: 'quote',   cls: 'stage-quote',      row: 0, col: 1 },
    { label: 'Accepted',      action: 'quote',   cls: 'stage-accepted',   row: 0, col: 2 },
    { label: 'Job Booked',    action: 'quote',   cls: 'stage-booked',     row: 0, col: 3 },
    { label: 'Job Started',   action: 'quote',   cls: 'stage-started',    row: 1, col: 3 },
    { label: 'Job Complete',  action: 'invoice', cls: 'stage-complete',   row: 1, col: 2 },
    { label: 'Invoiced',      action: 'invoice', cls: 'stage-invoice',    row: 1, col: 1 },
    { label: 'Paid',          action: 'receipt', cls: 'stage-paid',       row: 1, col: 0 },
  ];
  const makeStation = (s, i) => {
    const isDone   = i < stageRank;
    const isActive = i === stageRank;
    const dotCls   = isDone ? 'tube-done' : isActive ? `tube-active ${s.cls}` : 'tube-future';
    const lblCls   = (isDone || isActive) ? 'lit' : '';
    return `<div class="cdv-tube-station">
      <button type="button" class="cdv-tube-dot ${dotCls}"
        data-prog-doc-id="${esc(d.id)}"
        data-prog-action="${s.action}"
        title="${s.label}"></button>
      <span class="cdv-tube-lbl ${lblCls}">${s.label}</span>
    </div>`;
  };
  const makeSeg = (isDone) => `<div class="cdv-tube-seg${isDone ? ' done' : ''}"></div>`;
  // Row 0: stations 0–3 left to right
  const row0 = tubeStages.slice(0,4).map((s,i) => {
    const isDone = i < stageRank;
    return makeStation(s, i) + (i < 3 ? makeSeg(isDone) : '');
  }).join('');
  // Row 1 reversed (DOM): Paid(7), Invoiced(6), Job Complete(5), Job Started(4) — right-to-left visually
  const row2Stages = [...tubeStages.slice(4)].reverse(); // [Paid, Invoiced, JobComplete, JobStarted]
  const row1 = row2Stages.map((s, j) => {
    const realIdx = 7 - j; // 7=Paid, 6=Invoiced, 5=JobComplete, 4=JobStarted
    const segDone = stageRank >= (7 - j);
    return makeStation(s, realIdx) + (j < 3 ? makeSeg(segDone) : '');
  }).join('');
  // Corner: done when stageRank >= 4 (Job Started reached)
  const cornerDone = stageRank >= 4;
  // Warning: job auto-started today — show if date just passed and not manually confirmed
  const autoStartedToday = d.jobStartDate === todayStr() && !d.jobStarted;
  const startWarningHtml = autoStartedToday ? `
    <div class="cdv-start-warning">
      <strong>Your job starts today!</strong> If the date is wrong, update it below before it moves to Job Started.
    </div>` : '';
  const progressionHtml = `
    <div class="cdv-tube-map">
      <div class="cdv-prog-label">Job Status</div>
      ${startWarningHtml}
      <div class="cdv-tube-row">${row0}<div class="cdv-tube-corner-wrap"><div class="cdv-tube-corner${cornerDone ? ' done' : ''}"></div></div></div>
      <div class="cdv-tube-row cdv-tube-row2">${row1}</div>
    </div>`;

  const scheduleHtml = `
    <div class="cdv-job-schedule">
      <div class="cdv-schedule-row">
        <label class="cdv-accepted-label">
          <input type="checkbox" class="cdv-accepted-cb" data-doc-id="${esc(d.id)}"${d.jobAccepted ? ' checked' : ''}>
          Job Accepted
        </label>
        <div class="cdv-start-date-wrap"${!d.jobAccepted ? ' style="display:none"' : ''}>
          <span class="cdv-start-date-label">Date Booked For</span>
          <input type="date" class="cdv-start-date-input" data-doc-id="${esc(d.id)}"
            value="${esc(d.jobStartDate || '')}">
        </div>
      </div>
      <div class="cdv-schedule-row">
        <label class="cdv-accepted-label">
          <input type="checkbox" class="cdv-completed-cb" data-doc-id="${esc(d.id)}"${d.jobCompleted ? ' checked' : ''}>
          Job Completed
        </label>
        <div class="cdv-start-date-wrap"${!(d.jobCompleted && d.jobCompletedDate) ? ' style="display:none"' : ''}>
          <span class="cdv-start-date-label">Date Completed</span>
          <input type="date" class="cdv-completed-date-input" data-doc-id="${esc(d.id)}"
            value="${esc(d.jobCompletedDate || '')}">
        </div>
      </div>
      <div class="cdv-completed-prompt" data-doc-id="${esc(d.id)}"${!(d.jobCompleted && !d.jobCompletedDate) ? ' style="display:none"' : ''}>
        <p class="cdv-prompt-msg">Please tell me when the job was completed so I can help you track when payment is due.</p>
        <div class="cdv-prompt-actions">
          <button type="button" class="cdv-today-btn" data-doc-id="${esc(d.id)}">Today</button>
          <span class="cdv-prompt-or">or select a date</span>
          <input type="date" class="cdv-prompt-date" data-doc-id="${esc(d.id)}">
        </div>
      </div>
    </div>`;
  const acceptanceHtml = isAccepted ? `
    <div class="cdv-accepted-banner">
      <strong>Quote accepted</strong>
      <span>${d.acceptedBy ? `Signed by ${esc(d.acceptedBy)}` : 'Customer has accepted this quote'}${d.acceptedAt ? ` on ${new Date(d.acceptedAt).toLocaleDateString('en-GB')}` : ''}</span>
    </div>` : '';

  const jobActionBtns = `
    <div class="cdv-job-actions">
      <button type="button" class="cdv-action-btn cdv-action-edit" data-prog-doc-id="${esc(d.id)}" data-prog-action="editQuote">✏ Edit Quote</button>
      <button type="button" class="cdv-action-btn cdv-action-invoice" data-prog-doc-id="${esc(d.id)}" data-prog-action="invoice">Invoice</button>
      <button type="button" class="cdv-action-btn cdv-action-receipt" data-prog-doc-id="${esc(d.id)}" data-prog-action="receipt">Receipt</button>
    </div>`;

  return `
    <div class="cdv-job-card">
      <div class="cdv-job-header">
        <div class="cdv-job-meta">
          <span class="cdv-job-ref">${jobNum ? `<span class="cdv-job-num">Job ${jobNum}:</span> ` : ''}${esc(ref)}</span>
          ${docDate ? `<span class="cdv-job-date">${formatDate(docDate)}</span>` : ''}
        </div>
        <button type="button" class="type-badge ${statusClass} cdv-status-btn"
          data-prog-doc-id="${esc(d.id)}" data-prog-action="${statusClass === 'paid' ? 'receipt' : statusClass === 'invoiced' || statusClass === 'overdue' ? 'invoice' : 'quote'}"
          title="Open ${statusLabel}">${esc(statusLabel)}</button>
      </div>
      ${jobActionBtns}
      <div class="cdv-items">${itemsHtml}</div>
      ${totalsHtml}
      ${acceptanceHtml}
      ${progressionHtml}
      ${scheduleHtml}
      ${paymentsHtml}
      ${notesHtml}
      ${privateHtml}
      ${photosHtml}
    </div>`;
}

function renderSingleCustomerDashboard(group, groups) {
  activeCustomerGroup = group;
  const body = document.getElementById('customerDashboardBody');
  const firstDoc = group.docs[0];
  const q = firstDoc.quote || {};
  const totals = getCustomerTotals(group.docs);

  // Contact details
  const iconPin  = `<svg class="cdv-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
  const iconPhone = `<svg class="cdv-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.6 3.44 2 2 0 0 1 3.57 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.82a16 16 0 0 0 6.29 6.29l1.12-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;
  const iconMail  = `<svg class="cdv-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`;
  const contactLines = [
    q.custAddr    ? `<span class="cdv-contact-line"><span class="cdv-contact-icon">${iconPin}</span>${esc(q.custAddr)}${q.custPostcode ? ', ' + esc(q.custPostcode) : ''}</span>` : '',
    q.custPhone   ? `<span class="cdv-contact-line"><span class="cdv-contact-icon">${iconPhone}</span>${esc(q.custPhone)}</span>` : '',
    q.custEmail   ? `<span class="cdv-contact-line"><span class="cdv-contact-icon">${iconMail}</span>${esc(q.custEmail)}</span>` : '',
  ].filter(Boolean).join('');

  // Put customer name in modal title
  const titleEl = document.getElementById('customerDashboardTitle');
  if (titleEl) titleEl.innerHTML = `<span class="cdv-title-prefix">Dashboard:</span> ${esc(group.name)}`;

  // Contact action buttons (Email / WhatsApp / Phone)
  const dashPhone = q.custPhone || '';
  const dashEmail = q.custEmail || '';
  const dashDocId = firstDoc.id;
  const DSVG_EMAIL = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`;
  const DSVG_WA    = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  const DSVG_PHONE = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.6 3.44 2 2 0 0 1 3.57 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.82a16 16 0 0 0 6.29 6.29l1.12-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;
  const DSVG_SHARE  = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`;
  const DSVG_EDIT   = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
  const DSVG_CAMERA = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;
  const DSVG_DELETE = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
  const contactBtns = `
    <div class="cdv-contact-btns">
      <button type="button" class="cal-icon-btn cal-icon-email cdv-labeled${!dashEmail ? ' cal-btn-disabled' : ''}"
        ${dashEmail ? `onclick="openCalEmailComposer('${esc(dashDocId)}','dashboard','email')"` : ''}
        title="${dashEmail ? 'Email ' + esc(group.name) : 'No email address saved'}">${DSVG_EMAIL}<span>Email</span></button>
      <button type="button" class="cal-icon-btn cal-icon-whatsapp cdv-labeled${!dashPhone ? ' cal-btn-disabled' : ''}"
        ${dashPhone ? `onclick="openCalEmailComposer('${esc(dashDocId)}','dashboard','whatsapp')"` : ''}
        title="${dashPhone ? 'WhatsApp ' + esc(group.name) : 'No phone number saved'}">${DSVG_WA}<span>WhatsApp</span></button>
      ${dashPhone
        ? `<a href="tel:${esc(dashPhone)}" class="cal-icon-btn cal-icon-phone cdv-labeled" title="Call ${esc(group.name)}">${DSVG_PHONE}<span>Call</span></a>`
        : `<button type="button" class="cal-icon-btn cal-icon-phone cdv-labeled cal-btn-disabled" title="No phone number saved">${DSVG_PHONE}<span>Call</span></button>`}
      <button type="button" class="cal-icon-btn cal-icon-share cdv-labeled" onclick="openSendChoiceModal()" title="Share my details with this customer">${DSVG_SHARE}<span>Share</span></button>
      <button type="button" class="cal-icon-btn cal-icon-camera cdv-labeled" id="custDashCameraBtn" title="Add photo">${DSVG_CAMERA}<span>Photo</span></button>
      <button type="button" class="cal-icon-btn cal-icon-update cdv-labeled" id="custDashEditBtn" title="Update this customer">${DSVG_EDIT}<span>Update</span></button>
      <button type="button" class="cal-icon-btn cdv-labeled cdv-delete-btn" id="custDashDeleteBtn" title="Delete">${DSVG_DELETE}<span>Delete</span></button>
    </div>`;

  // contentHtml = pure dashboard content (used for download -no buttons)
  const contentHtml = `
    <div class="customer-dashboard-card printable-customer-dashboard">
      <div class="cdv-header">
        ${contactBtns}
        ${contactLines ? `<div class="cdv-contact">${contactLines}</div>` : ''}
      </div>
      <div class="cdv-summary-bar">
        <div class="cdv-summary-item">
          <span class="cdv-summary-label">Total Charged</span>
          <span class="cdv-summary-value">${fmtPrice(totals.total)}</span>
        </div>
        <div class="cdv-summary-item">
          <span class="cdv-summary-label">Paid</span>
          <span class="cdv-summary-value cdv-paid">${fmtPrice(totals.paid)}</span>
        </div>
        <div class="cdv-summary-item">
          <span class="cdv-summary-label">Outstanding</span>
          <span class="cdv-summary-value ${totals.outstanding > 0 ? 'cdv-outstanding' : 'cdv-paid'}">${fmtPrice(totals.outstanding)}</span>
        </div>
        <div class="cdv-summary-item">
          <span class="cdv-summary-label">Jobs</span>
          <span class="cdv-summary-value">${group.docs.length}</span>
        </div>
      </div>
      <div class="cdv-jobs-list">
        ${group.docs.map((d, i) => buildCustomerJobSection(d, group.docs.length > 1 ? i + 1 : 0)).join('')}
      </div>
      ${buildCustomerExtras(group.name)}
    </div>`;

  body.innerHTML = contentHtml;
  wireCustomerExtras(body, group.name);

  // Wire modal-header action buttons
  const firstDocId = group.docs[0]?.id;
  const modal = document.getElementById('customerDashboardModal');

  const dashEditBtn = document.getElementById('custDashEditBtn');
  if (dashEditBtn) dashEditBtn.onclick = () => {
    activeEditDocId = group.docs.length === 1 ? firstDocId : null;
    loadQuoteIntoBuilder(activeEditDocId || firstDocId);
  };

  // Camera button - open add photo flow for first doc
  const dashCameraBtn = document.getElementById('custDashCameraBtn');
  if (dashCameraBtn) dashCameraBtn.onclick = () => {
    if (group.docs.length === 1) {
      executeCustomerEdit('addPhoto', firstDocId);
    } else {
      // Pick which job to add photo to
      activeEditDocId = null;
      customerEditPickDoc('addPhoto');
    }
  };

  // Delete button - ask document or customer
  const dashDeleteBtn = document.getElementById('custDashDeleteBtn');
  if (dashDeleteBtn) dashDeleteBtn.onclick = () => openCustomerDeleteChoice(group);

  // Job status progression + per-job action buttons — event delegation
  body.addEventListener('click', e => {
    const btn = e.target.closest('[data-prog-doc-id]');
    if (!btn) return;
    const docId  = btn.dataset.progDocId;
    const action = btn.dataset.progAction;
    if (action === 'receipt') {
      handleReceiptRequest(docId);
    } else if (action === 'editQuote') {
      loadQuoteIntoBuilder(docId);
    } else {
      document.getElementById('customerDashboardModal').style.display = 'none';
      if      (action === 'quote')   openQuoteModal(docId);
      else if (action === 'invoice') previewInvoice(docId);
    }
  });

  // Job Accepted checkbox -show/hide date, auto-fill today, save
  body.addEventListener('change', e => {
    const cb = e.target.closest('.cdv-accepted-cb');
    if (!cb) return;
    const doc = state.saved.find(d => d.id === cb.dataset.docId);
    if (!doc) return;
    doc.jobAccepted = cb.checked;
    const wrap = cb.closest('.cdv-schedule-row')?.querySelector('.cdv-start-date-wrap');
    if (wrap) {
      wrap.style.display = cb.checked ? '' : 'none';
      if (cb.checked) {
        const inp = wrap.querySelector('.cdv-start-date-input');
        // Do not auto-fill today — leave blank so user picks an actual booking date
      }
    }
    save();
    queueSavedDocsSync(true);
  });

  // Helper: date confirmed -hide prompt, show compact date wrap
  function applyCompletedDate(docId, dateStr) {
    const doc = state.saved.find(d => d.id === docId);
    if (!doc) return;
    doc.jobCompleted      = true;
    doc.jobCompletedDate  = dateStr;
    save();
    queueSavedDocsSync(true);
    const prompt   = body.querySelector(`.cdv-completed-prompt[data-doc-id="${docId}"]`);
    const cb       = body.querySelector(`.cdv-completed-cb[data-doc-id="${docId}"]`);
    const dateWrap = cb?.closest('.cdv-schedule-row')?.querySelector('.cdv-start-date-wrap');
    if (prompt)   prompt.style.display   = 'none';
    if (dateWrap) {
      dateWrap.style.display = '';
      const inp = dateWrap.querySelector('.cdv-completed-date-input');
      if (inp) inp.value = dateStr;
    }
  }

  // Job Completed checkbox
  body.addEventListener('change', e => {
    const cb = e.target.closest('.cdv-completed-cb');
    if (!cb) return;
    const docId = cb.dataset.docId;
    const doc   = state.saved.find(d => d.id === docId);
    if (!doc) return;
    doc.jobCompleted = cb.checked;
    const prompt   = body.querySelector(`.cdv-completed-prompt[data-doc-id="${docId}"]`);
    const dateWrap = cb.closest('.cdv-schedule-row')?.querySelector('.cdv-start-date-wrap');
    if (cb.checked) {
      if (doc.jobCompletedDate) {
        // Date already stored -just show the compact wrap
        if (dateWrap) dateWrap.style.display = '';
        if (prompt)   prompt.style.display   = 'none';
      } else {
        // No date yet -show the prompt
        if (dateWrap) dateWrap.style.display = 'none';
        if (prompt)   prompt.style.display   = '';
      }
    } else {
      // Unchecked -hide everything
      if (dateWrap) dateWrap.style.display = 'none';
      if (prompt)   prompt.style.display   = 'none';
      doc.jobCompletedDate = '';
    }
    save();
    queueSavedDocsSync(true);
  });

  // "Today" button inside the completion prompt
  body.addEventListener('click', e => {
    const btn = e.target.closest('.cdv-today-btn');
    if (!btn) return;
    applyCompletedDate(btn.dataset.docId, todayStr());
  });

  // Manual date pick from the prompt calendar
  body.addEventListener('change', e => {
    const inp = e.target.closest('.cdv-prompt-date');
    if (!inp || !inp.value) return;
    applyCompletedDate(inp.dataset.docId, inp.value);
  });

  // Start Date input -save on change
  body.addEventListener('change', e => {
    const inp = e.target.closest('.cdv-start-date-input');
    if (!inp) return;
    const doc = state.saved.find(d => d.id === inp.dataset.docId);
    if (!doc) return;
    doc.jobStartDate = inp.value || '';
    save();
    queueSavedDocsSync(true);
  });

  // Completed Date input (compact view) -save on change
  body.addEventListener('change', e => {
    const inp = e.target.closest('.cdv-completed-date-input');
    if (!inp) return;
    const doc = state.saved.find(d => d.id === inp.dataset.docId);
    if (!doc) return;
    doc.jobCompletedDate = inp.value || '';
    save();
    queueSavedDocsSync(true);
  });

}

/* ===== CUSTOMER EDIT CHOICE ===== */
let activeEditDocId = null; // docId pre-selected when Edit is clicked on a specific job card

function openUpdateFromCal(docId) {
  // Set up activeCustomerGroup so the edit choice modal works correctly
  const groups = buildCustomerGroups();
  const group  = groups.find(g => g.docs.some(d => d.id === docId));
  if (!group) return;
  activeCustomerGroup = group;
  activeEditDocId     = docId;
  openCustomerEditChoice(docId);
}

function openCustomerEditChoice(docId) {
  // Removed the intermediate "What would you like to edit?" modal.
  // Update now goes straight to the QB builder.
  loadQuoteIntoBuilder(docId || activeEditDocId || activeCustomerGroup?.docs[0]?.id);
}

function loadQuoteIntoBuilder(docId) {
  const doc = state.saved.find(d => d.id === docId);
  if (!doc) return;
  document.getElementById('customerDashboardModal').style.display = 'none';
  state.editingDocId = docId;
  clearDraftQuote();
  prepareNewQuote();
  showPage('page3');
}

function customerEditPickDoc(editType) {
  const group = activeCustomerGroup;
  if (!group) return;
  // If we already know the specific doc (clicked from a job card), use it directly
  if (activeEditDocId) {
    executeCustomerEdit(editType, activeEditDocId);
    return;
  }
  if (group.docs.length === 1) {
    executeCustomerEdit(editType, group.docs[0].id);
  } else {
    // Multiple jobs — use first doc (per-job buttons in dashboard handle specific doc selection)
    executeCustomerEdit(editType, group.docs[0].id);
  }
}

function executeCustomerEdit(editType, docId) {
  if (editType === 'details') {
    openCustomerDetailsEdit(docId);
  } else if (editType === 'job') {
    openJobDetailsEdit(docId);
  } else if (editType === 'money') {
    document.getElementById('customerDashboardModal').style.display = 'none';
    openMarkPaid(docId);
  } else if (editType === 'terms') {
    document.getElementById('customerDashboardModal').style.display = 'none';
    openJobTermsEdit(docId);
  } else if (editType === 'addPhoto') {
    if (docId) openPhotosModal(docId);
  }
}

function openCustomerDetailsEdit(docId) {
  const group = activeCustomerGroup;
  if (!group) return;
  // Use the specific doc if we know which job was clicked, otherwise fall back to first doc in group
  const targetDoc = (docId && state.saved.find(d => d.id === docId)) || group.docs[0];
  const q = (targetDoc && targetDoc.quote) || {};
  setVal('cdeCustTitle',        q.custTitle        || '');
  setVal('cdeCustFirst',        q.custFirstName    || '');
  setVal('cdeCustLast',         q.custLastName     || '');
  setVal('cdeCustAddr',         q.custAddr         || '');
  setVal('cdeCustPostcode',     q.custPostcode     || '');
  setVal('cdeCustPhone',        q.custPhone        || '');
  setVal('cdeCustEmail',        q.custEmail        || '');
  setVal('cdeCustPrivateNotes', q.privateNotes     || '');
  document.getElementById('customerDetailsEditModal').style.display = 'flex';
}

// Persist whatever is currently in the Customer Details form -no UI side-effects.
// Called by both the Save button and any Next button that moves past this screen.
function persistCustomerDetailsForm() {
  const group = activeCustomerGroup;
  if (!group) return;
  const sharedUpdates = {
    custTitle:     getVal('cdeCustTitle'),
    custFirstName: getVal('cdeCustFirst'),
    custLastName:  getVal('cdeCustLast'),
    custAddr:      getVal('cdeCustAddr'),
    custPostcode:  getVal('cdeCustPostcode'),
    custPhone:     getVal('cdeCustPhone'),
    custEmail:     getVal('cdeCustEmail'),
  };
  const privateNotes = getVal('cdeCustPrivateNotes');
  const targetDocId  = activeEditDocId || (group.docs[0] && group.docs[0].id);
  group.docs.forEach(doc => {
    if (!doc.quote) doc.quote = {};
    Object.assign(doc.quote, sharedUpdates);
    if (doc.id === targetDocId) doc.quote.privateNotes = privateNotes;
    doc.custName = buildCustName(doc.quote);
  });
  group.name = buildCustName(sharedUpdates).trim() || group.name;
  upsertLocalCustomer(sharedUpdates, false);
  save();
  queueCustomerSync(sharedUpdates, true);
  refreshSavedDocs();
}

function saveCustomerDetails() {
  persistCustomerDetailsForm();

  // Close edit modal and return to dashboard
  document.getElementById('customerDetailsEditModal').style.display = 'none';

  // Re-render and show the customer dashboard
  const group        = activeCustomerGroup;
  const updatedGroups = buildCustomerGroups();
  const updatedGroup  = updatedGroups.find(g => g.docs.some(d => group.docs.some(gd => gd.id === d.id))) || group;
  activeCustomerGroup = updatedGroup;
  renderSingleCustomerDashboard(updatedGroup, updatedGroups);
  document.getElementById('customerDashboardModal').style.display = 'flex';

  showSavedPopup("Got it. Details saved.");
}

/* ===== JOB TERMS EDIT MODAL ===== */
let activeJobTermsDocId = null;

function openJobTermsEdit(docId) {
  const doc = state.saved.find(d => d.id === docId);
  if (!doc) return;
  activeJobTermsDocId = docId;
  const q = doc.quote || {};

  // Subtitle
  const custName = buildCustName(q) || doc.custName || '';
  const subtitleEl = document.getElementById('jobTermsEditSubtitle');
  if (subtitleEl) subtitleEl.textContent = custName ? `Job: ${custName}` : '';

  // Doc type
  const typeVal = (q.type || 'Estimate');
  document.querySelectorAll('input[name="jteDocType"]').forEach(r => { r.checked = r.value === typeVal; });

  // Discount
  const discSel = document.getElementById('jteDiscount');
  const discCustom = document.getElementById('jteDiscountCustom');
  const discVal = q.discount || '0';
  const standardDiscs = ['0','5','10','20'];
  if (standardDiscs.includes(String(discVal))) {
    discSel.value = discVal;
    discCustom.style.display = 'none';
  } else {
    discSel.value = 'custom';
    discCustom.style.display = '';
    discCustom.value = discVal;
  }

  // VAT
  const vatSel = document.getElementById('jteVat');
  const vatCustomEl = document.getElementById('jteVatCustom');
  const vatVal = q.vatRate || '0';
  const standardVats = ['0','5','10','20'];
  if (standardVats.includes(String(vatVal))) {
    vatSel.value = vatVal;
    vatCustomEl.style.display = 'none';
  } else {
    vatSel.value = 'custom';
    vatCustomEl.style.display = '';
    vatCustomEl.value = q.vatCustom || vatVal;
  }

  // Valid For
  const validSel = document.getElementById('jteValidFor');
  const validCustomGrp = document.getElementById('jteValidCustomGroup');
  const validCustomEl = document.getElementById('jteValidCustom');
  const validVal = q.validFor || '14';
  if (['7','14','30'].includes(String(validVal))) {
    validSel.value = validVal;
    validCustomGrp.style.display = 'none';
  } else {
    validSel.value = 'custom';
    validCustomGrp.style.display = '';
    validCustomEl.value = q.validCustom || validVal;
  }

  // Terms checkboxes
  const selectedTerms = q.selectedTerms || [];
  document.querySelectorAll('input[name="jteTerms"]').forEach(cb => {
    cb.checked = selectedTerms.includes(cb.value);
  });

  // Custom terms
  document.getElementById('jteCustomTerms').value = q.customTerms || '';

  // Signature
  document.getElementById('jteAuthSig').value = q.authSig || defaultAuthName();

  // Live totals
  jteUpdateTotals();

  document.getElementById('jobTermsEditModal').style.display = 'flex';
}

function jteGetSubtotal() {
  const doc = state.saved.find(d => d.id === activeJobTermsDocId);
  if (!doc) return 0;
  const items = (doc.quote?.items || doc.items || []);
  return items.reduce((s, i) => s + (i.unitPrice || 0) * (i.qty || 1), 0);
}

function jteUpdateTotals() {
  const subtotal = jteGetSubtotal();
  const discSel = document.getElementById('jteDiscount');
  const discCustom = document.getElementById('jteDiscountCustom');
  const vatSel = document.getElementById('jteVat');
  const vatCustomEl = document.getElementById('jteVatCustom');

  const discPct = discSel.value === 'custom' ? (parseFloat(discCustom.value) || 0) : (parseFloat(discSel.value) || 0);
  const vatPct  = vatSel.value  === 'custom' ? (parseFloat(vatCustomEl.value) || 0) : (parseFloat(vatSel.value) || 0);

  const discAmt  = subtotal * discPct / 100;
  const afterDisc = subtotal - discAmt;
  const vatAmt   = afterDisc * vatPct / 100;
  const total    = afterDisc + vatAmt;

  document.getElementById('jteSubtotal').textContent   = fmtPrice(subtotal);
  document.getElementById('jteDiscountAmt').textContent = '-' + fmtPrice(discAmt);
  document.getElementById('jteVatAmt').textContent      = fmtPrice(vatAmt);
  document.getElementById('jteTotal').textContent       = fmtPrice(total);
  document.getElementById('jteDiscountRow').style.display = discAmt > 0 ? '' : 'none';
  document.getElementById('jteVatRow').style.display      = vatAmt > 0 ? '' : 'none';
}

// Pure data-save for the Job Terms form -no UI side-effects.
function persistJobTermsForm() {
  const docId = activeJobTermsDocId;
  const doc   = state.saved.find(d => d.id === docId);
  if (!doc) return;
  if (!doc.quote) doc.quote = {};
  const typeEl = document.querySelector('input[name="jteDocType"]:checked');
  if (typeEl) { doc.quote.type = typeEl.value; doc.type = typeEl.value; }
  const discSel = document.getElementById('jteDiscount');
  doc.quote.discount = discSel.value === 'custom'
    ? (parseFloat(document.getElementById('jteDiscountCustom').value) || 0)
    : parseFloat(discSel.value) || 0;
  const vatSel = document.getElementById('jteVat');
  if (vatSel.value === 'custom') {
    doc.quote.vatRate   = 'custom';
    doc.quote.vatCustom = parseFloat(document.getElementById('jteVatCustom').value) || 0;
  } else {
    doc.quote.vatRate   = vatSel.value;
    doc.quote.vatCustom = '';
  }
  const validSel = document.getElementById('jteValidFor');
  if (validSel.value === 'custom') {
    doc.quote.validFor    = 'custom';
    doc.quote.validCustom = document.getElementById('jteValidCustom').value || '';
  } else {
    doc.quote.validFor    = validSel.value;
    doc.quote.validCustom = '';
  }
  doc.quote.selectedTerms = [...document.querySelectorAll('input[name="jteTerms"]:checked')].map(cb => cb.value);
  doc.quote.customTerms   = document.getElementById('jteCustomTerms').value || '';
  doc.quote.authSig       = document.getElementById('jteAuthSig').value || '';
  const subtotal  = jteGetSubtotal();
  const discPct   = parseFloat(doc.quote.discount) || 0;
  const afterDisc = subtotal * (1 - discPct / 100);
  const vatRate   = doc.quote.vatRate === 'custom' ? (parseFloat(doc.quote.vatCustom) || 0) : (parseFloat(doc.quote.vatRate) || 0);
  doc.total = afterDisc * (1 + vatRate / 100);
  save();
  refreshSavedDocs();
}

function saveJobTermsEdit() {
  persistJobTermsForm();
  const docId = activeJobTermsDocId;
  const doc   = state.saved.find(d => d.id === docId);
  if (!doc) return;

  document.getElementById('jobTermsEditModal').style.display = 'none';

  // Re-render and show customer dashboard
  try {
    const groups = buildCustomerGroups();
    const updatedGroup = groups.find(g => g.docs.some(d => d.id === docId)) || activeCustomerGroup;
    if (updatedGroup) {
      activeCustomerGroup = updatedGroup;
      renderSingleCustomerDashboard(updatedGroup, groups);
    }
  } catch(e) {}
  document.getElementById('customerDashboardModal').style.display = 'flex';
  showSavedPopup("Saved. Looking good.");
}

function setupJobTermsEdit() {
  document.getElementById('closeJobTermsEditBtn')?.addEventListener('click', () => {
    document.getElementById('jobTermsEditModal').style.display = 'none';
  });
  document.getElementById('backToJobDetailsFromTermsBtn')?.addEventListener('click', () => {
    persistJobTermsForm();                                             // save before leaving
    document.getElementById('jobTermsEditModal').style.display = 'none';
    if (activeJobTermsDocId) openJobDetailsEdit(activeJobTermsDocId);
  });
  document.getElementById('saveJobTermsEditBtn')?.addEventListener('click', saveJobTermsEdit);

  // Live totals on discount/VAT change
  ['jteDiscount','jteDiscountCustom','jteVat','jteVatCustom'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', jteUpdateTotals);
    document.getElementById(id)?.addEventListener('change', jteUpdateTotals);
  });

  // Show/hide custom discount
  document.getElementById('jteDiscount')?.addEventListener('change', () => {
    const isCustom = document.getElementById('jteDiscount').value === 'custom';
    document.getElementById('jteDiscountCustom').style.display = isCustom ? '' : 'none';
    jteUpdateTotals();
  });

  // Show/hide custom VAT
  document.getElementById('jteVat')?.addEventListener('change', () => {
    const isCustom = document.getElementById('jteVat').value === 'custom';
    document.getElementById('jteVatCustom').style.display = isCustom ? '' : 'none';
    jteUpdateTotals();
  });

  // Show/hide custom valid for
  document.getElementById('jteValidFor')?.addEventListener('change', () => {
    const isCustom = document.getElementById('jteValidFor').value === 'custom';
    document.getElementById('jteValidCustomGroup').style.display = isCustom ? '' : 'none';
  });
}

/* ===== BUSINESS DETAILS CHOICE ===== */

const BIZ_COMPARE_KEYS = ['businessName', 'firstName', 'lastName', 'address', 'postcode', 'phone', 'email', 'website', 'companyNumber', 'logo'];

function bizDetailsChanged(doc) {
  if (!doc || !doc.company) return false; // no snapshot = always uses current state
  if (state.company.bizChoiceMade === 'old') return false; // user said "always use old"
  const old = doc.company;
  const cur = state.company;
  return BIZ_COMPARE_KEYS.some(k => (old[k] || '') !== (cur[k] || ''));
}

let _bizChoiceCallback = null;
let _bizChoiceDocId    = null;

function withBizCheck(docId, callback) {
  const doc = state.saved.find(d => d.id === docId);
  if (!doc || !bizDetailsChanged(doc)) {
    callback(docId);
    return;
  }
  _bizChoiceDocId    = docId;
  _bizChoiceCallback = callback;
  // Populate modal with old vs new name for context
  const oldBiz = doc.company;
  const oldName = (oldBiz.businessName || [oldBiz.firstName, oldBiz.lastName].filter(Boolean).join(' ') || 'Original details').trim();
  const newName = (state.company.businessName || [state.company.firstName, state.company.lastName].filter(Boolean).join(' ') || 'Current details').trim();
  document.getElementById('bizChoiceOldSub').textContent = oldName;
  document.getElementById('bizChoiceNewSub').textContent = newName;
  // Reset radio + checkboxes
  const oldRadio = document.querySelector('input[name="bizChoice"][value="old"]');
  if (oldRadio) oldRadio.checked = true;
  document.getElementById('bizChoiceOldAll').checked = false;
  document.getElementById('bizChoiceNewAll').checked = false;
  document.getElementById('bizChoiceModal').style.display = 'flex';
}

function applyBizChoice(docId, useNew, forAll, callback) {
  if (useNew) {
    const companySnapshot = { ...state.company };
    // Derive the new authorised name (first+last, or business name as fallback)
    const newAuthName = [(companySnapshot.firstName||''), (companySnapshot.lastName||'')].filter(Boolean).join(' ')
      || companySnapshot.businessName || '';

    const updateDoc = d => {
      d.company = { ...companySnapshot };
      if (d.quote) {
        // Update the printed auth name
        d.quote.authSig = newAuthName;
        // Update the signature preview to F.Last format, but only if it was already set
        if (d.quote.custSigText) d.quote.custSigText = formatSigFromName(newAuthName);
      }
    };

    if (forAll) {
      state.saved.forEach(updateDoc);
      toast('All documents updated with your current business details.');
    } else {
      const doc = state.saved.find(d => d.id === docId);
      if (doc) updateDoc(doc);
    }
    save();
  } else {
    // Use old -no data change needed
    if (forAll) {
      state.company.bizChoiceMade = 'old';
      save();
      toast('Your existing documents will keep their original business details.');
    }
  }
  if (callback) callback(docId);
}

function setupBizChoiceModal() {
  const closeModal = () => {
    document.getElementById('bizChoiceModal').style.display = 'none';
    _bizChoiceCallback = null;
    _bizChoiceDocId    = null;
  };

  document.getElementById('closeBizChoiceBtn')?.addEventListener('click', closeModal);
  document.getElementById('bizChoiceCancelBtn')?.addEventListener('click', closeModal);

  document.getElementById('bizChoiceContinueBtn')?.addEventListener('click', () => {
    const useNew  = document.querySelector('input[name="bizChoice"]:checked')?.value === 'new';
    const forAll  = useNew
      ? document.getElementById('bizChoiceNewAll').checked
      : document.getElementById('bizChoiceOldAll').checked;
    document.getElementById('bizChoiceModal').style.display = 'none';
    const cb  = _bizChoiceCallback;
    const id  = _bizChoiceDocId;
    _bizChoiceCallback = null;
    _bizChoiceDocId    = null;
    applyBizChoice(id, useNew, forAll, cb);
  });

  // Clicking the "do this for all" checkbox auto-selects its matching radio
  document.getElementById('bizChoiceOldAll')?.addEventListener('change', () => {
    const r = document.querySelector('input[name="bizChoice"][value="old"]');
    if (r) r.checked = true;
  });
  document.getElementById('bizChoiceNewAll')?.addEventListener('change', () => {
    const r = document.querySelector('input[name="bizChoice"][value="new"]');
    if (r) r.checked = true;
  });

  // Click outside to close
  document.getElementById('bizChoiceModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('bizChoiceModal')) closeModal();
  });
}

/* ===== INVOICE JOB PICKER ===== */

function renderInvJobPicker(doc) {
  const q = doc.quote || {};
  const items = (q.items && q.items.length) ? q.items : ((doc.items && doc.items.length) ? doc.items : []);
  const calcedTotal = items.reduce((s, i) => s + (i.unitPrice || 0) * (i.qty || 1), 0);
  const displayTotal = items.length ? calcedTotal : (doc.total || 0);
  const body = document.getElementById('invJobsBody');
  if (!body) return;
  const hasPriceList = state.priceList && state.priceList.length > 0;
  body.innerHTML = `
    ${hasPriceList ? `
    <p class="jde-section-label">Add from Price List</p>
    <input type="text" id="invPickerSearch" class="search-input" placeholder="Search your price list…" style="margin-bottom:6px">
    <div id="invPickerList" class="jde-picker-list picker-list"></div>
    <div class="jde-divider"></div>` : ''}
    <p class="jde-section-label">Job Items</p>
    <div class="jde-item-headers"><span>Description</span><span>Price</span><span></span></div>
    <div id="invItemsList" class="jde-items-list">
      ${items.length
        ? items.map(item => jdeItemRowHtml(item)).join('')
        : '<p class="jde-empty-hint">No items yet. Add from your price list above or use the button below.</p>'}
    </div>
    <button type="button" class="btn btn-sage btn-sm" id="invAddItemBtn" style="margin-top:8px">+ One-off Item</button>
    <div class="form-group" style="margin-top:14px">
      <label for="invTotalOverride">Total <span class="jde-total-hint">(auto-calculated, or set manually)</span></label>
      <div class="input-pfx" style="margin:0">
        <span class="pfx-symbol">£</span>
        <input type="number" id="invTotalOverride" min="0" step="any" placeholder="0.00" value="${displayTotal > 0 ? displayTotal.toFixed(2) : ''}">
      </div>
    </div>`;

  wireInvRemoveButtons();
  document.getElementById('invAddItemBtn').addEventListener('click', invAddItem);
  body.addEventListener('input', e => {
    if (e.target.classList.contains('jde-item-price')) invUpdateTotal();
  });

  if (hasPriceList) {
    invRenderPicker('');
    document.getElementById('invPickerSearch').addEventListener('input', e => invRenderPicker(e.target.value));
    document.getElementById('invPickerList').addEventListener('click', e => {
      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        const jobId  = actionBtn.dataset.jobId;
        const action = actionBtn.dataset.action;
        if (action === 'add')         invAddFromPriceList(jobId);
        else if (action === 'remove') invRemoveFromPriceList(jobId);
        return;
      }
      const item = e.target.closest('.pick-item:not(.added)');
      if (item) invAddFromPriceList(item.dataset.jobId);
    });
  }
}

function invRenderPicker(searchVal) {
  const q = (searchVal || '').toLowerCase();
  const filtered = state.priceList.filter(j => j.name.toLowerCase().includes(q));
  const container = document.getElementById('invPickerList');
  if (!container) return;
  if (!filtered.length) {
    container.innerHTML = '<p style="color:#888;font-size:0.85rem;padding:6px 0">No jobs match your search.</p>';
    return;
  }
  const qtyCounts = {};
  document.querySelectorAll('#invItemsList .jde-item-name').forEach(el => {
    const name = el.value.trim().toLowerCase();
    if (name) qtyCounts[name] = (qtyCounts[name] || 0) + 1;
  });
  container.innerHTML = filtered.map(item => {
    const qty = qtyCounts[item.name.toLowerCase()] || 0;
    const counterHtml = qty === 0
      ? `<button type="button" class="pick-add-btn" data-action="add" data-job-id="${esc(item.id)}" aria-label="Add ${esc(item.name)}">+</button>`
      : `<div class="pick-counter">
           <button type="button" class="pick-qty-btn pick-qty-minus" data-action="remove" data-job-id="${esc(item.id)}" aria-label="Remove one">−</button>
           <span class="pick-qty-num">${qty}</span>
           <button type="button" class="pick-qty-btn pick-qty-plus" data-action="add" data-job-id="${esc(item.id)}" aria-label="Add one more">+</button>
         </div>`;
    return `
      <div class="pick-item${qty > 0 ? ' added' : ''}" data-job-id="${esc(item.id)}">
        <div class="pick-name">${esc(item.name)}${item.unit ? `<span class="pick-unit">(${esc(item.unit)})</span>` : ''}</div>
        <span class="pick-price">${fmtPrice(item.price)}</span>
        ${counterHtml}
      </div>`;
  }).join('');
}

function invAddFromPriceList(jobId) {
  const job = state.priceList.find(j => j.id === jobId);
  if (!job) return;
  const list = document.getElementById('invItemsList');
  const hint = list.querySelector('.jde-empty-hint');
  if (hint) hint.remove();
  const wrapper = document.createElement('div');
  wrapper.innerHTML = jdeItemRowHtml({ name: job.name, unitPrice: job.price });
  const row = wrapper.firstElementChild;
  list.appendChild(row);
  row.querySelector('.jde-item-remove').addEventListener('click', () => {
    row.remove();
    if (!list.querySelector('.jde-item-row')) {
      list.innerHTML = '<p class="jde-empty-hint">No items yet. Add from your price list above or use the button below.</p>';
    }
    invUpdateTotal();
    invRenderPicker(document.getElementById('invPickerSearch')?.value || '');
  });
  invUpdateTotal();
  invRenderPicker(document.getElementById('invPickerSearch')?.value || '');
  row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function invRemoveFromPriceList(jobId) {
  const job = state.priceList.find(j => j.id === jobId);
  if (!job) return;
  const list = document.getElementById('invItemsList');
  if (!list) return;
  const rows = [...list.querySelectorAll('.jde-item-row')];
  const matching = rows.filter(r => r.querySelector('.jde-item-name')?.value.trim().toLowerCase() === job.name.toLowerCase());
  if (!matching.length) return;
  matching[matching.length - 1].remove();
  if (!list.querySelector('.jde-item-row')) {
    list.innerHTML = '<p class="jde-empty-hint">No items yet. Add from your price list above or use the button below.</p>';
  }
  invUpdateTotal();
  invRenderPicker(document.getElementById('invPickerSearch')?.value || '');
}

function invUpdateTotal() {
  const prices = [...document.querySelectorAll('#invItemsList .jde-item-price')].map(el => parseFloat(el.value) || 0);
  if (prices.length > 0) {
    const totalEl = document.getElementById('invTotalOverride');
    if (totalEl) totalEl.value = prices.reduce((s, p) => s + p, 0).toFixed(2);
  }
}

function wireInvRemoveButtons() {
  document.querySelectorAll('#invItemsList .jde-item-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.jde-item-row');
      if (row) row.remove();
      const list = document.getElementById('invItemsList');
      if (list && !list.querySelector('.jde-item-row')) {
        list.innerHTML = '<p class="jde-empty-hint">No items yet. Add one below.</p>';
      }
      invUpdateTotal();
      invRenderPicker(document.getElementById('invPickerSearch')?.value || '');
    });
  });
}

function invAddItem() {
  const list = document.getElementById('invItemsList');
  const hint = list.querySelector('.jde-empty-hint');
  if (hint) hint.remove();
  const wrapper = document.createElement('div');
  wrapper.innerHTML = jdeItemRowHtml({ name: '', unitPrice: '' });
  const row = wrapper.firstElementChild;
  list.appendChild(row);
  row.querySelector('.jde-item-remove').addEventListener('click', () => {
    row.remove();
    if (!list.querySelector('.jde-item-row')) {
      list.innerHTML = '<p class="jde-empty-hint">No items yet. Add one below.</p>';
    }
    invUpdateTotal();
    invRenderPicker(document.getElementById('invPickerSearch')?.value || '');
  });
  row.querySelector('.jde-item-name').focus();
}

/* ===== JOB DETAILS EDIT ===== */
let activeJobDetailsDocId = null;

function openJobDetailsEdit(docId) {
  const doc = state.saved.find(d => d.id === docId);
  if (!doc) return;
  activeJobDetailsDocId = docId;
  const q = doc.quote || {};
  const custName = buildCustName(q) || doc.custName || '';
  const subtitleEl = document.getElementById('jobDetailsEditSubtitle');
  if (subtitleEl) subtitleEl.textContent = custName ? `Job: ${custName}` : '';
  renderJobDetailsForm(doc);
  document.getElementById('jobDetailsEditModal').style.display = 'flex';
}

function jdeItemRowHtml(item) {
  return `
    <div class="jde-item-row">
      <input type="text" class="jde-item-name" placeholder="Description" value="${esc(item.name || '')}">
      <div class="input-pfx" style="margin:0">
        <span class="pfx-symbol">£</span>
        <input type="number" class="jde-item-price" min="0" step="any" placeholder="0.00" value="${item.unitPrice != null ? item.unitPrice : ''}">
      </div>
      <button type="button" class="jde-item-remove" aria-label="Remove item">✕</button>
    </div>`;
}

function renderJobDetailsForm(doc) {
  const q = doc.quote || {};
  // Match same fallback logic as buildCustomerJobSection -quote.items first, then legacy doc.items
  const items = (q.items && q.items.length) ? q.items : ((doc.items && doc.items.length) ? doc.items : []);
  // Calculate total from items; fall back to doc.total for total-override docs
  const calcedTotal = items.reduce((s, i) => s + (i.unitPrice || 0) * (i.qty || 1), 0);
  const displayTotal = items.length ? calcedTotal : (doc.total || 0);
  const body = document.getElementById('jobDetailsEditBody');
  const hasPriceList = state.priceList && state.priceList.length > 0;
  body.innerHTML = `
    ${hasPriceList ? `
    <p class="jde-section-label">Add from Price List</p>
    <input type="text" id="jdePickerSearch" class="search-input" placeholder="Search your price list..." style="margin-bottom:6px">
    <div id="jdePickerList" class="jde-picker-list picker-list"></div>
    <div class="jde-divider"></div>` : ''}
    <p class="jde-section-label">Job Items</p>
    <div class="jde-item-headers">
      <span>Description</span><span>Price</span><span></span>
    </div>
    <div id="jdeItemsList" class="jde-items-list">
      ${items.length ? items.map(item => jdeItemRowHtml(item)).join('') : `<p class="jde-empty-hint">No items yet - add from your price list above or use the button below.</p>`}
    </div>
    <button type="button" class="btn btn-sage btn-sm" id="jdeAddItemBtn">+ One-off Item</button>
    <div class="form-group" style="margin-top:16px">
      <label for="jdeTotalOverride">Total <span class="jde-total-hint">(auto-calculated from items above, or set manually)</span></label>
      <div class="input-pfx form-group" style="margin:0">
        <span class="pfx-symbol">£</span>
        <input type="number" id="jdeTotalOverride" min="0" step="any" placeholder="0.00" value="${displayTotal > 0 ? displayTotal : ''}">
      </div>
    </div>
    <div class="form-group" style="margin-top:4px">
      <label for="jdeNotes">Notes</label>
      <textarea id="jdeNotes" rows="3" placeholder="Any notes for this job...">${esc(q.notes || '')}</textarea>
    </div>`;

  wireJdeRemoveButtons();
  document.getElementById('jdeAddItemBtn').addEventListener('click', jdeAddItem);

  // Auto-update total field as items are edited
  body.addEventListener('input', e => {
    if (e.target.classList.contains('jde-item-price')) jdeUpdateTotal();
  });

  // Wire price list picker if present
  if (hasPriceList) {
    jdeRenderPicker('');
    document.getElementById('jdePickerSearch').addEventListener('input', e => jdeRenderPicker(e.target.value));
    document.getElementById('jdePickerList').addEventListener('click', e => {
      // Check for explicit +/− action buttons first
      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        const jobId  = actionBtn.dataset.jobId;
        const action = actionBtn.dataset.action;
        if (action === 'add')    jdeAddFromPriceList(jobId);
        else if (action === 'remove') jdeRemoveFromPriceList(jobId);
        return;
      }
      // Clicking the name/price area of a 0-qty item also adds it
      const item = e.target.closest('.pick-item:not(.added)');
      if (item) jdeAddFromPriceList(item.dataset.jobId);
    });
  }
}

function jdeRenderPicker(searchVal) {
  const q = (searchVal || '').toLowerCase();
  const filtered = state.priceList.filter(j => j.name.toLowerCase().includes(q));
  const container = document.getElementById('jdePickerList');
  if (!container) return;
  if (!filtered.length) {
    container.innerHTML = '<p style="color:#888;font-size:0.85rem;padding:6px 0">No jobs match your search.</p>';
    return;
  }
  // Count how many times each job appears in the current items list
  const qtyCounts = {};
  document.querySelectorAll('#jdeItemsList .jde-item-name').forEach(el => {
    const name = el.value.trim().toLowerCase();
    if (name) qtyCounts[name] = (qtyCounts[name] || 0) + 1;
  });

  container.innerHTML = filtered.map(item => {
    const qty = qtyCounts[item.name.toLowerCase()] || 0;
    const counterHtml = qty === 0
      ? `<button type="button" class="pick-add-btn" data-action="add" data-job-id="${esc(item.id)}" aria-label="Add ${esc(item.name)}">+</button>`
      : `<div class="pick-counter">
           <button type="button" class="pick-qty-btn pick-qty-minus" data-action="remove" data-job-id="${esc(item.id)}" aria-label="Remove one">−</button>
           <span class="pick-qty-num">${qty}</span>
           <button type="button" class="pick-qty-btn pick-qty-plus" data-action="add" data-job-id="${esc(item.id)}" aria-label="Add one more">+</button>
         </div>`;
    return `
      <div class="pick-item${qty > 0 ? ' added' : ''}" data-job-id="${esc(item.id)}">
        <div class="pick-name">${esc(item.name)}${item.unit ? `<span class="pick-unit">(${esc(item.unit)})</span>` : ''}</div>
        <span class="pick-price">${fmtPrice(item.price)}</span>
        ${counterHtml}
      </div>`;
  }).join('');
}

function jdeAddFromPriceList(jobId) {
  const job = state.priceList.find(j => j.id === jobId);
  if (!job) return;
  const list = document.getElementById('jdeItemsList');
  // Remove empty hint if present
  const hint = list.querySelector('.jde-empty-hint');
  if (hint) hint.remove();
  // Add a new editable row pre-filled with price list item
  const wrapper = document.createElement('div');
  wrapper.innerHTML = jdeItemRowHtml({ name: job.name, unitPrice: job.price });
  const row = wrapper.firstElementChild;
  list.appendChild(row);
  row.querySelector('.jde-item-remove').addEventListener('click', () => {
    row.remove();
    if (!list.querySelector('.jde-item-row')) {
      list.innerHTML = '<p class="jde-empty-hint">No items yet - add from your price list above or use the button below.</p>';
    }
    jdeUpdateTotal();
    jdeRenderPicker(document.getElementById('jdePickerSearch')?.value || '');
  });
  jdeUpdateTotal();
  // Refresh picker to show item as added
  jdeRenderPicker(document.getElementById('jdePickerSearch')?.value || '');
  // Scroll new row into view
  row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function jdeRemoveFromPriceList(jobId) {
  const job = state.priceList.find(j => j.id === jobId);
  if (!job) return;
  const list = document.getElementById('jdeItemsList');
  if (!list) return;
  const rows = [...list.querySelectorAll('.jde-item-row')];
  // Remove the last matching row (most recently added)
  const matching = rows.filter(r => r.querySelector('.jde-item-name')?.value.trim().toLowerCase() === job.name.toLowerCase());
  if (matching.length === 0) return;
  matching[matching.length - 1].remove();
  if (!list.querySelector('.jde-item-row')) {
    list.innerHTML = '<p class="jde-empty-hint">No items yet - add from your price list above or use the button below.</p>';
  }
  jdeUpdateTotal();
  jdeRenderPicker(document.getElementById('jdePickerSearch')?.value || '');
}

function jdeUpdateTotal() {
  const prices = [...document.querySelectorAll('#jdeItemsList .jde-item-price')]
    .map(el => parseFloat(el.value) || 0);
  if (prices.length > 0) {
    const total = prices.reduce((s, p) => s + p, 0);
    const totalEl = document.getElementById('jdeTotalOverride');
    if (totalEl) totalEl.value = total.toFixed(2);
  }
}

function wireJdeRemoveButtons() {
  document.querySelectorAll('#jdeItemsList .jde-item-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.jde-item-row');
      if (row) row.remove();
      // Show empty hint if no rows left
      const list = document.getElementById('jdeItemsList');
      if (list && !list.querySelector('.jde-item-row')) {
        list.innerHTML = '<p class="jde-empty-hint">No items yet - add one below.</p>';
      }
    });
  });
}

function jdeAddItem() {
  const list = document.getElementById('jdeItemsList');
  // Remove empty hint if present
  const hint = list.querySelector('.jde-empty-hint');
  if (hint) hint.remove();
  const wrapper = document.createElement('div');
  wrapper.innerHTML = jdeItemRowHtml({ name: '', unitPrice: '' });
  const row = wrapper.firstElementChild;
  list.appendChild(row);
  row.querySelector('.jde-item-remove').addEventListener('click', () => {
    row.remove();
    if (!list.querySelector('.jde-item-row')) {
      list.innerHTML = '<p class="jde-empty-hint">No items yet - add one below.</p>';
    }
  });
  row.querySelector('.jde-item-name').focus();
}

// Pure data-save for the Job Details form -no UI side-effects.
function persistJobDetailsForm() {
  const docId = activeJobDetailsDocId;
  const doc = state.saved.find(d => d.id === docId);
  if (!doc) return;
  const previousQuote = { ...(doc.quote || {}) };
  const items = [];
  document.querySelectorAll('#jdeItemsList .jde-item-row').forEach(row => {
    const name  = (row.querySelector('.jde-item-name')?.value  || '').trim();
    const price = parseFloat(row.querySelector('.jde-item-price')?.value) || 0;
    if (name || price) items.push({ id: uid(), name, unitPrice: price, unit: '', qty: 1 });
  });
  const notes         = document.getElementById('jdeNotes')?.value || '';
  const totalOverride = parseFloat(document.getElementById('jdeTotalOverride')?.value) || 0;
  if (!doc.quote) doc.quote = {};
  restoreCustomerFieldsFromDocQuote(doc.quote, previousQuote);
  doc.quote.items = items;
  doc.quote.notes = notes;
  doc.updatedAt = new Date().toISOString();
  if (items.length > 0) {
    const subtotal  = items.reduce((s, i) => s + (i.unitPrice || 0) * (i.qty || 1), 0);
    const discPct   = parseFloat(doc.quote.discount) || 0;
    const afterDisc = subtotal * (1 - discPct / 100);
    const vatPct    = parseFloat(doc.quote.vatRate)   || 0;
    doc.total = afterDisc * (1 + vatPct / 100);
  } else if (totalOverride > 0) {
    doc.total = totalOverride;
  }
  doc.custName = buildCustName(doc.quote);
  save();
  queueSavedDocsSync(true);
  refreshSavedDocs();
}

function saveJobDetails() {
  persistJobDetailsForm();
  const docId = activeJobDetailsDocId;
  const doc   = state.saved.find(d => d.id === docId);
  if (!doc) return;

  document.getElementById('jobDetailsEditModal').style.display = 'none';

  // Keep customer dashboard data fresh in the background
  try {
    const groups = buildCustomerGroups();
    const updatedGroup = groups.find(g => g.docs.some(d => d.id === docId)) || activeCustomerGroup;
    if (updatedGroup) activeCustomerGroup = updatedGroup;
  } catch (e) { console.error('Dashboard refresh error:', e); }

  // Return to a live preview of the updated estimate/quote
  const html = buildDocHtml(doc, 'quote');
  openPreview(html, 'quote', docId);
  scrollMyJobsToTop();
  showSavedPopup('Job details saved.');
}

/* ===== DOCUMENT GENERATION ===== */
const DOC_CSS = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:13px;color:#1a1a1a;background:#e0e0e0;padding:20px 0}

  /* ── PAGE (full border, like the Word template) ── */
  .doc-wrap{max-width:760px;margin:0 auto;background:#fff;border:1px solid #b8b8b8}

  /* ── HEADER BAND (brand primary -set via inline style) ── */
  .doc-header{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:12px;padding:12px 18px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  /* Logo cell stretches to full header height */
  .doc-logo-cell{display:flex;align-items:center;align-self:stretch;min-width:48px;max-width:140px}
  .doc-logo{display:block;height:100%;width:auto;max-width:140px;min-height:40px;object-fit:contain}
  .doc-logo-placeholder{width:64px;height:100%;min-height:48px;border:1.5px dashed rgba(255,255,255,0.45);border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:0.72rem;color:rgba(255,255,255,0.65)}
  /* Business name -always one line, font scales down to fit */
  .doc-biz-name{font-weight:700;text-align:center;line-height:1.2;white-space:normal;word-break:break-word;font-size:2rem}
  /* Doc type badge -background set inline with accent colour */
  .doc-type-label{font-size:1.05rem;font-weight:800;text-align:center;text-transform:uppercase;letter-spacing:0.07em;line-height:1.2;padding:8px 14px;border-radius:7px;white-space:nowrap;-webkit-print-color-adjust:exact;print-color-adjust:exact}

  /* ── PREPARED BY / FOR (two cols, no dividers) ── */
  .doc-info{display:grid;grid-template-columns:1fr 1fr}
  .doc-info-col{padding:10px 18px}
  .doc-info-col h3{font-size:0.83rem;font-weight:700;margin-bottom:5px;text-transform:none;letter-spacing:0}
  .doc-info-col p{font-size:0.83rem;line-height:1.6;white-space:pre-wrap;color:#333}

  /* ── REFERENCE ROW -no internal borders; border-bottom = line above Itemised Breakdown ── */
  .doc-ref-row{display:grid;grid-template-columns:1fr 1fr 1fr;border-bottom:1px solid #c4c4c4}
  .doc-ref-cell{padding:6px 18px;font-size:0.83rem;display:flex;flex-direction:column;gap:2px}
  .ref-label{font-weight:700;white-space:nowrap}
  .ref-value{color:#333}

  /* ── BODY PADDING ── */
  .doc-body{padding:14px 18px 20px}

  /* ── INTRO ── */
  .doc-intro{font-size:0.83rem;line-height:1.3;color:#333;margin-bottom:14px}

  /* ── SECTION HEADINGS (sentence-case bold + thin rule, matching Word) ── */
  .doc-section-heading{font-size:0.88rem;font-weight:700;margin-top:16px;margin-bottom:0;padding-bottom:3px;border-bottom:1px solid #888;text-transform:none;letter-spacing:0}

  /* ── DESCRIPTION BOX (brand bg -set via inline style) ── */
  .doc-desc-box{border:1px solid #ccc;border-top:none;padding:10px 12px;min-height:70px;font-size:0.83rem;line-height:1.7;color:#aaa;font-style:italic;white-space:pre-wrap;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .doc-desc-box.filled{color:#333;font-style:normal}

  /* ── ITEMS TABLE (accent header -set via inline style) ── */
  .doc-items-table{width:100%;border-collapse:collapse;border:1px solid #ccc;border-top:none}
  .doc-items-table thead tr{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .doc-items-table thead th{padding:8px 10px;font-size:0.77rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;text-align:left;color:#fff;border-right:1px solid rgba(255,255,255,0.2)}
  .doc-items-table thead th:last-child{text-align:right;border-right:none}
  .doc-items-table thead th.r{text-align:right}
  .doc-items-table tbody td{padding:8px 10px;border-bottom:1px solid #e8e8e8;border-right:1px solid #e8e8e8;font-size:0.83rem;vertical-align:top}
  .doc-items-table tbody td:last-child{text-align:right;font-weight:600;border-right:none}
  .doc-items-table tbody td.r{text-align:right}
  .item-unit{display:block;font-size:0.71rem;color:#888;margin-top:1px}
  .totals-sep td{border-top:1.5px solid #bbb!important;border-bottom:none!important;border-right:none!important;padding:6px 0 0!important;background:transparent}
  .totals-row td{padding:3px 10px;font-size:0.82rem;border:none!important;background:transparent}
  .totals-row td.r{text-align:right}
  .totals-total{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .totals-total td{padding:8px 10px;font-size:0.9rem;font-weight:700;border:none!important;color:#fff}
  .totals-total td.r{text-align:right}

  /* ── TERMS TABLE ── */
  .doc-terms-table{width:100%;border-collapse:collapse;border:1px solid #ccc;border-top:none}
  .doc-terms-table td{padding:7px 12px;font-size:0.82rem;vertical-align:top;border-bottom:1px solid #e8e8e8;line-height:1.55}
  .doc-terms-table tr:last-child td{border-bottom:none}
  .t-label{font-weight:700;width:130px;border-right:1px solid #ccc!important;white-space:nowrap;color:#1a1a1a}
  .t-value{color:#333}

  /* ── GENERIC SECTIONS (invoice/receipt extras) ── */
  .section,.doc-section{margin-top:16px;padding-top:12px;border-top:1px solid #ddd}
  .section h3,.doc-section h3{font-size:0.75rem;text-transform:uppercase;letter-spacing:.07em;color:#888;margin-bottom:7px;font-weight:700}
  .section p,.doc-section p,.section ul,.doc-section ul{font-size:0.83rem;line-height:1.7;white-space:pre-wrap}
  .section ul,.doc-section ul{list-style:disc;padding-left:18px}

  /* ── SIG BLOCK (invoice/receipt) ── */
  .sig-block{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:24px}
  .sig-box{border:1.5px solid #ddd;border-radius:4px;padding:12px;min-height:80px;display:flex;flex-direction:column;justify-content:flex-end}
  .sig-label{font-size:0.75rem;color:#888;margin-top:8px;text-transform:uppercase;letter-spacing:.06em}
  .sig-img{max-height:60px;max-width:200px}
  .sig-typed{font-family:'Dancing Script',cursive;font-size:1.5rem;color:#1a1a1a}

  /* ── PAGE FOOTER ── */
  .doc-footer{padding:8px 18px;text-align:center;font-size:0.7rem;color:#aaa;border-top:1px solid #e0e0e0}

  /* ── ACCEPTANCE PAGE (quotes/estimates -same bordered box) ── */
  .doc-accept{max-width:760px;margin:20px auto 0;background:#fff;border:1px solid #b8b8b8;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:13px;color:#1a1a1a;page-break-before:always}
  .doc-accept-body{padding:22px 18px 20px}
  .doc-accept-heading{font-size:0.88rem;font-weight:700;padding-bottom:4px;margin-bottom:16px;text-transform:none;letter-spacing:0}
  .doc-accept-body>p{font-size:0.83rem;line-height:1.3;color:#333;margin-bottom:32px}
  .doc-sig-grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-bottom:32px}
  .doc-sig-box{min-height:72px;display:flex;flex-direction:column;justify-content:flex-end}
  .doc-sig-label{font-size:0.73rem;color:#666;margin-top:5px}
  .doc-sig-typed{font-family:'Dancing Script',cursive;font-size:1.4rem;color:#1a1a1a;display:block;margin-bottom:2px}
  .doc-sig-name{font-size:0.83rem;font-weight:600;color:#1a1a1a}
  .doc-accept-thanks{font-size:0.83rem;text-align:center;line-height:1.3;color:#333}

  /* ── PHOTOS ── */
  .photo-doc-page{page-break-before:always;padding-top:24px}
  .photo-doc-group{margin-top:16px}
  .photo-doc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:8px}
  .photo-doc-grid img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:4px;border:1px solid #ddd}

  /* ── MOBILE (≤ 520 px) ── */
  @media (max-width:520px){
    body{padding:0;background:#fff}
    .doc-wrap{border-left:none;border-right:none;max-width:100%}

    /* Header: tighten at small widths */
    .doc-header{gap:6px;padding:8px 10px}
    .doc-logo-cell{max-width:72px}
    .doc-logo{max-width:72px}
    .doc-biz-name{font-size:1.2rem}
    .doc-type-label{font-size:0.8rem;padding:5px 8px;letter-spacing:0.04em}

    /* Prepared by/for: stack vertically */
    .doc-info{grid-template-columns:1fr}
    .doc-info-col+.doc-info-col{border-left:none;border-top:1px solid #c4c4c4}

    /* Ref row: keep 3 cols but tighten */
    .doc-ref-cell{padding:5px 10px;font-size:0.77rem}

    /* Body */
    .doc-body{padding:10px 10px 14px}
    .doc-intro{margin-bottom:10px}
    .doc-section-heading{margin-top:12px}
    .doc-desc-box{padding:8px 10px;font-size:0.79rem}

    /* Items table */
    .doc-items-table{border-left:none;border-right:none}
    .doc-items-table thead th{padding:6px 5px;font-size:0.68rem;letter-spacing:0}
    .doc-items-table tbody td{padding:6px 5px;font-size:0.77rem}
    .item-unit{font-size:0.65rem}
    .totals-row td{padding:2px 5px;font-size:0.76rem}
    .totals-total td{padding:7px 6px;font-size:0.82rem}

    /* Terms */
    .doc-terms-table td{padding:5px 8px;font-size:0.77rem}
    .t-label{width:90px}

    /* Footer */
    .doc-footer{padding:6px 10px}

    /* Acceptance page */
    .doc-accept{margin-top:8px;border-left:none;border-right:none}
    .doc-accept-body{padding:14px 10px 14px}
    .doc-sig-grid{grid-template-columns:1fr;gap:16px}
    .doc-accept-thanks{font-size:0.79rem}
  }

  @media print{
    body{background:#fff;padding:0}
    .doc-wrap,.doc-accept{max-width:100%;margin:0;border:1px solid #b8b8b8}
    .doc-accept{margin-top:0}
  }
`;

function buildQuoteDoc() {
  const q = collectQuoteState();
  // Always pull the live items from state -collectQuoteState may be called
  // before the DOM is fully settled in some edge cases
  q.items = [...state.quote.items];
  const tempDoc = {
    quote: q,
    company: { ...state.company },
    custName: buildCustName(q),
    total: calcTotal(q)
  };
  return buildDocHtml(tempDoc, 'quote');
}

function buildDocHtml(doc, docType, extra = {}) {
  ensureDocumentRefAndDate(doc);
  const q  = doc.quote;
  const co = doc.company || state.company;

  // ── Brand colours -read live picker values so the document always
  //    reflects the currently selected colours, even before Save ──
  const primary = document.getElementById('colourHeader')?.value || state.company.brandPrimary || DEFAULT_COLOURS.primary;
  const accent  = document.getElementById('colourAccent')?.value || state.company.brandAccent  || DEFAULT_COLOURS.accent;
  const bgCol   = document.getElementById('colourBg')?.value     || state.company.brandBg      || DEFAULT_COLOURS.bg;

  // ── Financials ───────────────────────────────────────────────────
  const sub       = (q.items||[]).reduce((s,i) => s + i.unitPrice * i.qty, 0);
  const vatRate   = q.vatRate === 'custom' ? parseFloat(q.vatCustom)||0 : parseFloat(q.vatRate)||0;
  const disc      = parseFloat(q.discount)||0;
  const afterDisc = sub - sub * disc / 100;
  const vatAmt    = afterDisc * vatRate / 100;
  const total     = doc.total != null ? doc.total : afterDisc + vatAmt;

  // ── Doc labels ───────────────────────────────────────────────────
  let docLabel  = q.type || 'Estimate';
  let refLabel  = q.ref || doc.ref || doc.document_number || '';
  let dateLabel = q.date || doc.date || toSupabaseDate(doc.createdAt) || todayStr();
  if (docType === 'invoice') { docLabel = 'Invoice'; refLabel = extra.invRef || doc.invoiceRef || doc.ref || q.ref || ''; dateLabel = extra.invDate || q.date || doc.date || todayStr(); }
  if (docType === 'receipt') { docLabel = 'Receipt'; refLabel = extra.recRef || doc.receiptRef || doc.ref || q.ref || ''; dateLabel = extra.date || q.date || doc.date || todayStr(); }

  const isQuote = (docType !== 'invoice' && docType !== 'receipt');

  // ── Names -prefer live state so name changes always show immediately ──
  const liveFullName = [(state.company.firstName||''), (state.company.lastName||'')].filter(Boolean).join(' ');
  const snapFullName = [(co.firstName||''), (co.lastName||'')].filter(Boolean).join(' ');
  const authFullName = liveFullName || snapFullName;
  const bizName      = state.company.businessName || co.businessName || authFullName;
  const custName     = [q.custTitle, q.custFirstName, q.custLastName].filter(Boolean).join(' ');

  // ── Address blocks ───────────────────────────────────────────────
  const vatNum    = state.company.vatNumber || co.vatNumber || '';
  const bizLines  = [authFullName, co.address, co.postcode, co.phone, co.email, co.website, vatNum ? `VAT Reg No: ${vatNum}` : ''].filter(Boolean).join('\n');
  const custLines = [custName, q.custAddr, q.custPostcode, q.custEmail, q.custPhone].filter(Boolean).join('\n');

  // ── Logo -prefer doc snapshot, fall back to live state so it always shows ──
  const logoSrc = co.logo || state.company.logo || '';
  // ── Header text colours -auto dark/light based on header and accent backgrounds ──
  const headerTextCol  = isColorLight(primary) ? '#1a1a1a' : '#ffffff';
  const accentTextCol  = isColorLight(accent)  ? '#1a1a1a' : '#ffffff';
  const logoPlaceholderStyle = isColorLight(primary)
    ? 'border:1.5px dashed rgba(0,0,0,0.3);color:rgba(0,0,0,0.5)'
    : 'border:1.5px dashed rgba(255,255,255,0.45);color:rgba(255,255,255,0.65)';
  // Logo wrapped in a flex cell so it stretches to the full header height
  const logoHtml = `<div class="doc-logo-cell">${
    logoSrc
      ? `<img src="${logoSrc}" alt="Logo" class="doc-logo">`
      : `<div class="doc-logo-placeholder" style="${logoPlaceholderStyle}">Logo</div>`
  }</div>`;

  // ── Valid for ────────────────────────────────────────────────────
  let validForText = '';
  if (isQuote) {
    if      (q.validFor === 'custom') validForText = q.validCustom ? `${q.validCustom} days` : '';
    else if (q.validFor)              validForText = `${q.validFor} days`;
  }

  // ── Line items (grouped by Rates / Services / Materials) ────────
  const allItems = q.items || [];
  const grpRates     = allItems.filter(i => i.category === 'rate');
  const grpServices  = allItems.filter(i => !i.category || i.category === 'service' || i.category === 'labour');
  const grpMaterials = allItems.filter(i => i.category === 'materials');
  const multiGroup   = [grpRates, grpServices, grpMaterials].filter(g => g.length > 0).length > 1;

  const itemRow = item => `
    <tr>
      <td>${esc(item.name)}${item.unit ? `<span class="item-unit">${esc(item.unit)}</span>` : ''}</td>
      <td class="r">${item.qty}</td>
      <td class="r">${fmtPrice(item.unitPrice)}</td>
      <td class="r">${fmtPrice(item.unitPrice * item.qty)}</td>
    </tr>`;
  const groupHeader = label => `
    <tr class="doc-group-header">
      <td colspan="4" style="padding:6px 10px 3px;font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#888;border-bottom:1px solid #e0d9cf;">${label}</td>
    </tr>`;
  const renderGroup = (label, items) => {
    if (!items.length) return '';
    return (multiGroup ? groupHeader(label) : '') + items.map(itemRow).join('');
  };

  const itemsHtml = allItems.length
    ? renderGroup('Rates', grpRates) + renderGroup('Services', grpServices) + renderGroup('Materials', grpMaterials)
    : `<tr><td colspan="4" style="text-align:center;color:#aaa;padding:14px;font-style:italic">No items added. Go back and add jobs in Step 2.</td></tr>`;

  // ── Totals -label in col 3 (right-aligned), amount in col 4 (right-aligned) ──
  const tCell = (label, value, bold = false) =>
    `<tr class="totals-row">
      <td colspan="2" style="border:none;padding:0"></td>
      <td style="text-align:right;padding:3px 10px;font-size:0.79rem;${bold?'font-weight:700':''}">${label}</td>
      <td style="text-align:right;padding:3px 10px;font-size:0.82rem;">${value}</td>
    </tr>`;
  const discRow = disc > 0 ? tCell(`Discount (${disc}%):`, `-${fmtPrice(sub*disc/100)}`) : '';

  // ── Prior payments (deposit / part payment rows under TOTAL) ─────
  const docPayments    = getDocPayments(doc).filter(p => p.amount > 0);
  const totalPaid      = docPayments.reduce((s, p) => s + (p.amount || 0), 0);
  const balanceDue     = Math.max(0, total - totalPaid);
  const paymentRows    = docPayments.map(p =>
    tCell(`${paymentTypeDocLabel(p.type)}:`, `-${fmtPrice(p.amount)}`)
  ).join('');
  const balanceRow     = totalPaid > 0
    ? `<tr class="totals-total" style="background:#2e7d32">
         <td colspan="3" style="text-align:right;padding:8px 10px;font-size:0.9rem;font-weight:700;color:#fff;border:none">BALANCE DUE:</td>
         <td style="text-align:right;padding:8px 10px;font-size:0.9rem;font-weight:700;color:#fff;border:none">${fmtPrice(balanceDue)}</td>
       </tr>`
    : '';

  const totalsRows = `
    <tr class="totals-sep"><td colspan="4"></td></tr>
    ${tCell('Subtotal:', fmtPrice(afterDisc), true)}
    ${discRow}
    ${tCell(`VAT${vatRate>0?` (${vatRate}%)`:'  (if applicable)'}:`, vatRate>0?fmtPrice(vatAmt):'-')}
    <tr class="totals-total" style="background:${accent}">
      <td colspan="3" style="text-align:right;padding:8px 10px;font-size:0.9rem;font-weight:700;color:#fff;border:none">TOTAL:</td>
      <td style="text-align:right;padding:8px 10px;font-size:0.9rem;font-weight:700;color:#fff;border:none">${fmtPrice(total)}</td>
    </tr>
    ${paymentRows}
    ${balanceRow}`;

  // ── Description of work -only shown when a description was entered ──
  const descHtml = q.notes
    ? `<div class="doc-section-heading">Description of Work</div>
       <div class="doc-desc-box filled" style="background:${bgCol};-webkit-print-color-adjust:exact;print-color-adjust:exact">${esc(q.notes)}</div>`
    : '';

  // ── Terms table -not shown on receipts ─────────────────────────
  const termsHtml = docType !== 'receipt' ? buildNewTermsHtml(q) : '';

  // ── Invoice / receipt extras ────────────────────────────────────
  let extraHtml = '';
  if (docType === 'invoice') {
    // Prior payments (deposits / part payments made before invoice was generated)
    const priorPayments = getDocPayments(doc).filter(p => p.amount > 0);
    if (priorPayments.length > 0) {
      const totalPrior = priorPayments.reduce((s, p) => s + (p.amount || 0), 0);
      const balance    = Math.max(0, (doc.total || 0) - totalPrior);
      const payLines   = priorPayments.map(p => {
        return `${paymentTypeDocLabel(p.type)}: <strong>${fmtPrice(p.amount)}</strong> on ${formatDate(p.date)}`;
      }).join('<br>');
      extraHtml += `<div class="section"><h3>Payments Already Received</h3><p>${payLines}</p><p style="margin-top:6px">Total Received: <strong>${fmtPrice(totalPrior)}</strong><br>Balance Due: <strong>${fmtPrice(balance)}</strong></p></div>`;
    }
    if (extra.dueDate) extraHtml += `<div class="section"><h3>Payment Due</h3><p>${formatDate(extra.dueDate)}</p>${refLabel ? `<p style="margin-top:6px;font-size:0.85em;color:#666">Please use <strong>${esc(refLabel)}</strong> as your payment reference to help us process your payment quickly.</p>` : '<p style="margin-top:6px;font-size:0.85em;color:#666">Please use the invoice number as your payment reference to help us process your payment quickly.</p>'}</div>`;
    extraHtml += buildPaymentSection(co, docType, extra.payMethod);
    if (extra.notes)   extraHtml += `<div class="section"><h3>Notes</h3><p>${esc(extra.notes)}</p></div>`;
  } else if (docType === 'receipt') {
    const methodLine   = extra.method ? `<br>Paid by: ${esc(extra.method)}` : '';
    const payTypeLabel = paymentTypeDocLabel(extra.paymentType);
    extraHtml = `<div class="section"><h3>${payTypeLabel}</h3><p>Amount: <strong>${fmtPrice(parseFloat(extra.amount)||0)}</strong><br>Date: ${formatDate(extra.date||todayStr())}${methodLine}</p></div>`;
    if (extra.notes) extraHtml += `<div class="section"><h3>Notes</h3><p>${esc(extra.notes)}</p></div>`;
  }

  // ── Sig block for invoice/receipt ───────────────────────────────
  const sigHtml = !isQuote ? buildSigSection(q, co, docType) : '';

  // ── QR code ──────────────────────────────────────────────────────
  const qrSrc = state.company.qrCode || co.qrCode || '';
  const qrHtml = qrSrc ? `
    <div class="section doc-qr-section" style="text-align:center;padding-top:10px">
      <img src="${qrSrc}" alt="QR Code" style="width:90px;height:90px;object-fit:contain">
    </div>` : '';

  // ── Photos ───────────────────────────────────────────────────────
  const photosHtml = extra.includePhotos ? buildPhotosSection(doc) : '';

  // ── Acceptance page (quotes / estimates) ────────────────────────
  let acceptancePage = '';
  if (isQuote) {
    const sigText    = q.custSigText || '';
    const authName   = q.authSig || authFullName || bizName;
    const sigContent = sigText ? `<span class="doc-sig-typed">${esc(sigText)}</span>` : '';
    acceptancePage = `
      <div class="doc-accept" style="background:${bgCol};-webkit-print-color-adjust:exact;print-color-adjust:exact">
        <div class="doc-accept-body">
          <div class="doc-accept-heading">Acceptance</div>
          <p>Please let me know if this meets your needs. To accept this ${(q.type||'quote').toLowerCase()}, click the button below to sign.</p>
          <div style="display:flex;gap:12px;margin:18px 0">
            <div style="flex:1;padding:13px;border-radius:10px;background:#4a5d3a;color:#fff;text-align:center;font-weight:700;font-size:1rem">✔ Accept</div>
            <div style="flex:1;padding:13px;border-radius:10px;background:#fff;color:#C4553A;border:1.5px solid #C4553A;text-align:center;font-weight:700;font-size:1rem">✘ Decline</div>
          </div>
          <div class="doc-sig-grid">
            <div class="doc-sig-box">
              ${sigContent}
              ${authName ? `<div class="doc-sig-name">${esc(authName)}</div>` : ''}
              <div class="doc-sig-label">Authorised Signature</div>
            </div>
            <div class="doc-sig-box">
              <div class="doc-sig-label">Customer Signature</div>
            </div>
          </div>
          <p class="doc-accept-thanks">Thank you for the opportunity. I look forward to hearing from you.<br>Kind regards, ${esc(authName)}</p>
        </div>
        <div class="doc-footer">Powered by LexiHandlesIt.com</div>
      </div>`;
  }

  return `
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600&display=swap" rel="stylesheet">
    <style>${DOC_CSS}</style>
    <div class="doc-wrap" style="background:${bgCol};-webkit-print-color-adjust:exact;print-color-adjust:exact">
      <div class="doc-header" style="background:${primary};-webkit-print-color-adjust:exact;print-color-adjust:exact">
        ${logoHtml}
        <div class="doc-biz-name" style="color:${headerTextCol}" id="docBizName">${esc(bizName)}</div>
        <div class="doc-type-label" style="background:${accent};color:${accentTextCol}">${esc(docLabel)}</div>
      </div>
      <div class="doc-info">
        <div class="doc-info-col">
          <h3>Prepared By</h3>
          <p>${esc(bizLines)}</p>
        </div>
        <div class="doc-info-col">
          <h3>Prepared For</h3>
          <p>${esc(custLines)}</p>
        </div>
      </div>
      <div class="doc-ref-row">
        <div class="doc-ref-cell"><span class="ref-label">Reference No:</span><span class="ref-value">${esc(refLabel)}</span></div>
        <div class="doc-ref-cell"><span class="ref-label">Date:</span><span class="ref-value">${dateLabel ? formatDate(dateLabel) : ''}</span></div>
        <div class="doc-ref-cell">${isQuote ? `<span class="ref-label">Valid for:</span><span class="ref-value">${esc(validForText)}</span>` : ''}</div>
      </div>
      <div class="doc-body">
        ${descHtml}
        <table class="doc-items-table">
          <thead><tr style="background:${accent}">
            <th>Itemised Breakdown</th>
            <th class="r">Qty</th>
            <th class="r">Unit Price</th>
            <th class="r" style="border-right:none">Total</th>
          </tr></thead>
          <tbody>${itemsHtml}${totalsRows}</tbody>
        </table>
        ${extraHtml}
        ${termsHtml}
        ${sigHtml}
        ${qrHtml}
        ${photosHtml}
      </div>
      ${isQuote ? '' : '<div class="doc-footer">Powered by LexiHandlesIt.com</div>'}
    </div>
    ${acceptancePage}
    <script>
    (function(){
      var el = document.getElementById('docBizName');
      if(!el) return;
      var run = function(){
        var fs = 32;
        el.style.fontSize = fs + 'px';
        var parent = el.parentElement;
        while(el.scrollWidth > el.offsetWidth + 1 && fs > 8){
          fs -= 0.5;
          el.style.fontSize = fs + 'px';
        }
      };
      if(document.readyState === 'loading'){
        document.addEventListener('DOMContentLoaded', run);
      } else { run(); }
    })();
    </script>`;
}

function buildPaymentSection(co, docType, preferredMethod = '') {
  if (docType !== 'invoice') return '';
  const coMethods  = co.payMethods || [];
  // preferredMethod may be a string (legacy) or array (new multi-select)
  const preferred  = Array.isArray(preferredMethod)
    ? preferredMethod
    : (preferredMethod ? [preferredMethod] : []);

  // If specific methods chosen, only show those; otherwise fall back to all company methods
  const show = preferred.length > 0 ? preferred : null;

  let lines = [];
  const want = m => !show || show.some(s => s.toLowerCase().includes(m));

  if (want('bank') && coMethods.includes('bank') && co.bankAcc) {
    lines.push(`Bank Transfer\nAccount Name: ${co.bankAccHolder || ''}\nBank: ${co.bankName || ''}\nSort Code: ${co.bankSort || ''}\nAccount Number: ${co.bankAcc}`);
  }
  if (want('cash') && coMethods.includes('cash')) lines.push('Cash on Completion');
  if (want('paypal') && coMethods.includes('paypal') && co.paypalRef) lines.push(`PayPal: ${co.paypalRef}`);
  if (want('card')) lines.push('Card Payment Accepted');
  if (want('other') && coMethods.includes('other') && co.payOther) lines.push(co.payOther);

  // If preferred methods selected but no company details match, just list the chosen methods
  if (!lines.length && preferred.length) lines = [...preferred];

  if (!lines.length) return '';
  return `<div class="section"><h3>Payment Details</h3><p style="white-space:pre-line">${esc(lines.join('\n\n'))}</p></div>`;
}

function buildPhotosSection(doc) {
  const photos = doc.photos || {};
  const before = (photos.before || []).slice(0, 3);
  const after = (photos.after || []).slice(0, 3);
  if (!before.length && !after.length) return '';
  const group = (title, list) => !list.length ? '' : `
    <div class="photo-doc-group">
      <h3>${title}</h3>
      <div class="photo-doc-grid">${list.map(src => `<img src="${src}" alt="${title} photo">`).join('')}</div>
    </div>`;
  return `
    <div class="section photo-doc-page">
      <h3>Before and After Photos</h3>
      ${group('Before', before)}
      ${group('After', after)}
    </div>`;
}

function buildTermsSection(q) {
  // Legacy -kept for compatibility; new output uses buildNewTermsHtml
  const presets = {
    payment30:       'Payment due within 30 days of invoice date.',
    depositRequired: 'A 50% deposit is required before work commences.',
    quotationValid:  'This quotation is valid for 30 days from the date shown.',
    materialsExtra:  'Materials are not included unless stated above.',
    cancellation:    'Cancellation within 48 hours of scheduled start date may incur a charge.'
  };
  const lines = (q.selectedTerms || []).map(k => presets[k]).filter(Boolean);
  if (q.customTerms) lines.push(q.customTerms);
  if (!lines.length) return '';
  return `<div class="section"><h3>Terms &amp; Conditions</h3><ul>${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul></div>`;
}

function buildNewTermsHtml(q) {
  const presets = {
    payment30:       'Payment due within 30 days of invoice date.',
    depositRequired: 'A 50% deposit is required before work commences.',
    quotationValid:  'This quotation is valid for 30 days from the date shown.',
    materialsExtra:  'Materials are not included unless stated above.',
    cancellation:    'Cancellation within 48 hours of scheduled start date may incur a charge.'
  };
  const payKeys  = new Set(['payment30', 'depositRequired']);
  const sel      = q.selectedTerms || [];
  const payLines = sel.filter(k =>  payKeys.has(k)).map(k => presets[k]);
  const conLines = sel.filter(k => !payKeys.has(k)).map(k => presets[k]);
  const addText  = q.customTerms || '';
  if (!payLines.length && !conLines.length && !addText) return '';
  return `
    <div class="doc-section-heading">Terms and Conditions</div>
    <table class="doc-terms-table">
      <tr><td class="t-label">Payment Terms</td><td class="t-value">${esc(payLines.join(' '))}</td></tr>
      <tr><td class="t-label">Contract</td><td class="t-value">${esc(conLines.join(' '))}</td></tr>
      <tr><td class="t-label">Additional Terms</td><td class="t-value">${esc(addText)}</td></tr>
    </table>`;
}

function buildSigSection(q, co, docType) {
  const liveFullName = [(state.company.firstName||''), (state.company.lastName||'')].filter(Boolean).join(' ');
  const snapFullName = [(co.firstName||''), (co.lastName||'')].filter(Boolean).join(' ');
  const authFullName = liveFullName || snapFullName;

  // Receipts: just show the authorised name in cursive -no stored sig text, no customer box
  if (docType === 'receipt') {
    if (!authFullName) return '';
    return `
      <div class="sig-block">
        <div class="sig-box">
          <span class="sig-typed">${esc(authFullName)}</span>
          <div style="font-size:0.9rem;font-weight:600">${esc(authFullName)}</div>
          <div class="sig-label">Authorised Signature</div>
        </div>
      </div>`;
  }

  // Invoice / quote: use stored sig text
  const sigText = q.custSigText || document.getElementById('custSigText')?.value || '';
  if (!q.authSig && !sigText && !authFullName) return '';
  const authName = authFullName || q.authSig || co.businessName || '';
  const authSigContent = sigText ? `<span class="sig-typed">${esc(sigText)}</span>` : '';

  return `
    <div class="sig-block">
      <div class="sig-box">
        ${authSigContent}
        ${authName ? `<div style="font-size:0.9rem;font-weight:600">${esc(authName)}</div>` : ''}
        <div class="sig-label">Authorised Signature</div>
      </div>
      <div class="sig-box">
        <div class="sig-label">Customer Signature &amp; Date</div>
      </div>
    </div>`;
}

/* ===== PRINT & SHARE ===== */
function getDocFilename(type) {
  const ref = getVal('docRef') || type;
  return `${ref}-${getVal('custLastName') || 'quote'}.html`.replace(/\s+/g, '-');
}

function getDocFilenameFromRef(ref) {
  return `${ref}.html`.replace(/\s+/g, '-');
}

function wrapDoc(inner) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Document</title></head><body>${inner}</body></html>`;
}

function printDoc(html) {
  printRaw(html);
}

function downloadCustomerDashboard(groupName, html) {
  const safeName = (groupName || 'Customer').replace(/[^a-zA-Z0-9 \-_.]/g, '').trim().replace(/\s+/g, '-');
  const filename = `${safeName}-Dashboard.html`;
  const css = `
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;color:#2C2C2C;background:#fff;padding:24px;max-width:700px;margin:0 auto}
    .customer-dashboard-card{border:1px solid #DDD5C8;border-radius:8px;overflow:hidden;padding:16px}
    .cdv-header{border-bottom:1.5px solid #DDD5C8;padding-bottom:12px;margin-bottom:14px}
    .cdv-contact{display:flex;flex-direction:column;gap:4px}
    .cdv-contact-line{display:flex;align-items:flex-start;gap:6px;font-size:0.88rem;color:#2C2C2C;line-height:1.4}
    .cdv-summary-bar{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;background:#F5F0E8;border-radius:8px;padding:12px;margin-bottom:16px}
    .cdv-summary-item{display:flex;flex-direction:column;gap:2px;text-align:center}
    .cdv-summary-label{font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:#888;margin-bottom:2px}
    .cdv-summary-value{font-size:1rem;font-weight:700;color:#2C2C2C}
    .cdv-paid{color:#4A7C59}.cdv-outstanding{color:#C0392B}
    .cdv-jobs-list{display:flex;flex-direction:column;gap:12px}
    .cdv-job-card{border:1.5px solid #DDD5C8;border-radius:10px;overflow:hidden}
    .cdv-job-header{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#F5F0E8;border-bottom:1px solid #DDD5C8}
    .cdv-job-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
    .cdv-job-ref{font-weight:700;font-size:0.95rem;color:#7D5730}
    .cdv-job-date{font-size:0.82rem;color:#888}
    .cdv-items{padding:10px 14px 6px}
    .cdv-item-row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f0ebe3;font-size:0.9rem}
    .cdv-item-row:last-child{border-bottom:none}
    .cdv-item-name{flex:1;color:#2C2C2C}.cdv-item-qty{font-size:0.78rem;color:#999;margin-left:4px}.cdv-item-price{font-weight:600;white-space:nowrap}
    .cdv-totals{padding:8px 14px 10px;border-top:1px solid #DDD5C8;background:#F5F0E8}
    .cdv-total-row{display:flex;justify-content:space-between;padding:2px 0;font-size:0.92rem;color:#2C2C2C}
    .cdv-discount-row{color:#4A7C59}.cdv-vat-row{opacity:0.75}
    .cdv-grand-total{font-weight:700;font-size:1rem;margin-top:4px;border-top:1px solid #DDD5C8;padding-top:4px}
    .cdv-section{padding:10px 14px;border-top:1px solid #DDD5C8}
    .cdv-section-label{font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:#888;font-weight:600;margin-bottom:6px}
    .cdv-payment-row{display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #DDD5C8;font-size:0.88rem}
    .cdv-payment-row:last-child{border-bottom:none}
    .cdv-pay-num{min-width:82px;color:#888;font-size:0.82rem;flex-shrink:0}.cdv-pay-date{flex:1;color:#2C2C2C}.cdv-pay-amount{font-weight:700;white-space:nowrap}
    .cdv-outstanding-row .cdv-pay-amount{color:#C0392B}
    .cdv-paid-stamp{font-size:0.82rem;color:#4A7C59;font-weight:600}
    .cdv-note-text{font-size:0.88rem;line-height:1.55;color:#2C2C2C;white-space:pre-wrap}
    .cdv-private{background:#fffbf0;border-left:3px solid #e6b800}
    .cdv-photo-group{margin-bottom:8px}.cdv-photo-label{font-size:0.78rem;font-weight:600;color:#888;margin-bottom:4px}
    .cdv-photo-grid{display:flex;gap:8px;flex-wrap:wrap}.cdv-photo-thumb{width:80px;height:80px;object-fit:cover;border-radius:6px;border:1.5px solid #DDD5C8}
    .cdv-job-actions{display:none}
    .type-badge{display:inline-flex;align-items:center;padding:3px 10px;border-radius:12px;font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em}
    .type-badge.estimate{background:#e3f0d4;color:#6B7C5C}.type-badge.quote{background:#7D5730;color:#fff}
    .type-badge.invoiced{background:#dbeafe;color:#1d4ed8}.type-badge.paid{background:#dcfce7;color:#166534}
    .type-badge.overdue{background:#fecaca;color:#C0392B}`;
  const fullHtml = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${esc(groupName)} - Dashboard</title><style>${css}</style></head><body>${html}</body></html>`;
  const blob = new Blob([fullHtml], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function printRaw(inner) {
  const win = window.open('', '_blank');
  if (!win) { toast('Pop-up blocked. Please allow pop-ups for printing.', 'error'); return; }
  win.document.write(wrapDoc(inner));
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); win.close(); }, 400);
}

/* ── Upload a document to Supabase Storage and return its public URL ── */
async function uploadDocToStorage(htmlStr, filename, acceptToken = '', docType = '') {
  if (!lexiSupabase || !lexiAuthSession?.user?.id) {
    console.warn('Document storage skipped: not logged in or Supabase not ready');
    toast('Document link skipped: not signed in to Lexi', 'error', 8000);
    return null;
  }
  try {
    const blob = new Blob([htmlStr], { type: 'text/html' });
    const safeFilename = (filename || 'document.html').replace(/[^a-zA-Z0-9._-]/g, '-');
    const path = `${lexiAuthSession.user.id}/${safeFilename}`;
    console.log('Uploading doc to storage:', path);
    const { error } = await lexiSupabase.storage
      .from('Documents')
      .upload(path, blob, { contentType: 'text/html', upsert: true });
    if (error) throw error;
    const { data } = lexiSupabase.storage.from('Documents').getPublicUrl(path);
    const storageUrl = data?.publicUrl || null;
    console.log('Doc storage URL:', storageUrl);
    if (!storageUrl) {
      toast('Document uploaded but no public URL returned -check the Documents bucket is set to Public in Supabase Storage.', 'error', 10000);
      return null;
    }
    // Use a short view URL — just pass the storage path so the link stays short
    // enough for email clients (Outlook etc.) to auto-hyperlink it.
    // ALWAYS point at the live app: this link is opened by the customer on
    // their own device, and the doc itself lives in Supabase cloud storage,
    // so a localhost/file:// origin would produce a dead link.
    const appBase = LIVE_APP_URL.replace(/\/$/, '');
    let viewUrl = `${appBase}/view.html?path=${encodeURIComponent(path)}`;
    // Carry the acceptance token + business name + doc type so the single
    // customer link can both SHOW the document and let them accept/decline it.
    if (acceptToken) {
      const biz  = (state.company?.businessName || [state.company?.firstName, state.company?.lastName].filter(Boolean).join(' ') || '').trim();
      const type = (docType || 'quote').toLowerCase();
      viewUrl += `&token=${encodeURIComponent(acceptToken)}`;
      if (biz)  viewUrl += `&biz=${encodeURIComponent(biz)}`;
      if (type) viewUrl += `&type=${encodeURIComponent(type)}`;
    }
    console.log('View URL:', viewUrl);
    toast('Document link generated successfully.', 'success', 3000);
    return viewUrl;
  } catch (e) {
    console.warn('Document storage upload failed:', e);
    toast(`Document link failed: ${e?.message || 'storage error'}`, 'error', 8000);
    return null;
  }
}

async function sendDoc(html, filename, message = '', custEmail = '', custPhone = '', passedDocType = '', acceptToken = '') {
  const htmlStr = wrapDoc(html);

  // Upload to Supabase Storage for a permanent shareable link
  const docUrl = await uploadDocToStorage(htmlStr, filename, acceptToken, passedDocType);

  sendDocRaw(htmlStr, filename, message, custEmail, docUrl, custPhone, passedDocType);
}

function showSendMethodPicker(onEmail, onWhatsApp, onCopy, hasEmail = false, hasPhone = false) {
  const W = '#7D5730';
  const SVG_EMAIL = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:7px;flex-shrink:0"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`;
  const SVG_WA    = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:7px;flex-shrink:0"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  const SVG_COPY  = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:7px;flex-shrink:0"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  const fillBtn   = `display:flex;align-items:center;justify-content:center;width:100%;padding:14px;margin-bottom:10px;border-radius:10px;border:none;background:${W};color:#fff;font-size:1rem;font-weight:600;cursor:pointer`;
  const outBtn    = `display:flex;align-items:center;justify-content:center;width:100%;padding:12px;margin-bottom:10px;border-radius:10px;border:1.5px solid ${W};background:#fff;color:${W};font-size:0.95rem;font-weight:600;cursor:pointer`;
  const inputStyle = `width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #ccc;border-radius:8px;font-size:0.9rem;margin-bottom:8px;outline:none`;
  const saveBtn   = `display:flex;align-items:center;justify-content:center;width:100%;padding:11px;border-radius:10px;border:none;background:${W};color:#fff;font-size:0.95rem;font-weight:600;cursor:pointer;margin-bottom:6px`;

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px';

  const render = () => {
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:28px 24px;max-width:320px;width:100%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.18)">
        <div style="font-size:1.3rem;font-weight:700;margin-bottom:6px;color:#333">How would you like to send?</div>
        <div style="color:#777;font-size:0.9rem;margin-bottom:22px">Choose how to share this document with your customer</div>
        <button id="_smpCopy"  style="${outBtn}">${SVG_COPY}Copy Message</button>
        <button id="_smpWA"    style="${hasPhone ? fillBtn : outBtn}">${SVG_WA}WhatsApp</button>
        <button id="_smpEmail" style="${hasEmail ? fillBtn : outBtn}">${SVG_EMAIL}Email</button>
        <button id="_smpCancel" style="display:block;width:100%;padding:10px;border-radius:10px;border:none;background:transparent;color:#aaa;font-size:0.88rem;cursor:pointer;margin-top:4px">Cancel</button>
      </div>`;

    const close = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };

    const showCapture = (type) => {
      const isPhone = type === 'phone';
      const label   = isPhone ? 'Add a WhatsApp number for this customer' : 'Add an email address for this customer';
      const ph      = isPhone ? 'Phone number' : 'Email address';
      const inputId = isPhone ? '_smpPhoneIn' : '_smpEmailIn';
      overlay.querySelector('div > div').innerHTML = `
        <div style="font-size:1.1rem;font-weight:700;margin-bottom:8px;color:#333">${label}</div>
        <input id="${inputId}" type="${isPhone ? 'tel' : 'email'}" placeholder="${ph}" style="${inputStyle}">
        <button id="_smpSaveDetail" style="${saveBtn}">Save &amp; Send</button>
        <button id="_smpBackPicker" style="display:block;width:100%;padding:8px;border:none;background:transparent;color:#aaa;font-size:0.88rem;cursor:pointer">← Back</button>`;

      overlay.querySelector('#_smpSaveDetail').addEventListener('click', () => {
        const val = overlay.querySelector(`#${inputId}`).value.trim();
        if (!val) { overlay.querySelector(`#${inputId}`).style.borderColor = '#C4553A'; return; }
        // Build the customer data from the document being sent, not just the
        // (possibly empty) live form, so the detail lands on the right customer.
        const activeDoc = activeDocId ? state.saved.find(d => d.id === activeDocId) : null;
        const baseQuote = { ...(activeDoc?.quote || {}), ...state.quote };
        const merged = isPhone
          ? { ...baseQuote, custPhone: val }
          : { ...baseQuote, custEmail: val };

        if (isPhone) state.quote.custPhone = val; else state.quote.custEmail = val;

        // Mirror onto the saved document so it shows next time too
        if (activeDoc) {
          activeDoc.quote = activeDoc.quote || {};
          if (isPhone) activeDoc.quote.custPhone = val; else activeDoc.quote.custEmail = val;
        }

        // Persist to the customer dashboard (find-or-create) and sync to cloud.
        // Runs unconditionally so it works even when no prior customer record exists.
        upsertLocalCustomer(merged);   // calls save() internally
        save();
        queueCustomerSync(merged);
        if (typeof refreshSavedDocs === 'function') refreshSavedDocs();

        close();
        if (isPhone) onWhatsApp(val); else onEmail(val);
      });
      overlay.querySelector('#_smpBackPicker').addEventListener('click', render);
    };

    overlay.querySelector('#_smpCopy').addEventListener('click',   () => { close(); onCopy(); });
    overlay.querySelector('#_smpCancel').addEventListener('click', close);
    overlay.querySelector('#_smpWA').addEventListener('click',    () => { if (hasPhone) { close(); onWhatsApp(); } else { showCapture('phone'); } });
    overlay.querySelector('#_smpEmail').addEventListener('click', () => { if (hasEmail) { close(); onEmail(); }   else { showCapture('email'); } });
  };

  render();
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); } });
}

async function sendDocRaw(htmlStr, filename, message = '', custEmail = '', docUrl = null, custPhone = '', passedDocType = '') {
  const rawType = passedDocType || filename.match(/^(estimate|quote|invoice|receipt)/i)?.[0] || 'document';
  const docType = rawType.charAt(0).toUpperCase() + rawType.slice(1).toLowerCase();
  const bizName = state.company?.businessName || [state.company?.firstName, state.company?.lastName].filter(Boolean).join(' ') || 'Lexi Handles It';
  const subject = `Your ${docType} from ${bizName}`;

  // Replace the {VIEW_LINK} placeholder with the real storage URL (or remove the line if unavailable)
  let fullMsg = message;
  if (fullMsg.includes('{VIEW_LINK}')) {
    if (docUrl) {
      fullMsg = fullMsg.replace('{VIEW_LINK}', docUrl);
    } else {
      // Remove the whole "You can view..." paragraph if no link
      fullMsg = fullMsg.replace(/You can view your .+? by clicking the link below:\n\{VIEW_LINK\}\n\n/s, '');
      fullMsg = fullMsg.replace('\n{VIEW_LINK}\n', '\n');
    }
  }

  const stampSentVia = (via) => {
    const doc = activeDocId ? state.saved.find(d => d.id === activeDocId) : null;
    if (doc && doc.sentVia !== via) { doc.sentVia = via; save(); }
  };
  // doEmail / doWhatsApp accept an optional override value for when the user
  // just supplied the missing detail via the capture form in the picker
  const doEmail = (emailOverride) => {
    const email = emailOverride || custEmail;
    stampSentVia('email');
    openEmailCompose(email, subject, fullMsg, false, showPicker);
  };
  const doWhatsApp = (phoneOverride) => {
    const phone = formatWhatsAppNumber(phoneOverride || custPhone);
    stampSentVia('whatsapp');
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(fullMsg)}`, '_blank');
  };

  const showPicker = () => showSendMethodPicker(doEmail, doWhatsApp, doCopy, !!custEmail, !!custPhone);
  const doCopy = async () => {
    if (fullMsg && navigator.clipboard) {
      try { await navigator.clipboard.writeText(fullMsg); toast('Message copied -paste it into WhatsApp or email.', '', 6000); }
      catch(e) { toast('Could not copy to clipboard.', 'error', 4000); }
    }
  };

  // Always show the picker so the user can choose how to send
  showPicker();
}

/* ===== BACKUP & RESTORE ===== */
function exportData() {
  const data = {
    version: 1,
    company:   state.company,
    priceList: state.priceList,
    saved:     state.saved,
    refSeq:    localStorage.getItem(KEY_REF),
    invSeq:    localStorage.getItem(KEY_INV)
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `lexi-backup-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("I've exported your backup.", 'success');
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data.company && !data.priceList) throw new Error('Invalid backup file.');
      if (!confirm('This will replace all your current data. Continue?')) return;
      if (data.company)   state.company   = data.company;
      if (data.priceList) state.priceList = data.priceList;
      if (data.saved)     state.saved     = data.saved;
      if (data.refSeq)    localStorage.setItem(KEY_REF, data.refSeq);
      if (data.invSeq)    localStorage.setItem(KEY_INV, data.invSeq);
      save();
      populatePage1Fields();
      refreshPriceList();
      refreshSavedDocs();
      updateSavedBadge();
      toast("I've restored your backup.", 'success');
    } catch(err) {
      toast('Invalid backup file. Please check and try again.', 'error');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

/* ===== UTILITIES ===== */
function getVal(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val || '';
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtPrice(n) {
  return '£' + (parseFloat(n) || 0).toFixed(2);
}

function formatDate(str) {
  if (!str) return '';
  try {
    return new Date(str).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return str; }
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function formatWhatsAppNumber(phone) {
  // Strip all non-digit characters (spaces, dashes, brackets, plus, etc.)
  let n = (phone || '').replace(/\D/g, '');
  // Already has country code 44 (e.g. 447911123456 or was +447911123456)
  if (n.startsWith('44') && n.length >= 11) return n;
  // Leading 0 -> replace with 44 (e.g. 07911123456 -> 447911123456)
  if (n.startsWith('0')) return '44' + n.slice(1);
  // Bare 10-digit UK mobile starting with 7 (e.g. 7911123456)
  if (n.startsWith('7') && n.length === 10) return '44' + n;
  // Fallback - return as-is and hope for the best
  return n;
}

/* ===================================================
   CALENDAR
   =================================================== */

const CAL_COLORS = {
  startDate:  '#7D5730',  // walnut  -accepted job start date
  completed:  '#6B7C5C',  // sage    -job completed
  estimate:   '#E8B84B',  // gold    -estimate/quote awaiting response
  invoiceDue: '#E67E22',  // orange  -invoice due soon
  overdue:    '#C0392B',  // red     -invoice overdue
  paid:       '#2E7D32',  // green   -payment received
};

let calCurrentYear  = new Date().getFullYear();
let calCurrentMonth = new Date().getMonth(); // 0-indexed
let calSelectedDate = null;

// ---- Events map ----
function getCalendarEvents() {
  // Returns: { 'YYYY-MM-DD': [ { docId, type, color, label, custName, ref, doc } ] }
  const events = {};

  function addEvent(dateStr, ev) {
    if (!dateStr || dateStr.length < 8) return;
    if (!events[dateStr]) events[dateStr] = [];
    events[dateStr].push(ev);
  }

  const today = todayStr();

  (state.saved || []).forEach(d => {
    const q = d.quote || {};
    const custName = [q.custFirstName, q.custLastName].filter(Boolean).join(' ') || 'Unknown Customer';
    const ref = d.invoiceRef || d.receiptRef || q.ref || d.ref || '-';
    const base = { docId: d.id, custName, ref, doc: d };

    // 1. Job start date (accepted jobs with a start date set)
    if (d.jobAccepted && d.jobStartDate) {
      addEvent(d.jobStartDate, { ...base, type: 'startDate', color: CAL_COLORS.startDate, label: 'Job Starts' });
    }

    // 1b. Job completion date
    if (d.jobCompletedDate) {
      addEvent(d.jobCompletedDate, { ...base, type: 'completed', color: CAL_COLORS.completed, label: 'Job Completed' });
      // If invoice not yet sent, also mark the expected payment due date as a reminder
      if (!d.invoiceSent && !d.paid) {
        const terms    = (q.selectedTerms || []);
        const termDays = terms.includes('payment30') ? 30 : terms.includes('payment14') ? 14 : terms.includes('payment7') ? 7 : 30;
        const expDue   = addDays(d.jobCompletedDate, termDays);
        addEvent(expDue, { ...base, type: 'invoiceDue', color: CAL_COLORS.invoiceDue, label: 'Invoice Not Yet Raised' });
      }
    }

    // 2. Estimate / Quote -gold dot on doc creation date if not yet invoiced
    if (!d.invoiceSent && !d.paid) {
      const qType = (q.type || 'Estimate').toLowerCase();
      if (qType === 'estimate' || qType === 'quote') {
        const dateStr = q.date || d.date;
        if (dateStr) {
          addEvent(dateStr, { ...base, type: 'estimate', color: CAL_COLORS.estimate, label: qType === 'quote' ? 'Quote Sent' : 'Estimate Created' });
        }
      }
    }

    // 3. Invoice due date
    if (d.invoiceSent && !d.paid && d.invoiceDueDate) {
      const isOverdue = today > d.invoiceDueDate;
      addEvent(d.invoiceDueDate, {
        ...base,
        type: isOverdue ? 'overdue' : 'invoiceDue',
        color: isOverdue ? CAL_COLORS.overdue : CAL_COLORS.invoiceDue,
        label: isOverdue ? 'Invoice Overdue' : 'Invoice Due',
      });
    }

    // 4. Payment received dates -green dot
    getDocPayments(d).forEach(p => {
      if (p.amount > 0 && p.date) {
        const lbl = p.type && p.type !== 'Full Payment' ? p.type + ' Received' : 'Payment Received';
        addEvent(p.date, { ...base, type: 'paid', color: CAL_COLORS.paid, label: lbl });
      }
    });
  });

  return events;
}

// ---- Render the full calendar page ----
function renderCalendar() {
  const wrap = document.getElementById('calPageWrap');
  if (!wrap) return;

  const events  = getCalendarEvents();
  const today   = todayStr();
  const year    = calCurrentYear;
  const month   = calCurrentMonth;

  // --- Needs Attention panel ---
  const attentionItems = [];
  (state.saved || []).forEach(d => {
    const q = d.quote || {};
    const custName = [q.custFirstName, q.custLastName].filter(Boolean).join(' ') || 'Unknown Customer';
    const ref = d.invoiceRef || d.receiptRef || q.ref || d.ref || '-';

    if (d.invoiceSent && !d.paid && d.invoiceDueDate && today > d.invoiceDueDate) {
      const days = Math.floor((new Date(today) - new Date(d.invoiceDueDate)) / 86400000);
      attentionItems.push({ docId: d.id, custName, ref, color: CAL_COLORS.overdue, desc: `Invoice ${days} day${days === 1 ? '' : 's'} overdue`, doc: d, type: 'overdue' });
    } else if (!d.invoiceSent && !d.paid && d.jobCompletedDate) {
      // Job finished but no invoice sent -check if expected due date has passed
      const terms    = (q.selectedTerms || []);
      const termDays = terms.includes('payment30') ? 30 : terms.includes('payment14') ? 14 : terms.includes('payment7') ? 7 : 30;
      const expDue   = addDays(d.jobCompletedDate, termDays);
      if (today >= expDue) {
        const days = Math.floor((new Date(today) - new Date(expDue)) / 86400000);
        attentionItems.push({ docId: d.id, custName, ref, color: CAL_COLORS.invoiceDue, desc: `Job completed. Invoice not yet raised (${days === 0 ? 'due today' : days + ' day' + (days === 1 ? '' : 's') + ' overdue'})`, doc: d, type: 'invoiceDue' });
      }
    } else if (!d.invoiceSent && !d.paid) {
      const qType = (q.type || '').toLowerCase();
      // Only nudge if actually sent (acceptToken created on send) and we have a sent date
      const sentDate = d.sentAt || d.sharedAt || null;
      if ((qType === 'estimate' || qType === 'quote') && sentDate && d.acceptToken) {
        const age = Math.floor((new Date(today) - new Date(sentDate)) / 86400000);
        if (age >= 7) {
          attentionItems.push({ docId: d.id, custName, ref, color: CAL_COLORS.estimate, desc: `${qType === 'quote' ? 'Quote' : 'Estimate'} sent ${age} day${age === 1 ? '' : 's'} ago with no response yet`, doc: d, type: 'estimate' });
        }
      }
    }
  });

  const attentionHtml = attentionItems.length ? `
    <div class="cal-attention">
      <div class="cal-attention-header" onclick="toggleCalAttention()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span class="cal-attention-title">Needs Attention</span>
        <span class="cal-attention-badge">${attentionItems.length}</span>
      </div>
      <div class="cal-attention-body" id="calAttentionBody">
        ${attentionItems.map(item => {
          const phone = item.doc?.quote?.custPhone || '';
          const email = item.doc?.quote?.custEmail || '';
          const SVG_EMAIL_A = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`;
          const SVG_WA_A    = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
          const SVG_PHONE_A = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.6 3.44 2 2 0 0 1 3.57 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.82a16 16 0 0 0 6.29 6.29l1.12-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;
          return `<div class="cal-attention-item">
            <div class="cal-attn-dot" style="background:${item.color}"></div>
            <div class="cal-attn-content">
              <div class="cal-attn-ref">${esc(item.ref)}</div>
              <div class="cal-attn-name">${esc(item.custName)}</div>
              <div class="cal-attn-desc">${esc(item.desc)}</div>
            </div>
            <div class="cal-attn-actions">
              <button type="button" class="cal-icon-btn cal-icon-email${!email ? ' cal-btn-disabled' : ''}"
                ${email ? `onclick="openCalEmailComposer('${esc(item.docId)}','${item.type}','email')"` : ''}
                title="${email ? 'Email customer' : 'No email address saved'}">${SVG_EMAIL_A}</button>
              <button type="button" class="cal-icon-btn cal-icon-whatsapp${!phone ? ' cal-btn-disabled' : ''}"
                ${phone ? `onclick="openCalEmailComposer('${esc(item.docId)}','${item.type}','whatsapp')"` : ''}
                title="${phone ? 'WhatsApp customer' : 'No phone number saved'}">${SVG_WA_A}</button>
              ${phone
                ? `<a href="tel:${esc(phone)}" class="cal-icon-btn cal-icon-phone" title="Call customer">${SVG_PHONE_A}</a>`
                : `<button type="button" class="cal-icon-btn cal-icon-phone cal-btn-disabled" title="No phone number saved">${SVG_PHONE_A}</button>`}
              <button type="button" class="cal-view-cust-btn" onclick="openUpdateFromCal('${esc(item.docId)}')" title="Update job">Update</button>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>` : '';

  // --- Month grid ---
  const monthName = new Date(year, month, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' });
  // UK weeks start Monday: Sun=0 -> offset 6, Mon=1 -> offset 0
  let firstDow = new Date(year, month, 1).getDay();
  firstDow = (firstDow + 6) % 7;
  const daysInMonth    = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const dayHeaders     = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  const cells = [];
  for (let i = firstDow - 1; i >= 0; i--) {
    const d   = daysInPrevMonth - i;
    const pm  = month === 0 ? 11 : month - 1;
    const py  = month === 0 ? year - 1 : year;
    cells.push({ day: d, dateStr: `${py}-${String(pm+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`, other: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, dateStr: `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`, other: false });
  }
  const rem = cells.length % 7;
  if (rem > 0) {
    const fill = 7 - rem;
    for (let d = 1; d <= fill; d++) {
      const nm = month === 11 ? 0 : month + 1;
      const ny = month === 11 ? year + 1 : year;
      cells.push({ day: d, dateStr: `${ny}-${String(nm+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`, other: true });
    }
  }

  const gridHtml = cells.map(cell => {
    const evs        = events[cell.dateStr] || [];
    const isToday    = cell.dateStr === today;
    const isSelected = cell.dateStr === calSelectedDate;
    // Deduplicate dot colours so we don't show 5 green dots for 5 payments
    const uniqueColors = [...new Set(evs.map(e => e.color))];
    const dots = uniqueColors.map(c => `<div class="cal-dot" style="background:${c}"></div>`).join('');
    return `<div class="cal-cell${cell.other ? ' other-month' : ''}${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}${evs.length ? ' has-events' : ''}"
      onclick="openCalDayPanel('${cell.dateStr}')">
      <div class="cal-day-num">${cell.day}</div>
      ${dots ? `<div class="cal-dots">${dots}</div>` : ''}
    </div>`;
  }).join('');

  const monthHtml = `
    <div class="cal-month-card">
      <div class="cal-month-nav">
        <button class="cal-nav-btn" onclick="calChangeMonth(-1)" aria-label="Previous month">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span class="cal-month-title">${monthName}</span>
        <button class="cal-nav-btn" onclick="calChangeMonth(1)" aria-label="Next month">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>
      <div class="cal-grid-wrap">
        <div class="cal-day-headers">${dayHeaders.map(h => `<div class="cal-day-header">${h}</div>`).join('')}</div>
        <div class="cal-grid">${gridHtml}</div>
      </div>
    </div>`;

  // --- Day panel ---
  const dayPanelHtml = calSelectedDate
    ? buildCalDayPanel(calSelectedDate, events[calSelectedDate] || [])
    : '';

  // --- Legend ---
  const legendHtml = `
    <div class="cal-legend">
      <div class="cal-legend-item"><div class="cal-legend-dot" style="background:${CAL_COLORS.startDate}"></div> Job Start</div>
      <div class="cal-legend-item"><div class="cal-legend-dot" style="background:${CAL_COLORS.completed}"></div> Job Completed</div>
      <div class="cal-legend-item"><div class="cal-legend-dot" style="background:${CAL_COLORS.estimate}"></div> Estimate/Quote</div>
      <div class="cal-legend-item"><div class="cal-legend-dot" style="background:${CAL_COLORS.invoiceDue}"></div> Invoice Due</div>
      <div class="cal-legend-item"><div class="cal-legend-dot" style="background:${CAL_COLORS.overdue}"></div> Overdue</div>
      <div class="cal-legend-item"><div class="cal-legend-dot" style="background:${CAL_COLORS.paid}"></div> Payment</div>
    </div>`;

  wrap.innerHTML = attentionHtml + monthHtml + dayPanelHtml + legendHtml;
}

function toggleCalAttention() {
  const body = document.getElementById('calAttentionBody');
  if (body) body.style.display = body.style.display === 'none' ? '' : 'none';
}

function calChangeMonth(delta) {
  calCurrentMonth += delta;
  if (calCurrentMonth > 11) { calCurrentMonth = 0; calCurrentYear++; }
  if (calCurrentMonth < 0)  { calCurrentMonth = 11; calCurrentYear--; }
  renderCalendar();
}

function openCalDayPanel(dateStr) {
  calSelectedDate = (calSelectedDate === dateStr) ? null : dateStr;
  renderCalendar();
  if (calSelectedDate) {
    const panel = document.querySelector('.cal-day-panel');
    if (panel) setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
  }
}

function buildCalDayPanel(dateStr, evs) {
  const displayDate = new Date(dateStr).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const SVG_EMAIL = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`;
  const SVG_WA    = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  const SVG_PHONE = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.6 3.44 2 2 0 0 1 3.57 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.82a16 16 0 0 0 6.29 6.29l1.12-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;

  const eventsHtml = evs.length
    ? evs.map(ev => {
        const phone = ev.doc?.quote?.custPhone || '';
        const email = ev.doc?.quote?.custEmail || '';
        let desc = '';
        if (ev.type === 'estimate')   desc = 'Follow up to check they have seen it';
        if (ev.type === 'completed')  desc = 'Work finished. Raise invoice if not yet done';
        if (ev.type === 'invoiceDue') desc = ev.label === 'Invoice Not Yet Raised' ? 'Job complete but invoice not yet sent' : 'Payment due today';
        if (ev.type === 'overdue')    desc = 'Payment overdue';
        if (ev.type === 'startDate')  desc = 'Job confirmed to start today';

        const phoneBtn = phone
          ? `<a href="tel:${esc(phone)}" class="cal-icon-btn cal-icon-phone" title="Call customer">${SVG_PHONE}</a>`
          : `<button type="button" class="cal-icon-btn cal-icon-phone cal-btn-disabled" title="No phone number saved">${SVG_PHONE}</button>`;

        return `<div class="cal-day-event">
          <div class="cal-event-stripe" style="background:${ev.color}"></div>
          <div class="cal-event-content">
            <div class="cal-event-type">${esc(ev.label)}</div>
            <div class="cal-event-name">${esc(ev.custName)}</div>
            <div class="cal-event-ref">${esc(ev.ref)}</div>
            ${desc ? `<div class="cal-event-desc">${esc(desc)}</div>` : ''}
          </div>
          <div class="cal-event-btns">
            <div class="cal-icon-btns">
              <button type="button" class="cal-icon-btn cal-icon-email${!email ? ' cal-btn-disabled' : ''}"
                ${email ? `onclick="openCalEmailComposer('${esc(ev.docId)}','${ev.type}','email')"` : ''}
                title="${email ? 'Email customer' : 'No email address saved'}">${SVG_EMAIL}</button>
              <button type="button" class="cal-icon-btn cal-icon-whatsapp${!phone ? ' cal-btn-disabled' : ''}"
                ${phone ? `onclick="openCalEmailComposer('${esc(ev.docId)}','${ev.type}','whatsapp')"` : ''}
                title="${phone ? 'WhatsApp customer' : 'No phone number saved'}">${SVG_WA}</button>
              ${phoneBtn}
            </div>
            <button type="button" class="cal-view-cust-btn" onclick="openCustomerDashboardForDoc('${esc(ev.docId)}')">View Customer</button>
          </div>
        </div>`;
      }).join('')
    : `<p class="cal-day-empty">Nothing on this day.</p>`;

  return `<div class="cal-day-panel">
    <div class="cal-day-panel-header">
      <span class="cal-day-panel-title">${esc(displayDate)}</span>
      <button class="cal-day-panel-close" onclick="openCalDayPanel('${esc(dateStr)}')">&times;</button>
    </div>
    ${eventsHtml}
  </div>`;
}

// ---- Email / WhatsApp composer ----
let calEmailDocId = null;
let calEmailSelectedTemplate = null;
let calEmailAddr = '';
let calEmailChannel = 'email';   // 'email' | 'whatsapp'
let calEmailPhone = '';

function openCalEmailComposer(docId, eventType, channel) {
  const doc = (state.saved || []).find(d => d.id === docId);
  if (!doc) return;

  calEmailDocId  = docId;
  calEmailChannel = channel || 'email';

  const q          = doc.quote || {};
  const co         = state.company || {};
  const custFirst  = q.custFirstName || 'there';
  const custName   = [q.custFirstName, q.custLastName].filter(Boolean).join(' ') || 'Customer';
  const traderName = [co.firstName, co.lastName].filter(Boolean).join(' ') || (co.firstName || 'your tradesperson');
  const ref        = doc.invoiceRef || doc.receiptRef || q.ref || doc.ref || '';
  const dueDate    = doc.invoiceDueDate ? formatDate(doc.invoiceDueDate) : 'as agreed';
  const total      = fmtPrice(doc.total || 0);
  const jobDesc    = (q.items || []).map(i => i.name).filter(Boolean).join(', ') || 'your recent work';
  const qTypeName  = (q.type || 'Estimate').toLowerCase();
  calEmailAddr     = q.custEmail || '';
  calEmailPhone    = formatWhatsAppNumber(q.custPhone || '');

  const templates = [
    {
      id: 'follow_up',
      title: 'Quote Follow-up',
      desc: 'Check if they\'ve had a chance to look it over',
      subject: `Following up on your ${qTypeName} -${ref}`,
      body:
`Hi ${custFirst},

Just following up on the ${qTypeName} I sent over for ${jobDesc}.

Reference: ${ref}
Total: ${total}

Have you had a chance to look it over? Happy to answer any questions or tweak anything.

Looking forward to hearing from you.

Thanks,
${traderName}`,
    },
    {
      id: 'invoice_reminder',
      title: 'Invoice Reminder',
      desc: 'A friendly nudge that payment is due or overdue',
      subject: `Invoice reminder -${ref}`,
      body:
`Hi ${custFirst},

Just a friendly reminder that invoice ${ref} for ${total} is due ${dueDate}.

If you've already sent payment please ignore this. Any questions, just give me a shout.

Thanks for your business,
${traderName}`,
    },
    {
      id: 'job_confirmed',
      title: 'Job Confirmation',
      desc: 'Let them know the job is confirmed and you\'re ready',
      subject: `Your job is confirmed -${ref}`,
      body:
`Hi ${custFirst},

Great news -I'm confirmed to carry out the work for ${jobDesc}.

Reference: ${ref}
Total: ${total}

I'll be in touch with the exact start details. If you need anything before then, just reply here or give me a call.

Looking forward to working with you.

${traderName}`,
    },
    {
      id: 'payment_thanks',
      title: 'Payment Thanks',
      desc: 'A warm thank-you once the money comes in',
      subject: `Payment received, thank you! (${ref})`,
      body:
`Hi ${custFirst},

Thank you for your payment for ${ref}. Really appreciate it.

It was a pleasure working with you. If you ever need anything else, don't hesitate to get in touch.

Thanks again,
${traderName}`,
    },
  ];

  // Pre-select the most relevant template
  const defaultMap = {
    estimate:   'follow_up',
    invoiceDue: 'invoice_reminder',
    overdue:    'invoice_reminder',
    paid:       'payment_thanks',
    startDate:  'job_confirmed',
  };
  const defaultId = defaultMap[eventType] || 'follow_up';
  calEmailSelectedTemplate = templates.find(t => t.id === defaultId) || templates[0];

  // Update modal title and send button based on channel
  const titleEl = document.getElementById('calEmailModalTitle');
  const sendBtn = document.getElementById('sendCalEmailBtn');
  if (calEmailChannel === 'whatsapp') {
    if (titleEl) titleEl.textContent = 'WhatsApp Templates';
    if (sendBtn) sendBtn.textContent = 'Open in WhatsApp';
  } else {
    if (titleEl) titleEl.textContent = 'Email Templates';
    if (sendBtn) sendBtn.textContent = 'Open in Email App';
  }

  const descEl = document.getElementById('calEmailModalDesc');
  if (calEmailChannel === 'whatsapp') {
    if (descEl) descEl.textContent = `To: ${custName}${calEmailPhone ? ' (' + (doc.quote?.custPhone || '') + ')' : '. No phone number saved.'}`;
  } else {
    if (descEl) descEl.textContent = `To: ${custName}${calEmailAddr ? ' (' + calEmailAddr + ')' : '. No email address saved.'}`;
  }

  const listEl = document.getElementById('calTemplateList');
  if (listEl) {
    listEl.innerHTML = templates.map(t => `
      <button type="button" class="cal-template-btn${calEmailSelectedTemplate?.id === t.id ? ' selected' : ''}"
        onclick="calSelectTemplate('${t.id}')"
        data-tmpl-id="${t.id}"
        data-subj="${encodeURIComponent(t.subject)}"
        data-body="${encodeURIComponent(t.body)}">
        <div class="cal-template-btn-title">${t.title}</div>
        <div class="cal-template-btn-desc">${t.desc}</div>
      </button>`).join('') + `
      <button type="button" class="cal-template-btn${calEmailSelectedTemplate?.id === 'custom' ? ' selected' : ''}"
        onclick="calSelectTemplate('custom')"
        data-tmpl-id="custom" data-subj="" data-body="">
        <div class="cal-template-btn-title">Write Your Own</div>
        <div class="cal-template-btn-desc">Opens your ${calEmailChannel === 'whatsapp' ? 'WhatsApp' : 'email'} app with a blank message</div>
      </button>`;
  }

  updateCalEmailPreview();
  document.getElementById('calEmailModal').style.display = 'flex';
}

function calSelectTemplate(templateId) {
  // "Write Your Own" fires immediately without showing subject/body fields
  if (templateId === 'custom') {
    document.getElementById('calEmailModal').style.display = 'none';
    if (calEmailChannel === 'whatsapp') {
      // Use location.href for reliable mobile WhatsApp deep-link (contact chooser, no pre-filled message)
      window.location.href = 'https://wa.me/';
    } else {
      if (!calEmailAddr) { showSavedPopup('No email address saved for this customer.'); return; }
      window.location.href = 'mailto:' + calEmailAddr;
    }
    return;
  }

  document.querySelectorAll('.cal-template-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.tmplId === templateId);
  });
  const btn = document.querySelector(`.cal-template-btn[data-tmpl-id="${templateId}"]`);
  if (btn) {
    calEmailSelectedTemplate = {
      id:      templateId,
      subject: decodeURIComponent(btn.dataset.subj || ''),
      body:    decodeURIComponent(btn.dataset.body || ''),
    };
  }
  updateCalEmailPreview();
}

function updateCalEmailPreview() {
  const previewEl = document.getElementById('calEmailPreview');
  if (!calEmailSelectedTemplate || !previewEl) return;
  previewEl.style.display = 'block';
  previewEl.textContent = calEmailSelectedTemplate.body || '';
}

function sendCalEmail() {
  if (!calEmailSelectedTemplate) return;

  if (calEmailChannel === 'whatsapp') {
    const text = encodeURIComponent(calEmailSelectedTemplate.body || '');
    window.open(`https://wa.me/?text=${text}`, '_blank');
  } else {
    if (!calEmailAddr) {
      showSavedPopup('No email address saved for this customer.');
      return;
    }
    const subject = encodeURIComponent(calEmailSelectedTemplate.subject || '');
    const body    = encodeURIComponent(calEmailSelectedTemplate.body || '');
    window.location.href = `mailto:${calEmailAddr}?subject=${subject}&body=${body}`;
  }

  document.getElementById('calEmailModal').style.display = 'none';
}

function setupCalendar() {
  // Calendar nav button
  const menuCalendar = document.getElementById('menuCalendar');
  if (menuCalendar) {
    menuCalendar.addEventListener('click', () => {
      // Close the slide-out nav menu
      const hamburger = document.getElementById('hamburgerBtn');
      const navMenu   = document.getElementById('navMenu');
      const overlay   = document.getElementById('navMenuOverlay');
      hamburger?.classList.remove('open');
      navMenu?.classList.remove('open');
      overlay?.classList.remove('open');
      hamburger?.setAttribute('aria-expanded', 'false');
      navMenu?.setAttribute('aria-hidden', 'true');
      showPage('page-calendar');
    });
  }

  // Close email/WhatsApp modal
  function closeCalEmailModalFn() {
    document.getElementById('calEmailModal').style.display = 'none';
    calEmailSelectedTemplate = null;
    calEmailChannel = 'email';
  }
  ['closeCalEmailModal', 'closeCalEmailModalBtn'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', closeCalEmailModalFn);
  });

  // Send email button
  document.getElementById('sendCalEmailBtn')?.addEventListener('click', sendCalEmail);

  // Close on overlay click
  document.getElementById('calEmailModal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeCalEmailModalFn();
  });

  // Calendar sync modal
  document.getElementById('calSyncBtn')?.addEventListener('click', () => {
    document.getElementById('calSyncModal').style.display = 'flex';
  });
  document.getElementById('closeCalSyncBtn')?.addEventListener('click', () => {
    document.getElementById('calSyncModal').style.display = 'none';
  });
  document.getElementById('calSyncModal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
  });
  document.getElementById('downloadIcsBtn')?.addEventListener('click', downloadIcsFile);
}

/* ===== CALENDAR EXPORT (.ics) ===== */
function formatIcsDate(dateStr) {
  // dateStr is YYYY-MM-DD → YYYYMMDD
  return (dateStr || '').replace(/-/g, '');
}

function downloadIcsFile() {
  const docs = state.saved || [];
  const co   = state.company || {};
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lexi Handles It//Jobs//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  docs.forEach(d => {
    const q        = d.quote || {};
    const custName = [q.custFirstName, q.custLastName].filter(Boolean).join(' ') || 'Customer';
    const ref      = d.invoiceRef || d.receiptRef || q.ref || d.ref || 'Job';
    const startRaw = d.jobStartDate || q.date || d.date;
    const endRaw   = d.jobCompletedDate || startRaw;
    if (!startRaw) return; // skip undated docs

    const start = formatIcsDate(startRaw);
    const end   = formatIcsDate(endRaw || startRaw);
    // iCal DTEND for all-day is exclusive (day+1)
    const endExcl = formatIcsDate(
      new Date(new Date(endRaw || startRaw).getTime() + 86400000).toISOString().slice(0, 10)
    );

    const desc  = (q.items || []).map(i => i.name).join(', ') || ref;
    const status = d.paid ? 'Paid' : d.invoiceSent ? 'Invoiced' : (q.type || 'Estimate');
    const uid   = `${ref}-${d.id}@lexi-handles-it`;

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${formatIcsDate(new Date().toISOString().slice(0,10))}T000000Z`);
    lines.push(`DTSTART;VALUE=DATE:${start}`);
    lines.push(`DTEND;VALUE=DATE:${endExcl}`);
    lines.push(`SUMMARY:${ref} – ${custName}`);
    lines.push(`DESCRIPTION:${status} | ${desc}`);
    if (q.custAddr) lines.push(`LOCATION:${q.custAddr}${q.custPostcode ? ', ' + q.custPostcode : ''}`);
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');

  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'lexi-jobs.ics';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showSavedPopup('Calendar exported -open the file in Google, Outlook or Apple Calendar.', null, 4000);
}

/* ═══════════════════════════════════════════════════════════
   CHASE PAYMENTS
   ═══════════════════════════════════════════════════════════ */

const SEASONAL_TRADES = [
  'garden','gardener','gardening','landscape','landscaper','landscaping',
  'roofer','roofing','roof','exterior','painter','decorator','window',
  'tree surgeon','tree','fencer','fencing','driveway','paving','paver'
];

function isSeasonalTrade() {
  const t = (state.company?.trade || '').toLowerCase();
  return SEASONAL_TRADES.some(k => t.includes(k));
}

function getOverdueInvoices() {
  const today = todayStr();
  const results = [];
  (state.saved || []).forEach(d => {
    const q = d.quote || {};
    const custName = [q.custFirstName, q.custLastName].filter(Boolean).join(' ') || 'Customer';
    const ref = d.invoiceRef || d.receiptRef || q.ref || d.ref || '-';
    const payments = getDocPayments(d);
    const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
    const outstanding = Math.max(0, (d.total || 0) - totalPaid);
    if (outstanding <= 0 || d.paid) return;

    // Invoiced and overdue
    if (d.invoiceSent && d.invoiceDueDate && today > d.invoiceDueDate) {
      const days = Math.floor((new Date(today) - new Date(d.invoiceDueDate)) / 86400000);
      results.push({ docId: d.id, custName, ref, amount: outstanding, days, phone: q.custPhone || '', email: q.custEmail || '', urgency: days >= 30 ? 'critical' : days >= 14 ? 'warning' : 'gentle', doc: d });
    }
    // Job complete, no invoice raised and past expected due date
    else if (!d.invoiceSent && d.jobCompletedDate) {
      const terms = (q.selectedTerms || []);
      const termDays = terms.includes('payment30') ? 30 : terms.includes('payment14') ? 14 : terms.includes('payment7') ? 7 : 30;
      const expDue = addDays(d.jobCompletedDate, termDays);
      if (today >= expDue) {
        const days = Math.floor((new Date(today) - new Date(expDue)) / 86400000);
        results.push({ docId: d.id, custName, ref, amount: outstanding, days, phone: q.custPhone || '', email: q.custEmail || '', urgency: 'invoice-needed', doc: d });
      }
    }
  });
  // Sort: most overdue first
  results.sort((a, b) => b.days - a.days);
  return results;
}

function updateChasePaymentsBadge() {
  const overdue = getOverdueInvoices();
  const badge = document.getElementById('chasePaymentsBadge');
  if (!badge) return;
  if (overdue.length > 0) {
    badge.textContent = overdue.length;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

function buildChaseMessage(item, channel) {
  const traderName = state.company?.preferredName || state.company?.firstName || 'your tradesperson';
  const custFirst = (item.custName || '').split(' ')[0] || item.custName;

  if (item.urgency === 'invoice-needed') {
    return channel === 'whatsapp'
      ? `Hi ${custFirst}, hope all's good! Just wanted to let you know I'll be sending over your invoice for ${item.ref} shortly. Give me a shout if you have any questions. Cheers, ${traderName}`
      : { subject: `Invoice coming -${item.ref}`, body: `Hi ${custFirst},\n\nHope you're well. I'll be sending your invoice for job ${item.ref} (£${fmtPrice(item.amount)}) over shortly.\n\nGive me a shout if you have any questions.\n\nThanks,\n${traderName}` };
  }
  if (item.urgency === 'gentle') {
    return channel === 'whatsapp'
      ? `Hi ${custFirst}, hope you're well! Just a friendly nudge -invoice ${item.ref} for ${fmtPrice(item.amount)} is now due. No rush, just wanted to make sure you got it. Cheers, ${traderName}`
      : { subject: `Payment reminder -${item.ref}`, body: `Hi ${custFirst},\n\nHope all is good with you. Just a gentle reminder that invoice ${item.ref} for ${fmtPrice(item.amount)} is now due.\n\nLet me know if you have any questions.\n\nThanks,\n${traderName}` };
  }
  if (item.urgency === 'warning') {
    return channel === 'whatsapp'
      ? `Hi ${custFirst}, just chasing invoice ${item.ref} for ${fmtPrice(item.amount)} which is now ${item.days} days overdue. Could you let me know when to expect payment? Thanks, ${traderName}`
      : { subject: `Overdue invoice -${item.ref}`, body: `Hi ${custFirst},\n\nI'm just following up on invoice ${item.ref} for ${fmtPrice(item.amount)}, which is now ${item.days} days overdue.\n\nCould you please let me know when I can expect payment?\n\nThanks,\n${traderName}` };
  }
  // critical (30+ days)
  return channel === 'whatsapp'
    ? `Hi ${custFirst}, I need to chase invoice ${item.ref} for ${fmtPrice(item.amount)} which is now ${item.days} days overdue. Please could you make payment or get in touch to discuss. Thanks, ${traderName}`
    : { subject: `Urgent: overdue invoice ${item.ref}`, body: `Hi ${custFirst},\n\nI'm writing to chase invoice ${item.ref} for ${fmtPrice(item.amount)}, which is now ${item.days} days overdue.\n\nPlease could you arrange payment or contact me to discuss.\n\nThanks,\n${traderName}` };
}

function urgencyLabel(item) {
  if (item.urgency === 'invoice-needed') return { text: 'Invoice not sent', cls: 'chase-tag-invoice' };
  if (item.urgency === 'gentle')         return { text: `${item.days}d overdue`, cls: 'chase-tag-gentle' };
  if (item.urgency === 'warning')        return { text: `${item.days}d overdue`, cls: 'chase-tag-warning' };
  return { text: `${item.days}d overdue`, cls: 'chase-tag-critical' };
}

function openChaseForDoc(docId) {
  // Open chase modal pre-filtered -the relevant customer will be at the top (sorted by overdue days)
  openChasePaymentsModal();
  // Scroll to this customer's row after the modal renders
  setTimeout(() => {
    const row = document.querySelector(`.chase-row [data-id="${docId}"]`);
    if (row) row.closest('.chase-row')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 100);
}

function openChasePaymentsModal() {
  const overdue = getOverdueInvoices();
  const body = document.getElementById('chaseModalBody');
  const sub  = document.getElementById('chaseModalSub');
  if (!body) return;

  const totalOwed = overdue.reduce((s, i) => s + i.amount, 0);

  if (sub) {
    sub.textContent = overdue.length
      ? `${overdue.length} outstanding -${fmtPrice(totalOwed)} owed`
      : 'All payments up to date';
  }

  if (overdue.length === 0) {
    body.innerHTML = `
      <div style="padding:32px 20px;text-align:center">
        <div style="font-size:2.4rem;margin-bottom:10px">🎉</div>
        <p style="font-weight:700;color:var(--sage);margin:0 0 6px">Nothing to chase!</p>
        <p style="color:#888;font-size:0.88rem;margin:0">All your invoices are paid up. Nice work.</p>
      </div>`;
  } else {
    body.innerHTML = overdue.map(item => {
      const tag = urgencyLabel(item);
      const hasPhone = !!item.phone;
      const hasEmail = !!item.email;
      return `
        <div class="chase-row">
          <div class="chase-row-top">
            <div class="chase-row-name">${esc(item.custName)}</div>
            <span class="chase-tag ${tag.cls}">${tag.text}</span>
          </div>
          <div class="chase-row-ref">${esc(item.ref)} &bull; <strong>${fmtPrice(item.amount)}</strong> outstanding</div>
          <div class="chase-row-btns">
            <button type="button" class="chase-wa-btn${hasPhone ? '' : ' chase-btn-disabled'}"
              ${hasPhone ? `onclick="sendChase('${esc(item.docId)}','whatsapp')"` : ''}
              title="${hasPhone ? 'Send WhatsApp chase' : 'No phone number saved'}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              Chase by WhatsApp
            </button>
            <button type="button" class="chase-email-btn${hasEmail ? '' : ' chase-btn-disabled'}"
              ${hasEmail ? `onclick="sendChase('${esc(item.docId)}','email')"` : ''}
              title="${hasEmail ? 'Send email chase' : 'No email address saved'}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
              Email
            </button>
          </div>
        </div>`;
    }).join('');
  }

  document.getElementById('chasePaymentsModal').style.display = 'flex';
}

function sendChase(docId, channel) {
  const overdue = getOverdueInvoices();
  const item = overdue.find(i => i.docId === docId);
  if (!item) return;
  const msg = buildChaseMessage(item, channel);
  if (channel === 'whatsapp') {
    const text = encodeURIComponent(msg);
    window.open(`https://wa.me/${formatWhatsAppNumber(item.phone)}?text=${text}`, '_blank');
  } else {
    const m = msg;
    window.location.href = `mailto:${item.email}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;
  }
}

/* ═══════════════════════════════════════════════════════════
   QUIET SEASON
   ═══════════════════════════════════════════════════════════ */

const KEY_PAUSE      = 'lexi_paused';
const KEY_QS_HISTORY = 'lexi_qs_history'; // { monthsUsed: N } -persists across sessions

function getQsMonthsUsed()      { try { return JSON.parse(localStorage.getItem(KEY_QS_HISTORY))?.monthsUsed || 0; } catch { return 0; } }
function getQsMonthsRemaining() { return Math.max(0, 6 - getQsMonthsUsed()); }
function bankQsMonths(months)   {
  const used = getQsMonthsUsed() + months;
  localStorage.setItem(KEY_QS_HISTORY, JSON.stringify({ monthsUsed: used }));
}

function isPaused() {
  try { return !!JSON.parse(localStorage.getItem(KEY_PAUSE)); } catch { return false; }
}

function getPauseData() {
  try { return JSON.parse(localStorage.getItem(KEY_PAUSE)) || null; } catch { return null; }
}

function isQuietSeasonExpired() {
  const data = getPauseData();
  if (!data || !data.endDate) return false;
  return new Date() >= new Date(data.endDate);
}

function checkPauseExpiry() {
  if (isPaused() && isQuietSeasonExpired()) {
    localStorage.removeItem(KEY_PAUSE);
    const name = state.company?.preferredName || state.company?.firstName || '';
    showSavedPopup(`Welcome back${name ? ', ' + name : ''}! Ready when you are.`, null, 4000);
    updateChasePaymentsBadge();
    refreshSavedDocs();
  }
}

function quietSeasonGuard() {
  if (!isPaused()) return false;
  document.getElementById('quietSeasonLockedModal').style.display = 'flex';
  return true;
}

/* ── Stub backend integrations ── */
/* ═══════════════════════════════════════════════════════════
   QUOTE ACCEPTANCE -DIGITAL SIGN-OFF
   ═══════════════════════════════════════════════════════════ */

const KEY_ACCEPT_BASE = 'lexi_accept_'; // key prefix: lexi_accept_<token>

function generateAcceptToken(docId) {
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const doc = state.saved.find(d => d.id === docId);
  if (!doc) return null;
  doc.acceptToken = token;
  doc.acceptStatus = 'pending'; // pending | accepted | declined
  save();
  saveQuoteAcceptancePending(doc).catch(error => {
    console.warn('Quote acceptance token saved locally but did not sync to Supabase:', error);
  });
  return token;
}

function prepareAcceptTokenForSend(docId) {
  const doc = state.saved.find(d => d.id === docId);
  if (!doc) return null;
  // Stamp the actual sent date — used for "X days ago" nudges
  if (!doc.sentAt) {
    doc.sentAt = new Date().toISOString();
    save();
  }
  if (doc.acceptToken && doc.acceptStatus === 'pending') {
    saveQuoteAcceptancePending(doc).catch(error => {
      console.warn('Could not refresh quote acceptance row in Supabase:', error);
    });
    return doc.acceptToken;
  }
  return generateAcceptToken(docId);
}

function getAcceptUrl(token) {
  // ALWAYS point at the live app — this link is opened by the customer on
  // their own device, so a localhost/file:// origin would produce a dead link.
  const base = LIVE_APP_URL.replace(/\/$/, '');
  const doc  = (state.saved || []).find(d => d.acceptToken === token);
  const ref  = doc?.ref || doc?.quote?.ref || '';
  const biz  = (state.company?.businessName || [state.company?.firstName, state.company?.lastName].filter(Boolean).join(' ') || '').trim();
  const type = (doc?.quote?.type || doc?.type || 'quote').toLowerCase();
  return `${base}/accept.html?token=${encodeURIComponent(token)}${ref ? '&ref=' + encodeURIComponent(ref) : ''}${biz ? '&biz=' + encodeURIComponent(biz) : ''}${type ? '&type=' + encodeURIComponent(type) : ''}`;
}

function buildAcceptanceMessage(doc, baseMessage) {
  const q = doc.quote || {};
  // Prepare the acceptance token (also stamps doc.acceptToken, used to build
  // the single view+accept link in uploadDocToStorage).
  prepareAcceptTokenForSend(doc.id);
  const customerName = getCustomerFirstName(doc) || 'there';
  const rawDocType = String(q.type || doc.type || 'quote').toLowerCase();
  const docType = ['estimate','invoice','receipt'].includes(rawDocType) ? rawDocType : 'quote';
  // "an estimate / an invoice" vs "a quote / a receipt"
  const article = ['estimate','invoice'].includes(docType) ? 'an' : 'a';
  const traderName = [state.company.firstName, state.company.lastName].filter(Boolean).join(' ').trim();
  const companyName = (state.company.businessName || '').trim();
  const signoff = [traderName, companyName].filter(Boolean).join('\n') || 'Lexi Handles It';

  return `Hello ${customerName},

Thank you for allowing me to provide you with ${article} ${docType} to carry out the work.

Please feel free to consider it and talk it over with whoever you need to. I am happy to answer any queries, so feel free to message me back.

You can view your ${docType} and accept or decline it by clicking the link below:
{VIEW_LINK}

Kind regards
${signoff}`;
}

function quoteAcceptanceBaseRow(doc = {}) {
  const q = doc.quote || {};
  return {
    user_id: lexiAuthSession?.user?.id,
    token: doc.acceptToken || '',
    local_document_id: doc.id || '',
    document_number: doc.ref || q.ref || '',
    customer_name: buildCustName(q) || doc.custName || '',
    customer_email: q.custEmail || '',
    status: doc.acceptStatus || 'pending',
    accepted_by: doc.acceptedBy || '',
    accepted_at: doc.acceptedAt || null,
    declined_at: doc.declinedAt || null
  };
}

function quoteAcceptanceInsertCandidates(doc = {}) {
  const standard = quoteAcceptanceBaseRow(doc);
  return [
    standard,
    omitKeys(standard, ['declined_at', 'accepted_at']),
    omitKeys(standard, ['declined_at', 'accepted_at', 'customer_email', 'customer_name']),
    {
      user_id: standard.user_id,
      token: standard.token,
      document_number: standard.document_number,
      status: standard.status
    }
  ];
}

async function saveQuoteAcceptancePending(doc = {}) {
  if (!lexiSupabase || !lexiAuthSession?.user?.id || !doc.acceptToken) return;
  let lastError = null;
  for (const row of quoteAcceptanceInsertCandidates(doc)) {
    const result = await lexiSupabase
      .from('quote_acceptances')
      .upsert(row, { onConflict: 'token' });
    if (!result.error) return true;
    lastError = result.error;
    const message = String(result.error.message || '');
    if (!/column|schema cache|constraint|conflict/i.test(message)) throw result.error;
  }
  if (lastError) throw lastError;
  return false;
}

function applyAcceptanceToDoc(doc, data = {}) {
  if (!doc || !data?.status) return false;
  if (data.status === 'accepted') {
    doc.acceptStatus = 'accepted';
    // acceptedBy = who physically signed -may differ from the customer on the job
    doc.acceptedBy   = data.accepted_by || data.name || '';
    doc.acceptedAt   = data.accepted_at || data.timestamp || '';
    doc.jobAccepted  = true;
    // Restore customer name fields if they were lost -use the acceptance row's customer_name
    const q = doc.quote || {};
    if (!q.custFirstName && !q.custLastName && !doc.custName) {
      const restoredName = data.customer_name || '';
      if (restoredName) {
        doc.custName = restoredName;
        // Try to split into first/last if not already set
        const parts = restoredName.split(/,\s*|\s+/);
        if (parts.length >= 2 && !q.custFirstName) {
          q.custFirstName = parts[0];
          q.custLastName  = parts.slice(1).join(' ');
        } else if (parts.length === 1) {
          q.custLastName = parts[0];
        }
      }
    }
    return true;
  }
  if (data.status === 'declined') {
    doc.acceptStatus = 'declined';
    doc.declinedAt   = data.declined_at || data.timestamp || '';
    return true;
  }
  return false;
}

async function checkSupabaseQuoteAcceptances() {
  if (!lexiSupabase || !lexiAuthSession?.user?.id) return [];
  const pending = (state.saved || []).filter(doc =>
    doc.acceptToken && doc.acceptStatus !== 'accepted' && doc.acceptStatus !== 'declined'
  );
  if (!pending.length) return [];
  const tokens = pending.map(doc => doc.acceptToken);
  const { data, error } = await lexiSupabase
    .from('quote_acceptances')
    .select('*')
    .in('token', tokens);
  if (error) {
    console.warn('Could not check quote acceptances from Supabase:', error);
    return [];
  }
  const changed = [];
  (data || []).forEach(row => {
    if (!['accepted', 'declined'].includes(String(row.status || '').toLowerCase())) return;
    const doc = pending.find(item => item.acceptToken === row.token);
    if (doc && applyAcceptanceToDoc(doc, row)) changed.push(doc);
  });
  return changed;
}

async function checkQuoteAcceptances() {
  const newlyAccepted = [];

  // 1. Check Supabase quote_acceptances table
  const supabaseDocs = await checkSupabaseQuoteAcceptances();
  if (supabaseDocs?.length) newlyAccepted.push(...supabaseDocs);

  // 2. Check localStorage fallback (offline / same-device acceptance)
  (state.saved || []).forEach(doc => {
    if (doc.acceptToken && doc.acceptStatus !== 'accepted' && doc.acceptStatus !== 'declined') {
      const stored = localStorage.getItem(KEY_ACCEPT_BASE + doc.acceptToken);
      if (stored) {
        try {
          const data = JSON.parse(stored);
          if (applyAcceptanceToDoc(doc, data)) newlyAccepted.push(doc);
        } catch(e) {}
      }
    }
  });

  if (!newlyAccepted.length) return;

  save();
  refreshSavedDocs();
  // Show popup for the first newly accepted doc -reset acceptNotified so it always shows
  const doc = newlyAccepted[0];
  doc.acceptNotified = false;
  showQuoteAcceptedNotification();
  // Sync to Supabase after the popup (don't block the UI)
  saveSavedDocsToSupabase().catch(e => console.warn('Acceptance sync failed:', e));
}

let _quoteAcceptedDoc = null;

function showQuoteAcceptedNotification() {
  const accepted = (state.saved || []).filter(d => d.acceptStatus === 'accepted' && !d.acceptNotified);
  if (!accepted.length) return;
  const doc = accepted[0];
  _quoteAcceptedDoc = doc;
  const q = doc.quote || {};
  const custName = [q.custFirstName, q.custLastName].filter(Boolean).join(' ') || 'Your customer';
  const ref = q.ref || doc.ref || '';
  const el = document.getElementById('quoteAcceptedModal');
  const msg = document.getElementById('quoteAcceptedMsg');
  if (msg) msg.innerHTML = `<strong>${custName}</strong> has accepted your ${(q.type || 'quote').toLowerCase()}${ref ? ' (' + ref + ')' : ''}.<br><br>
    ${doc.acceptedBy ? 'Signed off by: <strong>' + doc.acceptedBy + '</strong><br>' : ''}
    ${doc.acceptedAt ? 'At: ' + new Date(doc.acceptedAt).toLocaleString('en-GB') : ''}`;
  if (el) el.style.display = 'flex';
  // Mark as notified so we don't show again
  accepted.forEach(d => { d.acceptNotified = true; });
  save();

  // Fire a phone notification if permission already granted
  sendLexiNotification(
    'Quote accepted!',
    `${custName} has accepted your ${(q.type||'quote').toLowerCase()}. Time to book them in.`,
    'accepted'
  );

  // If permission not yet decided, show the enable-notifications prompt inside the modal
  if (Notification.permission === 'default') {
    const notifPrompt = document.getElementById('acceptedNotifPrompt');
    if (notifPrompt) notifPrompt.style.display = 'flex';
  }
}

// ── NOTIFICATIONS ─────────────────────────────────────────────

const NOTIF_KEY = 'lexi_notif_asked';

function sendLexiNotification(title, body, tag = 'lexi') {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, {
      body,
      tag,
      icon: 'photos/1 Lexi Handles It Transparent.png',
      badge: 'photos/1 Lexi Handles It Transparent.png',
    });
    setTimeout(() => n.close(), 8000);
  } catch(e) { console.warn('Notification failed:', e); }
}

function openNotificationSettings() {
  if (!('Notification' in window)) {
    toast('Your browser does not support notifications.', 'error');
    return;
  }
  if (Notification.permission === 'granted') {
    toast('Notifications are already enabled.', 'success');
    updateNotifToggleBtn();
    return;
  }
  if (Notification.permission === 'denied') {
    // Blocked — user must go to phone/browser settings manually
    toast('Notifications are blocked. Go to your phone Settings > Safari (or Chrome) > Notifications and allow Lexi.', 'info', 7000);
    return;
  }
  // 'default' — ask for permission
  requestLexiNotifications(() => updateNotifToggleBtn());
}

function updateNotifToggleBtn() {
  const cb = document.getElementById('notifToggleBtn');
  if (!cb) return;
  const granted = ('Notification' in window) && Notification.permission === 'granted';
  cb.checked = granted;
  cb.disabled = ('Notification' in window) && Notification.permission === 'denied';
}

async function requestLexiNotifications(onGranted) {
  if (!('Notification' in window)) {
    toast('Your browser does not support notifications.', 'error');
    return;
  }
  if (Notification.permission === 'granted') {
    if (onGranted) onGranted();
    return;
  }
  if (Notification.permission === 'denied') {
    toast('Notifications are blocked. Enable them in your phone settings for this site.', 'info', 5000);
    return;
  }
  const result = await Notification.requestPermission();
  localStorage.setItem(NOTIF_KEY, 'asked');
  if (result === 'granted') {
    toast('Notifications enabled!', 'success');
    sendLexiNotification('Lexi notifications on', 'You\'ll get alerts for new acceptances, overdue invoices and upcoming jobs.', 'welcome');
    if (onGranted) onGranted();
  } else {
    toast('No problem - you can enable notifications from your phone settings any time.', 'info', 4000);
  }
}

// Daily check: fire notifications for overdue invoices and tomorrow's jobs
function checkScheduledNotifications() {
  if (Notification.permission !== 'granted') return;
  const today = todayStr();
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate()+1); return d.toISOString().slice(0,10); })();

  (state.saved || []).forEach(d => {
    const q = d.quote || {};
    const name = [q.custFirstName, q.custLastName].filter(Boolean).join(' ') || 'A customer';

    // Overdue invoice - notify once per day per doc
    if (d.invoiceSent && !d.paid && d.invoiceDueDate && d.invoiceDueDate < today) {
      const key = `lexi_notif_overdue_${d.id}_${today}`;
      if (!localStorage.getItem(key)) {
        const days = Math.floor((new Date(today) - new Date(d.invoiceDueDate)) / 86400000);
        sendLexiNotification(
          'Invoice overdue',
          `${name} - invoice ${days} day${days===1?'':'s'} overdue. Open Lexi to chase payment.`,
          `overdue_${d.id}`
        );
        localStorage.setItem(key, '1');
      }
    }

    // Job tomorrow - remind the night before
    if (d.jobStartDate === tomorrow && !d.jobCompleted) {
      const key = `lexi_notif_job_${d.id}_${today}`;
      if (!localStorage.getItem(key)) {
        sendLexiNotification(
          'Job tomorrow',
          `Reminder: ${name} is booked in tomorrow.`,
          `job_${d.id}`
        );
        localStorage.setItem(key, '1');
      }
    }

    // Job complete - invoice not raised after 48h
    if (d.jobCompleted && !d.invoiceSent) {
      const completedDate = d.jobCompletedDate || '';
      if (completedDate) {
        const daysSince = Math.floor((new Date(today) - new Date(completedDate)) / 86400000);
        if (daysSince >= 2) {
          const key = `lexi_notif_invoice_${d.id}_${today}`;
          if (!localStorage.getItem(key)) {
            sendLexiNotification(
              'Invoice not raised',
              `${name}'s job is complete but you haven't raised an invoice yet.`,
              `invoice_${d.id}`
            );
            localStorage.setItem(key, '1');
          }
        }
      }
    }
  });
}

/* ── Real-time subscription: instant acceptance notification ── */
let _acceptChannel = null;

function subscribeToQuoteAcceptances() {
  if (!lexiSupabase || !lexiAuthSession?.user?.id) return;
  // Tear down any existing subscription first
  if (_acceptChannel) {
    lexiSupabase.removeChannel(_acceptChannel);
    _acceptChannel = null;
  }
  _acceptChannel = lexiSupabase
    .channel('lexi-quote-acceptances')
    .on('postgres_changes', {
      event:  'UPDATE',
      schema: 'public',
      table:  'quote_acceptances',
      filter: `user_id=eq.${lexiAuthSession.user.id}`
    }, payload => {
      const row = payload.new || {};
      const status = String(row.status || '').toLowerCase();
      if (!['accepted', 'declined'].includes(status)) return;
      const doc = (state.saved || []).find(d => d.acceptToken === row.token);
      if (doc && applyAcceptanceToDoc(doc, row)) {
        if (status === 'accepted') doc.acceptNotified = false; // always show popup for live updates
        save();
        refreshSavedDocs();
        if (status === 'accepted') showQuoteAcceptedNotification();
      }
    })
    .subscribe();
}

// ── Supabase / Mailchimp stubs ──
function notifySupabaseQuoteAccepted(doc, data) {
  console.log('[Quote Acceptance] Supabase notify -doc:', doc.id, 'accepted by:', data.name, 'at:', data.timestamp);
}
function sendAcceptanceConfirmationEmail(custEmail, ref) {
  console.log('[Quote Acceptance] Confirmation email stub -to:', custEmail, 'ref:', ref);
  // TODO: Trigger Mailchimp transactional email to customer confirming acceptance
}

/* ═══════════════════════════════════════════════════════════
   QUIET SEASON (stubs)
   ═══════════════════════════════════════════════════════════ */

function notifySupabaseQuietSeason(data) {
  console.log('[Quiet Season] Supabase notify:', data);
}
function pauseStripeSubscription(months) {
  console.log('[Quiet Season] Stripe pause for', months, 'months');
}
function applyMailchimpQuietSeasonTag() {
  console.log('[Quiet Season] Mailchimp tag applied');
}
function resumeSupabaseAccount() {
  console.log('[Quiet Season] Supabase resume');
}
function resumeStripeSubscription() {
  console.log('[Quiet Season] Stripe resume');
}
function removeMailchimpQuietSeasonTag() {
  console.log('[Quiet Season] Mailchimp tag removed');
}

function openQuietSeasonIntroModal() {
  const name = state.company?.preferredName || state.company?.firstName || '';
  const titleEl = document.getElementById('qsIntroTitle');
  if (titleEl) titleEl.textContent = name ? `Hi ${name}.` : 'Quiet Season';
  const remaining = getQsMonthsRemaining();
  const noteEl = document.getElementById('qsIntroMonthsLeft');
  if (noteEl) {
    if (remaining < 6) {
      noteEl.textContent = `You have ${remaining} month${remaining !== 1 ? 's' : ''} of quiet season remaining this year.`;
      noteEl.style.display = 'block';
    } else {
      noteEl.style.display = 'none';
    }
  }
  document.getElementById('quietSeasonIntroModal').style.display = 'flex';
}

function openQuietSeasonModal() {
  const docs = state.saved || [];
  const custCount = buildCustomerGroups().length;
  const totalJobs = docs.length;
  const totalOwed = getOverdueInvoices().reduce((s, i) => s + i.amount, 0);
  const overdueCount = getOverdueInvoices().length;
  const remaining = getQsMonthsRemaining();

  // Build stats row
  const statsRow = document.getElementById('pauseStatsRow');
  if (statsRow) {
    statsRow.innerHTML = `
      <div class="pause-stat"><span class="pause-stat-num">${custCount}</span><span class="pause-stat-lbl">Customers</span></div>
      <div class="pause-stat"><span class="pause-stat-num">${totalJobs}</span><span class="pause-stat-lbl">Jobs</span></div>
      <div class="pause-stat"><span class="pause-stat-num">${fmtPrice(docs.reduce((s,d)=>s+(d.total||0),0))}</span><span class="pause-stat-lbl">Billed</span></div>`;
  }

  // Warn about outstanding invoices
  const chaseWrap = document.getElementById('chaseBeforePause');
  const chaseText = document.getElementById('chaseBeforePauseText');
  if (chaseWrap && chaseText) {
    if (overdueCount > 0) {
      chaseText.textContent = `You have ${overdueCount} outstanding invoice${overdueCount>1?'s':''} totalling ${fmtPrice(totalOwed)}. Chase them before your quiet season?`;
      chaseWrap.style.display = 'flex';
    } else {
      chaseWrap.style.display = 'none';
    }
  }

  // Reset duration picker -only show months within remaining allowance
  const noteEl = document.getElementById('qsMonthsRemainingNote');
  if (noteEl) {
    noteEl.textContent = remaining < 6
      ? `You have ${remaining} month${remaining !== 1 ? 's' : ''} remaining out of your 6-month allowance.`
      : 'You have your full 6-month allowance available.';
  }
  document.querySelectorAll('.qs-duration-btn').forEach(btn => {
    btn.classList.remove('selected');
    const m = parseInt(btn.dataset.months, 10);
    btn.disabled = m > remaining;
    btn.style.opacity = m > remaining ? '0.35' : '';
  });
  const confirmBtn = document.getElementById('confirmQuietSeasonBtn');
  if (confirmBtn) confirmBtn.disabled = true;

  document.getElementById('quietSeasonModal').style.display = 'flex';
}

function openQuietSeasonStatusModal() {
  const data = getPauseData();
  if (!data) return;
  const endDate = document.getElementById('qsStatusEndDate');
  const monthsLeft = document.getElementById('qsStatusMonthsLeft');
  if (endDate) endDate.textContent = `Your quiet season ends ${formatDate(data.endDate)}`;
  if (monthsLeft) {
    const remaining = data.months || '';
    monthsLeft.textContent = remaining ? `${remaining} month${remaining !== 1 ? 's' : ''} remaining` : '';
  }
  document.getElementById('quietSeasonStatusModal').style.display = 'flex';
}

function confirmQuietSeason(months) {
  const since = todayStr();
  const endDateObj = new Date();
  endDateObj.setMonth(endDateObj.getMonth() + months);
  const endDate = endDateObj.toISOString().slice(0, 10);
  const docs = state.saved || [];
  const pauseData = {
    since,
    endDate,
    months,
    custCount: buildCustomerGroups().length,
    jobCount: docs.length
  };
  localStorage.setItem(KEY_PAUSE, JSON.stringify(pauseData));
  document.getElementById('quietSeasonModal').style.display = 'none';

  // Stub integrations
  notifySupabaseQuietSeason(pauseData);
  pauseStripeSubscription(months);
  applyMailchimpQuietSeasonTag();

  // Close menu overlay cleanly before showing the paused screen
  document.getElementById('navMenu')?.classList.remove('open');
  document.getElementById('navMenuOverlay')?.classList.remove('active');
  document.getElementById('hamburgerBtn')?.setAttribute('aria-expanded','false');
  setTimeout(showPausedScreen, 250);
}

function showPausedScreen() {
  const data = getPauseData();
  if (!data) return;

  const sub    = document.getElementById('pausedSub');
  const stats  = document.getElementById('pausedStats');
  const since  = document.getElementById('pausedSince');
  const chaseSection = document.getElementById('pausedChaseSection');
  const chaseBtn = document.getElementById('pausedChaseBtn');

  if (sub) sub.textContent = `Your jobs, customers and earnings are all safe right here. See you when you are ready to get back on the tools.`;

  if (stats) {
    stats.innerHTML = `
      <div class="pause-stats-row" style="margin-bottom:0">
        <div class="pause-stat"><span class="pause-stat-num">${data.custCount || 0}</span><span class="pause-stat-lbl">Customers</span></div>
        <div class="pause-stat"><span class="pause-stat-num">${data.jobCount || 0}</span><span class="pause-stat-lbl">Jobs</span></div>
      </div>`;
  }

  if (since) {
    const endDateText = data.endDate ? `Your quiet season ends ${formatDate(data.endDate)}` : `Started ${formatDate(data.since)}`;
    since.textContent = endDateText;
  }

  const totalOwed = getOverdueInvoices().reduce((s,i)=>s+i.amount,0);
  if (chaseSection) chaseSection.style.display = totalOwed > 0 ? 'block' : 'none';
  if (chaseBtn) chaseBtn.style.display = totalOwed > 0 ? '' : 'none';

  // Update menu badge
  const badge = document.getElementById('qsActiveBadge');
  if (badge) badge.style.display = '';

  document.getElementById('pausedScreen').style.display = 'flex';
}

function resumeLexi() {
  const data = getPauseData();
  if (data?.months) bankQsMonths(data.months); // bank this session's months
  localStorage.removeItem(KEY_PAUSE);
  document.getElementById('pausedScreen').style.display = 'none';
  document.getElementById('quietSeasonStatusModal').style.display = 'none';

  // Stub integrations
  resumeSupabaseAccount();
  resumeStripeSubscription();
  removeMailchimpQuietSeasonTag();

  const name = state.company?.preferredName || state.company?.firstName || '';
  showSavedPopup(`Welcome back${name ? ', ' + name : ''}! Ready when you are.`, null, 4000);

  // Reset menu badge
  const badge = document.getElementById('qsActiveBadge');
  if (badge) badge.style.display = 'none';

  updateChasePaymentsBadge();
  refreshSavedDocs();
}

function checkSeasonalPrompt() {
  const month = new Date().getMonth(); // 0=Jan … 11=Dec
  const isSeason = isSeasonalTrade();

  // Quiet Season menu item -always visible, but update active badge
  const badge = document.getElementById('qsActiveBadge');
  if (badge) badge.style.display = isPaused() ? '' : 'none';

  // Seasonal banner in My Jobs page -August (7), September (8), October (9)
  const banner = document.getElementById('seasonalBanner');
  if (banner) {
    const showBanner = isSeason && [7, 8, 9].includes(month) && !isPaused()
      && !localStorage.getItem('lexi_seasonal_dismissed');
    banner.style.display = showBanner ? 'flex' : 'none';
  }
}

/* ── Wire up Chase + Quiet Season in setupModals ── */
function setupChaseAndPause() {
  // Chase payments menu
  document.getElementById('menuChasePayments')?.addEventListener('click', () => {
    if (!canUseMainApp()) { requireSetupGuard(); return; }
    closeMenu();
    setTimeout(openChasePaymentsModal, 180);
  });
  document.getElementById('closeChaseModalBtn')?.addEventListener('click', () => {
    document.getElementById('chasePaymentsModal').style.display = 'none';
  });
  document.getElementById('chasePaymentsModal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
  });

  // Quiet Season menu item
  document.getElementById('menuQuietSeason')?.addEventListener('click', () => {
    closeMenu();
    if (isPaused()) {
      setTimeout(openQuietSeasonStatusModal, 180);
    } else {
      setTimeout(openQuietSeasonIntroModal, 180);
    }
  });

  // Intro modal
  document.getElementById('closeQsIntroBtn')?.addEventListener('click', () => {
    document.getElementById('quietSeasonIntroModal').style.display = 'none';
  });
  document.getElementById('qsIntroMaybeLaterBtn')?.addEventListener('click', () => {
    document.getElementById('quietSeasonIntroModal').style.display = 'none';
  });
  document.getElementById('quietSeasonIntroModal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
  });
  document.getElementById('qsIntroContinueBtn')?.addEventListener('click', () => {
    document.getElementById('quietSeasonIntroModal').style.display = 'none';
    openQuietSeasonModal();
  });

  // Quiet Season activation modal
  document.getElementById('closeQuietSeasonModalBtn')?.addEventListener('click', () => {
    document.getElementById('quietSeasonModal').style.display = 'none';
  });
  document.getElementById('quietSeasonModal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
  });

  // Duration pill buttons
  document.getElementById('qsDurationGrid')?.addEventListener('click', e => {
    const btn = e.target.closest('.qs-duration-btn');
    if (!btn) return;
    document.querySelectorAll('.qs-duration-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    const confirmBtn = document.getElementById('confirmQuietSeasonBtn');
    if (confirmBtn) confirmBtn.disabled = false;
  });

  document.getElementById('confirmQuietSeasonBtn')?.addEventListener('click', () => {
    const selected = document.querySelector('.qs-duration-btn.selected');
    if (!selected) return;
    confirmQuietSeason(parseInt(selected.dataset.months, 10));
  });

  // Chase before quiet season shortcut
  document.getElementById('chaseBeforePauseBtn')?.addEventListener('click', () => {
    document.getElementById('quietSeasonModal').style.display = 'none';
    openChasePaymentsModal();
  });

  // Quiet Season status modal
  document.getElementById('closeQsStatusModalBtn')?.addEventListener('click', () => {
    document.getElementById('quietSeasonStatusModal').style.display = 'none';
  });
  document.getElementById('quietSeasonStatusModal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
  });
  document.getElementById('qsStatusResumeBtn')?.addEventListener('click', resumeLexi);

  // Locked modal
  document.getElementById('qsLockedResumeBtn')?.addEventListener('click', () => {
    document.getElementById('quietSeasonLockedModal').style.display = 'none';
    resumeLexi();
  });
  document.getElementById('qsLockedCloseBtn')?.addEventListener('click', () => {
    document.getElementById('quietSeasonLockedModal').style.display = 'none';
  });

  // Seasonal banner
  document.getElementById('seasonalBannerBtn')?.addEventListener('click', () => {
    document.getElementById('seasonalBanner').style.display = 'none';
    openQuietSeasonModal();
  });
  document.getElementById('seasonalBannerClose')?.addEventListener('click', () => {
    document.getElementById('seasonalBanner').style.display = 'none';
    localStorage.setItem('lexi_seasonal_dismissed', '1');
  });

  // Paused screen
  document.getElementById('resumeLexiBtn')?.addEventListener('click', resumeLexi);
  document.getElementById('pausedChaseBtn')?.addEventListener('click', () => {
    document.getElementById('pausedScreen').style.display = 'none';
    openChasePaymentsModal();
  });

  // Check expiry on load, then show if still paused
  checkPauseExpiry();
  checkQuoteAcceptances();
  if (isPaused()) showPausedScreen();

  // Poll for quote acceptances every 8 seconds
  setInterval(() => checkQuoteAcceptances(), 8000);

  // Check scheduled notifications on load and every hour
  checkScheduledNotifications();
  setInterval(() => checkScheduledNotifications(), 60 * 60 * 1000);

  // Also check immediately when the tradesperson tabs back to the app
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkQuoteAcceptances();
      checkScheduledNotifications();
    }
  });

  // Supabase real-time: instant notification when a customer accepts
  // (requires quote_acceptances table enabled in Supabase → Database → Replication)
  subscribeToQuoteAcceptances();

  // Show seasonal banner if applicable
  checkSeasonalPrompt();

  // Update chase badge
  updateChasePaymentsBadge();
}

/* ═══════════════════════════════════════════════════════════
   SEARCH
   ═══════════════════════════════════════════════════════════ */
function setupJobSearch() {
  const input = document.getElementById('jobSearchInput');
  if (!input) return;
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => refreshSavedDocs(), 200);
  });
}

function getJobSearchQuery() {
  return (document.getElementById('jobSearchInput')?.value || '').trim().toLowerCase();
}

/* ═══════════════════════════════════════════════════════════
   REVIEW REQUEST
   ═══════════════════════════════════════════════════════════ */
let _reviewDoc = null;

function maybeAskForReview(doc) {
  // Only ask once per job — if already asked (or dismissed), skip
  if (doc.reviewAsked) return;

  const reviewLink = state.company.reviewLink || '';
  const q = doc.quote || {};
  const custName = [q.custFirstName, q.custLastName].filter(Boolean).join(' ') || 'your customer';
  const traderName = state.company.preferredName || state.company.firstName || '';
  const msg = document.getElementById('reviewRequestMsg');
  if (msg) msg.textContent = `${custName}'s job is paid in full. Want to ask them for a Google review while they're happy?`;
  _reviewDoc = doc;
  document.getElementById('reviewRequestModal').style.display = 'flex';

  const markAsked = () => {
    doc.reviewAsked = true;
    save();
  };

  document.getElementById('reviewWhatsappBtn').onclick = () => {
    const text = reviewLink
      ? `Hi ${q.custFirstName || custName}, glad you're happy with the work! If you have two minutes, a Google review would really help my business: ${reviewLink} -thanks so much! ${traderName}`
      : `Hi ${q.custFirstName || custName}, really glad you're happy with the work! If you get a chance, a Google review would mean the world to me. Thanks! ${traderName}`;
    window.location.href = 'https://wa.me/' + formatWhatsAppNumber(q.custPhone || '') + '?text=' + encodeURIComponent(text);
    document.getElementById('reviewRequestModal').style.display = 'none';
    markAsked(); // sent — never ask again for this job
  };
  document.getElementById('reviewLaterBtn').onclick = () => {
    // Just close — will ask again next session
    document.getElementById('reviewRequestModal').style.display = 'none';
  };
  document.getElementById('reviewDontAskBtn').onclick = () => {
    document.getElementById('reviewRequestModal').style.display = 'none';
    markAsked(); // permanent — never ask again for this job
  };
}

/* ── Email compose panel ── */
function openEmailCompose(toAddr, subject, body, hasAttachment = false, onBack = null) {
  const modal      = document.getElementById('emailComposeModal');
  const toEl       = document.getElementById('ecTo');
  const subEl      = document.getElementById('ecSubject');
  const bodyEl     = document.getElementById('ecBody');
  const openBtn    = document.getElementById('ecOpenBtn');
  const attachBanner = document.getElementById('ecAttachBanner');
  if (!modal) return;
  if (toEl)   toEl.textContent  = toAddr;
  if (subEl)  subEl.textContent = subject;
  if (bodyEl) bodyEl.value      = body;
  if (attachBanner) attachBanner.style.display = hasAttachment ? 'block' : 'none';
  if (openBtn) openBtn.onclick = () => {
    window.open(`mailto:?to=${encodeURIComponent(toAddr)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
  };

  // Back button -returns to the send method picker
  const backBtn = document.getElementById('ecBackBtn');
  if (backBtn) {
    if (onBack) {
      backBtn.style.display = '';
      backBtn.onclick = () => { modal.style.display = 'none'; onBack(); };
    } else {
      backBtn.style.display = 'none';
    }
  }

  modal.style.display = 'flex';
}

function copyEmailField(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  const text = el.tagName === 'TEXTAREA' ? el.value : el.textContent;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => toast('Copied!', 'success', 1500));
  } else {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    toast('Copied!', 'success', 1500);
  }
}

/* ── Auto holding message: skip straight to sending when preference is ON ── */
function sendHoldingMessageForDoc(doc) {
  if (!doc) return;
  const q          = doc.quote || {};
  const traderName = (state.company?.preferredName || state.company?.firstName || '').trim();
  const custFirst  = getCustomerFirstName(doc);
  const phone      = formatWhatsAppNumber(q.custPhone || '');
  const email      = (q.custEmail || '').trim();
  const docType    = (q.type || q.type || 'quote').toLowerCase();
  const bizName    = (state.company?.businessName || traderName || '').trim();
  const signoff    = [traderName, bizName].filter((v, i, a) => v && a.indexOf(v) === i).join('\n');
  const msg        = `Hi ${custFirst || 'there'},\n\nThank you for accepting the ${docType}. I am really looking forward to getting the work done for you!\n\nI will be in touch shortly to confirm the booking details.\n\nKind regards\n${signoff}`.trim();

  // Match the method used to send the original quote
  const sentVia = doc.sentVia || (phone ? 'whatsapp' : 'email');
  if (sentVia === 'whatsapp' && phone) {
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
  } else if (email) {
    openEmailCompose(email, `Regarding your ${docType}`, msg);
  } else if (phone) {
    // sentVia email but no email address — fall back to WhatsApp
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
  } else {
    // No contact details at all — show the full booking modal
    showBookingContactModal(doc);
  }
}

/* ── Get the best first name available from a doc ── */
function getCustomerFirstName(doc) {
  const q = doc?.quote || {};
  if (q.custFirstName?.trim()) return q.custFirstName.trim();
  // Try custLastName then the combined custName field (never acceptedBy -that is the signer)
  const raw = (q.custLastName || doc.custName || '').trim();
  if (!raw) return '';
  // Handle "Last, First" format from buildCustName
  if (raw.includes(',')) return raw.split(',')[1]?.trim() || raw.split(',')[0]?.trim();
  return raw.split(' ')[0];
}

/* ── Contact choice modal after quote acceptance ── */
function showBookingContactModal(doc) {
  if (!doc) return;
  _quoteAcceptedDoc = null;
  const q = doc.quote || {};
  const traderName = (state.company?.preferredName || state.company?.firstName || '').trim();
  const custFirst  = getCustomerFirstName(doc);
  const phone      = formatWhatsAppNumber(q.custPhone || '');
  const email      = (q.custEmail || '').trim();
  const docType    = (q.type || 'quote').toLowerCase();
  const bizName    = (state.company?.businessName || traderName || '').trim();
  const signoff    = [traderName, bizName].filter((v, i, a) => v && a.indexOf(v) === i).join('\n');

  const titleEl = document.getElementById('bookingContactTitle');
  if (titleEl) titleEl.textContent = traderName
    ? `${traderName}, how would you like to contact ${custFirst || 'your customer'}?`
    : `How would you like to contact ${custFirst || 'your customer'}?`;

  const waBtn    = document.getElementById('bookingWhatsappBtn');
  const emailBtn = document.getElementById('bookingEmailBtn');
  const callBtn  = document.getElementById('bookingCallBtn');

  const holdingMsg  = (via) => `Hi ${custFirst || 'there'},\n\nThank you for accepting the ${docType}. I am really looking forward to getting the work done for you!\n\nI will be in touch shortly to confirm the booking details.\n\nKind regards\n${signoff}`.trim();
  const bookingMsg  = (via) => `Hi ${custFirst || 'there'},\n\nThank you for accepting the ${docType}. I am delighted to get started!\n\nI would like to book you in for:\n\nDate: \nTime: \n\nPlease let me know if this works for you.\n\nKind regards\n${signoff}`.trim();

  const showMessagePicker = (onHolding, onBooking) => {
    const W = '#7D5730';
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px';
    ov.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:28px 24px;max-width:320px;width:100%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.18)">
        <div style="font-size:1.2rem;font-weight:700;margin-bottom:6px;color:#333">What would you like to send?</div>
        <div style="color:#777;font-size:0.88rem;margin-bottom:22px">Choose the type of message to send</div>
        <button id="_bmpHolding" style="display:flex;align-items:center;justify-content:center;width:100%;padding:14px;margin-bottom:10px;border-radius:10px;border:none;background:${W};color:#fff;font-size:1rem;font-weight:600;cursor:pointer">Holding message</button>
        <button id="_bmpBooking" style="display:flex;align-items:center;justify-content:center;width:100%;padding:14px;margin-bottom:10px;border-radius:10px;border:none;background:${W};color:#fff;font-size:1rem;font-weight:600;cursor:pointer">Send booking details</button>
        <button id="_bmpCancel" style="display:block;width:100%;padding:10px;border-radius:10px;border:1.5px solid #ddd;background:#fff;color:#888;font-size:0.9rem;cursor:pointer">Cancel</button>
      </div>`;
    document.body.appendChild(ov);
    const close = () => { if (ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.querySelector('#_bmpHolding').addEventListener('click', () => { close(); onHolding(); });
    ov.querySelector('#_bmpBooking').addEventListener('click', () => { close(); onBooking(); });
    ov.querySelector('#_bmpCancel').addEventListener('click',  close);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
  };

  if (waBtn) {
    waBtn.disabled = !phone;
    waBtn.style.opacity = phone ? '' : '0.4';
    waBtn.onclick = () => {
      document.getElementById('bookingContactModal').style.display = 'none';
      showMessagePicker(
        () => window.open(`https://wa.me/${phone}?text=${encodeURIComponent(holdingMsg())}`, '_blank'),
        () => window.open(`https://wa.me/${phone}?text=${encodeURIComponent(bookingMsg())}`, '_blank')
      );
    };
  }
  if (emailBtn) {
    emailBtn.disabled = !email;
    emailBtn.style.opacity = email ? '' : '0.4';
    emailBtn.onclick = () => {
      document.getElementById('bookingContactModal').style.display = 'none';
      showMessagePicker(
        () => openEmailCompose(email, `Booking confirmation for your ${docType}`, holdingMsg()),
        () => openEmailCompose(email, `Booking details for your ${docType}`, bookingMsg())
      );
    };
  }
  if (callBtn) {
    callBtn.disabled = !phone;
    callBtn.style.opacity = phone ? '' : '0.4';
    callBtn.onclick = () => {
      document.getElementById('bookingContactModal').style.display = 'none';
      window.location.href = `tel:${phone}`;
    };
  }

  document.getElementById('bookingContactModal').style.display = 'flex';
}

function setupReviewModal() {
  // Quote accepted modal
  document.getElementById('quoteAcceptedOkBtn')?.addEventListener('click', () => {
    document.getElementById('quoteAcceptedModal').style.display = 'none';
    if (!_quoteAcceptedDoc) return;
    // If auto holding message is ON, skip straight to sending the holding message
    if (state.company?.autoHoldingMessage) {
      sendHoldingMessageForDoc(_quoteAcceptedDoc);
    } else {
      showBookingContactModal(_quoteAcceptedDoc);
    }
  });
  document.getElementById('quoteAcceptedModal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
  });

  document.getElementById('reviewRequestModal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
  });
}

/* ═══════════════════════════════════════════════════════════
   CUSTOMER STICKY NOTES + RECURRING JOBS
   Rendered inside the customer dashboard
   ═══════════════════════════════════════════════════════════ */
function buildCustomerExtras(groupName) {
  const data = getCustData(groupName);
  const note = data.note || '';
  const recurringDays = data.recurringDays || 0;

  const recurringOptions = [
    { val: 0,  label: 'Not a regular customer' },
    { val: 7,  label: 'Weekly' },
    { val: 14, label: 'Every 2 weeks' },
    { val: 28, label: 'Monthly' },
    { val: 42, label: 'Every 6 weeks' },
  ];

  return `
    <div class="cdv-extras-section">
      <div class="cdv-extras-row">
        <label class="cdv-extras-label">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          Customer Notes
        </label>
        <textarea class="cdv-sticky-note" data-cust="${esc(groupName)}" rows="3"
          placeholder="e.g. Dog in garden, parking at front, prefers WhatsApp…">${esc(note)}</textarea>
      </div>
      <div class="cdv-extras-row">
        <label class="cdv-extras-label">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          Regular Visit
        </label>
        <select class="cdv-recurring-select" data-cust="${esc(groupName)}">
          ${recurringOptions.map(o => `<option value="${o.val}"${o.val === recurringDays ? ' selected' : ''}>${o.label}</option>`).join('')}
        </select>
      </div>
    </div>`;
}

function wireCustomerExtras(body, groupName) {
  // Sticky note -auto-save on change
  let noteTimer;
  body.querySelector('.cdv-sticky-note')?.addEventListener('input', e => {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => {
      saveCustData(groupName, { note: e.target.value });
    }, 600);
  });
  // Recurring -save immediately on change
  body.querySelector('.cdv-recurring-select')?.addEventListener('change', e => {
    saveCustData(groupName, { recurringDays: parseInt(e.target.value) || 0 });
    updateChasePaymentsBadge(); // refresh badge in case recurring state changed
    renderAttentionWidget();
  });
}

/* ═══════════════════════════════════════════════════════════
   EARNINGS SUMMARY
   ═══════════════════════════════════════════════════════════ */
function openEarningsModal() {
  const body = document.getElementById('earningsModalBody');
  if (!body) return;

  const docs = state.saved || [];
  const now  = new Date();
  // UK tax year: 6 Apr to 5 Apr
  const taxYearStart = new Date(now.getMonth() < 3 || (now.getMonth() === 3 && now.getDate() < 6)
    ? now.getFullYear() - 1 : now.getFullYear(), 3, 6); // April = month 3

  let totalInvoiced = 0, totalPaid = 0, totalOutstanding = 0, jobCount = 0;
  const byMonth = {};

  docs.forEach(d => {
    const q = d.quote || {};
    const docDate = q.date || d.date;
    if (!docDate) return;
    const dDate = new Date(docDate);
    if (dDate < taxYearStart) return; // only this tax year

    const payments = getDocPayments(d);
    const paid     = payments.reduce((s, p) => s + (p.amount || 0), 0);
    const total    = d.total || 0;
    const outstanding = Math.max(0, total - paid);

    totalInvoiced   += total;
    totalPaid       += paid;
    totalOutstanding += outstanding;
    jobCount++;

    // Monthly breakdown by invoice date
    const monthKey = docDate.slice(0, 7); // YYYY-MM
    if (!byMonth[monthKey]) byMonth[monthKey] = { invoiced: 0, paid: 0 };
    byMonth[monthKey].invoiced += total;
    byMonth[monthKey].paid     += paid;
  });

  const months = Object.keys(byMonth).sort();
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const taxYearLabel = `${taxYearStart.getFullYear()}–${taxYearStart.getFullYear() + 1}`;

  body.innerHTML = `
    <p style="color:#888;font-size:0.8rem;margin:0 0 14px">Tax year ${taxYearLabel} (6 Apr – 5 Apr)</p>
    <div class="earn-summary-grid">
      <div class="earn-stat">
        <span class="earn-stat-num">${fmtPrice(totalInvoiced)}</span>
        <span class="earn-stat-lbl">Total Invoiced</span>
      </div>
      <div class="earn-stat">
        <span class="earn-stat-num earn-paid">${fmtPrice(totalPaid)}</span>
        <span class="earn-stat-lbl">Collected</span>
      </div>
      <div class="earn-stat">
        <span class="earn-stat-num ${totalOutstanding > 0 ? 'earn-owed' : ''}">${fmtPrice(totalOutstanding)}</span>
        <span class="earn-stat-lbl">Outstanding</span>
      </div>
      <div class="earn-stat">
        <span class="earn-stat-num">${jobCount}</span>
        <span class="earn-stat-lbl">Jobs</span>
      </div>
    </div>

    ${months.length ? `
    <div class="earn-breakdown">
      <div class="earn-breakdown-title">Month by month</div>
      ${months.map(m => {
        const [yr, mo] = m.split('-');
        const label = monthNames[parseInt(mo) - 1] + ' ' + yr;
        const d = byMonth[m];
        return `<div class="earn-month-row">
          <span class="earn-month-name">${label}</span>
          <span class="earn-month-invoiced">${fmtPrice(d.invoiced)}</span>
          <span class="earn-month-paid ${d.paid < d.invoiced ? 'earn-partial' : 'earn-full'}">${fmtPrice(d.paid)} collected</span>
        </div>`;
      }).join('')}
    </div>` : ''}

    <div class="earn-tax-note">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      These figures are for reference only. Always check with your accountant at tax time.
    </div>

    <button type="button" class="btn btn-outline w-100" id="exportEarningsBtn" style="margin-top:14px">Download as Text</button>`;

  // Wire export button
  document.getElementById('exportEarningsBtn')?.addEventListener('click', () => {
    const lines = [
      `Lexi Handles It -Earnings Summary`,
      `Tax year ${taxYearLabel}`,
      ``,
      `Total invoiced:   ${fmtPrice(totalInvoiced)}`,
      `Total collected:  ${fmtPrice(totalPaid)}`,
      `Outstanding:      ${fmtPrice(totalOutstanding)}`,
      `Number of jobs:   ${jobCount}`,
      ``,
      `Month-by-month:`,
      ...months.map(m => {
        const [yr, mo] = m.split('-');
        return `  ${monthNames[parseInt(mo)-1]} ${yr}: invoiced ${fmtPrice(byMonth[m].invoiced)}, collected ${fmtPrice(byMonth[m].paid)}`;
      }),
      ``,
      `Generated by Lexi Handles It`
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `lexi-earnings-${taxYearLabel}.txt`; a.click();
  });

  document.getElementById('earningsModal').style.display = 'flex';
}

function setupEarnings() {
  document.getElementById('menuEarnings')?.addEventListener('click', () => {
    closeMenu();
    setTimeout(openEarningsModal, 180);
  });
  document.getElementById('closeEarningsBtn')?.addEventListener('click', () => {
    document.getElementById('earningsModal').style.display = 'none';
  });
  document.getElementById('earningsModal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
  });
}
