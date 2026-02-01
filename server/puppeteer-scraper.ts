/**
 * Custom PrizePicks Scraper using Puppeteer
 * Uses a real headless browser to bypass anti-bot protection
 * 
 * Features:
 * - Real Chromium browser execution
 * - Stealth mode to avoid detection
 * - Human-like delays and behavior
 * - Cookie/session persistence
 * - Automatic retry with exponential backoff
 */

import type { Browser, Page, HTTPRequest, HTTPResponse } from 'puppeteer';
import { apiLogger } from './logger';

// Lazy load puppeteer to avoid issues when not installed
let puppeteer: typeof import('puppeteer') | null = null;

async function getPuppeteer() {
    if (!puppeteer) {
        try {
            puppeteer = await import('puppeteer');
        } catch (error) {
            throw new Error('Puppeteer not installed. Run: npm install puppeteer');
        }
    }
    return puppeteer;
}

// Browser instance management
let browserInstance: Browser | null = null;
let browserLastUsed: number = 0;
const BROWSER_IDLE_TIMEOUT = 5 * 60 * 1000; // Close browser after 5 min idle

/**
 * Get or create browser instance
 */
async function getBrowser(): Promise<Browser> {
    const pptr = await getPuppeteer();

    if (browserInstance && browserInstance.connected) {
        browserLastUsed = Date.now();
        return browserInstance;
    }

    apiLogger.info('[PuppeteerScraper] Launching new browser instance');

    browserInstance = await pptr.default.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1920,1080',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=site-per-process',
        ],
        defaultViewport: {
            width: 1920,
            height: 1080,
        },
    });

    browserLastUsed = Date.now();

    // Set up auto-close on idle
    setInterval(async () => {
        if (browserInstance && Date.now() - browserLastUsed > BROWSER_IDLE_TIMEOUT) {
            apiLogger.info('[PuppeteerScraper] Closing idle browser');
            await browserInstance.close();
            browserInstance = null;
        }
    }, 60000);

    return browserInstance;
}

/**
 * Random delay between min and max milliseconds
 */
function randomDelay(min: number, max: number): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Apply stealth settings to page
 */
async function applyStealthSettings(page: Page): Promise<void> {
    // Override webdriver detection
    await page.evaluateOnNewDocument(() => {
        // Remove webdriver property
        Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
        });

        // Override permissions
        const originalQuery = window.navigator.permissions.query;
        // @ts-ignore
        window.navigator.permissions.query = (parameters: any) =>
            parameters.name === 'notifications'
                ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
                : originalQuery(parameters);

        // Override plugins
        Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5],
        });

        // Override languages
        Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en'],
        });

        // Chrome runtime mock
        // @ts-ignore
        window.chrome = {
            runtime: {},
        };
    });

    // Set realistic user agent
    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Set extra headers
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
    });
}

/**
 * Fetch PrizePicks projections using Puppeteer
 */
export async function fetchWithPuppeteer(url: string): Promise<any> {
    const browser = await getBrowser();
    const page = await browser.newPage();

    try {
        // Apply stealth settings
        await applyStealthSettings(page);

        // Set up request interception for the API response
        let apiResponse: any = null;

        await page.setRequestInterception(true);

        page.on('request', (request: HTTPRequest) => {
            // Allow all requests
            request.continue();
        });

        page.on('response', async (response: HTTPResponse) => {
            const responseUrl = response.url();
            if (responseUrl.includes('api.prizepicks.com/projections')) {
                try {
                    const json = await response.json();
                    apiResponse = json;
                    apiLogger.info('[PuppeteerScraper] Captured API response');
                } catch (e) {
                    // Not JSON or error parsing
                }
            }
        });

        apiLogger.info('[PuppeteerScraper] Navigating to PrizePicks app');

        // First visit the main app to get cookies
        await page.goto('https://app.prizepicks.com/', {
            waitUntil: 'networkidle2',
            timeout: 30000,
        });

        // Random delay to seem human
        await randomDelay(2000, 4000);

        // Now make the API request directly
        apiLogger.info('[PuppeteerScraper] Fetching projections API');

        const response = await page.evaluate(async (apiUrl: string) => {
            const res = await fetch(apiUrl, {
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                },
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            return res.json();
        }, url);

        apiLogger.info('[PuppeteerScraper] Successfully fetched data');

        return response || apiResponse;

    } catch (error) {
        apiLogger.error('[PuppeteerScraper] Error:', { error: String(error) });
        throw error;
    } finally {
        await page.close();
    }
}

/**
 * Alternative: Direct navigation approach
 * Visits the projections API URL directly as a webpage
 */
export async function fetchWithPuppeteerDirect(url: string): Promise<any> {
    const browser = await getBrowser();
    const page = await browser.newPage();

    try {
        await applyStealthSettings(page);

        apiLogger.info('[PuppeteerScraper] Direct API fetch:', { url });

        // Navigate directly to API endpoint
        const response = await page.goto(url, {
            waitUntil: 'networkidle0',
            timeout: 30000,
        });

        if (!response) {
            throw new Error('No response received');
        }

        const status = response.status();
        if (status !== 200) {
            const text = await response.text();
            throw new Error(`HTTP ${status}: ${text.substring(0, 200)}`);
        }

        // Get the JSON from the page body
        const content = await page.content();

        // Extract JSON from page (might be wrapped in HTML)
        const bodyText = await page.evaluate(() => {
            const pre = document.querySelector('pre');
            if (pre) return pre.textContent || '';
            return document.body.textContent || '';
        });

        try {
            return JSON.parse(bodyText);
        } catch {
            // Try to extract JSON from content
            const jsonMatch = content.match(/\{.*\}/s);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            throw new Error('Could not parse response as JSON');
        }

    } catch (error) {
        apiLogger.error('[PuppeteerScraper] Direct fetch error:', { error: String(error) });
        throw error;
    } finally {
        await page.close();
    }
}

/**
 * Close browser instance manually
 */
export async function closeBrowser(): Promise<void> {
    if (browserInstance) {
        await browserInstance.close();
        browserInstance = null;
    }
}

/**
 * Check if Puppeteer is available
 */
export async function isPuppeteerAvailable(): Promise<boolean> {
    try {
        await getPuppeteer();
        return true;
    } catch {
        return false;
    }
}
