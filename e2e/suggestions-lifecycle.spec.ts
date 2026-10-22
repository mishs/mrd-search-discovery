import { expect, test, type Page } from '@playwright/test';
import { HEALTHY } from './servers.js';

const searchBox = (page: Page) => page.getByRole('combobox', { name: 'Search' });
const listbox = (page: Page) => page.getByRole('listbox', { name: 'Suggestions' });
const status = (page: Page) => page.locator('#search-status');

/** Holds every suggestion response for `ms` from now on (the request is still sent). */
async function delaySuggestions(page: Page, ms: number) {
  await page.route('**/api/suggestions**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue().catch(() => undefined); // the page may have aborted it meanwhile
  });
}

async function openSuggestionsFor(page: Page, text: string) {
  await page.goto(HEALTHY);
  await expect(status(page)).toHaveText('36 results.');
  await searchBox(page).pressSequentially(text, { delay: 20 });
  await expect(listbox(page)).toBeVisible();
}

test.describe('suggestion lifecycle with slow responses', () => {
  test('after the query changes, Enter searches the typed text, not an old highlighted option', async ({ page }) => {
    await openSuggestionsFor(page, 'piz');
    await searchBox(page).press('ArrowDown');
    await expect(listbox(page).getByRole('option', { selected: true })).toHaveCount(1);

    await delaySuggestions(page, 1500);
    await searchBox(page).press('z'); // "pizz": the old options no longer belong to this text
    await expect(listbox(page)).toBeHidden();
    await expect(searchBox(page)).not.toHaveAttribute('aria-activedescendant');

    const search = page.waitForRequest((r) => r.url().includes('/api/search?'));
    await searchBox(page).press('Enter');
    expect(new URL((await search).url()).searchParams.get('q')).toBe('pizz');
    await expect(searchBox(page)).toHaveValue('pizz');
  });

  test('Escape during a pending request keeps the list closed when the answer arrives', async ({ page }) => {
    await page.goto(HEALTHY);
    await expect(status(page)).toHaveText('36 results.');
    await delaySuggestions(page, 800);

    const pending = page.waitForRequest((r) => r.url().includes('/api/suggestions?'));
    await searchBox(page).pressSequentially('piz', { delay: 20 });
    await pending;
    await searchBox(page).press('Escape');

    await page.waitForTimeout(1200); // well past the delayed answer
    await expect(listbox(page)).toBeHidden();
    await expect(searchBox(page)).toHaveValue('piz'); // Escape doesn't clear the text
  });

  test('after a category change, old suggestions cannot be reopened', async ({ page }) => {
    await openSuggestionsFor(page, 'piz');
    await searchBox(page).press('Escape');
    await expect(listbox(page)).toBeHidden();

    await page.getByLabel('Category').selectOption('sushi');
    await expect(page).toHaveURL(/category=sushi/);

    await searchBox(page).focus();
    await searchBox(page).press('ArrowDown');
    await expect(listbox(page)).toBeHidden(); // the pizza options belonged to "All categories"
  });
});
