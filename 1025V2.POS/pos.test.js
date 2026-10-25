import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const directory = dirname(fileURLToPath(import.meta.url));
const financeScript = readFileSync(join(directory, 'finance.js'), 'utf8');
const inventoryScript = readFileSync(join(directory, 'inventory.js'), 'utf8');
const salesBundlesScript = readFileSync(join(directory, 'salesBundles.js'), 'utf8');
const posScript = readFileSync(join(directory, 'pos.js'), 'utf8');

function createContext(overrides = {}) {
    const elements = new Map([
        ['posDate', { value: '2026-10-21' }],
        ['posCustomer', { value: '' }],
        ['posPaymentMethod', { value: '現金' }],
        ['posBarcode', { value: '', focus() { this.focused = true; } }],
        ['posSearch', { value: '' }]
    ]);
    const messages = [];
    const context = {
        data: {
            products: [{ id: 'product-1', name: '產品一', barcode: '4901234567890', salesPrice: 100, taxStatus: '含稅' }],
            inventory: [{
                id: 'inventory-1',
                productId: 'product-1',
                productName: '產品一',
                spec: '規格一',
                warehouse: '總倉',
                quantity: 5,
                availableQuantity: 5,
                averageCost: 40,
                totalCost: 200,
                status: '正常'
            }],
            inventoryMovements: [],
            inventoryBatches: [],
            accountsReceivable: [],
            accountsPayable: [],
            financeCustomers: [{ id: 'customer-1', name: '客戶甲', taxId: '12345678' }]
        },
        document: { getElementById: id => elements.get(id) || null },
        confirm: () => true,
        saveData: () => true,
        showToast: message => messages.push(message),
        messages,
        elements,
        renderFinance() {},
        renderInventory() {},
        renderShipping() {},
        renderReports() {},
        getFinanceToday: () => '2026-10-21',
        getInventoryStatus: item => Number(item.availableQuantity) > 0 ? '正常' : '缺貨',
        ...overrides
    };
    vm.createContext(context);
    vm.runInContext(salesBundlesScript, context);
    vm.runInContext(financeScript, context);
    vm.runInContext(inventoryScript, context);
    vm.runInContext(posScript, context);
    return context;
}

function evaluate(context, expression) {
    return JSON.parse(JSON.stringify(vm.runInContext(expression, context)));
}

test('POS checkout creates a paid receivable and outbound movement and decrements inventory', () => {
    const context = createContext();
    vm.runInContext("posCart = [{ inventoryId: 'inventory-1', quantity: 2, unitPrice: 120, taxStatus: '含稅' }]", context);
    context.elements.get('posCustomer').value = 'customer-1';
    context.elements.get('posPaymentMethod').value = '刷卡';

    vm.runInContext('completePosSale()', context);

    const state = evaluate(context, `({
        inventory: data.inventory[0],
        movement: data.inventoryMovements[0],
        receivable: data.accountsReceivable[0],
        cart: posCart
    })`);
    assert.equal(state.inventory.quantity, 3);
    assert.equal(state.inventory.availableQuantity, 3);
    assert.equal(state.movement.type, 'outbound');
    assert.equal(state.movement.channel, 'POS收銀');
    assert.equal(state.movement.salesPrice, 120);
    assert.equal(state.receivable.counterpartyName, '客戶甲');
    assert.equal(state.receivable.totalAmount, 240);
    assert.equal(state.receivable.paidAmount, 240);
    assert.equal(state.receivable.status, 'paid');
    assert.equal(state.receivable.payments[0].method, '刷卡');
    assert.deepEqual(state.cart, []);
});

test('POS allows a walk-in sale with a selected payment method', () => {
    const context = createContext();
    vm.runInContext("posCart = [{ inventoryId: 'inventory-1', quantity: 1, unitPrice: 100, taxStatus: '含稅' }]", context);
    context.elements.get('posPaymentMethod').value = '現金';

    vm.runInContext('completePosSale()', context);

    assert.equal(context.data.accountsReceivable[0].counterpartyName, '現場客');
    assert.equal(context.data.accountsReceivable[0].customerId, '');
    assert.equal(context.data.accountsReceivable[0].payments[0].method, '現金');
});

test('POS scans product barcode, adds the matching stock, and combines repeated scans', () => {
    const context = createContext();
    context.elements.get('posBarcode').value = '4901234567890';
    vm.runInContext('processPosBarcode()', context);
    context.elements.get('posBarcode').value = ' 4901234567890 ';
    vm.runInContext('processPosBarcode()', context);

    const cart = evaluate(context, 'posCart');
    assert.equal(cart.length, 1);
    assert.equal(cart[0].inventoryId, 'inventory-1');
    assert.equal(cart[0].quantity, 2);
    assert.equal(cart[0].unitPrice, 100);
    assert.equal(context.elements.get('posBarcode').value, '');
    assert.equal(context.elements.get('posBarcode').focused, true);
});

test('POS uses the package inventory sales price instead of the product unit price', () => {
    const context = createContext();
    context.data.inventory[0].spec = '10件/包';
    context.data.inventory[0].salesPrice = 200;

    vm.runInContext("addPosItem('inventory-1')", context);

    const cart = evaluate(context, 'posCart');
    assert.equal(cart[0].unitPrice, 200);
});

