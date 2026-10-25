import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const directory = dirname(fileURLToPath(import.meta.url));
const inventoryScript = readFileSync(join(directory, 'inventory.js'), 'utf8');

test('splitting ten one-dollar units into one package preserves total inventory cost', () => {
    const context = {
        data: {
            products: [{ id: 'product-1', salesPrice: 20 }],
            inventory: [{
                id: 'inventory-source',
                productId: 'product-1',
                productName: '產品一',
                spec: '單件',
                supplierId: 'supplier-1',
                supplierName: '供應商一',
                warehouse: '總倉',
                quantity: 100,
                availableQuantity: 100,
                averageCost: 1,
                lastCost: 1,
                totalCost: 100,
                status: '正常',
                relatedOrders: []
            }],
            inventoryBatches: [{
                id: 'batch-source',
                inventoryId: 'inventory-source',
                quantity: 100,
                availableQuantity: 100,
                cost: 1,
                receivedDate: '2026-10-01'
            }],
            inventoryMovements: []
        },
        inventoryModalCurrentId: '',
        confirm: () => true,
        generateProductID: () => 'package-product-1',
        getRocYearMonth: () => '11510',
        saveData() {},
        closeModal() {},
        renderInventory() {},
        showToast() {}
    };

    vm.createContext(context);
    vm.runInContext(inventoryScript, context);
    vm.runInContext('renderInventory = () => {}', context);
    vm.runInContext(`applyInventorySplit({
        preventDefault() {},
        target: {
            inventoryId: { value: 'inventory-source' },
            splitFromQty: { value: '10' },
            splitToQty: { value: '1' },
            splitNewSpec: { value: '手打規格不同' },
            splitNote: { value: '' }
        }
    })`, context);

    const splitInventory = context.data.inventory.find(item => item.id !== 'inventory-source');
    const packageProduct = context.data.products.find(product => product.id === splitInventory.productId);
    assert.notEqual(splitInventory.productId, 'product-1');
    assert.equal(packageProduct.packageBaseProductId, 'product-1');
    assert.equal(packageProduct.packageUnitsPerPackage, 10);
    assert.equal(splitInventory.quantity, 1);
    assert.equal(splitInventory.lastCost, 10);
    assert.equal(splitInventory.averageCost, 10);
    assert.equal(splitInventory.salesPrice, 200);
    assert.equal(splitInventory.totalCost, 10);
    assert.equal(context.data.inventory[0].quantity, 90);
    assert.equal(context.data.inventoryBatches.find(batch => batch.id === 'batch-source').quantity, 90);
    assert.equal(context.data.inventoryBatches.find(batch => batch.id === 'batch-source').availableQuantity, 90);
    assert.equal(context.data.inventory.reduce((sum, item) => sum + item.totalCost, 0), 100);
    const packageBatch = context.data.inventoryBatches.find(batch => batch.inventoryId === splitInventory.id);
    assert.equal(packageBatch.cost, 10);
    assert.equal(packageBatch.quantity, 1);
    assert.equal(context.data.inventoryMovements[0].unitCost, 10);
});

test('splitting into an existing package merges stock instead of creating a duplicate', () => {
    const context = {
        data: {
            inventory: [
                {
                    id: 'inventory-source',
                    productId: 'product-1',
                    productName: '產品一',
                    spec: '單件',
                    supplierId: 'supplier-1',
                    supplierName: '供應商一',
                    warehouse: '總倉',
                    quantity: 100,
                    availableQuantity: 100,
                    averageCost: 1,
                    lastCost: 1,
                    totalCost: 100,
                    status: '正常',
                    relatedOrders: []
                },
                {
                    id: 'inventory-package',
                    productId: 'package-product-1',
                    productName: '產品一',
                    spec: '10件/包',
                    supplierId: 'supplier-1',
                    supplierName: '供應商一',
                    warehouse: '總倉',
                    quantity: 2,
                    availableQuantity: 2,
                    salesPrice: 180,
                    averageCost: 8,
                    lastCost: 8,
                    totalCost: 16,
                    status: '正常',
                    relatedOrders: []
                }
            ],
            products: [
                { id: 'product-1', salesPrice: 20 },
                {
                    id: 'package-product-1', packageBaseProductId: 'product-1',
                    packageUnitsPerPackage: 10, salesPrice: 200
                }
            ],
            inventoryBatches: [],
            inventoryMovements: []
        },
        inventoryModalCurrentId: '',
        confirm: () => true,
        generateProductID: () => 'package-product-1',
        getRocYearMonth: () => '11510',
        saveData() {},
        closeModal() {},
        renderInventory() {},
        showToast() {}
    };

    vm.createContext(context);
    vm.runInContext(inventoryScript, context);
    vm.runInContext('renderInventory = () => {}', context);
    vm.runInContext(`applyInventorySplit({
        preventDefault() {},
        target: {
            inventoryId: { value: 'inventory-source' },
            splitFromQty: { value: '10' },
            splitToQty: { value: '1' },
            splitNewSpec: { value: '10件/包' },
            splitNote: { value: '' }
        }
    })`, context);

    const packageInventory = context.data.inventory.find(item => item.id === 'inventory-package');
    assert.equal(context.data.inventory.length, 2);
    assert.equal(packageInventory.quantity, 3);
    assert.equal(packageInventory.availableQuantity, 3);
    assert.equal(packageInventory.totalCost, 26);
    assert.equal(packageInventory.averageCost, 26 / 3);
    assert.equal(packageInventory.lastCost, 10);
    assert.equal(packageInventory.salesPrice, 200);
    assert.notEqual(packageInventory.productId, 'product-1');
    assert.equal(context.data.products.filter(product => product.packageBaseProductId === 'product-1').length, 1);
    assert.equal(context.data.inventoryBatches[0].inventoryId, 'inventory-package');
    assert.equal(context.data.inventoryBatches[0].quantity, 1);
    assert.equal(context.data.inventoryBatches[0].cost, 10);
    assert.equal(context.data.inventoryMovements[0].batchNo, 'inventory-package');
    assert.equal(context.data.inventory.reduce((sum, item) => sum + item.totalCost, 0), 116);
});

