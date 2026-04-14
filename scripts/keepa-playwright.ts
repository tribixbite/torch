/**
 * Standalone Playwright script to extract Keepa price history from Amazon pages.
 * Launches Chromium with the Keepa extension loaded, navigates to Amazon product
 * pages, and extracts the price data injected by the extension.
 *
 * Usage: bun scripts/keepa-playwright.ts [ASIN...]
 * Default test ASINs used if none provided.
 */
// Use global install path since playwright-core isn't a project dependency
import { chromium } from '/data/data/com.termux/files/home/.bun/install/global/node_modules/playwright-core';
import { resolve } from 'path';

const KEEPA_EXT = resolve(process.env.HOME!, '.keepa-extension/unpacked');
const USER_DATA = resolve(process.env.HOME!, '.cache/keepa-playwright-profile');
const TEST_ASINS = ['B0DGSKPL8F', 'B08JCM95X6'];
const SCREENSHOT_DIR = resolve(process.env.HOME!, 'git/torch/output');

async function main() {
  const asins = process.argv.slice(2);
  const targets = asins.length > 0 ? asins : TEST_ASINS;

  console.log(`Launching Chromium with Keepa extension from ${KEEPA_EXT}`);

  const context = await chromium.launchPersistentContext(USER_DATA, {
    executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-notifications',
      `--disable-extensions-except=${KEEPA_EXT}`,
      `--load-extension=${KEEPA_EXT}`,
    ],
    ignoreDefaultArgs: ['--disable-extensions'],
    viewport: { width: 1280, height: 720 },
    // Realistic user agent to avoid bot detection
    userAgent: 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  console.log('Browser launched, waiting for Keepa service worker...');

  // Wait for the Keepa extension service worker
  let sw = context.serviceWorkers()[0];
  if (!sw) {
    try {
      sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
      console.log(`Service worker registered: ${sw.url()}`);
    } catch {
      console.warn('No service worker detected after 15s — extension may not have loaded');
    }
  } else {
    console.log(`Service worker already active: ${sw.url()}`);
  }

  const results: Record<string, unknown> = {};

  // Use the default page instead of creating new ones
  const page = context.pages()[0] || await context.newPage();

  for (const asin of targets) {
    const url = `https://www.amazon.com/dp/${asin}`;
    console.log(`\n--- ${asin} ---`);
    console.log(`Navigating to ${url}`);

    try {
      await page.goto(url, { waitUntil: 'load', timeout: 45000 });
      const title = await page.title();
      console.log(`Page loaded: ${title}`);

      // Screenshot before any scrolling (works with --disable-gpu)
      try {
        const ssPath = resolve(SCREENSHOT_DIR, `keepa-ext-${asin}.png`);
        await page.screenshot({ path: ssPath, fullPage: false });
        console.log(`Screenshot saved: ${ssPath}`);
      } catch { console.log('Screenshot failed, continuing...'); }

      // Check if we hit a CAPTCHA
      const bodyText = await page.evaluate(() => document.body.innerText?.slice(0, 500));
      if (bodyText?.includes('captcha') || bodyText?.includes('robot') || bodyText?.includes('automated')) {
        console.log('CAPTCHA detected! Page text:', bodyText.slice(0, 200));
        results[asin] = { error: 'CAPTCHA', bodyText: bodyText.slice(0, 300) };
        continue;
      }

      // Wait for Keepa to inject its content
      console.log('Waiting for Keepa injection (up to 30s)...');
      try {
        await page.waitForSelector('[id*="keepa"], [class*="keepa"], [id*="keepaBox"]', {
          timeout: 30000,
        });
        console.log('Keepa element detected!');
      } catch {
        console.log('No Keepa element found after 30s');
      }

      // Extra wait for Keepa to fully render
      await page.waitForTimeout(3000);

      // Scroll Keepa chart into view
      await page.evaluate(() => {
        const kc = document.getElementById('keepaContainer');
        if (kc) kc.scrollIntoView({ behavior: 'instant', block: 'center' });
      });
      await page.waitForTimeout(2000);

      // Access the Keepa iframe content
      const keepaFrame = page.frame({ url: /keepa\.com/ });
      if (keepaFrame) {
        console.log('Accessing Keepa iframe...');
        try {
          // Wait for iframe content to load
          await keepaFrame.waitForLoadState('load', { timeout: 10000 });
          const iframeData = await keepaFrame.evaluate(() => {
            return {
              url: window.location.href,
              bodyText: document.body?.innerText?.slice(0, 2000) ?? '',
              bodyHTML: document.body?.innerHTML?.slice(0, 3000) ?? '',
              elementCount: document.querySelectorAll('*').length,
              canvases: document.querySelectorAll('canvas').length,
              // Look for Keepa's price data in DOM or JS vars
              scripts: Array.from(document.querySelectorAll('script')).map(s => s.textContent?.slice(0, 200)).filter(Boolean),
            };
          });
          console.log(`Keepa iframe elements: ${iframeData.elementCount}, canvases: ${iframeData.canvases}`);
          console.log(`Keepa iframe text: ${iframeData.bodyText.slice(0, 300)}`);
          (results as any)[`${asin}_keepaFrame`] = iframeData;
        } catch (err) {
          console.log(`Could not access Keepa iframe: ${(err as Error).message}`);
        }
      } else {
        console.log('Keepa iframe not accessible as a frame');
      }

      // Extract everything
      const data = await page.evaluate(() => {
        // Keepa-related elements
        const keepaEls = document.querySelectorAll('[id*="keepa"], [class*="keepa"], [id*="keepaBox"]');
        const keepaInfo: Record<string, unknown>[] = [];
        keepaEls.forEach((el) => {
          const he = el as HTMLElement;
          keepaInfo.push({
            tag: he.tagName,
            id: he.id,
            class: he.className,
            text: he.innerText?.slice(0, 500),
            childCount: he.children.length,
            dimensions: `${he.offsetWidth}x${he.offsetHeight}`,
          });
        });

        // Amazon price
        const priceEl = document.querySelector('.a-price .a-offscreen');
        const titleEl = document.querySelector('#productTitle');

        // All canvas elements (Keepa charts are canvas-based)
        const canvases = document.querySelectorAll('canvas');
        const canvasInfo = Array.from(canvases).map((c) => ({
          id: c.id,
          width: c.width,
          height: c.height,
          parent: c.parentElement?.id || c.parentElement?.className,
        }));

        // All iframes
        const iframes = document.querySelectorAll('iframe');
        const iframeInfo = Array.from(iframes).map((f) => ({
          src: f.src?.slice(0, 200),
          id: f.id,
        }));

        return {
          title: titleEl?.textContent?.trim() ?? null,
          price: priceEl?.textContent?.trim() ?? null,
          keepaElementCount: keepaEls.length,
          keepaElements: keepaInfo,
          canvases: canvasInfo,
          iframes: iframeInfo,
          // Check page text for any price history text Keepa might add
          bodySnippet: document.body.innerText?.slice(0, 1000),
        };
      });

      console.log(`Title: ${data.title?.slice(0, 80)}`);
      console.log(`Price: ${data.price}`);
      console.log(`Keepa elements: ${data.keepaElementCount}`);
      console.log(`Canvases: ${data.canvases.length}`);
      console.log(`Iframes: ${data.iframes.length}`);

      if (data.keepaElements.length > 0) {
        for (const el of data.keepaElements) {
          console.log(`  Keepa: <${el.tag} id="${el.id}" class="${(el.class as string)?.slice(0, 60)}"> ${el.dimensions}`);
          if ((el.text as string)?.length > 0) {
            console.log(`    Text: ${(el.text as string).slice(0, 200)}`);
          }
        }
      }

      results[asin] = data;

      // Screenshot can fail after scroll with --disable-gpu, skip it

    } catch (err) {
      console.error(`Failed for ${asin}:`, (err as Error).message);
      results[asin] = { error: (err as Error).message };
    }
  }

  // Keep browser open for manual interaction (e.g. solving Cloudflare challenge)
  console.log('\n--- Browser left open. Press Ctrl+C to close. ---');
  console.log('Solve the anti-bot check in the Keepa iframe, then re-run extraction.');

  // Poll every 10s to check if Keepa loaded after manual interaction
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(10000);
    const keepaFrame = page.frame({ url: /keepa\.com/ });
    if (keepaFrame) {
      try {
        const text = await keepaFrame.evaluate(() => document.body?.innerText?.slice(0, 200) ?? '');
        if (text && !text.includes('Anti-bot') && text.length > 20) {
          console.log(`\n[${i * 10}s] Keepa loaded! Text: ${text.slice(0, 200)}`);
          const iframeData = await keepaFrame.evaluate(() => ({
            bodyText: document.body?.innerText ?? '',
            bodyHTML: document.body?.innerHTML?.slice(0, 5000) ?? '',
            canvases: document.querySelectorAll('canvas').length,
            elements: document.querySelectorAll('*').length,
          }));
          results[`keepaFrame`] = iframeData;
          console.log(`Canvases: ${iframeData.canvases}, Elements: ${iframeData.elements}`);
          console.log(`Full text: ${iframeData.bodyText.slice(0, 500)}`);
          break;
        } else {
          console.log(`[${i * 10}s] Still anti-bot: "${text.slice(0, 50)}"`);
        }
      } catch (err) {
        console.log(`[${i * 10}s] Frame check error: ${(err as Error).message.slice(0, 80)}`);
      }
    }
  }

  console.log('\n=== Results ===');
  console.log(JSON.stringify(results, null, 2));

  const outPath = resolve(SCREENSHOT_DIR, 'keepa-extension-test.json');
  await Bun.write(outPath, JSON.stringify(results, null, 2));
  console.log(`\nSaved to ${outPath}`);

  // Don't close — leave browser open
  // await context.close();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
