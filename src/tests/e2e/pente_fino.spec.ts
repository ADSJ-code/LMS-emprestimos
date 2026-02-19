import { test, expect } from '@playwright/test';

test.describe('Pente Fino - Senior QA Audit', () => {
    test.setTimeout(300000);

    test('Full Integrity and Functional Stress Test', async ({ page }) => {
        // 1. LOGIN
        await page.goto('https://lms-emprestimos.onrender.com/login');
        await page.fill('input[type="email"]', 'admin@creditnow.com');
        await page.fill('input[type="password"]', '123456');
        await page.click('button:has-text("Entrar no Sistema")');
        await expect(page).toHaveURL(/.*dashboard/, { timeout: 15000 });

        const timestamp = Date.now();
        const names = {
            monthly: `Carlos Roberto ${timestamp}`,
            weekly: `Maria Aparecida ${timestamp}`,
            daily: `Jose Silva ${timestamp}`,
            blacklisted: `Ricardo Souza ${timestamp}`
        };

        // 2. CREATE CLIENTS
        const createClient = async (name: string, cpf: string) => {
            await page.goto('https://lms-emprestimos.onrender.com/clients');
            await page.click('button:has-text("Novo Cliente")');
            await page.fill('input[placeholder="Ex: João da Silva"]', name);
            await page.fill('input[placeholder="000.000.000-00"]', cpf);
            await page.fill('input[placeholder="(00) 00000-0000"]', '11988887777');
            await page.click('button:has-text("Salvar Cliente")');
            await page.waitForTimeout(1500);
        };

        await createClient(names.monthly, '12312312312');
        await createClient(names.weekly, '23423423423');
        await createClient(names.daily, '34534534534');

        // 3. SCENARIO 1: MENSAL (Price)
        // R$ 5000, 5%, 12x. Price = 563.76 approx.
        await page.goto('https://lms-emprestimos.onrender.com/billing');
        await page.click('button:has-text("Novo Contrato")');
        await page.waitForSelector('label:has-text("Cliente Selecionado") + select option', { state: 'attached' });
        await page.selectOption('label:has-text("Cliente Selecionado") + select', { label: names.monthly });
        await page.fill('label:has-text("Valor (R$)") + input', '5000');
        await page.fill('label:has-text("Taxa Mensal (%)") + input', '5');
        await page.fill('label:has-text("Qtd. Parcelas") + input', '12');
        await page.fill('label:has-text("Data da Operação") + input', '2025-01-01');
        await page.selectOption('label:has-text("Periodicidade") + div select', 'MENSAL');

        await page.waitForTimeout(1000);
        const monthlyInst = await page.locator('span.text-xl.font-black.text-green-600').innerText();
        console.log(`Mensal (Carlos): ${monthlyInst}`); // Expect approx R$ 563,76

        await page.click('button:has-text("Iniciar Triagem")');
        await page.fill('textarea', 'Auditoria Senior Mensal');
        await page.click('button:has-text("Aprovar Contrato")');
        await page.waitForSelector('.fixed.inset-0', { state: 'hidden' });

        // 4. SCENARIO 2: SEMANAL
        await page.click('button:has-text("Novo Contrato")');
        await page.selectOption('label:has-text("Cliente Selecionado") + select', { label: names.weekly });
        await page.fill('label:has-text("Valor (R$)") + input', '1000');
        await page.fill('label:has-text("Taxa Mensal (%)") + input', '2');
        await page.fill('label:has-text("Qtd. Parcelas") + input', '4');
        await page.fill('label:has-text("Data da Operação") + input', '2025-02-01');
        await page.selectOption('label:has-text("Periodicidade") + div select', 'SEMANAL');

        await page.waitForTimeout(1000);
        const weeklyInst = await page.locator('span.text-xl.font-black.text-green-600').innerText();
        console.log(`Semanal (Maria): ${weeklyInst}`);

        await page.click('button:has-text("Iniciar Triagem")');
        await page.fill('textarea', 'Auditoria Senior Semanal');
        await page.click('button:has-text("Aprovar Contrato")');
        await page.waitForSelector('.fixed.inset-0', { state: 'hidden' });

        // 5. SCENARIO 3: DIARIO
        await page.click('button:has-text("Novo Contrato")');
        await page.selectOption('label:has-text("Cliente Selecionado") + select', { label: names.daily });
        await page.fill('label:has-text("Valor (R$)") + input', '500');
        await page.fill('label:has-text("Taxa Mensal (%)") + input', '1');
        await page.fill('label:has-text("Qtd. Parcelas") + input', '5');
        await page.fill('label:has-text("Data da Operação") + input', '2025-03-01');
        await page.selectOption('label:has-text("Periodicidade") + div select', 'DIARIO');

        await page.waitForTimeout(1000);
        const dailyInst = await page.locator('span.text-xl.font-black.text-green-600').innerText();
        console.log(`Diário (Jose): ${dailyInst}`);

        await page.click('button:has-text("Iniciar Triagem")');
        await page.fill('textarea', 'Auditoria Senior Diario');
        await page.click('button:has-text("Aprovar Contrato")');
        await page.waitForSelector('.fixed.inset-0', { state: 'hidden' });

        // 6. VERIFY DATES IN LIST
        const checkDueDate = async (name: string, expectedPart: string) => {
            const row = page.locator('tr').filter({ hasText: name }).first();
            const date = await row.locator('td:nth-child(4)').innerText();
            console.log(`Due Date for ${name}: ${date}`);
            // Basic check: should contain expected string
        };

        await checkDueDate(names.monthly, '01/02/2025'); // Jan 1st -> Feb 1st
        await checkDueDate(names.weekly, '08/02/2025');  // Feb 1st -> Feb 8th
        await checkDueDate(names.daily, '02/03/2025');   // Mar 1st -> Mar 2nd

        // 7. AGREEMENT TEST
        console.log("Iniciando Teste de Acordo...");
        const mariaRow = page.locator('tr').filter({ hasText: names.weekly }).first();
        await mariaRow.locator('button:has(svg.lucide-more-vertical)').click();
        await page.click('button:has-text("Registrar Acordo")');
        await page.fill('input[type="date"]', '2025-12-25');
        await page.fill('input[type="number"]', '150');
        await page.click('button:has-text("Confirmar Acordo")');
        await page.waitForSelector('.fixed.inset-0', { state: 'hidden' });

        const mariaStatus = await page.locator('tr').filter({ hasText: names.weekly }).first().locator('td:nth-child(7)').innerText();
        expect(mariaStatus.toUpperCase()).toContain('ACORDO');

        // 8. BLACKLIST BLOCK TEST
        console.log("Iniciando Teste de Blacklist...");
        const blCPF = `888.888.888-${timestamp % 100}`;
        await page.goto('https://lms-emprestimos.onrender.com/blacklist');
        await page.click('button:has-text("Bloquear Novo CPF")');
        await page.fill('input[placeholder="000.000.000-00"]', blCPF);
        await page.fill('label:has-text("Nome Completo") + input', names.blacklisted);
        await page.click('button:has-text("Confirmar Bloqueio")');
        await page.waitForTimeout(1000);

        await page.goto('https://lms-emprestimos.onrender.com/clients');
        await page.click('button:has-text("Novo Cliente")');
        await page.fill('input[placeholder="Ex: João da Silva"]', 'Tentativa Maliciosa');
        await page.fill('input[placeholder="000.000.000-00"]', blCPF);
        await page.fill('input[placeholder="(00) 00000-0000"]', '11000000000');

        const dialogPromise = page.waitForEvent('dialog');
        await page.click('button:has-text("Salvar Cliente")');
        const dialog = await dialogPromise;
        console.log(`Alert Box: ${dialog.message()}`);
        expect(dialog.message().toUpperCase()).toContain('BLACK');
        await dialog.accept();

        console.log("Auditoria Pente Fino Concluída.");
    });
});
