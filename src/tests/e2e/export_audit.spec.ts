import { test, expect } from '@playwright/test';

test('Action Buttons and File Exports', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('https://lms-emprestimos.onrender.com/login');
    await page.fill('input[type="email"]', 'admin@creditnow.com');
    await page.fill('input[type="password"]', '123456');
    await page.click('button:has-text("Entrar no Sistema")');

    await page.goto('https://lms-emprestimos.onrender.com/billing');
    await page.waitForLoadState('networkidle');

    // Check Excel Download
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.click('button:has-text("Relatório Excel")'),
        // Since it opens filters first
        page.click('button:has-text("Baixar Filtrado")')
    ]);
    console.log(`Excel Downloaded: ${download.suggestedFilename()}`);

    // Check PDF Contract
    await page.locator('button:has(svg.lucide-more-vertical)').first().click();
    const [pdfDownload] = await Promise.all([
        page.waitForEvent('download'),
        page.click('button:has-text("Contrato PDF")')
    ]);
    console.log(`PDF Downloaded: ${pdfDownload.suggestedFilename()}`);
});
