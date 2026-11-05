import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { chromium, devices } from 'playwright';
import { startMockIntiface } from './mock-intiface.mjs';

// npm run screenshot captures everything; `social` or `docs` as an argument captures only that part.
const TARGET = process.argv[2];

const LANDSCAPE_VIEWPORT = { width: 412, height: 915 };
const SCREENSHOT_FULL_PAGE = false;
// Card title of test/fixtures/media/BigBuckBunny_320x180.mp4 (Jellyfin falls back to the file name).
const PLAYER_MEDIA = /big\s*buck\s*bunny/i;

// Screenshots end up in the public docs, so they come from a demo Jellyfin holding only
// test/fixtures/media, never from a personal library: by default the local dev Jellyfin
// (npm run dev:jellyfin, credentials in config/dev-jellyfin.env), which serves the client from
// public/. SCREENSHOT_JELLYFIN_* point at another demo Jellyfin with the HAPPY plugin instead;
// they are deliberately separate from the HAPPY_JELLYFIN_* variables of the integration tests.
function devJellyfin() {
    const file = 'config/dev-jellyfin.env';
    if (!existsSync(file)) return {};
    return Object.fromEntries(readFileSync(file, 'utf8').split('\n')
        .map((line) => line.match(/^([A-Z_]+)=(.*)$/))
        .filter(Boolean)
        .map(([, key, value]) => [key, value]));
}
const dev = devJellyfin();
const JELLYFIN_URL = (process.env.SCREENSHOT_JELLYFIN_URL || dev.HAPPY_JELLYFIN_URL || '').replace(/\/+$/, '');
const JELLYFIN_USER = process.env.SCREENSHOT_JELLYFIN_USER || dev.HAPPY_JELLYFIN_USER;
const JELLYFIN_PASSWORD = process.env.SCREENSHOT_JELLYFIN_PASSWORD || dev.HAPPY_JELLYFIN_PASSWORD || '';
if (!JELLYFIN_URL || !JELLYFIN_USER) {
    console.error('Start the local dev Jellyfin first (npm run dev:jellyfin), or set SCREENSHOT_JELLYFIN_URL and '
        + 'SCREENSHOT_JELLYFIN_USER (and SCREENSHOT_JELLYFIN_PASSWORD) to a demo Jellyfin that serves test/fixtures/media '
        + 'with the HAPPY plugin installed.');
    process.exit(1);
}
const APP_URL = `${JELLYFIN_URL}/Happy/Web/`;

// docs/social.png: four phone screens side by side, with transparent gaps between them.
const SOCIAL_PATH = 'docs/social.png';
const SOCIAL_SIZE = { width: 1280, height: 640 };
const SOCIAL_VIEWPORT = { width: 412, height: 924 };
const SOCIAL_THEME = 'oled';
// The theme's first font, bundled so that the preview looks the same on every machine.
const SOCIAL_FONT_WEIGHTS = [400, 500, 600, 700];
const SOCIAL_VIDEO_TITLE = /^Big Buck Bunny$/;
// Still 1:31 on the clock, but just past the cut to the wide shot of the bunny with the apple.
const SOCIAL_SEEK_SECONDS = 91.9;
// What the settings panel shows. Both addresses are for display: the browser resolves the Intiface
// one to the mock (see launchSocialBrowser) and the DG-Lab relay stays disabled.
const SOCIAL_INTIFACE_ADDRESS = '192.168.1.200:12345';
const SOCIAL_DGLAB_RELAY = 'ws://192.168.1.100:3000';
const SOCIAL_ASSIGNMENTS = ['Vibrator', 'Buttplug', 'Stroker'];

async function capture(page, path) {
    // avoid focus/hover/selection styling leaking into the screenshot
    await page.evaluate(() => {
        document.activeElement?.blur?.();
        window.getSelection?.()?.removeAllRanges();
    });
    await page.mouse.move(0, 0);
    return page.screenshot({ path, fullPage: SCREENSHOT_FULL_PAGE });
}

function socialThemeCss() {
    const fonts = SOCIAL_FONT_WEIGHTS.map((weight) => {
        const file = readFileSync(`node_modules/@fontsource/noto-sans/files/noto-sans-latin-${weight}-normal.woff2`);
        return `@font-face { font-family: "Noto Sans"; font-weight: ${weight}; src: url(data:font/woff2;base64,${file.toString('base64')}); }`;
    });
    return [...fonts, readFileSync(`public/css/themes/${SOCIAL_THEME}.css`, 'utf8')].join('\n');
}

/** Applies the preview's look to this browser only; the Jellyfin's plugin settings stay as they are. */
async function useSocialSettings(page) {
    const themeCss = socialThemeCss();
    await page.route('**/theme.css', (route) => route.fulfill({ contentType: 'text/css', body: themeCss }));
    await page.route('**/Happy/Config', async (route) => {
        const response = await route.fetch();
        await route.fulfill({
            response,
            json: {
                ...await response.json(),
                theme: SOCIAL_THEME,
                dglabEnabled: true,
                dglabSandboxEnabled: true,
                dglabRelayUrl: SOCIAL_DGLAB_RELAY,
                funscriptColorGradient: true,
                blurContent: false,
            },
        });
    });
}

