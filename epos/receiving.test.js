import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const directory = dirname(fileURLToPath(import.meta.url));
const inventoryScript = readFileSync(join(directory, 'inventory.js'), 'utf8');
const receivingScript = readFileSync(join(directory, 'receiving.js'), 'utf8');
const settingsScript = readFileSync(join(directory, 'settings.js'), 'utf8');

function createContext(overrides = {}) {
    const messages = [];
    const context = {
        data: {
            companyProfile: { receivingWarehouses: ['總倉', '台北倉'] },
            products: [{ id: 'product-1', reorderPoint: 0 }],
            orders: [{
                id: 'order-1',
                status: 'arrived',
                arrivalDate: '2026-03-02',
                inventoryTransferred: true,
                inventoryTransferAt: '2026-03-02T12:00:00.000Z',
                items: [
                    { productId: 'product-1', productName: '產品一', quantity: 10, receivedQuantity: 8, acceptedQuantity: 6, rejectedQuantity: 2 }
                ]
            }],
            inventory: [{
                id: 'inventory-1',
                productId: 'product-1',
                productName: '產品一',
                spec: '',
                supplierId: 'supplier-1',
                warehouse: '台北倉',
                quantity: 6,
                availableQuantity: 6,
                totalCost: 60,
                averageCost: 10,
                status: '正常',
                relatedOrders: ['order-1', 'order-2']
            }],
            inventoryBatches: [
                { id: 'batch-1', inventoryId: 'inventory-1', orderId: 'order-1', receiptId: 'receipt-1', quantity: 2 },
                { id: 'batch-2', inventoryId: 'inventory-1', orderId: 'order-1', receiptId: 'receipt-2', quantity: 4 }
            ],
            inventoryMovements: [
                { id: 'move-1', inventoryId: 'inventory-1', orderId: 'order-1', receiptId: 'receipt-1', type: 'order-inbound', quantity: 2, unitCost: 10, totalCost: 20, createdAt: '2026-03-01T10:00:00.000Z' },
                { id: 'move-2', inventoryId: 'inventory-1', orderId: 'order-1', receiptId: 'receipt-2', type: 'order-inbound', quantity: 4, unitCost: 10, totalCost: 40, createdAt: '2026-03-02T10:00:00.000Z' }
            ],
            goodsReceipts: [
                {
                    id: 'receipt-1',
                    orderId: 'order-1',
                    receiptDate: '2026-03-01',
                    createdAt: '2026-03-01T10:00:00.000Z',
                    items: [{ itemIndex: 0, receivedQuantity: 3, acceptedQuantity: 2, rejectedQuantity: 1 }]
                },
                {
                    id: 'receipt-2',
                    orderId: 'order-1',
                    receiptDate: '2026-03-02',
                    createdAt: '2026-03-02T10:00:00.000Z',
                    items: [{ itemIndex: 0, receivedQuantity: 5, acceptedQuantity: 4, rejectedQuantity: 1 }]
                }
            ],
            accountsPayable: []
        },
        document: { getElementById: () => null },
        confirm: () => true,
        saveData: () => true,
        getFinanceToday: () => '2026-10-21',
        getInventoryStatus: item => Number(item.availableQuantity) > 0 ? '正常' : '缺貨',
        renderReceiving() {},
        renderOrders() {},
        renderInventory() {},
        renderFinance() {},
        showToast: message => messages.push(message),
        messages,
        ...overrides
    };
    vm.createContext(context);
    vm.runInContext(settingsScript, context);
    vm.runInContext(inventoryScript, context);
    vm.runInContext(receivingScript, context);
    return context;
}

function evaluate(context, expression) {
    return JSON.parse(JSON.stringify(vm.runInContext(expression, context)));
}

