import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const directory = dirname(fileURLToPath(import.meta.url));
const utilitiesScript = readFileSync(join(directory, 'utils.js'), 'utf8');

test('product reference checks cover package, quote, inventory, and nested history links', () => {
    const context = {
        data: {
            products: [
                { id: 'base-1' },
                { id: 'package-1', packageBaseProductId: 'base-1', packageUnitsPerPackage: 10 }
            ],
            clientQuotes: [{ items: [{ productId: 'package-1' }] }],
            accountsReceivable: [{ lines: [{ productId: 'base-1' }] }],
            inventoryMovements: [{ productId: 'historical-product', sourceKitProductId: 'kit-product' }]
        }
    };
    vm.createContext(context);
    vm.runInContext(utilitiesScript, context);

    assert.equal(vm.runInContext("hasProductReferences('base-1')", context), true);
    assert.equal(vm.runInContext("hasProductReferences('package-1')", context), true);
    assert.equal(vm.runInContext("hasProductReferences('historical-product')", context), true);
    assert.equal(vm.runInContext("hasProductReferences('kit-product')", context), true);
    assert.equal(vm.runInContext("hasProductReferences('unreferenced-product')", context), false);
});

test('product ID generation advances beyond two-digit monthly sequences', () => {
    const now = new Date();
    const rocYear = now.getFullYear() - 1911;
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const prefix = `p_${rocYear}${month}`;
    const context = {
        data: {
            products: [
                { id: `${prefix}99` },
                { id: `${prefix}100` }
            ]
        }
    };
    vm.createContext(context);
    vm.runInContext(utilitiesScript, context);

    assert.equal(vm.runInContext('generateProductID()', context), `${prefix}101`);
});
