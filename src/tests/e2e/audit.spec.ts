import { test, expect } from '@playwright/test';

test.describe('End-to-End Audit and Feature Verification', () => {
  test.beforeEach(async ({ page }) => {
    // Mock the API endpoints for both loans and clients
    await page.route('**/api/clients', async (route) => {
      if (route.request().method() === 'GET') {
        const clients = JSON.parse(await page.evaluate(() => localStorage.getItem('mock_clients') || '[]'));
        await route.fulfill({ json: clients });
      } else if (route.request().method() === 'POST') {
        const newClient = route.request().postDataJSON();
        const clients = JSON.parse(await page.evaluate(() => localStorage.getItem('mock_clients') || '[]'));
        clients.push({ ...newClient, id: Date.now() });
        await page.evaluate((c: any) => localStorage.setItem('mock_clients', JSON.stringify(c)), clients);
        await route.fulfill({ status: 201, json: newClient });
      }
    });

    await page.route('**/api/loans', async (route) => {
      if (route.request().method() === 'GET') {
        const loans = JSON.parse(await page.evaluate(() => localStorage.getItem('mock_loans') || '[]'));
        await route.fulfill({ json: loans });
      } else if (route.request().method() === 'POST') {
        const newLoan = route.request().postDataJSON();
        const loans = JSON.parse(await page.evaluate(() => localStorage.getItem('mock_loans') || '[]'));
        loans.push(newLoan);
        await page.evaluate((l: any) => localStorage.setItem('mock_loans', JSON.stringify(l)), loans);
        await route.fulfill({ status: 201, json: newLoan });
      }
    });

    await page.route('**/api/loans/**', async (route) => {
        const url = route.request().url();
        const id = url.split('/').pop();
        if (route.request().method() === 'PUT') {
          const updatedLoan = route.request().postDataJSON();
          let loans = JSON.parse(await page.evaluate(() => localStorage.getItem('mock_loans') || '[]'));
          loans = loans.map((l: any) => l.id === id ? updatedLoan : l);
          await page.evaluate((l: any) => localStorage.setItem('mock_loans', JSON.stringify(l)), loans);
          await route.fulfill({ status: 200, json: updatedLoan });
        }
    });

    await page.route('**/api/logs', async (route) => {
        await route.fulfill({ json: [
            { id: '1', user: 'Sistema', action: 'Contrato Gerado', details: 'R$ 1000 para João da Silva', timestamp: new Date().toISOString() }
        ]});
    });

    await page.route('**/api/dashboard/summary', async (route) => {
        const loans = JSON.parse(await page.evaluate(() => localStorage.getItem('mock_loans') || '[]'));
        const clients = JSON.parse(await page.evaluate(() => localStorage.getItem('mock_clients') || '[]'));
        const totalCapital = loans.reduce((acc: number, l: any) => acc + (l.amount - (l.totalPaidCapital || 0)), 0);
        await route.fulfill({ json: {
            totalActive: loans.length,
            totalOverdue: 0,
            totalCapital: totalCapital,
            activeClients: clients.length
        }});
    });

    // Bypass login
    await page.goto('http://localhost:3000/login');
    await page.evaluate(() => {
      const sessionData = JSON.stringify({
        token: `jwt-mock`,
        user: { name: 'Admin', email: 'admin@creditnow.com', role: 'ADMIN' },
        loginTime: new Date().toISOString()
      });
      localStorage.setItem('lms_active_session', sessionData);
      localStorage.setItem('token', 'jwt-mock');
      localStorage.setItem('mock_clients', JSON.stringify([]));
      localStorage.setItem('mock_loans', JSON.stringify([]));
    });
    await page.goto('http://localhost:3000/');
  });

  test('Comprehensive Audit: Clients -> Billing -> Dashboard', async ({ page }) => {
    // 1. Create a client
    await page.goto('http://localhost:3000/clients');
    await page.click('button:has-text("Novo Cliente")');
    await page.fill('input[placeholder="Ex: João da Silva"]', 'João da Silva');
    await page.fill('input[placeholder="000.000.000-00"]', '123.456.789-00');
    await page.fill('input[placeholder="(00) 00000-0000"]', '(11) 99999-9999');
    await page.fill('input[placeholder="cliente@email.com"]', 'joao@email.com');
    await page.fill('input[placeholder="São Paulo, SP"]', 'São Paulo, SP');
    await page.click('button:has-text("Salvar Cliente")');
    await expect(page.locator('text=João da Silva')).toBeVisible();

    // 2. Create a loan for that client
    await page.goto('http://localhost:3000/billing');
    await page.click('button:has-text("Novo Contrato")');
    // More specific selector for client select
    await page.selectOption('label:has-text("Cliente Selecionado") + select', 'João da Silva');
    await page.fill('label:has-text("Valor (R$)") + input', '1000');
    await page.fill('label:has-text("Taxa Mensal (%)") + input', '10');
    await page.fill('label:has-text("Data da Operação") + input', '2023-12-01');
    await page.fill('label:has-text("Qtd. Parcelas") + input', '10');

    await page.waitForTimeout(500);
    await page.click('button:has-text("Iniciar Triagem")');

    // Complete checklist
    const checklistItems = await page.locator('div.cursor-pointer').all();
    for (const item of checklistItems) {
      await item.click();
    }
    await page.click('button:has-text("2. Documentos Obrigatórios")');
    const checklistItems2 = await page.locator('div.cursor-pointer').all();
    for (const item of checklistItems2) {
      await item.click();
    }

    const dialogPromise1 = page.waitForEvent('dialog');
    await page.click('button:has-text("Aprovar Contrato")');
    const dialog1 = await dialogPromise1;
    await dialog1.accept();

    await expect(page.locator('text=João da Silva').first()).toBeVisible();

    // 3. Verify 'Renovação' logic
    await page.locator('button').filter({ has: page.locator('svg.lucide-more-vertical') }).first().click();
    await page.click('button:has-text("Registrar Pagamento / Baixa")');
    await page.click('button:has-text("Apenas Juros")');

    const dialogPromise2 = page.waitForEvent('dialog');
    await page.click('button:has-text("Confirmar Baixa")');
    const dialog2 = await dialogPromise2;
    await dialog2.accept();

    const updatedContract = await page.evaluate(() => {
        return JSON.parse(localStorage.getItem('mock_loans') || '[]')[0];
    });
    // paying only interest: installments stay same (10), date advances
    expect(updatedContract.installments).toBe(10);
    expect(new Date(updatedContract.nextDue).getTime()).toBeGreaterThan(new Date('2024-01-01').getTime());

    // 4. Verify Dashboard Consistency
    // Manually set a loan with partial principal paid for verification
    await page.evaluate(() => {
        const contract = {
            id: 'CTR-FIXED',
            client: 'João da Silva',
            amount: 1000,
            installments: 5,
            interestRate: 10,
            startDate: '2023-01-01',
            nextDue: '2024-02-01',
            status: 'Em Dia',
            installmentValue: 200,
            totalPaidCapital: 400,
            totalPaidInterest: 100
        };
        localStorage.setItem('mock_loans', JSON.stringify([contract]));
    });

    await page.goto('http://localhost:3000/');
    await page.waitForLoadState('networkidle');
    const capitalNaRua = await page.locator('h3:has-text("Capital na Rua") + p').innerText();

    // Capital na rua = 1000 - 400 = 600
    expect(capitalNaRua).toBe('600,00');

    // 5. Verify History
    await page.goto('http://localhost:3000/history');
    await expect(page.locator('text=Contrato Gerado')).toBeVisible();

    // 6. Verify Overdue
    // Set a contract in the past
    await page.evaluate(() => {
        const contract = {
            id: 'CTR-OVERDUE',
            client: 'João da Silva',
            amount: 1000,
            installments: 1,
            interestRate: 10,
            startDate: '2023-01-01',
            nextDue: '2023-02-01', // way in the past
            status: 'Atrasado',
            installmentValue: 1000,
            totalPaidCapital: 0,
            totalPaidInterest: 0
        };
        localStorage.setItem('mock_loans', JSON.stringify([contract]));
    });
    await page.goto('http://localhost:3000/overdue');
    await expect(page.locator('text=João da Silva')).toBeVisible();
    await expect(page.locator('td:has-text("dias")')).toBeVisible();
  });
});