test('splitting an unpriced product keeps the package sales price unset', () => {
    const context = {
        data: {
            products: [{ id: 'product-1', salesPrice: '' }],
            inventory: [{
                id: 'inventory-source', productId: 'product-1', productName: '產品一', spec: '單件',
                supplierId: 'supplier-1', supplierName: '供應商一', warehouse: '總倉',
                quantity: 10, availableQuantity: 10, averageCost: 5, lastCost: 5, totalCost: 50,
                status: '正常', relatedOrders: []
            }],
            inventoryBatches: [],
            suppliers: [],
            inventoryMovements: []
        },
        inventoryModalCurrentId: '',
        confirm: () => true,
        generateProductID: () => 'package-product-1',
        getRocYearMonth: () => '11510',
        saveData() {},
        closeModal() {},
        renderInventory() {},
        showToast() {}
    };

    vm.createContext(context);
    vm.runInContext(inventoryScript, context);
    vm.runInContext('renderInventory = () => {}', context);
    vm.runInContext(`applyInventorySplit({
        preventDefault() {},
        target: {
            inventoryId: { value: 'inventory-source' },
            splitFromQty: { value: '10' },
            splitToQty: { value: '1' },
            splitNewSpec: { value: '10件/包' },
            splitNote: { value: '' }
        }
    })`, context);

    const splitInventory = context.data.inventory.find(item => item.id !== 'inventory-source');
    assert.equal(splitInventory.salesPrice, '');
});

test('splitting a linked package back to singles reuses the base product id', () => {
    const context = {
        data: {
            products: [
                { id: 'product-1', prodName: '產品一', sku: 'SKU-1', unit: 'pcs', spec: '單件', salesPrice: 20 },
                { id: 'package-product-1', prodName: '產品一', sku: 'SKU-1-PK10', unit: '包', spec: '10件/包', salesPrice: 200, packageBaseProductId: 'product-1', packageUnitsPerPackage: 10 }
            ],
            inventory: [{
                id: 'inventory-package', productId: 'package-product-1', sku: 'SKU-1-PK10',
                productName: '產品一', spec: '10件/包', supplierId: 'supplier-1', supplierName: '供應商一',
                warehouse: '總倉', unit: '包', quantity: 1, availableQuantity: 1, salesPrice: 200,
                averageCost: 100, lastCost: 100, totalCost: 100, status: '正常', relatedOrders: []
            }],
            suppliers: [],
            inventoryBatches: [],
            inventoryMovements: []
        },
        inventoryModalCurrentId: '',
        confirm: () => true,
        generateProductID: () => 'unused-package-id',
        getRocYearMonth: () => '11510',
        saveData() {},
        closeModal() {},
        renderInventory() {},
        showToast() {}
    };

    vm.createContext(context);
    vm.runInContext(inventoryScript, context);
    vm.runInContext('renderInventory = () => {}', context);
    vm.runInContext(`applyInventorySplit({
        preventDefault() {},
        target: {
            inventoryId: { value: 'inventory-package' },
            splitFromQty: { value: '1' },
            splitToQty: { value: '10' },
            splitNewSpec: { value: '不採用的手動規格' },
            splitNote: { value: '' }
        }
    })`, context);

    const singleInventory = context.data.inventory.find(item => item.id !== 'inventory-package');
    assert.equal(singleInventory.productId, 'product-1');
    assert.equal(singleInventory.spec, '單件');
    assert.equal(singleInventory.unit, 'pcs');
    assert.equal(singleInventory.salesPrice, 20);
    assert.equal(singleInventory.quantity, 10);
    assert.equal(context.data.products.length, 2);
});

