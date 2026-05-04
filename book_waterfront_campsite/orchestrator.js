#!/usr/bin/env node
/**
 * Waterfront Campsite Orchestrator v2
 * 
 * Recursive search pattern:
 *   1. Try campground → check waterfront → found? Report & stop
 *   2. Not found? Try next campground in same park
 *   3. All campgrounds in park tried? Move to next park in region
 *   4. All parks in region tried? Move to next region
 *   5. All regions tried? Try next weekend
 *   6. Keep looping until waterfront found or all exhausted
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const SCRIPT = path.join(__dirname, 'scan-campground.js');
const RESULTS_DIR = path.join(__dirname, 'results');
fs.mkdirSync(RESULTS_DIR, { recursive: true });

// ─── SEARCH SPACE ───
// Region → Parks → Campgrounds
const REGIONS = [
  {
    name: 'Algonquin Park',
    parks: [
      {
        name: 'Algonquin',
        campgrounds: [
          'Algonquin - Pog Lake & Kearney Lake',  // Best lakefront
          'Algonquin - Mew Lake',                  // Good lakefront
          'Algonquin - Rock Lake & Raccoon Lake',  // On Rock Lake
          'Algonquin - Canisbay Lake',             // On Canisbay Lake
          'Algonquin - Lake Of Two Rivers',        // On two rivers
        ]
      }
    ]
  },
  {
    name: 'Georgian Bay / Muskoka',
    parks: [
      {
        name: 'Killbear',
        campgrounds: []  // Will be discovered at runtime
      },
      {
        name: 'Awenda',
        campgrounds: []
      },
      {
        name: 'Six Mile Lake',
        campgrounds: []
      },
      {
        name: 'Arrowhead',
        campgrounds: []
      }
    ]
  },
  {
    name: 'Lake Huron / Southwestern',
    parks: [
      {
        name: 'Pinery',
        campgrounds: []
      },
      {
        name: 'Rondeau',
        campgrounds: []
      },
      {
        name: 'Rock Point',
        campgrounds: []
      }
    ]
  },
  {
    name: 'Lake Ontario / Eastern',
    parks: [
      {
        name: 'Sandbanks',
        campgrounds: []
      },
      {
        name: 'Presqu\'ile',
        campgrounds: []
      },
      {
        name: 'Bon Echo',
        campgrounds: []
      },
      {
        name: 'Charleston Lake',
        campgrounds: []
      }
    ]
  }
];

// Dates to try (month-day pairs)
const DATES = [
  ['30', '31'],  // May 30-31
  ['23', '24'],  // May 23-24
  ['16', '18'],  // May 16-18 (Victoria Day)
  ['06', '07'],  // June 6-7
  ['13', '14'],  // June 13-14
  ['20', '21'],  // June 20-21
  ['27', '28'],  // June 27-28
  ['04', '05'],  // July 4-5
];

// ─── DISCOVER CAMPGROUNDS FOR A PARK ───
async function discoverCampgrounds(parkName) {
  // Check if we already have cached options
  const cacheFile = path.join(__dirname, `.campgrounds-${parkName.replace(/[^a-z]/gi, '')}.json`);
  if (fs.existsSync(cacheFile)) {
    return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  }

  console.log(`\n🔍 Discovering campgrounds for "${parkName}"...`);
  
  // Use a quick scan to get campground options from the autocomplete
  // We reuse scan-campground.js but intercept the options
  const resultFile = path.join(RESULTS_DIR, `_discover_${parkName.replace(/[^a-z]/gi, '')}.json`);
  
  // Quick script just to extract autocomplete options
  const discoverScript = `
    const { chromium } = require('playwright-extra');
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    chromium.use(StealthPlugin());
    const path = require('path');
    const fs = require('fs');
    (async () => {
      const b = await chromium.launch({headless:true, args:['--no-sandbox']});
      const p = await b.newPage({viewport:{width:1440,height:900}});
      await p.goto('https://reservations.ontarioparks.ca/',{waitUntil:'load',timeout:60000});
      for(let i=0;i<30;i++){if(await p.evaluate(()=>!!document.querySelector('#park-autocomplete-input')))break;await p.waitForTimeout(1000);}
      await p.locator('#park-autocomplete-input').click({force:true}).catch(()=>{});
      await p.waitForTimeout(100);
      await p.locator('#park-autocomplete-input').fill('');
      await p.locator('#park-autocomplete-input').type(${JSON.stringify(parkName)},{delay:10});
      await p.waitForTimeout(1500);
      const opts = await p.evaluate(() => Array.from(document.querySelectorAll('mat-option')).map(o=>o.innerText.trim()).filter(t=>t));
      fs.writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify({park: ${JSON.stringify(parkName)}, campgrounds: opts}));
      console.log(JSON.stringify(opts));
      await b.close();
    })();
  `;
  
  try {
    const out = execSync(`cd ${__dirname} && timeout 90 node -e "${discoverScript.replace(/"/g, '\\"')}" 2>&1`).toString();
    const lines = out.trim().split('\n');
    const jsonLine = lines.find(l => l.startsWith('['));
    if (jsonLine) {
      const options = JSON.parse(jsonLine);
      // First try: "Park - Campground" format (Algonquin)
      let campgrounds = options.filter(o => o.startsWith(parkName + ' - '));
      // Fallback: use the park name directly (Killbear, Pinery, etc.)
      if (campgrounds.length === 0 && options.length > 0) {
        campgrounds = options;
        console.log(`  Park names found: ${campgrounds.map(c => c.substring(0, 40)).join(', ')}`);
      } else {
        console.log(`  Found ${campgrounds.length} campgrounds: ${campgrounds.map(c => c.replace(parkName + ' - ', '')).join(', ')}`);
      }
      fs.writeFileSync(cacheFile, JSON.stringify(campgrounds, null, 2));
      return campgrounds;
    }
  } catch (e) {
    console.log(`  Discovery failed: ${e.message.substring(0, 80)}`);
  }
  return [];
}

// ─── RUN SINGLE SCAN ───
async function runScan(campground, arr, dep) {
  const label = `${campground.replace(/[^a-z0-9]/gi, '')}-${arr}-${dep}`.substring(0, 60);
  const resultFile = path.join(__dirname, `results-${label}.json`);
  const logFile = path.join(RESULTS_DIR, `${label}.log`);
  
  console.log(`\n  🔎 Scanning: ${campground} (${arr}-${dep})`);
  
  return new Promise((resolve) => {
    const proc = spawn('bash', ['-c', `CAMP="${campground}" ARR_DAY=${arr} DEP_DAY=${dep} LABEL=${label} timeout 600 node ${SCRIPT}`], {
      stdio: ['pipe', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'w')]
    });
    
    proc.on('exit', () => {
      let data = null;
      try { 
        if (fs.existsSync(resultFile)) {
          data = JSON.parse(fs.readFileSync(resultFile, 'utf8')); 
        }
      } catch(e) { console.log(`    Error reading results: ${e.message}`); }
      
      const foundWF = data?.waterfrontSites?.length > 0;
      console.log(`    ${foundWF ? '✅ Waterfront!' : '❌ No waterfront'} (${data?.availableCount || 0} avail, ${data?.waterfrontSites?.length || 0} waterfront)`);
      
      resolve({ label, campground, arr, dep, data, waterfront: data?.waterfrontSites || [] });
    });
    
    proc.on('error', () => resolve({ label, campground, arr, dep, data: null, waterfront: [] }));
  });
}

// ─── MAIN LOOP ───
async function run() {
  console.log('🌊🌊🌊 WATERFRONT CAMPSITE ORCHESTRATOR v2');
  console.log('Recursive search: campground → park → region → dates\n');
  
  let foundWaterfront = false;

  for (const dateIdx in DATES) {
    const [arr, dep] = DATES[dateIdx];
    const monthLabel = parseInt(arr) >= 20 ? 'May' : parseInt(arr) < 20 ? 'May' : 'June';
    console.log(`\n📅 === Trying dates: ${monthLabel} ${arr}-${dep} ===`);
    
    if (foundWaterfront) break;
    
    for (const region of REGIONS) {
      if (foundWaterfront) break;
      console.log(`\n📍 Region: ${region.name}`);
      
      for (const park of region.parks) {
        if (foundWaterfront) break;
        
        // Discover campgrounds if not known
        let campgrounds = park.campgrounds;
        if (campgrounds.length === 0) {
          const discovered = await discoverCampgrounds(park.name);
          campgrounds = discovered;
          park.campgrounds = discovered;
        }
        
        if (campgrounds.length === 0) {
          console.log(`  ⏭️ No campgrounds found for ${park.name}`);
          continue;
        }
        
        console.log(`\n🏞️  Park: ${park.name}`);
        
        for (const campground of campgrounds) {
          if (foundWaterfront) break;
          
          const result = await runScan(campground, arr, dep);
          
          if (result.waterfront.length > 0) {
            foundWaterfront = true;
            console.log(`\n🎉🎉🎉 WATERFRONT FOUND! 🎉🎉🎉`);
            console.log(`   ${campground} (${arr}-${dep})`);
            result.waterfront.sort((a, b) => a.waterDist - b.waterDist).slice(0, 10).forEach(s => {
              console.log(`   Site ${s.siteNum} — ${s.waterDist}px from water — ${s.section}`);
            });
            console.log(`\n   Direct link: https://reservations.ontarioparks.ca/`);
            break;
          }
        }
      }
    }
    
    if (!foundWaterfront) {
      console.log(`\n  ❌ No waterfront found for ${monthLabel} ${arr}-${dep} across any region.`);
      console.log(`  ➡️  Moving to next weekend...`);
    }
  }

  if (!foundWaterfront) {
    console.log(`\n😔 No waterfront campsite found across ALL regions and dates.`);
    console.log(`Suggestions: expand regions, try weekdays, or check for cancellations.`);
  }

  console.log(`\n✅ Search complete.`);
}

run().catch(console.error);
