import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const directory = dirname(fileURLToPath(import.meta.url));
const financeScript = readFileSync(join(directory, 'finance.js'), 'utf8');
const salesBundlesScript = readFileSync(join(directory, 'salesBundles.js'), 'utf8');

function createContext({
    customerName = '未建檔客戶',
    customers = [],
    closingDay = '',
    paymentDay = '',
    selection = 'inventory-1',
    saveData = () => true
} = {}) {
    const inventoryItem = {
        id: 'inventory-1',
        productId: 'product-1',
        productName: '產品一',
        quantity: 5,
        availableQuantity: 5,
        averageCost: 40,
        totalCost: 200,
        status: '正常'
    };
    const salesLine = {
        querySelector(selector) {
            const inputs = {
                '.sales-inventory-id': { value: selection },
                '.sales-quantity': { value: '1' },
                '.sales-unit-price': { value: '100' },
                '.sales-tax-status': { value: '含稅' }
            };
            return inputs[selector] || null;
        }
    };
    const elements = new Map([
        ['salesCustomerName', { value: customerName }],
        ['salesInvoiceDate', { value: '2026-10-23' }],
        ['salesCustomerClosingDay', { value: closingDay }],
        ['salesCustomerPaymentDay', { value: paymentDay }],
        ['salesDueDate', { value: '' }],
        ['salesDueDatePreview', { textContent: '' }],
        ['salesInvoiceShipping', { value: '0' }],
        ['salesInvoiceDiscount', { value: '0' }],
        ['salesInvoiceNumber', { value: '' }],
        ['salesInvoiceType', { value: '無發票' }],
        ['salesLogisticsProvider', { value: '' }],
        ['salesLogisticsNumber', { value: '' }],
        ['salesDeliveryAddress', { value: '' }],
        ['salesDeliveryPerson', { value: '' }],
        ['salesShipmentNote', { value: '' }],
        ['salesInvoiceLines', { replaceChildren() {} }]
    ]);
    const messages = [];
    const data = {
        accountsReceivable: [],
        financeCustomers: customers,
        inventory: [inventoryItem],
        inventoryMovements: []
    };
    const context = {
        data,
        document: {
            getElementById: id => elements.get(id) || null,
            querySelectorAll: selector => selector === '#salesInvoiceLines .sales-invoice-line' ? [salesLine] : []
        },
        confirm: () => true,
        saveData,
        showToast: message => messages.push(message),
        messages,
        getFinanceToday: () => '2026-10-23',
        generateOutboundId: () => 'movement-1',
        addSalesInvoiceLine() {},
        renderFinance() {},
        renderInventory() {},
        renderShipping() {}
    };
    vm.createContext(context);
    vm.runInContext(salesBundlesScript, context);
    vm.runInContext(financeScript, context);
    vm.runInContext('addSalesInvoiceLine = () => {}', context);
    return context;
}

function submitSalesInvoice(context) {
    vm.runInContext('createSalesInvoice', context)({
        preventDefault() {},
        target: { reset() {} }
    });
}

test('sales invoice rejects an unregistered customer before changing stock or accounting data', () => {
    const context = createContext({ closingDay: '25', paymentDay: '10' });

    submitSalesInvoice(context);

    assert.equal(context.data.financeCustomers.length, 0);
    assert.equal(context.data.accountsReceivable.length, 0);
    assert.equal(context.data.inventory[0].quantity, 5);
    assert.equal(context.data.inventory[0].availableQuantity, 5);
    assert.equal(context.data.inventoryMovements.length, 0);
    assert.match(context.messages.at(-1), /尚未建檔/);
    assert.match(context.messages.at(-1), /客戶管理/);
});

