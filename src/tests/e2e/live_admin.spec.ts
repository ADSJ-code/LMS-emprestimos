import { test, expect } from '@playwright/test';

test.describe('Live Validation - Admin', () => {
  test.setTimeout(120000); // Increase timeout
  test('Complete Admin Journey', async ({ page }) => {
    // 1. Login
    await page.goto('https://lms-emprestimos.onrender.com/login');
    await page.fill('input[type="email"]', 'admin@creditnow.com');
    await page.fill('input[type="password"]', '123456');
    await page.click('button:has-text("Entrar no Sistema")');

    // Check for error message if any
    const errorMsg = page.locator('div.bg-red-50');
    if (await errorMsg.isVisible()) {
        console.log('Login Error Message:', await errorMsg.innerText());
    }

    // Wait for Dashboard
    await expect(page).toHaveURL(/.*dashboard/, { timeout: 15000 });
    await expect(page.locator('h2:has-text("Dashboard")')).toBeVisible();

    // 2. Create Client
    await page.goto('https://lms-emprestimos.onrender.com/clients');
    await page.click('button:has-text("Novo Cliente")');
    const uniqueName = `QA ADMIN ${Date.now()}`;
    await page.fill('input[placeholder="Ex: João da Silva"]', uniqueName);
    await page.fill('input[placeholder="000.000.000-00"]', '12345678901'); // Mask will handle it
    await page.fill('input[placeholder="(00) 00000-0000"]', '11999999999');
    await page.click('button:has-text("Salvar Cliente")');

    // Wait for success alert (using dialog wait if alert is native, or just check list)
    await page.waitForTimeout(2000); // Give it some time to save and refresh
    await expect(page.locator(`text=${uniqueName}`)).toBeVisible();

    // 3. Create Loan
    await page.goto('https://lms-emprestimos.onrender.com/billing');
    await page.click('button:has-text("Novo Contrato")');
    await page.selectOption('label:has-text("Cliente Selecionado") + select', { label: uniqueName });
    await page.fill('label:has-text("Valor (R$)") + input', '500');
    await page.fill('label:has-text("Taxa Mensal (%)") + input', '10');
    await page.fill('label:has-text("Data da Operação") + input', new Date().toISOString().split('T')[0]);
    await page.fill('label:has-text("Qtd. Parcelas") + input', '2');

    await page.click('button:has-text("Iniciar Triagem")');

    // Checklist
    const checks = await page.locator('div.cursor-pointer').all();
    for (const check of checks) {
        await check.click();
    }
    await page.click('button:has-text("2. Documentos")');
    const checks2 = await page.locator('div.cursor-pointer').all();
    for (const check of checks2) {
        await check.click();
    }

    await page.fill('textarea[placeholder="Resuma a análise do cliente aqui..."]', 'Teste de QA automatizado');
    await page.click('button:has-text("Aprovar Contrato")');

    // Wait for contract in list
    await page.waitForTimeout(2000);
    await expect(page.locator(`text=${uniqueName}`).first()).toBeVisible();

    // 4. Record Payment
    await page.locator(`tr:has-text("${uniqueName}") button:has(svg.lucide-more-vertical)`).click();
    await page.click('button:has-text("Registrar Baixa")');

    await page.fill('label:has-text("Juros (Lucro)") + small + div input', '50');
    await page.fill('label:has-text("Capital (Amortização)") + small + div input', '0');
    await page.click('button:has-text("Confirmar Baixa")');

    await page.waitForTimeout(2000);

    // 5. Check Audit Logs
    await page.goto('https://lms-emprestimos.onrender.com/history');
    await expect(page.locator(`text=${uniqueName}`).first()).toBeVisible();

    // 6. Check Settings
    await page.goto('https://lms-emprestimos.onrender.com/settings');
    await page.click('button:has-text("Usuários do Sistema")');

    // Debug: Log current user role from localStorage
    const role = await page.evaluate(() => {
        const session = JSON.parse(localStorage.getItem('lms_active_session') || '{}');
        return session.user?.role;
    });
    console.log('Current User Role:', role);

    await expect(page.locator('h3:has-text("Gerenciar Acessos")')).toBeVisible();

    // Check if the button exists at all
    const buttons = await page.locator('button').allInnerTexts();
    console.log('Available buttons on Settings/Users:', buttons);

    console.log('Admin validation successful');
  });
});
