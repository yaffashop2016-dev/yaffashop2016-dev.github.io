import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const directory = dirname(fileURLToPath(import.meta.url));
const financeScript = readFileSync(join(directory, 'finance.js'), 'utf8');
const inventoryScript = readFileSync(join(directory, 'inventory.js'), 'utf8');
const returnsScript = readFileSync(join(directory, 'returns.js'), 'utf8');
const receivingScript = readFileSync(join(directory, 'receiving.js'), 'utf8');
const settingsScript = readFileSync(join(directory, 'settings.js'), 'utf8');
const salesBundlesScript = readFileSync(join(directory, 'salesBundles.js'), 'utf8');

function createContext({ inventory, movements, receivables = [], payables = [] }) {
    const elements = new Map(Object.entries({
        customerReturnOutbound: { value: 'outbound-1' },
        customerReturnQuantity: { value: '1' },
        customerReturnName: { value: '' },
        customerReturnReason: { value: '測試退貨' },
        exchangeInventory: { value: '' },
        exchangeQuantity: { value: '' },
        exchangeUnitPrice: { value: '' },
        supplierReturnInventory: { value: 'inventory-1' },
        supplierReturnQuantity: { value: '1' },
        supplierReturnAmount: { value: '', dataset: { manual: 'false' } },
        supplierReturnReason: { value: '測試供應商退貨' },
        financeDocumentType: { value: '' },
        financeDocumentId: { value: '' },
        financeDocumentModalTitle: { textContent: '' },
        financeDocumentCounterparty: { value: '' },
        financeDocumentDate: { value: '' },
        financeDocumentDueDate: { value: '' },
        financeDocumentInvoiceType: { value: '' },
        financeDocumentInvoiceNumber: { value: '' },
        financeDocumentSubtotal: { value: '' },
        financeDocumentShipping: { value: '' },
        financeDocumentTaxAmount: { value: '' },
        financeDocumentDiscount: { value: '' },
        financeDocumentEditTotal: { textContent: '' },
        financeDocumentModal: { classList: { add() {} } }
    }));
    const context = {
        data: {
            companyProfile: { receivingWarehouses: ['總倉'] },
            inventory,
            inventoryMovements: movements,
            inventoryBatches: [],
            goodsReceipts: [],
            accountsReceivable: receivables,
            accountsPayable: payables,
            returnTransactions: [],
            products: [],
            suppliers: [],
            orders: []
        },
        document: { getElementById: id => elements.get(id) || null },
        elements,
        confirm: () => true,
        saveData: () => true,
        closeModal() {},
        renderInventory() {},
        renderShipping() {},
        renderFinance() {},
        renderOrders() {},
        showToast() {},
        getRocYearMonth: () => '11510'
    };
    vm.createContext(context);
    vm.runInContext(salesBundlesScript, context);
    vm.runInContext(financeScript, context);
    vm.runInContext(settingsScript, context);
    vm.runInContext(inventoryScript, context);
    vm.runInContext(receivingScript, context);
    vm.runInContext(returnsScript, context);
    context.isKitProduct = product => product?.productType === 'kit';
    vm.runInContext('renderInventory = () => {}', context);
    return context;
}

test('customer return restores stock and creates a payable only for collected value', () => {
    const context = createContext({
        inventory: [{
            id: 'inventory-1', productId: 'product-1', productName: '商品一', spec: '規格',
            supplierId: 'supplier-1', supplierName: '供應商一', warehouse: '總倉', unit: 'pcs',
            quantity: 0, availableQuantity: 0, averageCost: 10, lastCost: 10, totalCost: 0, status: '缺貨'
        }],
        movements: [{
            id: 'outbound-1', type: 'outbound', inventoryId: 'inventory-1', productId: 'product-1',
            productName: '商品一', spec: '規格', quantity: 2, salesPrice: 50, unitCost: 50,
            costUnit: 10, totalCost: 100, accountsDocumentId: 'AR-1', createdAt: '2026-10-20'
        }],
        receivables: [{
            id: 'AR-1', type: 'receivable', counterpartyName: '客戶一', totalAmount: 100,
            subtotal: 100, paidAmount: 100, adjustmentAmount: 0, payments: [],
            lines: [{ inventoryId: 'inventory-1', productId: 'product-1', spec: '規格', quantity: 2, unitPrice: 50, totalAmount: 100 }]
        }]
    });

    vm.runInContext("saveCustomerReturn({ preventDefault() {} })", context);

    assert.equal(context.data.inventory[0].quantity, 1);
    assert.equal(context.data.inventory[0].totalCost, 10);
    assert.equal(context.data.accountsReceivable[0].totalAmount, 100);
    assert.equal(context.data.accountsPayable[0].returnKind, 'customer-refund');
    assert.equal(context.data.accountsPayable[0].totalAmount, 50);
    assert.equal(context.data.inventoryMovements[1].type, 'customer-return');
    assert.equal(context.data.returnTransactions[0].refundAmount, 50);
});

