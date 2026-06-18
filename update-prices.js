// GitHub Action script — runs on June 26 and July 24 after market close
// On June 26: fetches closing prices, calculates share counts from $950k budget,
//             writes ENTRY prices + ENTRY_SHARES into index.html → Netlify auto-deploys
// On July 24: fetches closing prices, writes EVAL prices into index.html → Netlify auto-deploys

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

// Budget for each stock — must sum to $950,000
// On June 26, share counts = floor(allocation / closing_price) so invested ≈ $950k exactly
const ALLOCATION = {
  MSFT: 63333,
  AAPL: 63333,
  NVDA: 63333,
  JPM:  95000,
  RY:   95000,
  COST: 190000,
  JNJ:  190000,
  CNR:  190000,
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

function updateLine(lines, prefix, replacement) {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith(prefix)) {
      lines[i] = replacement;
      return true;
    }
  }
  return false;
}

async function main() {
  // Determine ET date (UTC-4 during EDT)
  const now = new Date();
  const et  = new Date(now.getTime() - 4 * 3600000);
  const month = et.getUTCMonth() + 1;
  const day   = et.getUTCDate();

  let field = null;
  if (month === 6 && day === 26) field = 'ENTRY';
  if (month === 7 && day === 24) field = 'EVAL';

  // Allow manual override (PRICE_FIELD=ENTRY node update-prices.js)
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
    await new Promise(r => setTimeout(r, 300));
  }

  const html  = fs.readFileSync('index.html', 'utf8');
  const lines = html.split('\n');

  // Always update the price field (ENTRY or EVAL)
  const priceVals = Object.keys(TICKERS).map(t => `${t}:${prices[t] ?? 'null'}`).join(', ');
  const priceReplacement = `const ${field} = { ${priceVals} };`;
  if (!updateLine(lines, `const ${field} =`, priceReplacement)) {
    console.error(`Could not find "const ${field} =" in index.html`); process.exit(1);
  }
  console.log(`\n✓ ${field} prices written`);

  // On June 26 only: also calculate and write share counts
  // shares = floor(allocation / closing_price) → total invested ≈ $950,000
  if (field === 'ENTRY') {
    const shares = {};
    let totalInvested = 0;

    console.log('\nCalculating share counts based on Jun 26 closing prices:\n');
    for (const [ticker] of Object.entries(TICKERS)) {
      const price = prices[ticker];
      const alloc = ALLOCATION[ticker];
      if (price != null) {
        shares[ticker] = Math.floor(alloc / price);
        const cost = shares[ticker] * price;
        totalInvested += cost;
        console.log(`  ${ticker.padEnd(5)} → ${shares[ticker]} shares × $${price.toFixed(2)} = $${cost.toFixed(2)} (budget $${alloc})`);
      } else {
        shares[ticker] = null;
        console.log(`  ${ticker.padEnd(5)} → FAILED to fetch price, keeping planned count`);
      }
    }

    const cash = 1000000 - totalInvested;
    console.log(`\n  Total invested: $${totalInvested.toFixed(2)}`);
    console.log(`  Cash remaining: $${cash.toFixed(2)}`);
    console.log(`  Net worth at entry: $${(totalInvested + cash).toFixed(2)}`);

    const shareVals = Object.keys(TICKERS).map(t => `${t}:${shares[t] ?? 'null'}`).join(', ');
    const sharesReplacement = `const ENTRY_SHARES = { ${shareVals} };`;
    if (!updateLine(lines, 'const ENTRY_SHARES =', sharesReplacement)) {
      console.error('Could not find "const ENTRY_SHARES =" in index.html'); process.exit(1);
    }
    console.log('✓ ENTRY_SHARES written');
  }

  fs.writeFileSync('index.html', lines.join('\n'), 'utf8');
  console.log('\n✓ index.html updated — Git will commit → Netlify will auto-deploy.\n');
}

main().catch(e => { console.error(e); process.exit(1); });
