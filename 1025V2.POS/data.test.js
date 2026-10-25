import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const directory = dirname(fileURLToPath(import.meta.url));
const dataScript = readFileSync(join(directory, 'data.js'), 'utf8');

test('order export writes each order total only once', () => {
    const context = {
        localStorage: { getItem: () => null },
        calculateFinanceDocumentAmounts: lines => ({
            totalAmount: lines.reduce((sum, line) =>
                sum + line.unitPrice * line.quantity + line.shipping, 0)
        }),
        calculateEstimatedArrival: () => '',
        getTodayStr: () => '2026-10-21',
        getPurchaseOrderPaymentStatus: () => '',
        translatePayment: () => '',
        translateStatus: () => '',
        showToast() {},
        saveAsExcel: rows => {
            context.exportedRows = rows;
        }
    };

    vm.createContext(context);
    vm.runInContext(dataScript, context);
    vm.runInContext(`data.orders = [
        {
            id: 'order-1',
            discount: 10,
            items: [
                { productId: 'product-1', customPrice: 100, quantity: 2, customShipping: 10 },
                { productId: 'product-2', customPrice: 50, quantity: 1, customShipping: 0 }
            ]
        },
        {
            id: 'order-2',
            items: [
                { productId: 'product-3', customPrice: 40, quantity: 1, customShipping: 0 }
            ]
        }
    ];
    exportToExcel('orders');`, context);

    const totalColumnIndex = context.exportedRows[0].indexOf('總金額(NTD)');
    const exportedTotals = context.exportedRows.slice(1).map(row => row[totalColumnIndex]);

    assert.deepEqual(Array.from(exportedTotals), [250, '', 40]);
    assert.equal(exportedTotals.reduce((sum, total) => sum + (total || 0), 0), 290);
});

test('product Excel round-trips package identity and reuses it despite different spec text', () => {
    const context = {
        localStorage: { getItem: () => null },
        generateProductID: () => 'package-duplicate',
        getSalesPriceHistory: product => product.salesPriceHistory || [],
        getTodayStr: () => '2026-10-21',
        saveAsExcel(rows) { context.exportedRows = rows; },
        showToast() {}
    };
    vm.createContext(context);
    vm.runInContext(dataScript, context);
    vm.runInContext(`data.suppliers = [{ id: 'supplier-1', name: '供應商一' }];
    data.products = [
        { id: 'base-1', supplierId: 'supplier-1', prodName: '產品一', unit: 'pcs' },
        {
            id: 'package-1', supplierId: 'supplier-1', prodName: '產品一', unit: '包',
            spec: '10件/包', packageBaseProductId: 'base-1', packageUnitsPerPackage: 10
        }
    ];
    const headers = ['系統ID', '供應商名稱', '產品名稱', '規格', '進價', '售價', '商品類型', '包裝基礎產品編號', '每包基礎單位數'];
    const imported = importProducts([
        headers,
        ['', '供應商一', '產品一', '整箱 10 件', '5', '20', '一般單品', 'base-1', '10']
    ]);
    data.products.push({ id: 'base-2', supplierId: 'supplier-1', prodName: '產品二' });
    invalidIdentityImport = importProducts([
        headers,
        ['package-1', '供應商一', '產品一', '改掛其他基礎產品', '5', '20', '一般單品', 'base-2', '10']
    ]);
    exportToExcel('products');
    result = { imported, invalidIdentityImport, products: data.products };`, context);

    assert.equal(context.result.imported.count, 1);
    assert.equal(context.result.imported.invalidRateRows, 0);
    assert.equal(context.result.invalidIdentityImport.count, 0);
    assert.equal(context.result.invalidIdentityImport.invalidRateRows, 1);
    assert.equal(context.result.products.length, 3);
    assert.equal(context.result.products[1].id, 'package-1');
    assert.equal(context.result.products[1].packageBaseProductId, 'base-1');
    assert.equal(context.result.products[1].packageUnitsPerPackage, 10);
    assert.equal(context.result.products[1].spec, '整箱 10 件');
    assert.equal(context.exportedRows[0].includes('包裝基礎產品編號'), true);
    assert.equal(context.exportedRows[0].includes('每包基礎單位數'), true);
    assert.equal(context.exportedRows[2][context.exportedRows[0].indexOf('包裝基礎產品編號')], 'base-1');
    assert.equal(context.exportedRows[2][context.exportedRows[0].indexOf('每包基礎單位數')], 10);
});