async function signIn(page) {
    await page.goto(APP_URL, {
        waitUntil: 'networkidle',
    });

    await page.locator('#jellyfin-user').fill(JELLYFIN_USER);
    await page.locator('#jellyfin-password').fill(JELLYFIN_PASSWORD);
    await page.locator('#jellyfin-sign-in-submit').click();
    await page.locator('#jellyfin-sign-in').waitFor({ state: 'detached' });
    await page.waitForLoadState('networkidle');
}

/** The panel shows a LAN address like a real setup does; this browser reaches the mock behind it. */
function launchSocialBrowser(mockPort) {
    return chromium.launch({ args: [`--host-resolver-rules=MAP ${SOCIAL_INTIFACE_ADDRESS} 127.0.0.1:${mockPort}`] });
}

async function run(command, args, options = {}) {
    const child = spawn(command, args, {
        stdio: 'inherit',
        shell: false,
        ...options,
    });

    const [code] = await once(child, 'exit');

    if (code !== 0) {
        throw new Error(`${command} ${args.join(' ')} failed with exit code ${code}`);
    }
}

async function applyMediaFilter(page, filterName) {
    const filterTypes = {
        audio: 'tracks',
        track: 'tracks',
        tracks: 'tracks',
        video: 'videos',
        videos: 'videos',
    };

    const filterType = filterTypes[filterName.toLowerCase()] ?? filterName;
    const input = page.locator(`input[data-filter-type="${filterType}"]`).first();

    if (!(await input.count())) {
        throw new Error(`Could not find "${filterName}" media filter`);
    }

    const isChecked = await input.isChecked();

    if (isChecked) {
        return;
    }

    // set directly instead of clicking so no hover/focus styling remains for screenshots
    await input.evaluate((element) => {
        element.checked = true;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

async function clickPlayerMedia(page) {
    // Library ids are Jellyfin item ids, so the card is found by its title.
    const card = page.locator('#track-grid .track-card', { has: page.locator('.card-title', { hasText: PLAYER_MEDIA }) });
    const link = card.locator('a.track-art-link[href*="view=player"]').first();

    if (!(await link.count())) {
        throw new Error(`Could not find ${PLAYER_MEDIA} in the library`);
    }

    await link.click();
}

async function waitForJavaScriptToSettle(page) {
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => document.readyState === 'complete');
    await page.evaluate(async () => {
        await document.fonts?.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await new Promise((resolve) => {
            if ('requestIdleCallback' in window) {
                requestIdleCallback(resolve, { timeout: 1000 });
            } else {
                setTimeout(resolve, 0);
            }
        });
    });
}

async function setFavorite(button, favorite) {
    if ((await button.getAttribute('aria-pressed')) !== String(favorite)) await button.click();
}

/** The player, paused at SOCIAL_SEEK_SECONDS with the storyboard preview of that position open. */
async function openSocialPlayer(page) {
    await clickPlayerMedia(page);
    await page.locator('#player-view:not(.d-none)').waitFor();
    await waitForJavaScriptToSettle(page);

    // Only playing makes a slot active, and the haptic timelines follow the active slot.
    const player = page.locator('#player-view video-player:visible').first();
    await player.locator('media-play-button').first().evaluate((button) => button.click());
    const video = player.locator('video').first();
    await video.evaluate(async (element, seconds) => {
        await new Promise((resolve) => {
            if (!element.paused) resolve();
            else element.addEventListener('playing', resolve, { once: true });
        });
        element.pause();
        element.currentTime = seconds;
        await new Promise((resolve) => element.addEventListener('seeked', resolve, { once: true }));
    }, SOCIAL_SEEK_SECONDS);
    await page.locator('#viz-toggle').click();
    await waitForJavaScriptToSettle(page);

    const slider = player.locator('media-time-slider').first();
    const duration = await video.evaluate((element) => element.duration);
    const box = await slider.boundingBox();
    await page.mouse.move(box.x + box.width * (SOCIAL_SEEK_SECONDS / duration), box.y + box.height / 2);
    await page.waitForTimeout(1000);
}

/** Connects to the mock from the settings panel and assigns its features through their dropdowns. */
async function openSocialSettings(page) {
    await page.mouse.move(0, 0);
    await page.locator('#btn-settings').click();
    await page.locator('#settings-panel.show').waitFor();

    await page.locator('#intiface-address').fill(SOCIAL_INTIFACE_ADDRESS);
    await page.locator('#intiface-address').blur();
    await page.locator('#btn-connect').click();
    await page.locator('#intiface-status', { hasText: 'Connected' }).waitFor();
    await page.locator('#intiface-devices [data-feature-select]').nth(SOCIAL_ASSIGNMENTS.length - 1).waitFor();

    for (const [index, label] of SOCIAL_ASSIGNMENTS.entries()) {
        // Each assignment redraws the device list, so the dropdowns are looked up again.
        await page.locator('#intiface-devices [data-feature-select]').nth(index).selectOption({ label });
    }
    await page.evaluate(() => {
        document.activeElement?.blur?.();
        document.querySelector('#settings-panel .offcanvas-body').scrollTop = 0;
    });
    await page.mouse.move(0, 0);
    await waitForJavaScriptToSettle(page);
}

/** Lays the screens out next to each other, in the browser so the gaps can stay transparent. */
async function composeSocial(browser, screens) {
    const page = await browser.newPage({ viewport: SOCIAL_SIZE });
    const images = screens.map((screen) => `<img src="data:image/png;base64,${screen.toString('base64')}">`);
    await page.setContent(`
        <style>
            html, body { margin: 0; background: transparent; }
            body { display: flex; justify-content: space-between; height: 100vh; }
            img { height: 100%; }
        </style>
        ${images.join('')}`);
    await page.evaluate(() => Promise.all([...document.images].map((image) => image.decode())));
    await page.screenshot({ path: SOCIAL_PATH, omitBackground: true });
    await page.close();
}

async function captureSocial() {
    const mock = await startMockIntiface(0);
    const browser = await launchSocialBrowser(mock.address().port);
    try {
        const context = await browser.newContext({
            ...devices['Pixel 9'],
            viewport: SOCIAL_VIEWPORT,
            screen: SOCIAL_VIEWPORT,
            reducedMotion: 'reduce',
        });
        const page = await context.newPage();
        await useSocialSettings(page);
        await signIn(page);
        await page.evaluate(() => document.fonts.load('400 16px "Noto Sans"'));

        await page.locator('#btn-view-list').click();
        await page.locator('#track-list:not(.d-none)').waitFor();
        const row = page.locator('#track-list tr', { has: page.getByText(SOCIAL_VIDEO_TITLE) })
            .filter({ has: page.locator('button[data-favorite-id]') }).first();
        const favorite = row.locator('button[data-favorite-id]');
        const wasFavorite = (await favorite.getAttribute('aria-pressed')) === 'true';
        await setFavorite(favorite, true);

        try {
            await page.locator('#btn-view-grid').click();
            await waitForJavaScriptToSettle(page);
            const grid = await capture(page);

            await page.locator('#btn-view-list').click();
            await waitForJavaScriptToSettle(page);
            const list = await capture(page);

            await page.locator('#btn-view-grid').click();
            await waitForJavaScriptToSettle(page);
            await openSocialPlayer(page);
            const player = await page.screenshot();

            await openSocialSettings(page);
            const settings = await page.screenshot();

            await composeSocial(browser, [grid, list, player, settings]);
        } finally {
            await page.goto(`${APP_URL}?view=library`);
            await page.locator('#btn-view-list').click();
            await setFavorite(favorite, wasFavorite);
            await page.waitForLoadState('networkidle');
        }
    } finally {
        await browser.close();
        mock.close();
    }
}

async function captureDocs(browser) {
    const context = await browser.newContext({
        ...devices['Pixel 9'],
        viewport: LANDSCAPE_VIEWPORT,
        screen: LANDSCAPE_VIEWPORT,
        isMobile: true,
        reducedMotion: 'reduce',
    });

    const page = await context.newPage();

    await signIn(page);

    await applyMediaFilter(page, 'audio');
    await applyMediaFilter(page, 'video');

    await waitForJavaScriptToSettle(page);

    await capture(page, 'docs/screenshots/library.jpg');

    await page.setViewportSize({
        width: LANDSCAPE_VIEWPORT.height,
        height: LANDSCAPE_VIEWPORT.width,
    });
    await waitForJavaScriptToSettle(page);

    await capture(page, 'docs/screenshots/library-landscape.jpg');

    await page.setViewportSize(LANDSCAPE_VIEWPORT);
    await waitForJavaScriptToSettle(page);

    await capture(page, 'docs/screenshots/library-portrait.jpg');

    await page.locator('#btn-view-list').click();
    await page.locator('#track-list:not(.d-none)').waitFor();
    await waitForJavaScriptToSettle(page);

    await capture(page, 'docs/screenshots/library-tabular.jpg');

    await page.locator('#btn-view-grid').click();
    await waitForJavaScriptToSettle(page);

    await clickPlayerMedia(page);
    await page.locator('#player-view:not(.d-none)').waitFor();
    // await page.locator('#viz-toggle').click();
    await waitForJavaScriptToSettle(page);

    await capture(page, 'docs/screenshots/player.jpg');

    await context.close();
}

try {
    // The dev Jellyfin serves public/ straight from disk, so a fresh build is what gets captured.
    await run('npm', ['run', 'build:client']);
    await run('npm', ['run', 'build:vendor']);

    if (TARGET !== 'social') {
        const browser = await chromium.launch();
        await captureDocs(browser).finally(() => browser.close());
    }
    if (TARGET !== 'docs') {
        await captureSocial();
    }
} catch (err) {
    console.error(err);
    process.exitCode = 1;
}
