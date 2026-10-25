import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const directory = dirname(fileURLToPath(import.meta.url));
const reportsScript = readFileSync(join(directory, 'reports.js'), 'utf8');

function createReportsContext() {
    const dateValues = {
        reportStartDate: '2026-04-01',
        reportEndDate: '2026-04-30',
        reportGrouping: 'month'
    };
    const exportedSheets = [];
    const elements = new Map();
    const context = {
        data: {
            inventory: [],
            inventoryMovements: [],
            products: [],
            orders: [],
            accountsReceivable: [],
            accountsPayable: []
        },
        document: {
            getElementById: id => {
                if (!elements.has(id)) {
                    elements.set(id, { value: dateValues[id] || '', innerHTML: '', textContent: '' });
                }
                return elements.get(id);
            }
        },
        getFinanceToday: () => '2026-10-21',
        getTodayStr: () => '2026-10-21',
        calculateOrderTotal: order => Math.max(0,
            order.items.reduce((sum, item) =>
                sum + Number(item.customPrice || 0) * Number(item.quantity || 1) + Number(item.customShipping || 0), 0)
            - Number(order.discount || 0)),
        showToast() {},
        XLSX: {
            utils: {
                book_new: () => ({ SheetNames: [], Sheets: {} }),
                aoa_to_sheet: rows => ({ rows }),
                book_append_sheet: (workbook, sheet, name) => {
                    workbook.SheetNames.push(name);
                    workbook.Sheets[name] = sheet;
                    exportedSheets.push({ name, rows: sheet.rows });
                }
            },
            writeFile: () => {}
        },
        exportedSheets,
        elements
    };
    vm.createContext(context);
    vm.runInContext(reportsScript, context);
    return context;
}

function evaluate(context, expression) {
    return JSON.parse(JSON.stringify(vm.runInContext(expression, context)));
}

test('sales analysis groups gross profit by customer and product', () => {
    const context = createReportsContext();
    context.data.accountsReceivable = [
        {
            id: 'sale-1',
            counterpartyName: '客戶甲',
            discount: 30,
            lines: [
                { inventoryId: 'inv-1', productId: 'p1', amount: 200 },
                { inventoryId: 'inv-3', productId: 'p1', amount: 100 }
            ]
        },
        {
            id: 'sale-2',
            counterpartyName: '客戶乙',
            lines: [{ inventoryId: 'inv-2', productId: 'p1', amount: 100 }]
        }
    ];
    context.data.inventoryMovements = [
        { type: 'outbound', accountsDocumentId: 'sale-1', inventoryId: 'inv-1', productId: 'p1', productName: '產品一', quantity: 2, salesPrice: 105, costUnit: 60, sourceDate: '2026-04-10' },
        { type: 'outbound', accountsDocumentId: 'sale-1', inventoryId: 'inv-3', productId: 'p1', productName: '產品一', quantity: 1, salesPrice: 105, costUnit: 60, sourceDate: '2026-04-10' },
        { type: 'outbound', accountsDocumentId: 'sale-2', inventoryId: 'inv-2', productId: 'p1', productName: '產品一', quantity: 1, salesPrice: 100, costUnit: 60, sourceDate: '2026-04-12' }
    ];

    const groups = evaluate(context, `getReportCustomerProfit(getReportSalesValues(getReportMoves()))`);
    const productGroups = evaluate(context, `getReportProductProfit(getReportSalesValues(getReportMoves()))`);

    assert.deepEqual(groups.map(({ name, quantity, revenue, cost, profit }) => ({ name, quantity, revenue, cost, profit })), [
        { name: '客戶甲', quantity: 3, revenue: 270, cost: 180, profit: 90 },
        { name: '客戶乙', quantity: 1, revenue: 100, cost: 60, profit: 40 }
    ]);
    assert.deepEqual(productGroups.map(({ name, quantity, revenue, cost, profit }) => ({ name, quantity, revenue, cost, profit })), [
        { name: '產品一', quantity: 4, revenue: 370, cost: 240, profit: 130 }
    ]);
});

