import { test, expect, EVENTS } from './fixtures';

test.describe('Admin application visibility and manual assessment', () => {
  test('Draft applications stay private from Admin queues and direct reads', async ({ page, api, loginAs }) => {
    await loginAs('admin');
    await page.goto('/admin/applications');
    await expect(page.getByRole('heading', { name: /application queue/i })).toBeVisible();
    await expect(page.getByText('STERAS Test · Perlis conference application 1')).toHaveCount(0);
    await expect(api.getDoc('events/steras-test-perlis-01')).rejects.toThrow();

    await page.goto('/admin/applications/steras-test-perlis-01');
    await expect(page.getByText('Application could not be loaded.')).toBeVisible();
  });

  test('manual queue is list-only and a valid assessment finalizes from the detail page', async ({ page, api, loginAs }) => {
    await loginAs('admin');
    await page.goto('/admin');

    const queueItem = page.getByTestId(`manual-review-${EVENTS.provisionalReview}`);
    await expect(queueItem).toBeVisible({ timeout: 30_000 });
    await expect(queueItem).toContainText('Organizer 1');
    await expect(queueItem).toContainText('insufficient data');
    await expect(page.getByTestId('manual-assessment-form')).toHaveCount(0);
    await queueItem.click();

    await expect(page).toHaveURL(new RegExp(`/admin/applications/${EVENTS.provisionalReview}\\?focus=manual-assessment`));
    const form = page.getByTestId('manual-assessment-form');
    await expect(form).toBeVisible();
    await form.getByPlaceholder('Hazard name').fill('Crowd congestion');
    await form.getByPlaceholder(/Hazard rationale/).fill('Crowd congestion requires documented controls.');

    const evidenceGroups = form.locator('fieldset');
    for (let index = 0; index < await evidenceGroups.count(); index += 1) {
      await evidenceGroups.nth(index).locator('input[type="checkbox"]').first().check();
    }
    const categoryRationales = form.getByPlaceholder('Category rationale');
    for (let index = 0; index < await categoryRationales.count(); index += 1) {
      await categoryRationales.nth(index).fill('The submitted evidence supports this official category score.');
    }
    await form.getByLabel('Overall assessment rationale').fill('The complete submitted evidence supports this locked Admin assessment.');
    await form.getByRole('button', { name: 'Submit locked manual assessment' }).click();
    await expect(page.getByText('Manual assessment finalized as the official assessment.')).toBeVisible({ timeout: 30_000 });

    await expect.poll(async () => {
      const event = await api.getDoc<{ currentAssessmentId?: string; currentResourceId?: string }>(`events/${EVENTS.provisionalReview}`);
      if (!event?.currentAssessmentId || !event.currentResourceId) return null;
      const assessment = await api.getDoc<{ status?: string; sourceKind?: string }>(`events/${EVENTS.provisionalReview}/assessments/${event.currentAssessmentId}`);
      return `${assessment?.status}:${assessment?.sourceKind}:${Boolean(event.currentResourceId)}`;
    }, { timeout: 30_000 }).toBe('official_ready:admin_manual:true');
  });
});
