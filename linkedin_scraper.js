const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(require('os').homedir(), '.n8n-files', 'linkedin_posts.json');
const SESSION_FILE = path.join(__dirname, 'linkedin_session.json');
const SEARCH_URL = 'https://www.linkedin.com/search/results/content/?keywords=hiring%20react.js&origin=SWITCH_SEARCH_VERTICAL';

function delay(ms) {
  return new Promise(r => setTimeout(r, ms + Math.random() * 2000));
}

function parsePostsFromText(fullText) {
  const posts = [];
  const chunks = fullText.split('Feed post').slice(1);

  for (const chunk of chunks) {
    const lines = chunk.split('\n').filter(l => l.trim());
    if (lines.length < 3) continue;

    const posterName = lines[0]?.trim() || '';
    const timeLine = lines.find(l => /\d+[hdmw]\s•/.test(l) || /\d+ (hour|day|week|month)/.test(l) || /^\d+d\s•/.test(l));
    const timePosted = timeLine?.match(/(\d+[hdmw]\s•|\d+ (hour|day|week|month)|\ +\|\d+\s•)/)?.[0]?.trim() || '';

    const emails = [...new Set(
      (chunk.match(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/g) || [])
        .map(e => e.toLowerCase())
        .filter(e => !e.includes('linkedin') && !e.includes('example') && !e.includes('@email'))
    )];

    const phones = [...new Set(
      (chunk.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3}[-.\s]?\d{3,4}/g) || [])
        .filter(p => p.replace(/[-.\s()]/g, '').length >= 7)
    )];

    const companyMatch = chunk.match(/(?:at|@|working\s+at)\s+([\w\s&.]+(?:Inc|LLC|Ltd|Corp|Technologies|Tech|Group|Solutions|Consulting|Services))/i);
    const company = companyMatch ? companyMatch[1].trim() : '';

    const textBody = chunk.substring(0, 800).trim();

    posts.push({
      poster_name: posterName,
      company: company,
      time_posted: timePosted,
      text: textBody,
      emails: emails,
      phones: phones
    });
  }

  return posts;
}

async function main() {
  console.log('LinkedIn Posts Scraper');
  console.log('='.repeat(50));

  const hasSession = fs.existsSync(SESSION_FILE);
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled']
  });

  const ctxOpts = {
    viewport: { width: 1400, height: 900 },
    locale: 'en-US',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
  };
  if (hasSession) ctxOpts.storageState = SESSION_FILE;

  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();

  console.log('Navigating to search page...');
  await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await delay(5000);

  const currentUrl = page.url();
  if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint')) {
    console.log('Log in to LinkedIn in the browser, then press Enter:');
    await new Promise(resolve => process.stdin.once('data', () => resolve()));
    await delay(5000);
    await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await delay(5000);
    await context.storageState({ path: SESSION_FILE });
    console.log('Session saved.');
  }

  console.log('URL:', page.url());
  const initialText = await page.evaluate(() => document.body.innerText.substring(0, 300));
  console.log('Page preview:', initialText.substring(0, 200));
  console.log('Scraping posts...\n');

  const allPosts = [];
  const seenKeys = new Set();
  let staleRounds = 0;

  for (let round = 0; round < 200; round++) {
    const pageText = await page.evaluate(() => document.body.innerText);
    const newPosts = parsePostsFromText(pageText);

    let added = 0;
    for (const post of newPosts) {
      const key = post.poster_name + '|' + post.text.substring(0, 60);
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        allPosts.push(post);
        added++;
      }
    }

    if (added > 0) {
      staleRounds = 0;
    } else {
      staleRounds++;
      if (staleRounds >= 8) {
        console.log('No new posts for 8 rounds. Done.');
        break;
      }
    }

    const totalEmails = [...new Set(allPosts.flatMap(p => p.emails))];
    const totalPhones = [...new Set(allPosts.flatMap(p => p.phones))];
    console.log(`Round ${round + 1}: ${allPosts.length} posts (+${added} new) | ${totalEmails.length} emails | ${totalPhones.length} phones`);

    if (round % 5 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allPosts, null, 2));
    }

    for (let s = 0; s < 3; s++) {
      await page.evaluate(() => {
        const main = document.querySelector('main[class*="workspace"]') ||
          document.querySelector('main') ||
          document.querySelector('section.scaffold-layout__main') ||
          document.documentElement;
        main.scrollTop += 2000;
      });
      await delay(3000);
    }
  }

  await context.storageState({ path: SESSION_FILE });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allPosts, null, 2));

  const uniqueEmails = [...new Set(allPosts.flatMap(p => p.emails))];
  const uniquePhones = [...new Set(allPosts.flatMap(p => p.phones))];

  console.log('\n' + '='.repeat(50));
  console.log(`${allPosts.length} posts saved to ${OUTPUT_FILE}`);
  console.log(`Emails: ${uniqueEmails.length}`);
  console.log(`Phones: ${uniquePhones.length}`);
  uniqueEmails.forEach(e => console.log(`  ${e}`));
  uniquePhones.forEach(p => console.log(`  ${p}`));

  await browser.close();
}

main().catch(err => { console.error(err.message); process.exit(1); });
