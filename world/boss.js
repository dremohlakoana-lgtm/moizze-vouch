/**
 * MOIZZE WORLD — BOSS SCRIPT
 * Runs every Monday. Deploys 7 workers. Each does a different job.
 * Results saved to world/report-YYYY-WW.json
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');

const WORKERS = [
  {
    id: 1,
    name: 'Scout',
    role: 'SA Business Leads',
    task: `Search the web for South African small businesses that recently opened or are looking for digital services. Find at least 5 leads with business name, location, and what they need. Search queries like "new business South Africa 2025" or "SA startup looking for website". Return a JSON array of leads.`
  },
  {
    id: 2,
    name: 'Pulse',
    role: 'Trending Products in SA',
    task: `Search the web for what products are trending and selling fast in South Africa right now. Check takealot.com trending, SA Twitter/X trends, and Google trends for SA. Find top 5 trending products with why they are trending. Return a JSON array.`
  },
  {
    id: 3,
    name: 'Radar',
    role: 'SA Job Market Demand',
    task: `Search South African job boards (pnet.co.za, careers24.com, LinkedIn SA) for the top 5 most in-demand skills or jobs this week. Include job title, average salary if available, and how many listings found. Return a JSON array.`
  },
  {
    id: 4,
    name: 'Hawk',
    role: 'Competitor Prices & Gaps',
    task: `Search the web for digital products, SaaS tools, or services being sold in South Africa. Find 5 products/services that are overpriced or have a gap in the market — things people complain are too expensive or hard to find locally. Return a JSON array with product, current price, and the gap/opportunity.`
  },
  {
    id: 5,
    name: 'Echo',
    role: 'SA News & Business Events',
    task: `Search for the top 5 South African business news stories this week. Focus on economy, startups, tech, and money. Include headline, summary, and source URL. Return a JSON array.`
  },
  {
    id: 6,
    name: 'Vibe',
    role: 'Social Trends & Viral SA Content',
    task: `Search Twitter/X, TikTok trends, and Reddit for what is going viral in South Africa this week. Find 5 trending topics, memes, or content that SA people are talking about. Include topic, why it is trending, and potential business angle. Return a JSON array.`
  },
  {
    id: 7,
    name: 'Hunter',
    role: 'Tenders, Grants & Opportunities',
    task: `Search South African government tender sites (etenders.gov.za), SEDA grants, NEF funding, and similar sources for open opportunities this week. Find 5 open tenders or grants that small businesses or individuals can apply for. Include name, deadline, value, and link. Return a JSON array.`
  }
];

async function runBoss() {
  const weekNumber = getWeekNumber(new Date());
  const year = new Date().getFullYear();
  const reportFile = path.join(__dirname, `report-${year}-W${weekNumber}.json`);

  console.log(`\n👑 MOIZZE BOSS — Week ${weekNumber}, ${year}`);
  console.log(`📋 Deploying 7 workers...\n`);

  const report = {
    week: `${year}-W${weekNumber}`,
    generated: new Date().toISOString(),
    workers: []
  };

  // Save initial state
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

  // Update workers.json status
  const workersData = JSON.parse(fs.readFileSync(path.join(__dirname, 'workers.json')));
  workersData.last_run = new Date().toISOString();
  workersData.week = `${year}-W${weekNumber}`;
  workersData.workers.forEach(w => { w.status = 'working'; w.result = null; });
  fs.writeFileSync(path.join(__dirname, 'workers.json'), JSON.stringify(workersData, null, 2));

  console.log(`✅ Boss initialized. Workers deployed to field.`);
  console.log(`📁 Report will be saved to: ${reportFile}`);
  console.log(`\nThe 7 workers are now running as subagents...`);
  console.log(`Results will appear in world/report-${year}-W${weekNumber}.json\n`);
}

function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

module.exports = { WORKERS, getWeekNumber };

runBoss();
