// GitHub Action script — runs on June 26 and July 24 after market close
// Fetches closing prices from Finnhub and writes them into index.html
// Then git commits → Netlify auto-deploys the updated file

const https = require('https');
const fs    = require('fs');

const KEY = process.env.FINNHUB_KEY;
if (!KEY) { console.error('Error: FINNHUB_KEY secret not set in GitHub Actions.'); process.exit(1); }

// Maps the ticker used in index.html → Finnhub symbol to query
const TICKERS = {
  MSFT: 'MSFT',
  AAPL: 'AAPL',
  NVDA: 'NVDA',
  JPM:  'JPM',
  RY:   'RY',
  COST: 'COST',
  JNJ:  'JNJ',
  CNR:  'CNI',   // Canadian National Railway trades on NYSE as CNI
};

function fetchPrice(symbol) {
  return new Promise((resolve) => {
    const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${KEY}`;
    https.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          resolve(j.c && j.c !== 0 ? j.c : null);
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

async function main() {
  // Determine ET date (UTC-4 during EDT)
  const now = new Date();
  const et  = new Date(now.getTime() - 4 * 3600000);
  const month = et.getUTCMonth() + 1;
  const day   = et.getUTCDate();

  // Decide which field to update — ENTRY on Jun 26, EVAL on Jul 24
  let field = null;
  if (month === 6 && day === 26) field = 'ENTRY';
  if (month === 7 && day === 24) field = 'EVAL';

  // Allow manual override via env var (for testing: PRICE_FIELD=ENTRY node update-prices.js)
  if (process.env.PRICE_FIELD) field = process.env.PRICE_FIELD.toUpperCase();

  if (!field) {
    console.log(`Today is ${et.toISOString().slice(0, 10)} ET — not Jun 26 or Jul 24. Nothing to update.`);
    return;
  }

  console.log(`\nFetching ${field} prices (${et.toISOString().slice(0, 10)} ET)...\n`);

  const prices = {};
  for (const [ticker, sym] of Object.entries(TICKERS)) {
    const price = await fetchPrice(sym);
    prices[ticker] = price;
    console.log(`  ${ticker.padEnd(5)} (${sym.padEnd(5)}) → ${price != null ? '$' + price.toFixed(2) : 'FAILED'}`);
    await new Promise(r => setTimeout(r, 300)); // stay within Finnhub free-tier rate limit
  }

  // Build the replacement line, e.g.:
  //   const ENTRY = { MSFT:420.12, AAPL:198.34, ... };
  const vals = Object.keys(TICKERS).map(t => `${t}:${prices[t] ?? 'null'}`).join(', ');
  const replacement = `const ${field} = { ${vals} };`;

  // Read index.html and replace the matching line
  const html  = fs.readFileSync('index.html', 'utf8');
  const lines = html.split('\n');
  const prefix = `const ${field} =`;
  let updated = false;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith(prefix)) {
      lines[i] = replacement;
      updated = true;
      break;
    }
  }

  if (!updated) {
    console.error(`\nError: Could not find "${prefix}" line in index.html.`);
    process.exit(1);
  }

  fs.writeFileSync('index.html', lines.join('\n'), 'utf8');
  console.log(`\n✓ ${field} prices written to index.html`);
  console.log('  Git will commit this change → Netlify will auto-deploy.\n');
}

main().catch(e => { console.error(e); process.exit(1); });
