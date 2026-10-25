function normalizeReceivingWarehouses(value) {
    const entries = Array.isArray(value) ? value : String(value || '').split(/\r?\n/);
    const warehouses = [];
    const seen = new Set();
    entries.forEach(entry => {
        const name = String(entry || '').trim();
        const key = name.toLocaleLowerCase();
        if (name && !seen.has(key)) {
            seen.add(key);
            warehouses.push(name);
        }
    });
    return warehouses;
}

function getConfiguredWarehouses() {
    const warehouses = normalizeReceivingWarehouses(data.companyProfile?.receivingWarehouses);
    return warehouses.length ? warehouses : ['總倉'];
}

function renderCompanySettings() {
    const profile = data.companyProfile || {};
    document.getElementById('companyName').value = profile.companyName || '';
    document.getElementById('companyTaxId').value = profile.taxId || '';
    document.getElementById('companyPhone').value = profile.phone || '';
    document.getElementById('companyContact').value = profile.contact || '';
    document.getElementById('companyBank').value = profile.bank || '';
    document.getElementById('companyBankAccount').value = profile.bankAccount || '';
    document.getElementById('companyPaymentTerms').value = profile.paymentTerms || '';
    document.getElementById('receivingWarehouses').value = getConfiguredWarehouses().join('\n');
}

function saveCompanySettings(event) {
    event.preventDefault();
    const previousProfile = data.companyProfile || {};
    const receivingWarehouses = normalizeReceivingWarehouses(
        document.getElementById('receivingWarehouses').value
    );
    if (!receivingWarehouses.length) {
        return showToast('請至少設定一個入庫倉別。', 'bg-red-500');
    }
    if (receivingWarehouses.length > 50 || receivingWarehouses.some(warehouse => warehouse.length > 80)) {
        return showToast('入庫倉別最多 50 個，每個名稱不可超過 80 個字。', 'bg-red-500');
    }
    data.companyProfile = {
        ...previousProfile,
        companyName: document.getElementById('companyName').value.trim(),
        taxId: document.getElementById('companyTaxId').value.trim(),
        phone: document.getElementById('companyPhone').value.trim(),
        contact: document.getElementById('companyContact').value.trim(),
        bank: document.getElementById('companyBank').value.trim(),
        bankAccount: document.getElementById('companyBankAccount').value.trim(),
        paymentTerms: document.getElementById('companyPaymentTerms').value.trim(),
        receivingWarehouses,
        updatedAt: new Date().toISOString()
    };
    if (!saveData()) {
        data.companyProfile = previousProfile;
        return showToast('公司設定儲存失敗，請確認瀏覽器儲存空間。', 'bg-red-500');
    }
    showToast('公司設定已儲存；新報價單將使用此資料。', 'bg-green-600');
}