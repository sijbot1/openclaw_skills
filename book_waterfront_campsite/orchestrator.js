#!/usr/bin/env node
/**
 * Waterfront Campsite Orchestrator
 * 
 * Spawns parallel scans across multiple campgrounds and dates.
 * Collects results and reports the best waterfront options.
 * 
 * Usage: node orchestrator.js
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const SCRIPT = path.join(__dirname, 'scan-campground.js');
const RESULTS_DIR = path.join(__dirname, 'results');

fs.mkdirSync(RESULTS_DIR, { recursive: true });

const searches = [
  // Campground, Arrival, Departure, Label
  ['Algonquin - Pog Lake & Kearney Lake', '30', '31', 'pog-30-31'],
  ['Algonquin - Pog Lake & Kearney Lake', '20', '21', 'pog-06-20'],
  ['Algonquin - Pog Lake & Kearney Lake', '27', '28', 'pog-06-27'],
  ['Algonquin - Mew Lake', '30', '31', 'mew-30-31'],
  ['Algonquin - Mew Lake', '23', '24', 'mew-23-24'],
  ['Algonquin - Rock Lake & Raccoon Lake', '30', '31', 'rock-30-31'],
  ['Algonquin - Rock Lake & Raccoon Lake', '23', '24', 'rock-23-24'],
  ['Algonquin - Canisbay Lake', '30', '31', 'canisbay-30-31'],
];

async function run() {
  console.log('🌊 Waterfront Campsite Orchestrator\n');
  console.log(`Spawning ${searches.length} parallel scans...\n`);

  const procs = searches.map(([camp, arr, dep, label]) => {
    const logFile = path.join(RESULTS_DIR, `${label}.log`);
    const cmd = `CAMP="${camp}" ARR_DAY=${arr} DEP_DAY=${dep} LABEL=${label} timeout 180 node ${SCRIPT}`;
    
    const proc = require('child_process').spawn('bash', ['-c', cmd], {
      stdio: ['pipe', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'w')],
      detached: false
    });
    
    return { label, camp, arr, dep, proc, logFile };
  });

  // Wait for all with progress
  const pending = new Set(procs.map(p => p.label));
  const results = [];

  while (pending.size > 0) {
    for (const p of procs) {
      if (!pending.has(p.label)) continue;
      try {
        const code = p.proc.exitCode;
        if (code !== null && code !== undefined) {
          pending.delete(p.label);
          const success = code === 0;
          
          // Read result
          let resultData = null;
          const resultFile = path.join(__dirname, `results-${p.label}.json`);
          try { resultData = JSON.parse(fs.readFileSync(resultFile, 'utf8')); } catch(e) {}
          
          results.push({ label: p.label, camp: p.camp, arr: p.arr, dep: p.dep, success, data: resultData });
          console.log(`  ${success ? '✅' : '❌'} ${p.label} (${p.camp} ${p.arr}-${p.dep})`);
        }
      } catch(e) {}
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  // Summary
  console.log('\n========== RESULTS ==========\n');
  
  const available = results.filter(r => r.success && r.data && r.data.sites && r.data.sites.length > 0);
  const waterfront = results.filter(r => r.success && r.data && r.data.sites && r.data.sites.some(s => s.isAvailable));
  
  if (available.length === 0) {
    console.log('No available campsites found across any search.');
    console.log('Check the logs in:', RESULTS_DIR);
    return;
  }
  
  console.log('Available campsites found:');
  for (const r of available) {
    console.log(`\n  ${r.camp} (${r.arr}/${r.dep}):`);
    for (const site of (r.data.sites || [])) {
      const wf = site.waterDistance ? ` [${site.waterDistance}px from water]` : '';
      console.log(`    Site ${site.siteNum}: ${site.isAvailable ? '✅' : '❌'} ${site.popup?.substring(0, 60) || ''}${wf}`);
    }
  }
  
  // Best waterfront picks
  const waterfrontSites = available
    .flatMap(r => (r.data.sites || []).filter(s => s.isAvailable && (s.waterDistance || 99) < 20)
      .map(s => ({ ...s, camp: r.camp, dates: `${r.arr}-${r.dep}` })));
  
  waterfrontSites.sort((a, b) => (a.waterDistance || 999) - (b.waterDistance || 999));
  
  if (waterfrontSites.length > 0) {
    console.log('\n🏆 Best Waterfront Picks:');
    waterfrontSites.slice(0, 5).forEach(s => {
      console.log(`  Site ${s.siteNum} at ${s.camp} (${s.dates}) — ${s.waterDistance || '?'}px from water`);
    });
  }
}

run().catch(console.error);
