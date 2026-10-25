import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const directory = dirname(fileURLToPath(import.meta.url));
const script = readFileSync(join(directory, 'salesBundles.js'), 'utf8');

function createContext({ saveData = () => true } = {}) {
    let sequence = 0;
    const context = {
        data: {
            products: [
                { id: 'A', prodName: '產品 A', productType: 'standard' },
                { id: 'B', prodName: '產品 B', productType: 'standard' },
                {
                    id: 'C',
                    prodName: '促銷組合 C',
                    productType: 'sales-bundle',
                    unit: '組',
                    salesPrice: 50,
                    components: [{ productId: 'A', quantity: 2 }, { productId: 'B', quantity: 1 }]
                }
            ],
            suppliers: [],
            inventory: [
                { id: 'A-1', productId: 'A', productName: '產品 A', quantity: 2, availableQuantity: 2, averageCost: 10, totalCost: 20, warehouse: '總倉' },
                { id: 'A-2', productId: 'A', productName: '產品 A', quantity: 8, availableQuantity: 8, averageCost: 12, totalCost: 96, warehouse: '台北倉' },
                { id: 'B-1', productId: 'B', productName: '產品 B', quantity: 5, availableQuantity: 5, averageCost: 20, totalCost: 100, warehouse: '總倉' }
            ],
            inventoryMovements: [],
            inventoryBatches: [],
            companyProfile: { receivingWarehouses: ['總倉', '台北倉'] }
        },
        generateOutboundId: () => `movement-${++sequence}`,
        generateInventoryId: () => 'C-1',
        createInventoryBatch: batch => {
            const created = { id: `batch-${context.data.inventoryBatches.length + 1}`, ...batch };
            context.data.inventoryBatches.push(created);
            return created;
        },
        getFinanceToday: () => '2026-10-23',
        saveData,
        renderInventory() {},
        renderPosProducts() {},
        showToast() {},
        closeModal() {},
        escapeFinanceHtml: value => String(value)
    };
    vm.createContext(context);
    vm.runInContext(script, context);
    return context;
}

test('sales bundle availability is limited by the scarcest required component', () => {
    const context = createContext();
    assert.equal(vm.runInContext("getSalesBundleAvailability(data.products[2])", context), 5);
});

test('component allocation is repeatable per bundle and reserves shared stock for other sale lines', () => {
    const context = createContext();
    const result = vm.runInContext(`(() => {
        const lines = [
            { productId: 'A', inventoryId: 'A-1', quantity: 1, bundleMode: '' },
            { productId: 'C', quantity: 2, unitPrice: 50, bundleMode: 'components' }
        ];
        return { success: prepareSalesBundleLineAllocations(lines), lines };
    })()`, context);
    assert.equal(result.success, true);
    assert.equal(result.lines[1].bundleUnits.length, 2);
    assert.equal(result.lines[1].bundleUnits[0].allocations[0].inventoryId, 'A-1');
    assert.equal(result.lines[1].costUnit, 43);
});

test('bundle allocation rejects overlapping sales that exceed shared component stock without mutating inventory', () => {
    const context = createContext();
    const result = vm.runInContext(`(() => {
        const lines = [
            { productId: 'A', inventoryId: 'A-1', quantity: 2, bundleMode: '' },
            { productId: 'A', inventoryId: 'A-2', quantity: 7, bundleMode: '' },
            { productId: 'C', quantity: 1, unitPrice: 50, bundleMode: 'components' }
        ];
        return prepareSalesBundleLineAllocations(lines);
    })()`, context);
    assert.equal(result, false);
    assert.equal(context.data.inventory.find(item => item.id === 'A-1').availableQuantity, 2);
    assert.equal(context.data.inventoryMovements.length, 0);
});

test('component sales deduct component stock and retain a uniquely identified parent return snapshot', () => {
    const context = createContext();
    vm.runInContext(`(() => {
        const line = { productId: 'C', quantity: 1, unitPrice: 50, bundleMode: 'components' };
        prepareSalesBundleLineAllocations([line]);
        applySalesBundleConsumption(line, { orderId: 'AR-1', date: '2026-10-23', channel: 'POS收銀', note: 'POS AR-1' });
    })()`, context);
    const parent = context.data.inventoryMovements.find(move => move.type === 'outbound');
    const components = context.data.inventoryMovements.filter(move => move.type === 'bundle-component-outbound');
    assert.equal(context.data.inventory.find(item => item.id === 'A-1').availableQuantity, 0);
    assert.equal(context.data.inventory.find(item => item.id === 'A-2').availableQuantity, 8);
    assert.equal(context.data.inventory.find(item => item.id === 'B-1').availableQuantity, 4);
    assert.equal(parent.bundleMode, 'components');
    assert.equal(parent.bundleUnits.length, 1);
    assert.equal(parent.costUnit, 40);
    assert.equal(new Set(context.data.inventoryMovements.map(move => move.id)).size, context.data.inventoryMovements.length);
    assert.equal(components.length, 2);
    assert.ok(components.every(move => move.parentOutboundId === parent.id));
});

test('assembly consumes components, adds the assembled product and restores all changes when saving fails', () => {
    const context = createContext();
    vm.runInContext("assembleSalesBundle('C', 2, '台北倉')", context);
    const assembled = context.data.inventory.find(item => item.productId === 'C');
    assert.equal(assembled.quantity, 2);
    assert.equal(assembled.averageCost, 42);
    assert.equal(context.data.inventory.find(item => item.id === 'A-1').quantity, 0);
    assert.equal(context.data.inventory.find(item => item.id === 'A-2').quantity, 6);
    assert.equal(context.data.inventory.find(item => item.id === 'B-1').quantity, 3);
    assert.equal(context.data.inventoryMovements.filter(move => move.type === 'bundle-assembly-consume').length, 4);
    assert.equal(context.data.inventoryMovements.filter(move => move.type === 'bundle-assembly-inbound').length, 1);

    const failedContext = createContext({ saveData: () => false });
    assert.throws(() => vm.runInContext("assembleSalesBundle('C', 1, '總倉')", failedContext), /儲存失敗/);
    assert.equal(failedContext.data.inventory.length, 3);
    assert.equal(failedContext.data.inventoryMovements.length, 0);
    assert.equal(failedContext.data.inventoryBatches.length, 0);

    const insufficientContext = createContext();
    assert.throws(() => vm.runInContext("assembleSalesBundle('C', 6, '總倉')", insufficientContext), /組成品可用庫存不足/);
    assert.equal(insufficientContext.data.inventory[0].quantity, 2);
    assert.equal(insufficientContext.data.inventoryMovements.length, 0);
});