test('product Excel round-trips promotional bundle type and BOM and protects referenced types', () => {
    const context = {
        localStorage: { getItem: () => null },
        generateProductID: () => 'bundle-new',
        getSalesPriceHistory: product => product.salesPriceHistory || [],
        getTodayStr: () => '2026-10-21',
        hasProductReferences: () => true,
        saveAsExcel(rows) { context.exportedRows = rows; },
        showToast() {}
    };
    vm.createContext(context);
    vm.runInContext(dataScript, context);
    vm.runInContext(`data.suppliers = [{ id: 'supplier-1', name: '供應商一' }];
    data.products = [
        { id: 'A', supplierId: 'supplier-1', prodName: '產品 A', productType: 'standard' },
        { id: 'B', supplierId: 'supplier-1', prodName: '產品 B', productType: 'standard' }
    ];
    const headers = ['系統ID', '供應商名稱', '產品名稱', '規格', '商品類型', '組合內容（JSON）', '進價', '售價'];
    const components = JSON.stringify([{ productId: 'A', quantity: 1 }, { productId: 'B', quantity: 2 }]);
    const imported = importProducts([
        headers,
        ['bundle-1', '供應商一', '促銷組合 C', 'A+B', '促銷銷售組合', components, '0', '150']
    ]);
    const typeChange = importProducts([
        headers,
        ['bundle-1', '供應商一', '促銷組合 C', 'A+B', '一般單品', '', '0', '150']
    ]);
    exportToExcel('products');
    result = { imported, typeChange, bundle: data.products.find(product => product.id === 'bundle-1'), rows: exportedRows };`, context);

    assert.equal(context.result.imported.count, 1);
    assert.equal(context.result.bundle.productType, 'sales-bundle');
    assert.equal(context.result.bundle.components.length, 2);
    assert.equal(context.result.typeChange.invalidRateRows, 1);
    const typeColumn = context.result.rows[0].indexOf('商品類型');
    const componentsColumn = context.result.rows[0].indexOf('組合內容（JSON）');
    assert.equal(context.result.rows[3][typeColumn], '促銷銷售組合');
    assert.equal(JSON.parse(context.result.rows[3][componentsColumn]).length, 2);
});

test('product import preserves legacy system IDs and accepts package rows before their base row', () => {
    const context = {
        localStorage: { getItem: () => null },
        generateProductID: () => 'generated-id',
        getSalesPriceHistory: product => product.salesPriceHistory || [],
        showToast() {}
    };
    vm.createContext(context);
    vm.runInContext(dataScript, context);
    vm.runInContext(`data.suppliers = [{ id: 'supplier-1', name: '供應商一' }];
    const headers = ['系統ID', '供應商名稱', '產品名稱', '規格', '進價', '售價', '商品類型', '包裝基礎產品編號', '每包基礎單位數'];
    result = importProducts([
        headers,
        ['package-1', '供應商一', '產品一', '10件/包', '50', '200', '一般單品', 'base-1', '10'],
        ['base-1', '供應商一', '產品一', '單件', '5', '20', '一般單品', '', '']
    ]);
    importedProducts = data.products;`, context);

    assert.equal(context.result.count, 2);
    assert.deepEqual(Array.from(context.importedProducts, product => product.id), ['package-1', 'base-1']);
    assert.equal(context.importedProducts[0].packageBaseProductId, 'base-1');
    assert.equal(context.importedProducts[0].packageUnitsPerPackage, 10);
});

