import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const directory = dirname(fileURLToPath(import.meta.url));
const quotesScript = readFileSync(join(directory, 'quotes.js'), 'utf8');

function createQuotesContext() {
    const elements = new Map();
    const createdElements = [];
    const context = {
        data: {
            clientQuotes: [],
            suppliers: [],
            products: [],
            financeCustomers: [{
                id: 'customer-1',
                name: '測試客戶',
                contactName: '主檔聯絡人',
                phone: '02-1234-5678',
                email: 'master@example.com'
            }],
            companyProfile: {}
        },
        document: {
            getElementById(id) {
                if (!elements.has(id)) {
                    elements.set(id, {
                        value: '',
                        textContent: '',
                        innerHTML: '',
                        appendChild() {},
                        classList: {
                            add() {},
                            remove() {}
                        }
                    });
                }
                return elements.get(id);
            },
            createElement: () => {
                const element = { className: '', innerHTML: '' };
                createdElements.push(element);
                return element;
            }
        },
        generateQuoteID: () => 'QT115102101',
        findFinanceCustomer: name => context.data.financeCustomers.find(customer => customer.name === name),
        saveData() {},
        closeModal() {},
        renderClientQuotes() {},
        escapeFinanceHtml: value => String(value ?? ''),
        showToast() {},
        saveAsExcel(rows) {
            context.exportedRows = rows;
        }
    };
    context.createdElements = createdElements;
    vm.createContext(context);
    vm.runInContext('let tempQuoteItems = [{ productId: "product-1", prodName: "產品一", costPrice: 50, salesPrice: 100, quantity: 2 }];', context);
    vm.runInContext(quotesScript, context);
    return context;
}

test('quote product search can find package products by ID and shows structured conversion', () => {
    const context = createQuotesContext();
    context.data.products = [
        { id: 'base-product', prodName: '產品一', unit: 'pcs' },
        {
            id: 'package-product', prodName: '產品一', spec: '任意舊規格',
            packageBaseProductId: 'base-product', packageUnitsPerPackage: 10,
            unit: '包', salesPrice: 200, purchasePrice: 100, currency: 'NTD'
        }
    ];
    context.getProductCurrency = () => 'NTD';
    context.getProductPurchasePrice = product => product.purchasePrice || 0;
    context.getProductPurchasePriceNtd = product => product.purchasePrice || 0;
    context.getProductSalesPrice = product => product.salesPrice || 0;
    context.document.getElementById('quoteSearchProduct').value = 'package-product';

    vm.runInContext('renderQuoteProductSelection()', context);

    assert.match(context.createdElements[0].innerHTML, /基礎產品 base-product · 每包 10 pcs/);
    assert.match(context.createdElements[0].innerHTML, /addToQuoteTemp\('package-product'\)/);
});

test('package quotes use package-specific prices and preserve price snapshots', () => {
    const context = createQuotesContext();
    context.data.products = [
        { id: 'base-product', prodName: '產品一', salesPrice: 20, purchasePrice: 10, currency: 'NTD' },
        {
            id: 'package-product', prodName: '產品一', spec: '10入', salesPrice: 200,
            purchasePrice: 100, currency: 'NTD', packageBaseProductId: 'base-product',
            packageUnitsPerPackage: 10
        }
    ];
    context.getProductPurchasePriceNtd = product => product.purchasePrice;
    context.getProductSalesPrice = product => product.salesPrice || 0;

    vm.runInContext(`tempQuoteItems = [];
    addToQuoteTemp('package-product');
    data.products[0].salesPrice = 25;
    firstPrice = tempQuoteItems[0].salesPrice;
    tempQuoteItems = [];
    data.products[1].salesPrice = 230;
    addToQuoteTemp('package-product');
    secondPrice = tempQuoteItems[0].salesPrice;`, context);

    assert.equal(context.firstPrice, 200);
    assert.equal(context.secondPrice, 230);
    assert.equal(context.data.products[0].salesPrice, 25);
});

test('quote contact details can be copied from customer and overridden per quote', () => {
    const context = createQuotesContext();
    vm.runInContext(`
        document.getElementById('quoteClientName').value = '測試客戶';
        document.getElementById('quoteCustomerId').value = '';
        document.getElementById('quoteId').value = '';
        document.getElementById('quoteDate').value = '2026-10-21';
        document.getElementById('quoteNote').value = '';
        document.getElementById('quoteStatus').value = 'open';
        document.getElementById('quoteLossReason').value = '';
        selectFinanceCustomerForQuote('customer-1');
        document.getElementById('quoteContactName').value = '本次對接人';
        document.getElementById('quoteContactPhone').value = '0912-345-678';
        document.getElementById('quoteContactEmail').value = 'contact@example.com';
        saveClientQuote();
    `, context);

    assert.equal(context.data.clientQuotes.length, 1);
    assert.equal(context.data.clientQuotes[0].customerId, 'customer-1');
    assert.equal(context.data.clientQuotes[0].customerContactName, '本次對接人');
    assert.equal(context.data.clientQuotes[0].customerPhone, '0912-345-678');
    assert.equal(context.data.clientQuotes[0].customerEmail, 'contact@example.com');

    vm.runInContext('exportQuoteExcel(data.clientQuotes[0].id)', context);

    assert.ok(context.exportedRows.some(row => row[0] === '客戶聯絡人' && row[1] === '本次對接人'));
    assert.ok(context.exportedRows.some(row => row[0] === '客戶電話' && row[1] === '0912-345-678'));
    assert.ok(context.exportedRows.some(row => row[0] === '客戶 Email' && row[1] === 'contact@example.com'));
});

test('editing an existing quote restores its saved customer contact details', () => {
    const context = createQuotesContext();
    context.data.clientQuotes.push({
        id: 'QT-OLD',
        clientName: '測試客戶',
        customerId: 'customer-1',
        customerContactName: '歷史聯絡人',
        customerPhone: '03-9876-5432',
        customerEmail: 'old-contact@example.com',
        date: '2026-10-01',
        note: '',
        status: 'open',
        items: [{ productId: 'product-1', prodName: '產品一', costPrice: 50, salesPrice: 100, quantity: 2 }]
    });

    vm.runInContext(`
        renderQuoteProductSelection = () => {};
        renderQuoteSelected = () => {};
        openEditQuote('QT-OLD');
    `, context);

    assert.equal(context.document.getElementById('quoteContactName').value, '歷史聯絡人');
    assert.equal(context.document.getElementById('quoteContactPhone').value, '03-9876-5432');
    assert.equal(context.document.getElementById('quoteContactEmail').value, 'old-contact@example.com');
});