test('splitting ten singles into one package and back returns to base ID, spec, and price', () => {
    const context = {
        data: {
            products: [{
                id: 'product-1', prodName: '產品一', sku: 'SKU-1',
                unit: 'pcs', spec: '原始單品規格', salesPrice: 20
            }],
            inventory: [{
                id: 'inventory-base', productId: 'product-1', productName: '產品一',
                spec: '原始單品規格', supplierId: 'supplier-1', supplierName: '供應商一',
                warehouse: '總倉', unit: 'pcs', quantity: 20, availableQuantity: 20,
                salesPrice: 20, averageCost: 5, lastCost: 5, totalCost: 100, relatedOrders: []
            }],
            suppliers: [{ id: 'supplier-1', name: '供應商一' }],
            inventoryBatches: [],
            inventoryMovements: []
        },
        inventoryModalCurrentId: '',
        confirm: () => true,
        generateProductID: () => 'package-10',
        getRocYearMonth: () => '11510',
        saveData() {},
        closeModal() {},
        renderInventory() {},
        showToast() {}
    };
    vm.createContext(context);
    vm.runInContext(inventoryScript, context);
    vm.runInContext('renderInventory = () => {}', context);
    const split = (inventoryId, fromQty, toQty, spec) => vm.runInContext(`applyInventorySplit({
        preventDefault() {},
        target: {
            inventoryId: { value: '${inventoryId}' },
            splitFromQty: { value: '${fromQty}' },
            splitToQty: { value: '${toQty}' },
            splitNewSpec: { value: '${spec}' },
            splitNote: { value: '' }
        }
    })`, context);

    split('inventory-base', 10, 1, '10 入');
    const packageInventory = context.data.inventory.find(item => item.productId === 'package-10');
    assert.ok(packageInventory);
    assert.equal(context.data.products.find(product => product.id === 'package-10').packageUnitsPerPackage, 10);

    split(packageInventory.id, 1, 10, 'different returned spec');
    const baseInventory = context.data.inventory.find(item => item.productId === 'product-1');
    assert.equal(baseInventory.id, 'inventory-base');
    assert.equal(baseInventory.quantity, 20);
    assert.equal(baseInventory.productId, 'product-1');
    assert.equal(baseInventory.spec, '原始單品規格');
    assert.equal(baseInventory.unit, 'pcs');
    assert.equal(baseInventory.salesPrice, 20);
    assert.equal(context.data.products.length, 2);
});

test('ten-unit packages convert to two five-unit packages, reusing an existing 5-pack', () => {
    const context = {
        data: {
            products: [
                { id: 'base-1', prodName: '商品', unit: 'pcs', spec: '單件', salesPrice: 20 },
                { id: 'pack-10', prodName: '商品', unit: '包', spec: '10入', salesPrice: 200, packageBaseProductId: 'base-1', packageUnitsPerPackage: 10 },
                { id: 'pack-5', prodName: '商品', unit: '包', spec: '5 入包', salesPrice: 110, packageBaseProductId: 'base-1', packageUnitsPerPackage: 5 }
            ],
            inventory: [{
                id: 'inventory-10', productId: 'pack-10', productName: '商品', spec: '10入',
                unit: '包', supplierId: 'supplier-1', warehouse: '總倉', quantity: 1,
                availableQuantity: 1, salesPrice: 200, averageCost: 100, lastCost: 100,
                totalCost: 100, relatedOrders: []
            }],
            suppliers: [{ id: 'supplier-1', name: '供應商一' }],
            inventoryBatches: [],
            inventoryMovements: []
        },
        inventoryModalCurrentId: '',
        confirm: () => true,
        generateProductID: () => 'must-not-create',
        getRocYearMonth: () => '11510',
        saveData() {},
        closeModal() {},
        renderInventory() {},
        showToast() {}
    };
    vm.createContext(context);
    vm.runInContext(inventoryScript, context);
    vm.runInContext('renderInventory = () => {}', context);
    vm.runInContext(`applyInventorySplit({
        preventDefault() {},
        target: {
            inventoryId: { value: 'inventory-10' },
            splitFromQty: { value: '1' },
            splitToQty: { value: '2' },
            splitNewSpec: { value: 'other text' },
            splitNote: { value: '' }
        }
    })`, context);

    const fivePack = context.data.inventory.find(item => item.productId === 'pack-5');
    assert.ok(fivePack);
    assert.equal(fivePack.quantity, 2);
    assert.equal(fivePack.spec, '5 入包');
    assert.equal(fivePack.salesPrice, 110);
    assert.equal(context.data.products.length, 3);
    assert.equal(context.data.inventoryMovements[0].productId, 'pack-5');
    assert.equal(context.data.inventoryMovements[0].quantity, 2);
});