test('returning a component-consumed promotional bundle restores its original component inventory, not virtual C stock', () => {
    const context = createContext({
        inventory: [
            { id: 'A-stock', productId: 'A', productName: '產品 A', spec: 'A規格', warehouse: '總倉', unit: 'pcs', quantity: 0, availableQuantity: 0, averageCost: 10, totalCost: 0, status: '缺貨' },
            { id: 'B-stock', productId: 'B', productName: '產品 B', spec: 'B規格', warehouse: '台北倉', unit: 'pcs', quantity: 0, availableQuantity: 0, averageCost: 20, totalCost: 0, status: '缺貨' }
        ],
        movements: [{
            id: 'outbound-bundle',
            type: 'outbound',
            inventoryId: '',
            productId: 'bundle-C',
            productName: '促銷組合 C',
            spec: 'A+B',
            quantity: 2,
            salesPrice: 50,
            costUnit: 40,
            bundleMode: 'components',
            bundleUnits: [
                { allocations: [
                    { inventoryId: 'A-stock', productId: 'A', productName: '產品 A', spec: 'A規格', warehouse: '總倉', unit: 'pcs', quantity: 2, costUnit: 10 },
                    { inventoryId: 'B-stock', productId: 'B', productName: '產品 B', spec: 'B規格', warehouse: '台北倉', unit: 'pcs', quantity: 1, costUnit: 20 }
                ] },
                { allocations: [
                    { inventoryId: 'A-stock', productId: 'A', productName: '產品 A', spec: 'A規格', warehouse: '總倉', unit: 'pcs', quantity: 2, costUnit: 10 },
                    { inventoryId: 'B-stock', productId: 'B', productName: '產品 B', spec: 'B規格', warehouse: '台北倉', unit: 'pcs', quantity: 1, costUnit: 20 }
                ] }
            ]
        }]
    });
    context.data.products = [{ id: 'bundle-C', prodName: '促銷組合 C', productType: 'sales-bundle' }];
    context.elements.get('customerReturnOutbound').value = 'outbound-bundle';

    vm.runInContext("saveCustomerReturn({ preventDefault() {} })", context);

    assert.equal(context.data.inventory.find(item => item.id === 'A-stock').quantity, 2);
    assert.equal(context.data.inventory.find(item => item.id === 'B-stock').quantity, 1);
    assert.equal(context.data.inventory.some(item => item.productId === 'bundle-C'), false);
    const parentReturn = context.data.inventoryMovements.find(move => move.type === 'customer-return');
    assert.deepEqual(parentReturn.bundleUnitIndexes, [0]);
    assert.equal(context.data.inventoryMovements.filter(move => move.type === 'bundle-component-return').length, 2);
    assert.equal(context.data.inventoryMovements.filter(move => move.type === 'customer-return').reduce((sum, move) => sum + move.quantity, 0), 1);
});

test('supplier return removes stock and records a negative payable credit memo', () => {
    const context = createContext({
        inventory: [{
            id: 'inventory-1', productId: 'product-1', productName: '商品一', spec: '規格',
            supplierId: 'supplier-1', supplierName: '供應商一', warehouse: '總倉', unit: 'pcs',
            quantity: 5, availableQuantity: 5, averageCost: 10, lastCost: 10, totalCost: 50,
            status: '正常', relatedOrders: ['PO-1']
        }],
        movements: [],
        payables: [{ id: 'AP-1', sourceOrderId: 'PO-1', totalAmount: 100, paidAmount: 0 }]
    });
    context.elements.get('supplierReturnQuantity').value = '2';

    vm.runInContext("saveSupplierReturn({ preventDefault() {} })", context);

    assert.equal(context.data.inventory[0].quantity, 3);
    assert.equal(context.data.inventory[0].totalCost, 30);
    assert.equal(context.data.accountsPayable[0].returnKind, 'supplier-credit');
    assert.equal(context.data.accountsPayable[0].totalAmount, -20);
    assert.equal(context.data.accountsPayable[0].sourceOrderId, 'PO-1');
    assert.equal(context.data.inventoryMovements[0].type, 'supplier-return');
    assert.equal(context.data.inventoryMovements[0].quantity, -2);
    assert.equal(vm.runInContext('getFinanceBalance(data.accountsPayable[0])', context), -20);
    assert.equal(vm.runInContext('getFinanceStatus(data.accountsPayable[0])', context), '退貨折讓');
});