test('undoing a receipt reverses only its stock, batches, movements, and received quantities', () => {
    const context = createContext();

    vm.runInContext("undoGoodsReceipt('receipt-1')", context);

    const state = evaluate(context, `({
        inventory: data.inventory,
        batches: data.inventoryBatches,
        movements: data.inventoryMovements,
        receipts: data.goodsReceipts,
        order: data.orders[0]
    })`);
    assert.equal(state.inventory[0].quantity, 4);
    assert.equal(state.inventory[0].availableQuantity, 4);
    assert.equal(state.inventory[0].totalCost, 40);
    assert.deepEqual(state.inventory[0].relatedOrders, ['order-1', 'order-2']);
    assert.deepEqual(state.batches.map(batch => batch.receiptId), ['receipt-2']);
    assert.deepEqual(state.movements.map(move => move.receiptId), ['receipt-2']);
    assert.deepEqual(state.receipts.map(receipt => receipt.id), ['receipt-2']);
    assert.equal(state.order.items[0].receivedQuantity, 5);
    assert.equal(state.order.items[0].acceptedQuantity, 4);
    assert.equal(state.order.items[0].rejectedQuantity, 1);
    assert.equal(state.order.status, 'partially_received');
    assert.equal(state.order.inventoryTransferred, false);
    assert.equal(state.order.arrivalDate, '');
});

test('undoing a rejected-only receipt keeps a fully accepted order arrived', () => {
    const context = createContext();
    context.data.orders[0].items[0] = {
        productId: 'product-1',
        productName: '產品一',
        quantity: 5,
        receivedQuantity: 7,
        acceptedQuantity: 5,
        rejectedQuantity: 2
    };
    context.data.inventory[0].quantity = 5;
    context.data.inventory[0].availableQuantity = 5;
    context.data.inventory[0].totalCost = 50;
    context.data.inventory[0].averageCost = 10;
    context.data.inventoryBatches = [
        { id: 'batch-1', inventoryId: 'inventory-1', orderId: 'order-1', receiptId: 'receipt-1', quantity: 5 }
    ];
    context.data.inventoryMovements = [
        { id: 'move-1', inventoryId: 'inventory-1', orderId: 'order-1', receiptId: 'receipt-1', type: 'order-inbound', quantity: 5, unitCost: 10, totalCost: 50, createdAt: '2026-03-01T10:00:00.000Z' }
    ];
    context.data.goodsReceipts[0].items[0] = { itemIndex: 0, receivedQuantity: 5, acceptedQuantity: 5, rejectedQuantity: 0 };
    context.data.goodsReceipts[1].items[0] = { itemIndex: 0, receivedQuantity: 2, acceptedQuantity: 0, rejectedQuantity: 2 };

    vm.runInContext("undoGoodsReceipt('receipt-2')", context);

    const order = evaluate(context, 'data.orders[0]');
    assert.equal(order.items[0].receivedQuantity, 5);
    assert.equal(order.items[0].acceptedQuantity, 5);
    assert.equal(order.items[0].rejectedQuantity, 0);
    assert.equal(order.status, 'arrived');
    assert.equal(order.inventoryTransferred, true);
    assert.equal(order.arrivalDate, '2026-03-01');
    assert.equal(order.inventoryTransferAt, '2026-03-01T10:00:00.000Z');
});