test('ten-unit packages create a five-pack product when that conversion does not exist', () => {
    const context = {
        data: {
            products: [
                { id: 'base-1', prodName: '商品', unit: 'pcs', salesPrice: 20 },
                { id: 'pack-10', prodName: '商品', unit: '包', salesPrice: 200, packageBaseProductId: 'base-1', packageUnitsPerPackage: 10 }
            ],
            suppliers: [{ id: 'supplier-1', name: '供應商一' }],
            inventory: [{
                id: 'inventory-10', productId: 'pack-10', productName: '商品', unit: '包',
                supplierId: 'supplier-1', warehouse: '總倉', quantity: 1, availableQuantity: 1,
                salesPrice: 200, averageCost: 100, lastCost: 100, totalCost: 100, relatedOrders: []
            }],
            inventoryBatches: [],
            inventoryMovements: []
        },
        inventoryModalCurrentId: '',
        confirm: () => true,
        generateProductID: () => 'pack-5-new',
        getRocYearMonth: () => '11510',
        saveData() {},
        closeModal() {},
        renderInventory() {},
        showToast() {}
    };
    vm.createContext(context);
    vm.runInContext(inventoryScript, context);
    vm.runInContext('renderInventory = () => {}', context);
    vm.runInContext(`applyInventorySplit({
        preventDefault() {},
        target: {
            inventoryId: { value: 'inventory-10' },
            splitFromQty: { value: '1' },
            splitToQty: { value: '2' },
            splitNewSpec: { value: '5 件一組' },
            splitNote: { value: '' }
        }
    })`, context);

    const newFivePack = context.data.products.find(product => product.id === 'pack-5-new');
    const targetInventory = context.data.inventory.find(item => item.productId === 'pack-5-new');
    assert.equal(newFivePack.packageBaseProductId, 'base-1');
    assert.equal(newFivePack.packageUnitsPerPackage, 5);
    assert.equal(newFivePack.salesPrice, 100);
    assert.equal(targetInventory.quantity, 2);
    assert.equal(targetInventory.salesPrice, 100);
});

test('reverse conversion merges by base product ID even when the existing spec differs', () => {
    const context = {
        data: {
            products: [
                { id: 'product-1', prodName: '產品一', unit: 'pcs', spec: '單件', salesPrice: 20 },
                {
                    id: 'package-product-1', prodName: '產品一', unit: '包', spec: '10件/包',
                    salesPrice: 200, packageBaseProductId: 'product-1', packageUnitsPerPackage: 10
                }
            ],
            inventory: [
                {
                    id: 'inventory-package', productId: 'package-product-1', productName: '產品一',
                    spec: '10件/包', supplierId: 'supplier-1', supplierName: '供應商一',
                    warehouse: '總倉', quantity: 1, availableQuantity: 1, averageCost: 10,
                    lastCost: 10, totalCost: 10, relatedOrders: []
                },
                {
                    id: 'inventory-base', productId: 'product-1', productName: '產品一',
                    spec: '舊版描述文字', supplierId: 'supplier-1', supplierName: '供應商一',
                    warehouse: '總倉', quantity: 2, availableQuantity: 2, averageCost: 5,
                    lastCost: 5, totalCost: 10, relatedOrders: []
                }
            ],
            inventoryBatches: [],
            inventoryMovements: []
        },
        inventoryModalCurrentId: '',
        confirm: () => true,
        generateProductID: () => 'unused-package-id',
        getRocYearMonth: () => '11510',
        saveData() {},
        closeModal() {},
        renderInventory() {},
        showToast() {}
    };
    vm.createContext(context);
    vm.runInContext(inventoryScript, context);
    vm.runInContext('renderInventory = () => {}', context);
    vm.runInContext(`applyInventorySplit({
        preventDefault() {},
        target: {
            inventoryId: { value: 'inventory-package' },
            splitFromQty: { value: '1' },
            splitToQty: { value: '10' },
            splitNewSpec: { value: '不使用的文字' },
            splitNote: { value: '' }
        }
    })`, context);

    assert.equal(context.data.inventory.length, 2);
    const baseInventory = context.data.inventory.find(item => item.id === 'inventory-base');
    assert.equal(baseInventory.quantity, 12);
    assert.equal(baseInventory.totalCost, 20);
    assert.equal(baseInventory.spec, '單件');
});

test('same package conversion reuses its product id even when the typed spec differs', () => {
    const context = {
        data: {
            products: [
                { id: 'product-1', prodName: '產品一', sku: 'SKU-1', unit: 'pcs', spec: '單件', salesPrice: 20 },
                { id: 'package-product-1', prodName: '產品一', sku: 'SKU-1-PK10', unit: '包', spec: '10件/包', salesPrice: 200, packageBaseProductId: 'product-1', packageUnitsPerPackage: 10 }
            ],
            inventory: [
                {
                    id: 'inventory-source', productId: 'product-1', productName: '產品一', spec: '單件',
                    supplierId: 'supplier-1', supplierName: '供應商一', warehouse: '總倉', unit: 'pcs',
                    quantity: 20, availableQuantity: 20, averageCost: 1, lastCost: 1, totalCost: 20,
                    status: '正常', relatedOrders: []
                },
                {
                    id: 'inventory-package', productId: 'package-product-1', productName: '產品一', spec: '10件/包',
                    supplierId: 'supplier-1', supplierName: '供應商一', warehouse: '總倉', unit: '包',
                    quantity: 1, availableQuantity: 1, salesPrice: 200, averageCost: 10, lastCost: 10,
                    totalCost: 10, status: '正常', relatedOrders: []
                }
            ],
            inventoryBatches: [],
            inventoryMovements: []
        },
        inventoryModalCurrentId: '',
        confirm: () => true,
        generateProductID: () => 'unexpected-extra-package',
        getRocYearMonth: () => '11510',
        saveData() {},
        closeModal() {},
        renderInventory() {},
        showToast() {}
    };

    vm.createContext(context);
    vm.runInContext(inventoryScript, context);
    vm.runInContext('renderInventory = () => {}', context);
    vm.runInContext(`applyInventorySplit({
        preventDefault() {},
        target: {
            inventoryId: { value: 'inventory-source' },
            splitFromQty: { value: '10' },
            splitToQty: { value: '1' },
            splitNewSpec: { value: '手打規格不同' },
            splitNote: { value: '' }
        }
    })`, context);

    assert.equal(context.data.products.length, 2);
    assert.equal(context.data.inventory[1].productId, 'package-product-1');
    assert.equal(context.data.inventory[1].spec, '10件/包');
    assert.equal(context.data.inventory[1].quantity, 2);
});

