const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ======= CONFIGURATION =======
const SEARCH_QUERIES = [
  'react next.js recruiter',
  'hiring react next.js',
  'technical recruiter react',
  'hiring next.js react frontend',
  'react.js recruiter',
  'talent acquisition react next.js',
];

const MAX_PROFILES_PER_QUERY = 30;
const MAX_TOTAL_PROFILES = 100;
const SCROLL_DELAY_MS = 2000;
const PROFILE_VISIT_DELAY_MS = 3000;
const OUTPUT_FILE = path.join(__dirname, 'linkedin_recruiters.json');

// ======= STATE =======
const results = [];
const visitedProfiles = new Set();

// ======= HELPERS =======
function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function randomDelay(baseMs) {
  return delay(baseMs + Math.random() * 2000);
}

// ======= SCRAPE LOGIC =======
async function scrapeSearchResults(page, query) {
  console.log(`\n=== Searching: "${query}" ===`);
  const url = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await delay(3000);

  let previousCount = 0;
  let staleScrolls = 0;

  for (let scrollRound = 0; scrollRound < 20; scrollRound++) {
    // Get all profile links visible on page
    const profiles = await page.evaluate(() => {
      const links = [];
      document.querySelectorAll('a[href*="/in/"]').forEach(a => {
        const href = a.getAttribute('href');
        if (href && href.startsWith('/in/')) {
          links.push({ href: 'https://www.linkedin.com' + href.split('?')[0] });
        }
      });
      return [...new Map(links.map(p => [p.href, p])).values()];
    });

    // Extract name, title, company from visible search result cards
    const cards = await page.evaluate(() => {
      const items = [];
      document.querySelectorAll('.reusable-search__result-container').forEach(c => {
        const nameEl = c.querySelector('.entity-result__title-text a, .actor-name, .profile-card-name');
        const titleEl = c.querySelector('.entity-result__primary-subtitle, .profile-card-subtitle');
        const subtitleEl = c.querySelector('.entity-result__secondary-subtitle, .profile-card-subtitle-2');
        const name = nameEl ? nameEl.textContent.trim() : '';
        const title = titleEl ? titleEl.textContent.trim() : '';
        const company = subtitleEl ? subtitleEl.textContent.trim() : '';
        if (name) {
          items.push({ name, title, company });
        }
      });
      return items;
    });

    console.log(`  Scroll ${scrollRound + 1}: found ${profiles.length} profiles, ${cards.length} cards visible`);

    // Merge card data with profile URLs
    for (let i = 0; i < profiles.length && i < cards.length; i++) {
      const id = profiles[i].href;
      if (!visitedProfiles.has(id)) {
        visitedProfiles.add(id);
        results.push({
          name: cards[i]?.name || '',
          title: cards[i]?.title || '',
          company: cards[i]?.company || '',
          linkedin_url: profiles[i].href,
          email: '',
          phone: '',
          notes: ''
        });
      }
    }

    // Scroll down
    await page.evaluate(() => {
      const scrollable = document.querySelector('.reusable-search__entity-result-list, ' +
        '.search-results-container, ' +
        'main, ' +
        'html');
      if (scrollable) {
        scrollable.scrollBy(0, 800);
      } else {
        window.scrollBy(0, 800);
      }
    });

    await randomDelay(SCROLL_DELAY_MS);

    // Check if we're stuck
    if (results.length === previousCount) {
      staleScrolls++;
      if (staleScrolls >= 3) break;
    } else {
      staleScrolls = 0;
    }
    previousCount = results.length;

    if (results.length >= MAX_PROFILES_PER_QUERY) break;
  }

  console.log(`  Collected ${results.length} total profiles so far from this query`);
}