test('undoing the final receipt returns the order to receivable state and permits a new receipt', () => {
    const context = createContext();
    context.data.orders[0].items[0] = {
        productId: 'product-1',
        productName: '產品一',
        quantity: 2,
        receivedQuantity: 2,
        acceptedQuantity: 2,
        rejectedQuantity: 0
    };
    context.data.inventory[0].quantity = 2;
    context.data.inventory[0].availableQuantity = 2;
    context.data.inventory[0].totalCost = 20;
    context.data.inventory[0].averageCost = 10;
    context.data.inventoryBatches = [
        { id: 'batch-1', inventoryId: 'inventory-1', orderId: 'order-1', receiptId: 'receipt-1', quantity: 2 }
    ];
    context.data.inventoryMovements = [
        { id: 'move-1', inventoryId: 'inventory-1', orderId: 'order-1', receiptId: 'receipt-1', type: 'order-inbound', quantity: 2, unitCost: 10, totalCost: 20, createdAt: '2026-03-01T10:00:00.000Z' }
    ];
    context.data.goodsReceipts = [context.data.goodsReceipts[0]];
    context.data.goodsReceipts[0].items[0] = { itemIndex: 0, receivedQuantity: 2, acceptedQuantity: 2, rejectedQuantity: 0 };

    vm.runInContext("undoGoodsReceipt('receipt-1')", context);

    assert.equal(context.data.orders[0].status, 'ordered');
    assert.equal(context.data.orders[0].inventoryTransferred, false);
    assert.equal(context.data.inventory.length, 0);
    assert.equal(context.data.goodsReceipts.length, 0);
    assert.match(context.messages.at(-1), /可在此重新收貨/);

    context.transferOrderToInventory = (orderId, receiptContext) => {
        context.data.inventory.push({
            id: 'inventory-new',
            productId: 'product-1',
            warehouse: receiptContext.warehouse,
            quantity: receiptContext.quantities[0],
            availableQuantity: receiptContext.quantities[0],
            averageCost: 10,
            totalCost: receiptContext.quantities[0] * 10,
            relatedOrders: [orderId]
        });
        context.data.inventoryMovements.push({
            id: 'move-new',
            inventoryId: 'inventory-new',
            orderId,
            receiptId: receiptContext.receiptId,
            type: 'order-inbound',
            quantity: receiptContext.quantities[0],
            unitCost: 10,
            totalCost: receiptContext.quantities[0] * 10,
            createdAt: '2026-10-21T10:00:00.000Z'
        });
        context.data.inventoryBatches.push({
            id: 'batch-new',
            inventoryId: 'inventory-new',
            orderId,
            receiptId: receiptContext.receiptId,
            quantity: receiptContext.quantities[0]
        });
        return true;
    };

    vm.runInContext(`receiveOrderItems('order-1', [{ itemIndex: 0, receivedQuantity: 2, rejectedQuantity: 0 }], {
        receiptDate: '2026-10-21',
        warehouse: '台北倉',
        note: ''
    })`, context);

    assert.equal(context.data.goodsReceipts.length, 1);
    assert.equal(context.data.orders[0].status, 'arrived');
    assert.equal(context.data.orders[0].inventoryTransferred, true);
    assert.equal(context.data.inventory[0].quantity, 2);
});

test('undo is blocked for shipped stock or active payables without changing data', () => {
    const outboundContext = createContext();
    outboundContext.data.inventoryMovements.push({
        id: 'outbound-1',
        inventoryId: 'inventory-1',
        type: 'outbound',
        quantity: 1,
        createdAt: '2026-03-03T10:00:00.000Z'
    });
    vm.runInContext("undoGoodsReceipt('receipt-1')", outboundContext);
    assert.equal(outboundContext.data.goodsReceipts.length, 2);
    assert.match(outboundContext.messages.at(-1), /已有出貨/);

    const payableContext = createContext();
    payableContext.data.accountsPayable.push({ sourceOrderId: 'order-1', status: 'unpaid' });
    vm.runInContext("undoGoodsReceipt('receipt-1')", payableContext);
    assert.equal(payableContext.data.goodsReceipts.length, 2);
    assert.match(payableContext.messages.at(-1), /已建立應付/);

    const voidPayableContext = createContext();
    voidPayableContext.data.accountsPayable.push({ sourceOrderId: 'order-1', status: 'void' });
    vm.runInContext("undoGoodsReceipt('receipt-1')", voidPayableContext);
    assert.equal(voidPayableContext.data.goodsReceipts.length, 1);
    assert.match(voidPayableContext.messages.at(-1), /已撤銷/);
});

test('save failure restores the receipt, order, inventory, batches, and movements exactly', () => {
    const context = createContext({ saveData: () => false });
    const before = evaluate(context, `({
        inventory: data.inventory,
        batches: data.inventoryBatches,
        movements: data.inventoryMovements,
        receipts: data.goodsReceipts,
        order: data.orders[0]
    })`);

    vm.runInContext("undoGoodsReceipt('receipt-1')", context);

    const after = evaluate(context, `({
        inventory: data.inventory,
        batches: data.inventoryBatches,
        movements: data.inventoryMovements,
        receipts: data.goodsReceipts,
        order: data.orders[0]
    })`);
    assert.deepEqual(after, before);
    assert.match(context.messages.at(-1), /原資料已復原/);
});

