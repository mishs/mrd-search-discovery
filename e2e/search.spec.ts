import { expect, test, type Page } from '@playwright/test';
import { FAILING, HEALTHY, SLOW } from './servers.js';

const status = (page: Page) => page.locator('#search-status');
const searchBox = (page: Page) => page.getByRole('combobox', { name: 'Search' });
const cards = (page: Page) => page.locator('main article');

test.describe('healthy provider', () => {
  test('browse, search and filter, with live prices', async ({ page }) => {
    await page.goto(HEALTHY);
    await expect(status(page)).toHaveText('36 results.');
    await expect(cards(page).first().locator('.price')).toHaveText(/^R\s?\d+[.,]\d{2}$/);

    await searchBox(page).fill('chocolate');
    await searchBox(page).press('Enter');
    await expect(status(page)).toHaveText('2 results.');
    await expect(cards(page).locator('h3')).toHaveText(['Chocolate Brownie', 'Vegan Chocolate Mousse']);

    await page.getByLabel('Category').selectOption('pizza');
    await expect(status(page)).toHaveText('No results.');
    await expect(page).toHaveURL(/\?q=chocolate&category=pizza$/);
  });

  test('a link restores the search; Back and Forward move between searches', async ({ page }) => {
    await page.goto(`${HEALTHY}/?q=sushi&category=bogus&sort=name`);
    await expect(status(page)).toHaveText('6 results.');
    await expect(page).toHaveURL(`${HEALTHY}/?q=sushi&sort=name`); // invalid category dropped
    await expect(page.getByLabel('Sort by')).toHaveValue('name');

    await searchBox(page).fill('pizza');
    await searchBox(page).press('Enter');
    await expect(page).toHaveURL(/q=pizza/);

    await page.goBack();
    await expect(searchBox(page)).toHaveValue('sushi');
    await expect(cards(page).first().locator('.meta')).toContainText('Sushi');

    await page.goForward();
    await expect(searchBox(page)).toHaveValue('pizza');
  });

  test('typeahead: pick a suggestion with the keyboard', async ({ page }) => {
    await page.goto(HEALTHY);
    await expect(status(page)).toHaveText('36 results.');

    await searchBox(page).pressSequentially('piz', { delay: 30 });
    const listbox = page.getByRole('listbox', { name: 'Suggestions' });
    await expect(listbox).toBeVisible();
    await expect(searchBox(page)).toHaveAttribute('aria-expanded', 'true');

    await searchBox(page).press('ArrowDown');
    await searchBox(page).press('ArrowDown');
    await expect(listbox.getByRole('option', { selected: true })).toHaveText('Pepperoni Pizza');
    await searchBox(page).press('Enter');

    await expect(searchBox(page)).toHaveValue('Pepperoni Pizza');
    await expect(listbox).toBeHidden();
    await expect(status(page)).toHaveText('1 result.');
  });

  test('mobile: no horizontal scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(HEALTHY);
    await expect(status(page)).toHaveText('36 results.');
    expect(await page.evaluate<number>('document.documentElement.scrollWidth')).toBeLessThanOrEqual(375);
  });
});

test('failing provider: results stay, live details are unknown, never R0', async ({ page }) => {
  await page.goto(FAILING);
  await expect(status(page)).toHaveText('36 results. Live prices are unavailable right now.');
  await expect(page.getByText('Live prices and delivery times are unavailable.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry live prices' })).toBeVisible();
  await expect(cards(page)).toHaveCount(36);
  await expect(page.locator('.price')).toHaveCount(0);
  await expect(page.getByText('Currently unavailable')).toHaveCount(0);
});

test('slow provider: rapid filter changes, the last one wins', async ({ page }) => {
  await page.goto(SLOW);
  await expect(status(page)).toHaveText('36 results.');

  for (const category of ['burgers', 'pizza', 'desserts', 'sushi']) {
    await page.getByLabel('Category').selectOption(category);
  }
  await expect(status(page)).toHaveText('6 results.');
  // Give any older responses time to arrive; they must not replace the result.
  await page.waitForTimeout(1200);
  await expect(page.locator('.summary')).toContainText('in Sushi');
  for (const meta of await cards(page).locator('.meta').allTextContents()) {
    expect(meta).toMatch(/^Sushi/);
  }
});