test('package preview shows the existing or generated product ID from the conversion ratio', () => {
    const context = {
        data: {
            products: [
                { id: 'product-1', unit: 'pcs' },
                { id: 'package-10', packageBaseProductId: 'product-1', packageUnitsPerPackage: 10 }
            ],
            inventory: [{
                id: 'inventory-1', productId: 'product-1', quantity: 100, availableQuantity: 100
            }]
        },
        inventoryModalCurrentId: 'inventory-1',
        generateProductID: () => 'package-20'
    };
    vm.createContext(context);
    vm.runInContext(inventoryScript, context);
    const elements = new Map([
        ['inventorySplitFromQty', { value: '10' }],
        ['inventorySplitToQty', { value: '1' }],
        ['inventorySplitProductPreview', { textContent: '' }]
    ]);
    context.document = { getElementById: id => elements.get(id) || null };

    vm.runInContext('updateInventorySplitProductPreview()', context);
    assert.match(elements.get('inventorySplitProductPreview').textContent, /package-10/);

    elements.get('inventorySplitFromQty').value = '20';
    vm.runInContext('updateInventorySplitProductPreview()', context);
    assert.match(elements.get('inventorySplitProductPreview').textContent, /package-20/);
});

test('new-product preview is read-only and predicts the ID actually used by conversion', () => {
    const context = {
        data: {
            products: [{ id: 'base-1', prodName: '商品', unit: 'pcs', salesPrice: 10 }],
            suppliers: [],
            inventory: [{
                id: 'stock-1', productId: 'base-1', productName: '商品', unit: 'pcs',
                quantity: 20, availableQuantity: 20, averageCost: 1, lastCost: 1, totalCost: 20
            }],
            inventoryBatches: [],
            inventoryMovements: []
        },
        inventoryModalCurrentId: 'stock-1',
        generateProductID: () => 'generated-pack-10',
        getRocYearMonth: () => '11510',
        confirm: () => true,
        saveData() {},
        closeModal() {},
        renderInventory() {},
        showToast() {}
    };
    vm.createContext(context);
    vm.runInContext(inventoryScript, context);
    vm.runInContext('renderInventory = () => {}', context);
    const elements = new Map([
        ['inventorySplitFromQty', { value: '10' }],
        ['inventorySplitToQty', { value: '1' }],
        ['inventorySplitProductPreview', { textContent: '' }]
    ]);
    context.document = { getElementById: id => elements.get(id) || null };

    vm.runInContext('updateInventorySplitProductPreview()', context);
    const preview = elements.get('inventorySplitProductPreview').textContent;
    assert.equal(context.data.products.length, 1);
    assert.match(preview, /generated-pack-10/);

    vm.runInContext(`applyInventorySplit({
        preventDefault() {},
        target: {
            inventoryId: { value: 'stock-1' },
            splitFromQty: { value: '10' },
            splitToQty: { value: '1' },
            splitNewSpec: { value: '10 入' },
            splitNote: { value: '' }
        }
    })`, context);
    assert.equal(context.data.inventory.find(item => item.productId === 'generated-pack-10').productId, 'generated-pack-10');
});

