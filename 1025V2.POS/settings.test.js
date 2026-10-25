import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const directory = dirname(fileURLToPath(import.meta.url));
const settingsScript = readFileSync(join(directory, 'settings.js'), 'utf8');

function createSettingsContext({ saveData = () => true, warehouses = '總倉' } = {}) {
    const values = new Map([
        ['companyName', '測試公司'],
        ['companyTaxId', ''],
        ['companyPhone', ''],
        ['companyContact', ''],
        ['companyBank', ''],
        ['companyBankAccount', ''],
        ['companyPaymentTerms', ''],
        ['receivingWarehouses', warehouses]
    ]);
    const messages = [];
    const context = {
        data: { companyProfile: { existingSetting: 'keep' } },
        document: {
            getElementById: id => ({
                value: values.get(id) || '',
                set value(value) {
                    values.set(id, value);
                },
                get value() {
                    return values.get(id) || '';
                }
            })
        },
        saveData,
        showToast: message => messages.push(message),
        messages,
        values
    };
    vm.createContext(context);
    vm.runInContext(settingsScript, context);
    return context;
}

test('warehouse settings normalize entries and preserve a default warehouse', () => {
    const context = createSettingsContext({ warehouses: ' 總倉 \n台北倉\n台北倉\n\n台中倉 ' });

    vm.runInContext('saveCompanySettings({ preventDefault() {} })', context);

    assert.deepEqual(JSON.parse(JSON.stringify(context.data.companyProfile.receivingWarehouses)), ['總倉', '台北倉', '台中倉']);
    assert.equal(context.data.companyProfile.existingSetting, 'keep');
    assert.deepEqual(JSON.parse(JSON.stringify(context.getConfiguredWarehouses())), ['總倉', '台北倉', '台中倉']);
    assert.match(context.messages.at(-1), /設定已儲存/);
});

test('warehouse settings require at least one option and preserve prior data on failure', () => {
    const context = createSettingsContext({ warehouses: ' \n \n' });
    const previousProfile = { ...context.data.companyProfile };

    vm.runInContext('saveCompanySettings({ preventDefault() {} })', context);

    assert.deepEqual(context.data.companyProfile, previousProfile);
    assert.match(context.messages.at(-1), /至少設定一個入庫倉別/);
});

test('warehouse settings restore the default for existing data without a configured list', () => {
    const context = createSettingsContext();
    delete context.data.companyProfile.receivingWarehouses;
    const rendered = [];
    context.document.getElementById = id => ({
        get value() {
            return context.values.get(id) || '';
        },
        set value(value) {
            context.values.set(id, value);
            rendered.push([id, value]);
        }
    });

    vm.runInContext('renderCompanySettings()', context);

    assert.deepEqual(JSON.parse(JSON.stringify(context.getConfiguredWarehouses())), ['總倉']);
    assert.deepEqual(rendered.find(([id]) => id === 'receivingWarehouses'), ['receivingWarehouses', '總倉']);
});

test('warehouse settings restore the prior profile when persistence fails', () => {
    const context = createSettingsContext({
        warehouses: '總倉\n台北倉',
        saveData: () => false
    });
    const previousProfile = { ...context.data.companyProfile };

    vm.runInContext('saveCompanySettings({ preventDefault() {} })', context);

    assert.deepEqual(context.data.companyProfile, previousProfile);
    assert.match(context.messages.at(-1), /儲存失敗/);
});