test('customer return offsets an unpaid receivable before creating a refund', () => {
    const context = createContext({
        inventory: [{
            id: 'inventory-1', productId: 'product-1', productName: '商品一', spec: '規格',
            quantity: 0, availableQuantity: 0, averageCost: 10, totalCost: 0
        }],
        movements: [{
            id: 'outbound-1', type: 'outbound', inventoryId: 'inventory-1', productId: 'product-1',
            productName: '商品一', spec: '規格', quantity: 2, unitCost: 50, salesPrice: 50,
            costUnit: 10, accountsDocumentId: 'AR-1'
        }],
        receivables: [{
            id: 'AR-1', type: 'receivable', counterpartyName: '客戶一', totalAmount: 100,
            subtotal: 100, paidAmount: 0, adjustmentAmount: 0, payments: [],
            lines: [{ inventoryId: 'inventory-1', productId: 'product-1', spec: '規格', quantity: 2, unitPrice: 50, totalAmount: 100 }]
        }]
    });

    vm.runInContext("saveCustomerReturn({ preventDefault() {} })", context);

    assert.equal(context.data.accountsReceivable[0].totalAmount, 50);
    assert.equal(vm.runInContext('getFinanceBalance(data.accountsReceivable[0])', context), 50);
    assert.equal(context.data.accountsPayable.length, 0);
    assert.equal(context.data.returnTransactions[0].refundAmount, 0);
});

test('exchange creates a receivable for the price difference after offsetting the return', () => {
    const context = createContext({
        inventory: [
            {
                id: 'inventory-1', productId: 'product-1', productName: '商品一', spec: '規格',
                quantity: 0, availableQuantity: 0, averageCost: 10, totalCost: 0
            },
            {
                id: 'inventory-2', productId: 'product-2', productName: '商品二', spec: '規格二',
                quantity: 3, availableQuantity: 3, averageCost: 20, totalCost: 60
            }
        ],
        movements: [{
            id: 'outbound-1', type: 'outbound', inventoryId: 'inventory-1', productId: 'product-1',
            productName: '商品一', spec: '規格', quantity: 1, unitCost: 50, salesPrice: 50,
            costUnit: 10, accountsDocumentId: 'AR-1'
        }],
        receivables: [{
            id: 'AR-1', type: 'receivable', counterpartyName: '客戶一', totalAmount: 50,
            subtotal: 50, paidAmount: 50, adjustmentAmount: 0, payments: [],
            lines: [{ inventoryId: 'inventory-1', productId: 'product-1', spec: '規格', quantity: 1, unitPrice: 50, totalAmount: 50 }]
        }]
    });
    context.elements.get('customerReturnQuantity').value = '1';
    context.elements.get('exchangeInventory').value = 'inventory-2';
    context.elements.get('exchangeQuantity').value = '2';
    context.elements.get('exchangeUnitPrice').value = '35';

    vm.runInContext("saveCustomerReturn({ preventDefault() {} })", context);

    assert.equal(context.data.inventory[0].quantity, 1);
    assert.equal(context.data.inventory[1].quantity, 1);
    const originalReceivable = context.data.accountsReceivable.find(item => item.id === 'AR-1');
    assert.equal(originalReceivable.totalAmount, 50);
    assert.equal(originalReceivable.returnAdjustments[0].amount, 0);
    assert.equal(context.data.accountsReceivable[0].returnKind, 'exchange-charge');
    assert.equal(context.data.accountsReceivable[0].totalAmount, 20);
    assert.equal(context.data.accountsReceivable[0].lines[0].quantity, 1);
    assert.equal(context.data.accountsReceivable[0].lines[0].unitPrice, 20);
    assert.equal(context.data.returnTransactions[0].returnAmount, 50);
    assert.equal(context.data.returnTransactions[0].extraChargeAmount, 20);
});