test('legacy stock is not reidentified from matching spec text during package conversion', () => {
    const context = {
        data: {
            products: [
                { id: 'product-1', prodName: '產品一', unit: 'pcs', salesPrice: 20 },
                {
                    id: 'package-product-1', prodName: '產品一', unit: '包', spec: '10件/包',
                    salesPrice: 200, packageBaseProductId: 'product-1', packageUnitsPerPackage: 10
                }
            ],
            inventory: [
                {
                    id: 'inventory-source', productId: 'product-1', productName: '產品一',
                    supplierId: 'supplier-1', supplierName: '供應商一', warehouse: '總倉',
                    quantity: 20, availableQuantity: 20, averageCost: 1, lastCost: 1, totalCost: 20
                },
                {
                    id: 'legacy-inventory', productId: 'product-1', productName: '產品一',
                    spec: '10件/包', supplierId: 'supplier-1', supplierName: '供應商一',
                    warehouse: '總倉', quantity: 1, availableQuantity: 1,
                    averageCost: 10, lastCost: 10, totalCost: 10
                }
            ],
            inventoryBatches: [{
                id: 'legacy-batch', inventoryId: 'legacy-inventory', productId: 'product-1',
                quantity: 1, availableQuantity: 1
            }],
            inventoryMovements: [{
                id: 'legacy-movement', inventoryId: 'legacy-inventory', productId: 'product-1',
                spec: '10件/包', quantity: 1
            }]
        },
        inventoryModalCurrentId: '',
        confirm: () => true,
        generateProductID: () => 'unused-package-id',
        getRocYearMonth: () => '11510',
        saveData() {},
        closeModal() {},
        renderInventory() {},
        showToast() {}
    };
    vm.createContext(context);
    vm.runInContext(inventoryScript, context);
    vm.runInContext('renderInventory = () => {}', context);
    vm.runInContext(`applyInventorySplit({
        preventDefault() {},
        target: {
            inventoryId: { value: 'inventory-source' },
            splitFromQty: { value: '10' },
            splitToQty: { value: '1' },
            splitNewSpec: { value: '不同顯示名稱' },
            splitNote: { value: '' }
        }
    })`, context);

    const legacyInventory = context.data.inventory.find(item => item.id === 'legacy-inventory');
    assert.equal(legacyInventory.productId, 'product-1');
    assert.equal(legacyInventory.quantity, 1);
    assert.equal(context.data.inventoryBatches[0].productId, 'product-1');
    assert.equal(context.data.inventoryMovements[0].productId, 'product-1');
    assert.equal(context.data.inventory.filter(item => item.productId === 'package-product-1').length, 1);
});

test('splitting rejects fractional or reserved quantities without changing data', () => {
    for (const [fromQty, availableQuantity] of [['1.5', 10], ['3', 2]]) {
        const messages = [];
        const context = {
            data: {
                products: [{ id: 'product-1', unit: 'pcs', salesPrice: 20 }],
                inventory: [{
                    id: 'inventory-source', productId: 'product-1', productName: '產品一',
                    quantity: 10, availableQuantity, averageCost: 1, totalCost: 10, lastCost: 1
                }],
                inventoryBatches: [],
                inventoryMovements: []
            },
            inventoryModalCurrentId: '',
            confirm: () => true,
            generateProductID: () => 'package-product-1',
            getRocYearMonth: () => '11510',
            saveData() {},
            closeModal() {},
            renderInventory() {},
            showToast(message) { messages.push(message); }
        };
        vm.createContext(context);
        vm.runInContext(inventoryScript, context);
        vm.runInContext('renderInventory = () => {}', context);
        vm.runInContext(`applyInventorySplit({
            preventDefault() {},
            target: {
                inventoryId: { value: 'inventory-source' },
                splitFromQty: { value: '${fromQty}' },
                splitToQty: { value: '1' },
                splitNewSpec: { value: '任意規格' },
                splitNote: { value: '' }
            }
        })`, context);

        assert.equal(context.data.inventory[0].quantity, 10);
        assert.equal(context.data.products.length, 1);
        assert.equal(context.data.inventoryMovements.length, 0);
        assert.equal(messages.length, 1);
    }
});

test('a failed save restores product, inventory, batch, and movement data', () => {
    const context = {
        data: {
            products: [{ id: 'product-1', unit: 'pcs', salesPrice: 20 }],
            suppliers: [],
            inventory: [{
                id: 'inventory-source', productId: 'product-1', productName: '產品一',
                quantity: 10, availableQuantity: 10, averageCost: 5, totalCost: 50, lastCost: 5
            }],
            inventoryBatches: [],
            inventoryMovements: []
        },
        inventoryModalCurrentId: '',
        confirm: () => true,
        generateProductID: () => 'package-product-1',
        getRocYearMonth: () => '11510',
        saveData: () => false,
        closeModal() {},
        renderInventory() {},
        showToast(message) { messages.push(message); }
    };
    const messages = [];
    vm.createContext(context);
    vm.runInContext(inventoryScript, context);
    vm.runInContext('renderInventory = () => {}', context);
    vm.runInContext(`applyInventorySplit({
        preventDefault() {},
        target: {
            inventoryId: { value: 'inventory-source' },
            splitFromQty: { value: '10' },
            splitToQty: { value: '1' },
            splitNewSpec: { value: '10件/包' },
            splitNote: { value: '' }
        }
    })`, context);

    assert.equal(context.data.products.length, 1);
    assert.equal(context.data.inventory.length, 1);
    assert.equal(context.data.inventory[0].quantity, 10);
    assert.equal(context.data.inventoryMovements.length, 0);
    assert.match(messages[0], /已復原/);
});

