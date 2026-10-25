import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const directory = dirname(fileURLToPath(import.meta.url));
const ordersScript = readFileSync(join(directory, 'orders.js'), 'utf8');

test('clearing the purchase list resets and hides its tab count', () => {
    const elements = new Map();
    const getElement = id => {
        if (!elements.has(id)) {
            elements.set(id, {
                textContent: '',
                innerHTML: '',
                classList: {
                    hidden: id === 'cartCount',
                    toggle(className, force) {
                        if (className === 'hidden') this.hidden = force;
                    }
                }
            });
        }
        return elements.get(id);
    };
    const context = {
        data: { cart: [{ productId: 'product-1' }] },
        selectedCartItems: new Set(['product-1']),
        document: { getElementById: getElement },
        confirm: () => true,
        saveData() {},
        calculateFinanceDocumentAmounts: () => ({ subtotal: 0, taxAmount: 0, totalAmount: 0 }),
        convertCurrencyToNtd: value => Number(value)
    };

    vm.runInNewContext(ordersScript, context);
    getElement('cartCount').textContent = '1';
    getElement('cartCount').classList.hidden = false;

    vm.runInNewContext('clearCart()', context);

    assert.equal(context.data.cart.length, 0);
    assert.equal(String(getElement('cartCount').textContent), '0');
    assert.equal(getElement('cartCount').classList.hidden, true);
});