test('customer returns reverse sales quantity, revenue, and inventory cost in profit reports', () => {
    const context = createReportsContext();
    context.data.inventory = [{ id: 'inv-1', productId: 'p1', spec: '規格', averageCost: 10 }];
    context.data.accountsReceivable = [{
        id: 'sale-1',
        counterpartyName: '客戶甲',
        lines: [{ inventoryId: 'inv-1', productId: 'p1', amount: 100 }]
    }];
    context.data.inventoryMovements = [
        {
            id: 'out-1', type: 'outbound', accountsDocumentId: 'sale-1', inventoryId: 'inv-1',
            productId: 'p1', productName: '產品一', quantity: 2, salesPrice: 50, costUnit: 10, sourceDate: '2026-04-10'
        },
        {
            id: 'return-move-1', type: 'customer-return', returnId: 'return-1', inventoryId: 'inv-1',
            productId: 'p1', productName: '產品一', quantity: 1, unitCost: 50, costUnit: 10,
            totalCost: 50, sourceDate: '2026-04-15'
        }
    ];
    context.data.returnTransactions = [{ id: 'return-1', customerName: '客戶甲' }];

    const groups = evaluate(context, 'getReportCustomerProfit(getReportSalesValues(getReportMoves()))');

    assert.deepEqual(groups.map(({ name, quantity, revenue, cost, profit }) => ({ name, quantity, revenue, cost, profit })), [
        { name: '客戶甲', quantity: 1, revenue: 50, cost: 10, profit: 40 }
    ]);
});

test('inventory and aging summaries group balances into management categories', () => {
    const context = createReportsContext();
    context.data.products = [
        { id: 'p1', category: '食品' },
        { id: 'p2', category: '飲料' }
    ];
    context.data.inventory = [
        { productId: 'p1', warehouse: '台北倉', quantity: 5, availableQuantity: 4, totalCost: 500 },
        { productId: 'p2', warehouse: '台北倉', quantity: 3, availableQuantity: 3, totalCost: 180 },
        { productId: 'p1', warehouse: '台中倉', quantity: 2, availableQuantity: 2, averageCost: 100 }
    ];
    context.data.accountsReceivable = [
        { counterpartyName: '甲客戶', dueDate: '2026-10-20', totalAmount: 100, paidAmount: 20 },
        { counterpartyName: '甲客戶', dueDate: '2026-10-25', totalAmount: 40, paidAmount: 0 },
        { counterpartyName: '乙客戶', dueDate: '2026-08-20', totalAmount: 75, paidAmount: 0 },
        { counterpartyName: '乙客戶', dueDate: '2026-10-01', totalAmount: 99, paidAmount: 99 },
        { counterpartyName: '作廢單', dueDate: '2026-10-01', totalAmount: 100, paidAmount: 0, status: 'void' },
        { counterpartyName: '未設定', totalAmount: 25, paidAmount: 0 }
    ];

    const warehouseGroups = evaluate(context, `getReportInventoryGroups('warehouse')`);
    const categoryGroups = evaluate(context, `getReportInventoryGroups('category')`);
    const agingGroups = evaluate(context, `getReportAgingGroups(data.accountsReceivable, '2026-10-21')`);

    assert.deepEqual(warehouseGroups.map(({ name, quantity, availableQuantity, amount }) => ({ name, quantity, availableQuantity, amount })), [
        { name: '台北倉', quantity: 8, availableQuantity: 7, amount: 680 },
        { name: '台中倉', quantity: 2, availableQuantity: 2, amount: 200 }
    ]);
    assert.deepEqual(categoryGroups.map(({ name, quantity, amount }) => ({ name, quantity, amount })), [
        { name: '食品', quantity: 7, amount: 700 },
        { name: '飲料', quantity: 3, amount: 180 }
    ]);
    assert.deepEqual(agingGroups.map(({ name, documentCount, buckets, total }) => ({ name, documentCount, buckets, total })), [
        {
            name: '甲客戶',
            documentCount: 2,
            buckets: {
                '未到期': 40,
                '逾期 1-30 天': 80,
                '逾期 31-60 天': 0,
                '逾期 61-90 天': 0,
                '逾期 90 天以上': 0,
                '未設定到期日': 0,
                '退貨折讓': 0
            },
            total: 120
        },
        {
            name: '乙客戶',
            documentCount: 1,
            buckets: {
                '未到期': 0,
                '逾期 1-30 天': 0,
                '逾期 31-60 天': 0,
                '逾期 61-90 天': 75,
                '逾期 90 天以上': 0,
                '未設定到期日': 0,
                '退貨折讓': 0
            },
            total: 75
        },
        {
            name: '未設定',
            documentCount: 1,
            buckets: {
                '未到期': 0,
                '逾期 1-30 天': 0,
                '逾期 31-60 天': 0,
                '逾期 61-90 天': 0,
                '逾期 90 天以上': 0,
                '未設定到期日': 25,
                '退貨折讓': 0
            },
            total: 25
        }
    ]);
});