test('cancelling, resubmitting, or throwing during split does not duplicate products or stock', () => {
    const makeContext = ({ confirm = () => true, saveData = () => true, batchGenerator = null } = {}) => {
        const context = {
            data: {
                products: [{ id: 'base-1', prodName: '商品', unit: 'pcs', salesPrice: 10 }],
                suppliers: [],
                inventory: [{
                    id: 'stock-1', productId: 'base-1', productName: '商品', quantity: 20,
                    availableQuantity: 20, averageCost: 1, lastCost: 1, totalCost: 20
                }],
                inventoryBatches: [],
                inventoryMovements: []
            },
            inventoryModalCurrentId: 'stock-1',
            confirm,
            generateProductID: () => 'pack-10',
            getRocYearMonth: () => {
                if (batchGenerator) throw new Error('batch failure');
                return '11510';
            },
            saveData,
            closeModal() {},
            renderInventory() {},
            showToast() {}
        };
        vm.createContext(context);
        vm.runInContext(inventoryScript, context);
        vm.runInContext('renderInventory = () => {}', context);
        return context;
    };
    const runSplit = context => vm.runInContext(`applyInventorySplit({
        preventDefault() {},
        target: {
            inventoryId: { value: 'stock-1' },
            splitFromQty: { value: '10' },
            splitToQty: { value: '1' },
            splitNewSpec: { value: '10入' },
            splitNote: { value: '' }
        }
    })`, context);

    const cancelled = makeContext({ confirm: () => false });
    runSplit(cancelled);
    assert.equal(cancelled.data.products.length, 1);
    assert.equal(cancelled.data.inventory[0].quantity, 20);

    const repeated = makeContext();
    const form = {
        inventoryId: { value: 'stock-1' },
        splitFromQty: { value: '10' },
        splitToQty: { value: '1' },
        splitNewSpec: { value: '10入' },
        splitNote: { value: '' }
    };
    const event = { preventDefault() {}, target: form };
    vm.runInContext('applyInventorySplit', repeated)(event);
    vm.runInContext('applyInventorySplit', repeated)(event);
    assert.equal(repeated.data.products.length, 2);
    assert.equal(repeated.data.inventory.filter(item => item.productId === 'pack-10').reduce((sum, item) => sum + item.quantity, 0), 1);
    assert.equal(form.splitFromQty.value, '');

    const failed = makeContext();
    vm.runInContext(`generateInventoryId = () => {
        throw new Error('inventory ID failure');
    }`, failed);
    runSplit(failed);
    assert.equal(failed.data.products.length, 1);
    assert.equal(failed.data.inventory[0].quantity, 20);
    assert.equal(failed.data.inventoryMovements.length, 0);
});

