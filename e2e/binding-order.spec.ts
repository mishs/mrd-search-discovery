/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test';
import { HEALTHY } from './servers.js';

/**
 * Evidence for Svelte binding/event ordering: SearchInput reads the bound value in
 * `oninput`, and SearchForm reads bound select values in `onchange`. If a handler ran
 * before its binding updated, the request would carry the previous value.
 */
const apiRequests = (page: Page) => {
  const seen: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/search') || url.pathname.startsWith('/api/suggestions')) {
      seen.push(`${url.pathname}${url.search}`);
    }
  });
  return seen;
};

const searchBox = (page: Page) => page.getByRole('combobox', { name: 'Search' });
const status = (page: Page) => page.locator('#search-status');

test('requests carry the value just typed, pasted, cleared or selected', async ({ page }) => {
  await page.goto(HEALTHY);
  await expect(status(page)).toHaveText('36 results.');
  const seen = apiRequests(page);

  // Two characters typed: exactly one suggestion request, for both characters.
  await searchBox(page).pressSequentially('pi', { delay: 20 });
  await expect.poll(() => seen.filter((r) => r.startsWith('/api/suggestions'))).toEqual(['/api/suggestions?q=pi']);

  // Paste: one input event carrying the whole pasted text.
  await searchBox(page).fill('');
  seen.length = 0;
  await searchBox(page).focus();
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('#search-q');
    if (!input) throw new Error('missing input');
    input.value = 'sushi';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: 'sushi' }));
  });
  await expect.poll(() => seen).toEqual(['/api/suggestions?q=sushi']);

  // Clear: below the minimum length, so no request at all.
  seen.length = 0;
  await searchBox(page).fill('');
  await page.waitForTimeout(400);
  expect(seen).toEqual([]);

  // Category change: the search uses the newly selected category.
  await page.getByLabel('Category').selectOption('pizza');
  await expect.poll(() => seen).toEqual(['/api/search?category=pizza&sort=popularity']);
  await expect(status(page)).toHaveText(/results?\./);

  // Sort change: the search uses the new sort and keeps the category.
  seen.length = 0;
  await page.getByLabel('Sort by').selectOption('name');
  await expect.poll(() => seen).toEqual(['/api/search?category=pizza&sort=name']);
});