test('supplier return credits reduce procurement payable balances and show separately in aging', () => {
    const context = createReportsContext();
    context.data.orders = [{
        id: 'order-1',
        date: '2026-04-12',
        supplierName: '供應商甲',
        items: [{ customPrice: 100, quantity: 1 }]
    }];
    context.data.accountsPayable = [
        { sourceOrderId: 'order-1', counterpartyName: '供應商甲', totalAmount: 100, paidAmount: 0, dueDate: '2026-10-30' },
        { sourceOrderId: 'order-1', counterpartyName: '供應商甲', returnKind: 'supplier-credit', totalAmount: -30, paidAmount: 0 }
    ];

    const procurement = evaluate(context, 'getReportProcurementGroups()');
    const aging = evaluate(context, "getReportAgingGroups(data.accountsPayable, '2026-10-21')");

    assert.equal(procurement[0].payableAmount, 70);
    assert.equal(procurement[0].balance, 70);
    assert.equal(aging[0].buckets['退貨折讓'], -30);
    assert.equal(aging[0].total, 70);
});

test('procurement summary applies the date range and exports all analytical sheets', () => {
    const context = createReportsContext();
    context.data.orders = [
        {
            id: 'order-1',
            date: '2026-04-12',
            supplierName: '供應商甲',
            discount: 10,
            items: [
                { customPrice: 100, quantity: 2, customShipping: 10 },
                { customPrice: 50, quantity: 1 }
            ]
        },
        {
            id: 'order-outside-range',
            date: '2026-03-31',
            supplierName: '供應商乙',
            items: [{ customPrice: 200, quantity: 1 }]
        }
    ];
    context.data.accountsPayable = [
        { sourceOrderId: 'order-1', totalAmount: 200, paidAmount: 80 },
        { sourceOrderId: 'order-1', totalAmount: 20, paidAmount: 20 },
        { sourceOrderId: 'order-1', totalAmount: 100, paidAmount: 0, status: 'void' }
    ];

    const groups = evaluate(context, 'getReportProcurementGroups()');
    vm.runInContext('exportAnalyticalReports()', context);

    assert.deepEqual(groups, [{
        name: '供應商甲',
        period: '2026-04',
        orderCount: 1,
        quantity: 3,
        purchaseAmount: 250,
        payableAmount: 220,
        paidAmount: 100,
        balance: 120
    }]);
    assert.deepEqual(context.exportedSheets.map(sheet => sheet.name), [
        '商品毛利',
        '客戶毛利',
        '期間毛利',
        '庫存倉別',
        '庫存分類',
        '應收帳齡',
        '應付帳齡',
        '採購統計'
    ]);
});

test('report dashboard renders each added analysis section', () => {
    const context = createReportsContext();
    context.data.accountsReceivable = [{ id: 'sale-1', counterpartyName: '客戶甲' }];
    context.data.inventory = [{
        id: 'inv-1',
        productId: 'p1',
        productName: '產品一',
        warehouse: '台北倉',
        quantity: 3,
        availableQuantity: 2,
        totalCost: 150
    }];
    context.data.products = [{ id: 'p1', category: '食品' }];
    context.data.inventoryMovements = [{
        type: 'outbound',
        accountsDocumentId: 'sale-1',
        inventoryId: 'inv-1',
        productId: 'p1',
        productName: '產品一',
        quantity: 1,
        salesPrice: 100,
        costUnit: 50,
        sourceDate: '2026-04-10'
    }];

    vm.runInContext('renderReports()', context);

    for (const id of [
        'customerProfitReport',
        'inventoryWarehouseReport',
        'inventoryCategoryReport',
        'receivableAgingReport',
        'payableAgingReport',
        'procurementReport'
    ]) {
        assert.notEqual(context.elements.get(id).innerHTML, '');
    }
    assert.match(context.elements.get('customerProfitReport').innerHTML, /客戶甲/);
    assert.match(context.elements.get('inventoryWarehouseReport').innerHTML, /台北倉/);
});