test('package import does not identify a product by matching base spec text', () => {
    const context = {
        localStorage: { getItem: () => null },
        generateProductID: () => 'package-new',
        getSalesPriceHistory: product => product.salesPriceHistory || [],
        showToast() {}
    };
    vm.createContext(context);
    vm.runInContext(dataScript, context);
    vm.runInContext(`data.suppliers = [{ id: 'supplier-1', name: '供應商一' }];
    data.products = [{
        id: 'base-1', supplierId: 'supplier-1', prodName: '產品一', spec: '10件/包'
    }];
    const headers = ['系統ID', '供應商名稱', '產品名稱', '規格', '進價', '售價', '商品類型', '包裝基礎產品編號', '每包基礎單位數'];
    const row = ['', '供應商一', '產品一', '10件/包', '50', '200', '一般單品', 'base-1', '10'];
    firstImport = importProducts([headers, row]);
    secondImport = importProducts([headers, row]);
    importedProducts = data.products;`, context);

    assert.equal(context.firstImport.count, 1);
    assert.equal(context.secondImport.count, 1);
    assert.equal(context.importedProducts.length, 2);
    assert.equal(context.importedProducts[1].id, 'package-new');
    assert.equal(context.importedProducts[1].packageBaseProductId, 'base-1');
    assert.equal(context.importedProducts[1].packageUnitsPerPackage, 10);
});

test('repeating package CSV import is idempotent and preserves stock and historical records', () => {
    const context = {
        localStorage: { getItem: () => null },
        generateProductID: () => 'package-new',
        getSalesPriceHistory: product => product.salesPriceHistory || [],
        hasProductReferences: productId => [
            ...(context.data.inventory || []),
            ...(context.data.inventoryMovements || []),
            ...(context.data.orders || []).flatMap(order => order.items || [])
        ].some(record => record.productId === productId),
        showToast() {}
    };
    vm.createContext(context);
    vm.runInContext(dataScript, context);
    vm.runInContext(`data.suppliers = [{ id: 'supplier-1', name: '供應商一' }];
    data.products = [{ id: 'base-1', supplierId: 'supplier-1', prodName: '產品一', unit: 'pcs', spec: '原規格' }];
    data.inventory = [{ id: 'stock-1', productId: 'base-1', quantity: 17, availableQuantity: 12, spec: '庫存規格' }];
    data.inventoryMovements = [{ id: 'move-1', productId: 'base-1', quantity: -3, spec: '歷史規格' }];
    data.orders = [{ id: 'order-1', items: [{ productId: 'base-1', quantity: 4, spec: '訂單規格' }] }];
    const previousStock = JSON.stringify(data.inventory);
    const previousMovements = JSON.stringify(data.inventoryMovements);
    const previousOrders = JSON.stringify(data.orders);
    const headers = ['系統ID', '供應商名稱', '產品名稱', '規格', '進價', '售價', '商品類型', '包裝基礎產品編號', '每包基礎單位數'];
    const rows = [headers, ['package-1', '供應商一', '產品一', '10入', '50', '200', '一般單品', 'base-1', '10']];
    firstImport = importProducts(rows);
    secondImport = importProducts(rows);
    result = {
        firstImport,
        secondImport,
        products: data.products,
        stockUnchanged: previousStock === JSON.stringify(data.inventory),
        movementsUnchanged: previousMovements === JSON.stringify(data.inventoryMovements),
        ordersUnchanged: previousOrders === JSON.stringify(data.orders)
    };`, context);

    assert.equal(context.result.firstImport.count, 1);
    assert.equal(context.result.secondImport.count, 1);
    assert.equal(context.result.products.filter(product => product.packageBaseProductId === 'base-1').length, 1);
    assert.equal(context.result.products.find(product => product.id === 'package-1').spec, '10入');
    assert.equal(context.result.stockUnchanged, true);
    assert.equal(context.result.movementsUnchanged, true);
    assert.equal(context.result.ordersUnchanged, true);
});
