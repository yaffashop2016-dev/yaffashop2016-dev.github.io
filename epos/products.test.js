import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const directory = dirname(fileURLToPath(import.meta.url));
const productsScript = readFileSync(join(directory, 'products.js'), 'utf8');
const indexHtml = readFileSync(join(directory, 'index.html'), 'utf8');

function makeElement() {
    const classes = new Set();
    const listeners = new Map();
    return {
        value: '',
        addEventListener(name, listener) {
            listeners.set(name, listener);
        },
        classList: {
            toggle(name, force) {
                if (force) classes.add(name);
                else classes.delete(name);
            },
            contains(name) {
                return classes.has(name);
            }
        }
    };
}

function makeProductContext() {
    const elements = new Map();
    const getElementById = id => {
        if (!elements.has(id)) elements.set(id, makeElement());
        return elements.get(id);
    };
    const editForm = makeElement();
    editForm.supplierId = makeElement();
    editForm.prodName = makeElement();
    elements.set('editProductForm', editForm);
    const context = {
        data: {
            products: [{ id: 'single-1', prodName: '單品 A', productType: 'standard' }],
            suppliers: []
        },
        isSalesBundleProduct: product => product?.productType === 'sales-bundle',
        document: { getElementById },
        showToast() {}
    };
    vm.createContext(context);
    vm.runInContext(productsScript, context);
    return { context, getElementById };
}

test('product composition selector exposes the BOM for the chosen workflow', () => {
    const { context, getElementById } = makeProductContext();
    const type = getElementById('newProductType');
    const mode = getElementById('newProductCompositionMode');
    const procurementFields = getElementById('newKitFields');
    const salesFields = getElementById('newSalesBundleFields');
    const modeFields = getElementById('newProductCompositionModeFields');
    type.value = 'combination';
    mode.value = 'sales-bundle';

    context.toggleProductCompositionFields(
        'newProductType',
        'newKitFields',
        'newSalesBundleFields',
        'newProductCompositionModeFields',
        'newProductCompositionMode'
    );

    assert.equal(modeFields.classList.contains('hidden'), false);
    assert.equal(procurementFields.classList.contains('hidden'), true);
    assert.equal(salesFields.classList.contains('hidden'), false);
    mode.value = 'kit';
    context.toggleProductCompositionFields(
        'newProductType',
        'newKitFields',
        'newSalesBundleFields',
        'newProductCompositionModeFields',
        'newProductCompositionMode'
    );
    assert.equal(procurementFields.classList.contains('hidden'), false);
    assert.equal(salesFields.classList.contains('hidden'), true);
    assert.equal(context.getProductTypeFromForm({ get: () => 'combination' }), 'kit');
    assert.equal(context.getProductTypeFromForm({
        get: field => field === 'productType' ? 'combination' : 'sales-bundle'
    }), 'sales-bundle');
    assert.equal(context.getProductTypeFromForm({ get: () => 'standard' }), 'standard');
});

test('sales compositions accept ordinary single products as components', () => {
    const { context, getElementById } = makeProductContext();
    const componentRow = {
        querySelector(selector) {
            if (selector === '.kit-component-product') return { value: 'single-1' };
            if (selector === '.kit-component-quantity') return { value: '2' };
            if (selector === '.kit-component-weight') return { value: '' };
            return null;
        }
    };
    getElementById('newSalesBundleComponents').children = [componentRow];

    const result = context.readKitComponents('newSalesBundleComponents');
    assert.equal(result.error, undefined);
    assert.deepEqual(JSON.parse(JSON.stringify(result.components)), [{
        productId: 'single-1',
        quantity: 2,
        allocationWeight: 1
    }]);
});

test('product forms show one composition type and select its processing mode separately', () => {
    assert.match(indexHtml, /option value="combination">產品組合（多品項合成 1）/);
    const productTypeSelects = [...indexHtml.matchAll(/<select name="productType"[\s\S]*?<\/select>/g)].map(match => match[0]);
    assert.equal(productTypeSelects.length, 2);
    productTypeSelects.forEach(select => {
        assert.doesNotMatch(select, /value="kit"|value="sales-bundle"/);
    });
    assert.match(indexHtml, /name="compositionMode"/);
    assert.match(indexHtml, /採購組合包（收貨時拆成單品）/);
    assert.match(indexHtml, /促銷銷售組合（銷售時扣組成品）/);
});