test('supplier credit offsets the purchase payable status', () => {
    const context = createContext({
        inventory: [{
            id: 'inventory-1', productId: 'product-1', productName: '商品一', spec: '規格',
            quantity: 5, availableQuantity: 5, averageCost: 10, totalCost: 50,
            status: '正常', relatedOrders: ['PO-1']
        }],
        movements: [],
        payables: [{ id: 'AP-1', sourceOrderId: 'PO-1', totalAmount: 50, paidAmount: 0 }]
    });
    context.elements.get('supplierReturnQuantity').value = '5';

    vm.runInContext("saveSupplierReturn({ preventDefault() {} })", context);

    assert.equal(vm.runInContext("getPurchaseOrderPaymentStatus({ id: 'PO-1' })", context), 'paid');
});

test('supplier credit memo amount can differ from inventory valuation cost', () => {
    const context = createContext({
        inventory: [{
            id: 'inventory-1', productId: 'product-1', productName: '商品一', spec: '規格',
            quantity: 5, availableQuantity: 5, averageCost: 10, totalCost: 50,
            status: '正常', relatedOrders: ['PO-1']
        }],
        movements: [],
        payables: []
    });
    context.elements.get('supplierReturnQuantity').value = '2';
    context.elements.get('supplierReturnAmount').value = '13';

    vm.runInContext("saveSupplierReturn({ preventDefault() {} })", context);

    assert.equal(context.data.accountsPayable[0].totalAmount, -13);
    assert.equal(context.data.inventory[0].quantity, 3);
    assert.equal(context.data.inventory[0].totalCost, 30);
    assert.equal(context.data.inventoryMovements[0].totalCost, -20);
});

test('supplier credit memo edits keep negative accounting and update the return history', () => {
    const context = createContext({
        inventory: [{
            id: 'inventory-1', productId: 'product-1', productName: '商品一', spec: '規格',
            quantity: 5, availableQuantity: 5, averageCost: 10, totalCost: 50,
            status: '正常', relatedOrders: []
        }],
        movements: [],
        payables: []
    });
    vm.runInContext("saveSupplierReturn({ preventDefault() {} })", context);
    const credit = context.data.accountsPayable[0];

    vm.runInContext(`openFinanceDocumentEdit('payable', '${credit.id}')`, context);
    context.elements.get('financeDocumentSubtotal').value = '30';
    context.elements.get('financeDocumentShipping').value = '0';
    context.elements.get('financeDocumentTaxAmount').value = '5';
    context.elements.get('financeDocumentDiscount').value = '0';
    context.elements.get('financeDocumentDate').value = '2026-10-23';
    vm.runInContext("saveFinanceDocumentEdit({ preventDefault() {} })", context);

    assert.equal(credit.subtotal, -30);
    assert.equal(credit.taxAmount, -5);
    assert.equal(credit.totalAmount, -35);
    assert.equal(credit.lines[0].totalAmount, -35);
    assert.equal(context.data.returnTransactions[0].creditAmount, 35);
    assert.equal(context.data.inventory[0].quantity, 4);
});

test('deleting an unused supplier credit reverses the return and restores receivable stock', () => {
    const context = createContext({
        inventory: [{
            id: 'inventory-1', productId: 'product-1', productName: '商品一', spec: '規格',
            quantity: 5, availableQuantity: 5, averageCost: 10, totalCost: 50,
            status: '正常', relatedOrders: []
        }],
        movements: [],
        payables: []
    });
    vm.runInContext("saveSupplierReturn({ preventDefault() {} })", context);
    const creditId = context.data.accountsPayable[0].id;
    assert.equal(context.data.inventory[0].quantity, 4);

    vm.runInContext(`deleteFinanceDocument('payable', '${creditId}')`, context);

    assert.equal(context.data.accountsPayable.length, 0);
    assert.equal(context.data.inventory[0].quantity, 5);
    assert.equal(context.data.inventory[0].availableQuantity, 5);
    assert.equal(context.data.inventory[0].totalCost, 50);
    assert.equal(context.data.inventoryMovements.length, 0);
    assert.equal(context.data.returnTransactions.length, 0);
});