test('receipt undo requires a source order and confirms repair when an inventory link is missing', () => {
    const missingOrderContext = createContext();
    missingOrderContext.data.orders = [];
    vm.runInContext("undoGoodsReceipt('receipt-1')", missingOrderContext);
    assert.equal(missingOrderContext.data.goodsReceipts.length, 2);
    assert.match(missingOrderContext.messages.at(-1), /找不到收貨單的來源採購單/);

    const confirmations = [];
    const missingMovementContext = createContext({
        confirm: message => {
            confirmations.push(message);
            return true;
        }
    });
    missingMovementContext.data.inventoryMovements = missingMovementContext.data.inventoryMovements.filter(move => move.receiptId !== 'receipt-1');
    vm.runInContext("undoGoodsReceipt('receipt-1')", missingMovementContext);
    assert.equal(missingMovementContext.data.goodsReceipts.length, 1);
    assert.equal(missingMovementContext.data.orders[0].items[0].receivedQuantity, 5);
    assert.equal(missingMovementContext.data.inventory[0].quantity, 4);
    assert.match(confirmations[0], /庫存.*批次已不存在/);
    assert.match(missingMovementContext.messages.at(-1), /已撤銷/);
});

test('failed receipt creation restores the full previous order and inventory state', () => {
    const context = createContext({ saveData: () => false });
    context.data.goodsReceipts = [context.data.goodsReceipts[0]];
    const before = evaluate(context, `({
        inventory: data.inventory,
        batches: data.inventoryBatches,
        movements: data.inventoryMovements,
        receipts: data.goodsReceipts,
        order: data.orders[0]
    })`);
    context.transferOrderToInventory = (orderId, receiptContext) => {
        context.data.inventory[0].quantity += receiptContext.quantities[0];
        context.data.inventory[0].availableQuantity += receiptContext.quantities[0];
        context.data.inventory[0].totalCost += receiptContext.quantities[0] * 10;
        context.data.inventoryMovements.push({
            id: 'move-temporary',
            inventoryId: 'inventory-1',
            orderId,
            receiptId: receiptContext.receiptId,
            quantity: receiptContext.quantities[0],
            type: 'order-inbound'
        });
        context.data.inventoryBatches.push({
            id: 'batch-temporary',
            orderId,
            receiptId: receiptContext.receiptId,
            inventoryId: 'inventory-1',
            quantity: receiptContext.quantities[0]
        });
        return true;
    };

    vm.runInContext(`receiveOrderItems('order-1', [{ itemIndex: 0, receivedQuantity: 1, rejectedQuantity: 0 }], {
        receiptDate: '2026-10-21',
        warehouse: '台北倉',
        note: ''
    })`, context);

    const after = evaluate(context, `({
        inventory: data.inventory,
        batches: data.inventoryBatches,
        movements: data.inventoryMovements,
        receipts: data.goodsReceipts,
        order: data.orders[0]
    })`);
    assert.deepEqual(after, before);
    assert.match(context.messages.at(-1), /儲存空間可能已滿/);
});

test('order-level transfer undo directs receipt-based orders to receipt reversal', () => {
    const context = createContext();
    vm.runInContext("undoTransferOrderToInventory('order-1')", context);

    assert.match(context.messages.at(-1), /逐筆撤銷收貨/);
    assert.equal(context.data.inventory.length, 1);
    assert.equal(context.data.goodsReceipts.length, 2);
});

test('receiving form renders the configured warehouse dropdown with the first option selected', () => {
    const containers = new Map([
        ['receivingOrderList', { innerHTML: '' }],
        ['receivingReceiptHistory', { innerHTML: '' }]
    ]);
    const context = createContext({
        document: { getElementById: id => containers.get(id) || null }
    });

    vm.runInContext('renderReceiving()', context);

    const html = containers.get('receivingOrderList').innerHTML;
    assert.match(html, /<select name="warehouse" required/);
    assert.match(html, /<option value="總倉" selected>總倉<\/option>/);
    assert.match(html, /<option value="台北倉">台北倉<\/option>/);
    assert.doesNotMatch(html, /<input name="warehouse"/);
});

test('receipt history remains visible when every order is fully received', () => {
    const containers = new Map([
        ['receivingOrderList', { innerHTML: '' }],
        ['receivingReceiptHistory', { innerHTML: '' }]
    ]);
    const context = createContext({
        document: { getElementById: id => containers.get(id) || null }
    });
    context.data.orders[0].items[0].receivedQuantity = 10;
    context.data.orders[0].items[0].acceptedQuantity = 10;
    context.data.orders[0].status = 'arrived';

    vm.runInContext('renderReceiving()', context);

    assert.match(containers.get('receivingOrderList').innerHTML, /目前沒有待收貨的採購單/);
    assert.match(containers.get('receivingReceiptHistory').innerHTML, /receipt-2/);
    assert.match(containers.get('receivingReceiptHistory').innerHTML, /order-1/);
});