test('sales invoice links to an existing registered customer', () => {
    const customer = { id: 'customer-1', name: '已建檔客戶', taxId: '12345678', address: '客戶預設地址' };
    const context = createContext({ customerName: customer.name, customers: [customer] });
    vm.runInContext('loadFinanceCustomerTerms()', context);
    assert.equal(context.document.getElementById('salesDeliveryAddress').value, customer.address);
    context.document.getElementById('salesLogisticsProvider').value = '黑貓宅急便';
    context.document.getElementById('salesLogisticsNumber').value = 'TRACK-123';
    context.document.getElementById('salesDeliveryAddress').value = '台北市自訂出貨地址';
    context.document.getElementById('salesDeliveryPerson').value = '王先生';
    context.document.getElementById('salesShipmentNote').value = '請於下午送達';

    submitSalesInvoice(context);

    assert.equal(context.data.accountsReceivable.length, 1);
    assert.equal(context.data.accountsReceivable[0].customerId, customer.id);
    assert.equal(context.data.accountsReceivable[0].counterpartyName, customer.name);
    assert.equal(context.data.accountsReceivable[0].logisticsProvider, '黑貓宅急便');
    assert.equal(context.data.accountsReceivable[0].logisticsNumber, 'TRACK-123');
    assert.equal(context.data.accountsReceivable[0].deliveryAddress, '台北市自訂出貨地址');
    assert.equal(context.data.accountsReceivable[0].deliveryPerson, '王先生');
    assert.equal(context.data.accountsReceivable[0].shipmentNote, '請於下午送達');
    assert.equal(context.data.inventory[0].quantity, 4);
    assert.equal(context.data.inventoryMovements.length, 1);
    assert.equal(context.data.inventoryMovements[0].accountsDocumentId, context.data.accountsReceivable[0].id);
    assert.equal(context.data.inventoryMovements[0].customerId, customer.id);
    assert.equal(context.data.inventoryMovements[0].customerName, customer.name);
    assert.equal(context.data.inventoryMovements[0].logisticsProvider, '黑貓宅急便');
    assert.equal(context.data.inventoryMovements[0].logisticsNumber, 'TRACK-123');
    assert.equal(context.data.inventoryMovements[0].deliveryAddress, '台北市自訂出貨地址');
    assert.equal(context.data.inventoryMovements[0].deliveryPerson, '王先生');
    assert.equal(context.data.inventoryMovements[0].shipmentNote, '請於下午送達');
});

test('sales invoice sells a promotional bundle and records component consumption with its own price', () => {
    const customer = { id: 'customer-1', name: '已建檔客戶', taxId: '12345678' };
    const context = createContext({
        customerName: customer.name,
        customers: [customer],
        selection: 'bundle-components:bundle-1'
    });
    context.document.getElementById('salesLogisticsProvider').value = '郵局';
    context.document.getElementById('salesLogisticsNumber').value = 'POST-456';
    context.document.getElementById('salesDeliveryAddress').value = '新竹市出貨地址';
    context.document.getElementById('salesDeliveryPerson').value = '李小姐';
    context.document.getElementById('salesShipmentNote').value = '組合商品請分開包裝';
    context.data.products = [
        { id: 'product-1', prodName: '產品一', productType: 'standard' },
        { id: 'product-2', prodName: '產品二', productType: 'standard' },
        {
            id: 'bundle-1', prodName: '促銷組合 C', spec: 'A+B', unit: '組', productType: 'sales-bundle',
            salesPrice: 100, components: [{ productId: 'product-1', quantity: 1 }, { productId: 'product-2', quantity: 1 }]
        }
    ];
    context.data.inventory.push({
        id: 'inventory-2', productId: 'product-2', productName: '產品二', quantity: 3,
        availableQuantity: 3, averageCost: 20, totalCost: 60
    });

    submitSalesInvoice(context);

    assert.equal(context.data.inventory[0].availableQuantity, 4);
    assert.equal(context.data.inventory[1].availableQuantity, 2);
    assert.equal(context.data.accountsReceivable[0].lines[0].productId, 'bundle-1');
    assert.equal(context.data.accountsReceivable[0].lines[0].unitPrice, 100);
    const bundleMovement = context.data.inventoryMovements.find(move => move.type === 'outbound');
    assert.equal(bundleMovement.bundleMode, 'components');
    assert.equal(bundleMovement.accountsDocumentId, context.data.accountsReceivable[0].id);
    assert.equal(bundleMovement.logisticsProvider, '郵局');
    assert.equal(bundleMovement.logisticsNumber, 'POST-456');
    assert.equal(bundleMovement.deliveryAddress, '新竹市出貨地址');
    assert.equal(bundleMovement.deliveryPerson, '李小姐');
    assert.equal(bundleMovement.shipmentNote, '組合商品請分開包裝');
    const componentMovement = context.data.inventoryMovements.find(move => move.type === 'bundle-component-outbound');
    assert.equal(componentMovement.accountsDocumentId, context.data.accountsReceivable[0].id);
    assert.equal(componentMovement.logisticsProvider, '郵局');
    assert.equal(componentMovement.logisticsNumber, 'POST-456');
    assert.equal(componentMovement.deliveryAddress, '新竹市出貨地址');
    assert.equal(componentMovement.deliveryPerson, '李小姐');
    assert.equal(componentMovement.shipmentNote, '組合商品請分開包裝');
});