test('deleting a supplier return credit restores the source order received quantity', () => {
    const context = createContext({
        inventory: [{
            id: 'inventory-1', productId: 'product-1', productName: '商品一', spec: '規格',
            supplierId: 'supplier-1', supplierName: '供應商一', warehouse: '總倉', unit: 'pcs',
            quantity: 5, availableQuantity: 5, averageCost: 10, totalCost: 50,
            status: '正常', relatedOrders: ['PO-1']
        }],
        movements: [],
        payables: []
    });
    context.data.orders = [{
        id: 'PO-1', status: 'arrived', inventoryTransferred: true,
        items: [{ productId: 'product-1', spec: '規格', quantity: 5, receivedQuantity: 5, acceptedQuantity: 5, rejectedQuantity: 0 }]
    }];
    vm.runInContext("saveSupplierReturn({ preventDefault() {} })", context);
    const creditId = context.data.accountsPayable[0].id;

    vm.runInContext(`deleteFinanceDocument('payable', '${creditId}')`, context);

    assert.equal(context.data.orders[0].items[0].receivedQuantity, 5);
    assert.equal(context.data.orders[0].items[0].acceptedQuantity, 5);
    assert.equal(context.data.orders[0].status, 'arrived');
    assert.equal(context.data.inventory[0].quantity, 5);
    assert.equal(context.data.accountsPayable.length, 0);
});

test('supplier return defaults to original tax-inclusive payable amount', () => {
    const context = createContext({
        inventory: [{
            id: 'inventory-1', productId: 'product-1', productName: '商品一', spec: '規格',
            quantity: 1, availableQuantity: 1, averageCost: 95, totalCost: 95,
            status: '正常', relatedOrders: ['PO-1'], supplierId: 'supplier-1', supplierName: '供應商一'
        }],
        movements: [],
        payables: [{
            id: 'AP-1', sourceOrderId: 'PO-1', supplierId: 'supplier-1', counterpartyName: '供應商一',
            subtotal: 95, taxAmount: 5, totalAmount: 100, paidAmount: 0,
            lines: [{
                productId: 'product-1', productName: '商品一', spec: '規格', quantity: 1,
                unitPrice: 95, taxStatus: '不含稅', amount: 95, taxAmount: 5, totalAmount: 100
            }]
        }]
    });

    vm.runInContext("saveSupplierReturn({ preventDefault() {} })", context);

    assert.equal(context.data.accountsPayable[0].totalAmount, -100);
    assert.equal(context.data.accountsPayable[0].subtotal, -95);
    assert.equal(context.data.accountsPayable[0].taxAmount, -5);
    assert.equal(context.data.accountsPayable[0].lines[0].unitPrice, 100);
    assert.equal(context.data.accountsPayable[0].lines[0].amount, -95);
    assert.equal(context.data.accountsPayable[0].lines[0].taxAmount, -5);
    assert.equal(context.data.inventory[0].totalCost, 0);
    assert.equal(context.data.inventoryMovements[0].totalCost, -95);
    assert.equal(context.data.returnTransactions[0].creditAmount, 100);
});

test('supplier return derives tax from legacy payable line tax status', () => {
    const context = createContext({
        inventory: [{
            id: 'inventory-1', productId: 'product-1', productName: '商品一', spec: '規格',
            quantity: 1, availableQuantity: 1, averageCost: 95, totalCost: 95,
            status: '正常', relatedOrders: ['PO-1'], supplierId: 'supplier-1', supplierName: '供應商一'
        }],
        movements: [],
        payables: [{
            id: 'AP-1', sourceOrderId: 'PO-1', supplierId: 'supplier-1', counterpartyName: '供應商一',
            totalAmount: 100, paidAmount: 0,
            lines: [{ productId: 'product-1', spec: '規格', quantity: 1, unitPrice: 95, taxStatus: '不含稅' }]
        }]
    });

    vm.runInContext("saveSupplierReturn({ preventDefault() {} })", context);

    assert.equal(context.data.accountsPayable[0].totalAmount, -100);
    assert.equal(context.data.accountsPayable[0].taxAmount, -5);
});