async function visitProfileForContact(page, profileUrl) {
  try {
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(PROFILE_VISIT_DELAY_MS);

    // Try clicking "Contact info" if visible
    const contactBtn = page.locator('a[href*="contact-info"], a[data-control-name="contact_see_more"]');
    if (await contactBtn.count() > 0) {
      await contactBtn.first().click();
      await delay(2000);
    }

    // Extract visible contact info
    const contactInfo = await page.evaluate(() => {
      const data = { email: '', phone: '' };
      const body = document.body.innerText || '';

      // Look for email patterns
      const emailMatch = body.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g);
      if (emailMatch) {
        data.email = [...new Set(emailMatch.map(e => e.toLowerCase()))]
          .filter(e => !e.includes('@linkedin') && !e.includes('@email.com'))
          .join(', ');
      }

      // Look for phone patterns
      const phoneRegex = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
      const phoneMatch = body.match(phoneRegex);
      if (phoneMatch) {
        data.phone = [...new Set(phoneMatch)].join(', ');
      }

      return data;
    });

    return contactInfo;
  } catch (err) {
    console.log(`  Error visiting ${profileUrl}: ${err.message}`);
    return { email: '', phone: '' };
  }
}

// ======= MAIN =======
async function main() {
  console.log('LinkedIn Recruiter Scraper for React/Next.js Hiring');
  console.log('='.repeat(60));
  console.log('NOTE: LinkedIn requires login. A browser will open.');
  console.log('Please log in manually when prompted, then press Enter in the terminal.\n');

  const browser = await chromium.launch({
    headless: false,  // Show browser so user can log in
    args: ['--disable-blink-features=AutomationControlled']
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  // Step 1: Go to LinkedIn and let user log in
  console.log('Opening LinkedIn login page...');
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(async () => {
    // If timeout, try a simpler approach
    await page.goto('https://www.linkedin.com/login', { waitUntil: 'commit', timeout: 60000 }).catch(() => {});
  });
  await delay(5000);
  console.log('Browser opened. Please log in to LinkedIn manually, then press Enter here to continue...');
  await new Promise(resolve => {
    process.stdin.once('data', () => resolve());
  });

  // Verify we're logged in
  const currentUrl = page.url();
  if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint')) {
    console.log('Still on login page. Please make sure you logged in successfully and try again.');
    await browser.close();
    return;
  }
  console.log('Login confirmed. Starting scrape...\n');

  // Step 2: Run searches
  for (const query of SEARCH_QUERIES) {
    if (results.length >= MAX_TOTAL_PROFILES) {
      console.log('\nReached max total profiles limit.');
      break;
    }
    await scrapeSearchResults(page, query);
    await randomDelay(3000);
  }

  console.log(`\n=== Collected ${results.length} profiles from search ===`);

  // Step 3: Visit profiles for contact info (sample top 30)
  const toVisit = results.slice(0, Math.min(30, results.length));
  console.log(`\n=== Visiting ${toVisit.length} profiles for contact info... ===`);

  for (let i = 0; i < toVisit.length; i++) {
    const profile = toVisit[i];
    if (!profile.linkedin_url) continue;

    process.stdout.write(`  [${i + 1}/${toVisit.length}] ${profile.name}... `);
    const contact = await visitProfileForContact(page, profile.linkedin_url);
    profile.email = contact.email;
    profile.phone = contact.phone;
    profile.notes = contact.email || contact.phone ? 'Contact info found on LinkedIn profile' : 'No contact info visible';
    console.log(contact.email || contact.phone ? 'found contact info' : 'no contact info');
  }

  // Step 4: Save results
  const output = {
    scrape_date: new Date().toISOString(),
    search_queries: SEARCH_QUERIES,
    total_found: results.length,
    recruiters: results
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\n=== Results saved to: ${OUTPUT_FILE} ===`);
  console.log(`Total profiles: ${results.length}`);
  console.log(`Profiles with email: ${results.filter(r => r.email).length}`);
  console.log(`Profiles with phone: ${results.filter(r => r.phone).length}`);

  await browser.close();
}

main().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