test('deleting a component-consumed bundle sale restores its component stock and removes linked movements', () => {
    const context = createContext();
    context.data.products = [
        { id: 'product-1', prodName: '產品一', productType: 'standard' },
        { id: 'product-2', prodName: '產品二', productType: 'standard' },
        { id: 'bundle-1', prodName: '促銷組合 C', productType: 'sales-bundle' }
    ];
    context.data.inventory[0].quantity = 4;
    context.data.inventory[0].availableQuantity = 4;
    context.data.inventory.push({
        id: 'inventory-2', productId: 'product-2', productName: '產品二', quantity: 2,
        availableQuantity: 2, averageCost: 20, totalCost: 40
    });
    context.data.inventoryMovements = [
        {
            id: 'bundle-outbound', type: 'outbound', inventoryId: '', productId: 'bundle-1',
            quantity: 1, costUnit: 60, bundleMode: 'components',
            bundleUnits: [{ allocations: [
                { inventoryId: 'inventory-1', productId: 'product-1', productName: '產品一', quantity: 1, costUnit: 40, warehouse: '總倉', unit: 'pcs' },
                { inventoryId: 'inventory-2', productId: 'product-2', productName: '產品二', quantity: 1, costUnit: 20, warehouse: '總倉', unit: 'pcs' }
            ] }],
            accountsDocumentId: 'AR-1', orderId: 'AR-1'
        },
        { id: 'component-outbound', type: 'bundle-component-outbound', parentOutboundId: 'bundle-outbound', accountsDocumentId: 'AR-1' }
    ];
    context.data.accountsReceivable = [{ id: 'AR-1', type: 'receivable', counterpartyName: '客戶甲', payments: [] }];

    vm.runInContext("deleteFinanceDocument('receivable', 'AR-1')", context);

    assert.equal(context.data.inventory[0].quantity, 5);
    assert.equal(context.data.inventory[1].quantity, 3);
    assert.equal(context.data.accountsReceivable.length, 0);
    assert.equal(context.data.inventoryMovements.length, 0);
});

test('failed bundle invoice persistence restores component stock, movements, and receivable data', () => {
    const customer = { id: 'customer-1', name: '已建檔客戶', taxId: '12345678' };
    const context = createContext({
        customerName: customer.name,
        customers: [customer],
        selection: 'bundle-components:bundle-1',
        saveData: () => false
    });
    context.data.products = [
        { id: 'product-1', prodName: '產品一', productType: 'standard' },
        { id: 'product-2', prodName: '產品二', productType: 'standard' },
        {
            id: 'bundle-1', prodName: '促銷組合 C', productType: 'sales-bundle', salesPrice: 100,
            components: [{ productId: 'product-1', quantity: 1 }, { productId: 'product-2', quantity: 1 }]
        }
    ];
    context.data.inventory.push({
        id: 'inventory-2', productId: 'product-2', productName: '產品二', quantity: 3,
        availableQuantity: 3, averageCost: 20, totalCost: 60
    });

    submitSalesInvoice(context);

    assert.equal(context.data.inventory[0].quantity, 5);
    assert.equal(context.data.inventory[1].quantity, 3);
    assert.equal(context.data.inventoryMovements.length, 0);
    assert.equal(context.data.accountsReceivable.length, 0);
    assert.match(context.messages.at(-1), /已還原/);
});