test('supplier return releases purchase quantity so the returned item can be received again', () => {
    const context = createContext({
        inventory: [{
            id: 'inventory-1', productId: 'product-1', productName: '商品一', spec: '規格',
            supplierId: 'supplier-1', supplierName: '供應商一', warehouse: '總倉', unit: 'pcs',
            quantity: 5, availableQuantity: 5, averageCost: 95, lastCost: 95, totalCost: 475,
            status: '正常', relatedOrders: ['PO-1']
        }],
        movements: [],
        payables: [{
            id: 'AP-1', sourceOrderId: 'PO-1', supplierId: 'supplier-1', counterpartyName: '供應商一',
            totalAmount: 500, paidAmount: 0,
            lines: [{ productId: 'product-1', productName: '商品一', spec: '規格', quantity: 5, unitPrice: 95, taxStatus: '不含稅', amount: 475, taxAmount: 25, totalAmount: 500 }]
        }]
    });
    const messages = [];
    context.showToast = message => messages.push(message);
    context.data.products = [{ id: 'product-1', prodName: '商品一', spec: '規格', unit: 'pcs', supplierId: 'supplier-1' }];
    context.data.suppliers = [{ id: 'supplier-1', name: '供應商一' }];
    context.data.orders = [{
        id: 'PO-1', status: 'arrived', inventoryTransferred: true, supplierId: 'supplier-1', supplierName: '供應商一',
        items: [{
            productId: 'product-1', productName: '商品一', spec: '規格', supplierId: 'supplier-1', supplierName: '供應商一',
            quantity: 5, receivedQuantity: 5, acceptedQuantity: 5, rejectedQuantity: 0,
            customPrice: 95, customShipping: 0, taxStatus: '不含稅', unit: 'pcs'
        }]
    }];
    context.elements.get('supplierReturnQuantity').value = '1';

    vm.runInContext("saveSupplierReturn({ preventDefault() {} })", context);

    assert.equal(context.data.orders[0].items[0].receivedQuantity, 4);
    assert.equal(context.data.orders[0].items[0].acceptedQuantity, 4);
    assert.equal(context.data.orders[0].status, 'partially_received');
    assert.equal(vm.runInContext('getOrderLineRemainingQuantity(data.orders[0].items[0])', context), 1);
    messages.length = 0;

    vm.runInContext(`receiveOrderItems('PO-1', [{ itemIndex: 0, receivedQuantity: 1, rejectedQuantity: 0 }], {
        receiptDate: '2026-10-23',
        warehouse: '總倉',
        note: '供應商補貨'
    })`, context);

    assert.match(messages.at(-1), /收貨單 .* 已建立/);
    assert.equal(context.data.orders[0].items[0].receivedQuantity, 5);
    assert.equal(context.data.orders[0].items[0].acceptedQuantity, 5);
    assert.equal(context.data.orders[0].status, 'arrived');
    assert.equal(context.data.inventory[0].quantity, 5);
    assert.equal(context.data.goodsReceipts.length, 1);
    const creditId = context.data.accountsPayable.find(item => item.returnKind === 'supplier-credit').id;

    vm.runInContext(`deleteFinanceDocument('payable', '${creditId}')`, context);

    assert.equal(context.data.accountsPayable.some(item => item.id === creditId), true);
    assert.equal(context.data.inventory[0].quantity, 5);
    assert.match(messages.at(-1), /退貨後此庫存已有其他異動/);
});

test('failed persistence restores all supplier return inventory and payable changes', () => {
    const context = createContext({
        inventory: [{
            id: 'inventory-1', productId: 'product-1', productName: '商品一', spec: '規格',
            quantity: 5, availableQuantity: 5, averageCost: 10, totalCost: 50,
            status: '正常', relatedOrders: ['PO-1']
        }],
        movements: [],
        payables: []
    });
    context.saveData = () => false;

    vm.runInContext("saveSupplierReturn({ preventDefault() {} })", context);

    assert.equal(context.data.inventory[0].quantity, 5);
    assert.equal(context.data.inventory[0].totalCost, 50);
    assert.equal(context.data.accountsPayable.length, 0);
    assert.equal(context.data.inventoryMovements.length, 0);
    assert.equal(context.data.returnTransactions.length, 0);
});

test('customer return rejects quantities greater than the unreturned shipment', () => {
    const context = createContext({
        inventory: [{
            id: 'inventory-1', productId: 'product-1', productName: '商品一', spec: '規格',
            quantity: 0, availableQuantity: 0, averageCost: 10, totalCost: 0
        }],
        movements: [{
            id: 'outbound-1', type: 'outbound', inventoryId: 'inventory-1', productId: 'product-1',
            productName: '商品一', spec: '規格', quantity: 1, salesPrice: 50, costUnit: 10
        }]
    });
    context.elements.get('customerReturnQuantity').value = '2';

    vm.runInContext("saveCustomerReturn({ preventDefault() {} })", context);

    assert.equal(context.data.inventory[0].quantity, 0);
    assert.equal(context.data.inventoryMovements.length, 1);
    assert.equal(context.data.returnTransactions.length, 0);
});