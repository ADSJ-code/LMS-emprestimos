import { test, expect } from '@playwright/test';

test.describe('Live Validation - Operator', () => {
  test.setTimeout(120000);
  test('Operator Access and Limitations', async ({ page }) => {
    // 1. Login
    await page.goto('https://lms-emprestimos.onrender.com/login');
    await page.fill('input[type="email"]', 'operador@gmail.com');
    await page.fill('input[type="password"]', '123456');
    await page.click('button:has-text("Entrar no Sistema")');

    // Wait for Dashboard
    await expect(page).toHaveURL(/.*dashboard/, { timeout: 15000 });

    // Check role in localStorage
    const role = await page.evaluate(() => {
        const session = JSON.parse(localStorage.getItem('lms_active_session') || '{}');
        return session.user?.role;
    });
    console.log('Current User Role (Operator):', role);

    // 2. Navigate to Clients
    await page.goto('https://lms-emprestimos.onrender.com/clients');
    await expect(page.locator('h2:has-text("Gestão de Clientes")')).toBeVisible();

    // 3. Navigate to Billing
    await page.goto('https://lms-emprestimos.onrender.com/billing');
    await expect(page.locator('h2:has-text("Cobrança e Empréstimos")')).toBeVisible();

    // 4. Navigate to Settings and check for Admin-only elements
    await page.goto('https://lms-emprestimos.onrender.com/settings');
    await page.click('button:has-text("Usuários do Sistema")');

    // Check if "Adicionar Usuário" is hidden
    const addUserBtn = page.getByRole('button', { name: 'Adicionar Usuário' });
    await expect(addUserBtn).not.toBeVisible();

    console.log('Operator validation successful');
  });
});