test('shipping slips export a single outbound record and print an escaped A4 document', () => {
    const classNames = new Set();
    let afterPrint;
    let printCount = 0;
    let exported;
    const printArea = { innerHTML: '' };
    const context = {
        data: {
            companyProfile: { companyName: '<工作室>', taxId: '12345678', phone: '02-1234-5678' },
            financeCustomers: [{ name: '王小明', contactName: '小明', phone: '0912-000-000', address: '台北市' }],
            products: [{ id: 'product-1', unit: '盒' }],
            inventoryMovements: [{
                id: 'shipment-1',
                type: 'outbound',
                customerName: '王小明',
                productId: 'product-1',
                productName: '產品一',
                spec: '標準規格',
                warehouse: '總倉',
                quantity: 2,
                salesPrice: 125,
                totalCost: 250,
                invoiceNo: '<AB12345678>',
                deliveryAddress: '台北市信義區',
                logisticsProvider: '宅配',
                logisticsNumber: 'TRACK-1',
                createdAt: '2026-10-25T09:00:00.000Z'
            }]
        },
        document: {
            getElementById: () => printArea,
            body: {
                classList: {
                    add: name => classNames.add(name),
                    remove: name => classNames.delete(name)
                }
            }
        },
        window: {
            addEventListener: (eventName, callback) => {
                if (eventName === 'afterprint') afterPrint = callback;
            },
            print: () => { printCount += 1; }
        },
        saveAsExcel(rows, sheetName, fileName) {
            exported = { rows, sheetName, fileName };
        },
        formatFinanceMoney: amount => `$${Number(amount).toLocaleString('zh-TW')}`,
        escapeFinanceHtml: value => String(value ?? '').replace(/[&<>"']/g, character => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[character]),
        showToast() {}
    };
    vm.createContext(context);
    vm.runInContext(inventoryScript, context);

    context.exportShippingSlip('shipment-1');
    assert.equal(exported.sheetName, '出貨單');
    assert.equal(exported.fileName, '出貨單_shipment-1.xlsx');
    const exportedRows = JSON.parse(JSON.stringify(exported.rows));
    assert.ok(exportedRows.some(row => row[0] === '客戶名稱' && row[1] === '王小明'));
    assert.ok(exportedRows.some(row => row[0] === '產品一' && row[4] === 2 && row[6] === 125 && row[7] === 250));

    context.printShippingSlip('shipment-1');
    const printHtml = printArea.innerHTML;
    assert.match(printHtml, /出 貨 單/);
    assert.match(printHtml, /&lt;工作室&gt;/);
    assert.match(printHtml, /發票號碼：<\/strong>&lt;AB12345678&gt;/);
    assert.match(printHtml, /台北市信義區/);
    assert.equal(printCount, 1);
    assert.ok(classNames.has('printing-finance'));
    afterPrint();
    assert.ok(!classNames.has('printing-finance'));
});

test('shipping slip actions report a missing outbound record', () => {
    const messages = [];
    const context = {
        data: { inventoryMovements: [] },
        showToast: message => messages.push(message),
        saveAsExcel() {}
    };
    vm.createContext(context);
    vm.runInContext(inventoryScript, context);

    context.exportShippingSlip('missing');
    assert.deepEqual(messages, ['找不到出貨記錄，無法產生出貨單。']);
});

test('linked shipment edits save only delivery and logistics fields, not receivable data', () => {
    const financialFields = [
        'inventoryShipmentAvailable', 'inventoryShipmentQty', 'inventoryShipmentPrice',
        'inventoryShipmentInvoice', 'inventoryShipmentChannel', 'inventoryShipmentInvoiceNo',
        'inventoryShipmentInvoiceDate', 'inventoryShipmentNote'
    ].map(id => ({ id, disabled: id === 'inventoryShipmentAvailable' }));
    const fields = Object.fromEntries([
        ['inventoryShipmentLabel', { textContent: '' }],
        ['inventoryShipmentAvailable', { value: '' }],
        ['inventoryShipmentQty', { value: '' }],
        ['inventoryShipmentPrice', { value: '' }],
        ['inventoryShipmentInvoice', { value: '' }],
        ['inventoryShipmentChannel', { value: '' }],
        ['inventoryShipmentInvoiceNo', { value: '' }],
        ['inventoryShipmentInvoiceDate', { value: '' }],
        ['inventoryShipmentNote', { value: '' }],
        ['inventoryShipmentDeliveryAddress', { value: '' }],
        ['inventoryShipmentLogisticsProvider', { value: '' }],
        ['inventoryShipmentLogisticsNumber', { value: '' }],
        ['inventoryShipmentSubmit', { textContent: '' }],
        ['modal-inventory-shipment', { classList: { add() {} } }]
    ]);
    let shouldSave = false;
    const messages = [];
    const receivable = { id: 'invoice-1', deliveryAddress: '舊客戶地址', logisticsProvider: '舊物流', logisticsNumber: 'OLD-1', totalAmount: 500 };
    const movement = {
        id: 'shipment-1', type: 'outbound', inventoryId: 'inventory-1', accountsDocumentId: 'invoice-1',
        quantity: 2, unitCost: 250, totalCost: 500, deliveryAddress: '舊地址',
        logisticsProvider: '舊物流', logisticsNumber: 'OLD-1', invoiceType: '有發票'
    };
    const context = {
        data: {
            inventory: [{ id: 'inventory-1', availableQuantity: 3 }],
            inventoryMovements: [movement],
            accountsReceivable: [receivable]
        },
        document: {
            getElementById: id => fields[id],
            querySelector: selector => selector.includes('inventoryId')
                ? { value: 'inventory-1' }
                : { value: 'shipment-1' },
            querySelectorAll: () => financialFields
        },
        getCustomerReturnableQuantity: () => 2,
        saveData: () => shouldSave,
        closeModal() {},
        renderShipping() {},
        showToast: message => messages.push(message)
    };
    vm.createContext(context);
    vm.runInContext(inventoryScript, context);

    context.openEditShippingModal('shipment-1');
    assert.equal(fields.inventoryShipmentQty.value, 2);
    assert.equal(fields.inventoryShipmentSubmit.textContent, '儲存出貨資訊');
    assert.ok(financialFields.filter(field => field.id !== 'inventoryShipmentAvailable').every(field => field.disabled));

    fields.inventoryShipmentDeliveryAddress.value = '新地址';
    fields.inventoryShipmentLogisticsProvider.value = '新物流';
    fields.inventoryShipmentLogisticsNumber.value = 'NEW-1';
    const receivableBefore = structuredClone(receivable);
    const financialBefore = {
        quantity: movement.quantity,
        unitCost: movement.unitCost,
        totalCost: movement.totalCost,
        invoiceType: movement.invoiceType
    };

    context.applyInventoryShipment({ preventDefault() {} });
    assert.equal(movement.deliveryAddress, '舊地址');
    assert.equal(messages.at(-1), '出貨資訊儲存失敗，資料未變更。');

    shouldSave = true;
    context.applyInventoryShipment({ preventDefault() {} });
    assert.equal(movement.deliveryAddress, '新地址');
    assert.equal(movement.logisticsProvider, '新物流');
    assert.equal(movement.logisticsNumber, 'NEW-1');
    assert.deepEqual(receivable, receivableBefore);
    assert.deepEqual({
        quantity: movement.quantity,
        unitCost: movement.unitCost,
        totalCost: movement.totalCost,
        invoiceType: movement.invoiceType
    }, financialBefore);
    assert.equal(messages.at(-1), '出貨地址與物流資訊已更新；應收單資料未變更。');
});