test('POS barcode search reports unknown or unavailable products and asks for a warehouse when stock is split', () => {
    const unknownContext = createContext();
    unknownContext.elements.get('posBarcode').value = '0000000000000';
    vm.runInContext('processPosBarcode()', unknownContext);
    assert.match(unknownContext.messages.at(-1), /找不到條碼/);
    assert.equal(evaluate(unknownContext, 'posCart.length'), 0);

    const unavailableContext = createContext();
    unavailableContext.data.inventory[0].availableQuantity = 0;
    unavailableContext.elements.get('posBarcode').value = '4901234567890';
    vm.runInContext('processPosBarcode()', unavailableContext);
    assert.match(unavailableContext.messages.at(-1), /沒有可用庫存/);
    assert.equal(evaluate(unavailableContext, 'posCart.length'), 0);

    const splitStockContext = createContext();
    splitStockContext.data.inventory.push({
        ...splitStockContext.data.inventory[0],
        id: 'inventory-2',
        warehouse: '台北倉',
        quantity: 3,
        availableQuantity: 3
    });
    splitStockContext.elements.get('posBarcode').value = '4901234567890';
    vm.runInContext('processPosBarcode()', splitStockContext);
    assert.match(splitStockContext.messages.at(-1), /多筆可用庫存/);
    assert.equal(splitStockContext.elements.get('posSearch').value, '產品一');
    assert.equal(evaluate(splitStockContext, 'posCart.length'), 0);
});

test('POS blocks checkout when stock is insufficient or saving fails without partial changes', () => {
    const insufficientContext = createContext();
    vm.runInContext("posCart = [{ inventoryId: 'inventory-1', quantity: 6, unitPrice: 100, taxStatus: '含稅' }]", insufficientContext);
    vm.runInContext('completePosSale()', insufficientContext);
    assert.equal(insufficientContext.data.accountsReceivable.length, 0);
    assert.equal(insufficientContext.data.inventory[0].quantity, 5);
    assert.match(insufficientContext.messages.at(-1), /庫存不足/);

    const failedContext = createContext({ saveData: () => false });
    vm.runInContext("posCart = [{ inventoryId: 'inventory-1', quantity: 2, unitPrice: 100, taxStatus: '含稅' }]", failedContext);
    vm.runInContext('completePosSale()', failedContext);
    assert.equal(failedContext.data.accountsReceivable.length, 0);
    assert.equal(failedContext.data.inventory[0].quantity, 5);
    assert.equal(failedContext.data.inventoryMovements.length, 0);
    assert.match(failedContext.messages.at(-1), /資料已還原/);
});

test('POS sells a promotional bundle by consuming components and retains the bundle sale identity', () => {
    const context = createContext();
    context.data.products.push(
        { id: 'product-2', prodName: '產品二', productType: 'standard' },
        {
            id: 'bundle-1', prodName: '促銷組合 C', spec: 'A+B', unit: '組', productType: 'sales-bundle',
            salesPrice: 150, components: [{ productId: 'product-1', quantity: 1 }, { productId: 'product-2', quantity: 1 }]
        }
    );
    context.data.inventory.push({
        id: 'inventory-2', productId: 'product-2', productName: '產品二', quantity: 3,
        availableQuantity: 3, averageCost: 20, totalCost: 60, status: '正常'
    });
    vm.runInContext("addPosBundle('bundle-1'); completePosSale()", context);

    const parent = context.data.inventoryMovements.find(move => move.type === 'outbound');
    assert.equal(context.data.inventory[0].availableQuantity, 4);
    assert.equal(context.data.inventory[1].availableQuantity, 2);
    assert.equal(parent.productId, 'bundle-1');
    assert.equal(parent.bundleMode, 'components');
    assert.equal(parent.salesPrice, 150);
    assert.equal(context.data.accountsReceivable[0].lines[0].productId, 'bundle-1');
    assert.equal(context.data.accountsReceivable[0].lines[0].unitPrice, 150);
});

test('failed POS bundle persistence restores every component and removes its parent and child movements', () => {
    const context = createContext({ saveData: () => false });
    context.data.products.push(
        { id: 'product-2', prodName: '產品二', productType: 'standard' },
        {
            id: 'bundle-1', prodName: '促銷組合 C', productType: 'sales-bundle', salesPrice: 150,
            components: [{ productId: 'product-1', quantity: 1 }, { productId: 'product-2', quantity: 1 }]
        }
    );
    context.data.inventory.push({
        id: 'inventory-2', productId: 'product-2', productName: '產品二', quantity: 3,
        availableQuantity: 3, averageCost: 20, totalCost: 60
    });

    vm.runInContext("addPosBundle('bundle-1'); completePosSale()", context);

    assert.equal(context.data.inventory[0].quantity, 5);
    assert.equal(context.data.inventory[1].quantity, 3);
    assert.equal(context.data.inventoryMovements.length, 0);
    assert.equal(context.data.accountsReceivable.length, 0);
    assert.match(context.messages.at(-1), /資料已還原/);
});

test('POS identifies assembled promotional stock separately and deducts only the assembled product', () => {
    const context = createContext();
    context.data.products.push({
        id: 'bundle-1', prodName: '促銷組合 C', productType: 'sales-bundle',
        components: [{ productId: 'product-1', quantity: 1 }], salesPrice: 125
    });
    context.data.inventory.push({
        id: 'inventory-C', productId: 'bundle-1', productName: '促銷組合 C', quantity: 3,
        availableQuantity: 3, averageCost: 60, totalCost: 180, status: '正常'
    });

    vm.runInContext("addPosItem('inventory-C'); completePosSale()", context);

    assert.equal(context.data.inventory[0].availableQuantity, 5);
    assert.equal(context.data.inventory[1].availableQuantity, 2);
    assert.equal(context.data.inventoryMovements[0].bundleMode, 'assembled');
    assert.equal(context.data.inventoryMovements[0].inventoryId, 'inventory-C');
    assert.equal(context.data.inventoryMovements[0].productId, 'bundle-1');
});