test('receiving rejects warehouses not configured in settings', () => {
    const context = createContext();

    vm.runInContext(`receiveOrderItems('order-1', [{ itemIndex: 0, receivedQuantity: 1, rejectedQuantity: 0 }], {
        receiptDate: '2026-10-21',
        warehouse: '不存在的倉',
        note: ''
    })`, context);

    assert.equal(context.data.goodsReceipts.length, 2);
    assert.equal(context.data.inventory[0].quantity, 6);
    assert.match(context.messages.at(-1), /從「設定」的入庫倉別清單選擇/);
});

test('legacy order transfer uses the configured default receiving warehouse', () => {
    const context = createContext();
    context.receiveOrderItems = (orderId, lines, details) => {
        context.receivedDetails = details;
        return true;
    };

    vm.runInContext("transferOrderToInventory('order-1')", context);

    assert.equal(context.receivedDetails.warehouse, '總倉');
});

test('a receipt left after its inventory was manually deleted can be repaired and received again', () => {
    const confirmations = [];
    const context = createContext({
        confirm: message => {
            confirmations.push(message);
            return true;
        }
    });
    context.data.inventory = [];
    context.data.inventoryBatches = [];
    context.data.inventoryMovements = [];

    vm.runInContext("undoGoodsReceipt('receipt-1')", context);

    assert.equal(context.data.goodsReceipts.length, 1);
    assert.equal(context.data.orders[0].items[0].receivedQuantity, 5);
    assert.equal(context.data.orders[0].items[0].acceptedQuantity, 4);
    assert.equal(context.data.orders[0].status, 'partially_received');
    assert.equal(context.data.orders[0].inventoryTransferred, false);
    assert.match(confirmations[0], /庫存.*批次已不存在/);
    assert.match(context.messages.at(-1), /可在此重新收貨/);

    context.transferOrderToInventory = (orderId, receiptContext) => {
        const quantity = receiptContext.quantities[0];
        context.data.inventory.push({
            id: 'inventory-received-again',
            productId: 'product-1',
            warehouse: receiptContext.warehouse,
            quantity,
            availableQuantity: quantity,
            totalCost: quantity * 10,
            averageCost: 10,
            relatedOrders: [orderId]
        });
        context.data.inventoryBatches.push({
            id: 'batch-received-again',
            inventoryId: 'inventory-received-again',
            orderId,
            receiptId: receiptContext.receiptId,
            quantity
        });
        context.data.inventoryMovements.push({
            id: 'move-received-again',
            inventoryId: 'inventory-received-again',
            orderId,
            receiptId: receiptContext.receiptId,
            quantity,
            type: 'order-inbound',
            unitCost: 10,
            totalCost: quantity * 10,
            createdAt: '2026-10-21T10:00:00.000Z'
        });
        return true;
    };

    vm.runInContext(`receiveOrderItems('order-1', [{ itemIndex: 0, receivedQuantity: 6, rejectedQuantity: 0 }], {
        receiptDate: '2026-10-21',
        warehouse: '台北倉',
        note: ''
    })`, context);

    assert.equal(context.data.goodsReceipts.length, 2);
    assert.equal(context.data.orders[0].items[0].receivedQuantity, 11);
    assert.equal(context.data.orders[0].items[0].acceptedQuantity, 10);
    assert.equal(context.data.orders[0].items[0].rejectedQuantity, 1);
    assert.equal(context.data.orders[0].status, 'arrived');
    assert.equal(context.data.orders[0].inventoryTransferred, true);
    assert.equal(context.data.inventory[0].quantity, 6);
});

test('manual inventory deletion is blocked while a goods receipt links to it', () => {
    const context = createContext();

    vm.runInContext("openDeleteInventoryConfirmModal('inventory-1')", context);
    assert.match(context.messages.at(-1), /請先到「收貨驗收」撤銷/);

    vm.runInContext("deleteInventoryItem('inventory-1')", context);

    assert.equal(context.data.inventory.length, 1);
    assert.equal(context.data.inventoryBatches.length, 2);
    assert.equal(context.data.inventoryMovements.length, 2);
    assert.match(context.messages.at(-1), /請先到「收貨驗收」撤銷/);
});
