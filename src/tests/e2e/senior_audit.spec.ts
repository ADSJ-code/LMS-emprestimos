import { test, expect } from '@playwright/test';

test.describe('Extensive Senior QA Audit - LMS Live Site', () => {
  test.setTimeout(120000);

  test.beforeEach(async ({ page }) => {
    await page.goto('https://lms-emprestimos.onrender.com/login');
    await page.fill('input[type="email"]', 'admin@creditnow.com');
    await page.fill('input[type="password"]', '123456');
    await page.click('button:has-text("Entrar no Sistema")');
    await expect(page).toHaveURL(/.*dashboard/, { timeout: 20000 });
  });

  test('Client and Loan Mathematical Validation', async ({ page }) => {
    const clientName = `QA SENIOR ${Date.now()}`;
    await page.goto('https://lms-emprestimos.onrender.com/clients');
    await page.click('button:has-text("Novo Cliente")');
    await page.fill('input[placeholder="Ex: João da Silva"]', clientName);
    await page.fill('input[placeholder="000.000.000-00"]', '999.999.999-99');
    await page.fill('input[placeholder="(00) 00000-0000"]', '(11) 99999-8888');
    await page.click('button:has-text("Salvar Cliente")');
    await page.waitForTimeout(2000);
    await expect(page.locator(`text=${clientName}`)).toBeVisible();

    // 3. MULTIPLE LOAN SCENARIOS (MATHEMATICAL STRESS TEST)
    const scenarios = [
      { amount: '500', rate: '20', installments: '3', label: 'Cenário Curto Alta Taxa' },
      { amount: '10000', rate: '5', installments: '12', label: 'Cenário Longo Baixa Taxa' },
      { amount: '2500', rate: '12.5', installments: '6', label: 'Cenário Médio Taxa Quebrada' }
    ];

    await page.goto('https://lms-emprestimos.onrender.com/billing');

    for (const sc of scenarios) {
      console.log(`Testando ${sc.label}...`);
      await page.click('button:has-text("Novo Contrato")');
      await page.selectOption('label:has-text("Cliente Selecionado") + select', { label: clientName });
      await page.fill('label:has-text("Valor (R$)") + input', sc.amount);
      await page.fill('label:has-text("Taxa Mensal (%)") + input', sc.rate);
      await page.fill('label:has-text("Qtd. Parcelas") + input', sc.installments);
      await page.fill('label:has-text("Data da Operação") + input', '2025-01-01');

      // Wait for simulation update
      await page.waitForTimeout(1000);
      const installmentValue = await page.locator('span.text-xl.font-black.text-green-600').innerText();
      console.log(`${sc.label} -> Parcela Simulada: ${installmentValue}`);

      // Approval Flow
      await page.click('button:has-text("Iniciar Triagem")');
      const checks = await page.locator('div.cursor-pointer').all();
      for (const check of checks) { await check.click(); }
      await page.click('button:has-text("2. Documentos")');
      const checks2 = await page.locator('div.cursor-pointer').all();
      for (const check of checks2) { await check.click(); }
      await page.fill('textarea', `Validação automática ${sc.label}`);
      await page.click('button:has-text("Aprovar Contrato")');
      await page.waitForTimeout(2000);
    }

    // 4. FUNCTIONAL BUTTON AUDIT (PDF/Excel)
    const firstContractRow = page.locator('tr').filter({ hasText: clientName }).first();
    await firstContractRow.locator('button:has(svg.lucide-more-vertical)').click();

    // Check if Menu items are present
    await expect(page.locator('button:has-text("Ver Detalhes")')).toBeVisible();
    await expect(page.locator('button:has-text("Contrato PDF")')).toBeVisible();
    await expect(page.locator('button:has-text("Promissórias")')).toBeVisible();

    // 5. FLEXIBLE PAYMENT AUDIT (Amortization Logic)
    console.log("Iniciando auditoria de Baixa Flexível...");
    await page.click('button:has-text("Registrar Baixa")');

    // Pay partial interest
    await page.fill('label:has-text("Juros (Lucro)") + small + div input', '100');
    await page.fill('label:has-text("Capital (Amortização)") + small + div input', '0');

    const totalReceived = await page.locator('p.text-3xl.font-black.text-white').innerText();
    expect(totalReceived).toBe('R$ 100,00');

    await page.click('button:has-text("Confirmar Baixa")');
    await page.waitForTimeout(2000);

  });

  test('Dashboard and Security Validation', async ({ page }) => {
    // 1. Dashboard KPIs
    await page.goto('https://lms-emprestimos.onrender.com/dashboard');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h2:has-text("Dashboard")')).toBeVisible();

    // 2. Blacklist
    await page.goto('https://lms-emprestimos.onrender.com/blacklist');
    await page.click('button:has-text("Bloquear Novo CPF")');
    const blacklistCPF = `000.111.222-${Math.floor(Math.random()*90 + 10)}`;
    await page.fill('input[placeholder="000.000.000-00"]', blacklistCPF);
    await page.fill('label:has-text("Nome Completo") + input', 'NOME BLOQUEADO TESTE');
    await page.click('button:has-text("Confirmar Bloqueio")');
    await page.waitForTimeout(2000);
    await expect(page.locator(`text=${blacklistCPF}`)).toBeVisible();

    // 3. Settings & Admin Bugfix Verification
    await page.goto('https://lms-emprestimos.onrender.com/settings');
    await page.click('button:has-text("Usuários do Sistema")');
    const isVisible = await page.getByRole('button', { name: 'Adicionar Usuário' }).isVisible();
    console.log(`Botão 'Adicionar Usuário' visível: ${isVisible}`);
  });
});
