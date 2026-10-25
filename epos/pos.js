let posCart = [];

function renderPos() {
    const dateInput = document.getElementById('posDate');
    if (dateInput && !dateInput.value) dateInput.value = getFinanceToday();
    renderPosCustomers();
    renderPosProducts();
    renderPosCart();
    document.getElementById('posBarcode')?.focus();
}

function renderPosCustomers() {
    const select = document.getElementById('posCustomer');
    if (!select) return;
    const selectedId = select.value;
    const customers = (data.financeCustomers || [])
        .filter(customer => String(customer.name || '').trim())
        .slice()
        .sort((first, second) => first.name.localeCompare(second.name, 'zh-TW'));
    select.innerHTML = '<option value="">現場客</option>' + customers.map(customer =>
        `<option value="${escapeFinanceHtml(customer.id)}">${escapeFinanceHtml(customer.name)}</option>`
    ).join('');
    if (customers.some(customer => customer.id === selectedId)) select.value = selectedId;
}

function renderPosProducts() {
    const container = document.getElementById('posProductList');
    if (!container) return;
    const query = String(document.getElementById('posSearch')?.value || '').trim().toLocaleLowerCase();
    const items = (data.inventory || []).filter(item => Number(item.availableQuantity || 0) > 0 &&
        (!query || [item.productName, item.productId, item.spec, item.id, item.sku,
            (data.products || []).find(product => product.id === item.productId)?.barcode]
            .some(value => String(value || '').toLocaleLowerCase().includes(query))));
    const bundles = (data.products || []).filter(product => isSalesBundleProduct(product) &&
        getSalesBundleAvailability(product) > 0 &&
        (!query || [product.prodName, product.id, product.spec, product.sku, product.barcode]
            .some(value => String(value || '').toLocaleLowerCase().includes(query))));
    if (!items.length && !bundles.length) {
        container.innerHTML = '<div class="col-span-full py-10 text-center text-sm text-slate-400">沒有符合條件的可用庫存</div>';
        return;
    }
    container.innerHTML = items.map(item => {
        const price = getInventorySalesPrice(item);
        const product = (data.products || []).find(candidate => candidate.id === item.productId);
        return `<button type="button" data-pos-add="${escapeFinanceHtml(item.id)}" class="rounded-lg border border-slate-200 p-3 text-left hover:border-emerald-400 hover:bg-emerald-50">
            <span class="block font-bold text-slate-800">${escapeFinanceHtml(item.productName || item.productId || '未命名商品')}</span>
            <span class="mt-1 block text-xs text-slate-500">${escapeFinanceHtml(item.spec || '無規格')} · ${escapeFinanceHtml(item.warehouse || '總倉')}${isSalesBundleProduct(product) ? ' · 已組裝庫存' : ''}</span>
            <span class="mt-2 flex justify-between gap-2 text-sm"><span>可用 ${Number(item.availableQuantity || 0)} ${escapeFinanceHtml(item.unit || 'pcs')}</span><span class="font-semibold text-emerald-700">${price === '' ? '未設定售價' : formatFinanceUnitPrice(price)}</span></span>
        </button>`;
    }).join('') + bundles.map(product => {
        const price = product.salesPrice === '' || product.salesPrice == null ? '' : Number(product.salesPrice) || 0;
        return `<button type="button" data-pos-bundle="${escapeFinanceHtml(product.id)}" class="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-left hover:border-emerald-400 hover:bg-emerald-100">
            <span class="block font-bold text-slate-800">${escapeFinanceHtml(product.prodName || product.id)}</span>
            <span class="mt-1 block text-xs text-emerald-800">${escapeFinanceHtml(product.spec || '無規格')} · 組成品即時扣庫</span>
            <span class="mt-2 flex justify-between gap-2 text-sm"><span>可組 ${getSalesBundleAvailability(product)} ${escapeFinanceHtml(product.unit || 'pcs')}</span><span class="font-semibold text-emerald-700">${price === '' ? '未設定售價' : formatFinanceUnitPrice(price)}</span></span>
        </button>`;
    }).join('');
    container.querySelectorAll('[data-pos-add]').forEach(button => {
        button.addEventListener('click', () => addPosItem(button.dataset.posAdd));
    });
    container.querySelectorAll('[data-pos-bundle]').forEach(button => {
        button.addEventListener('click', () => addPosBundle(button.dataset.posBundle));
    });
}

function processPosBarcode(event) {
    event?.preventDefault();
    const barcodeInput = document.getElementById('posBarcode');
    const barcode = String(barcodeInput?.value || '').trim();
    if (!barcode) return showToast('請先掃描或輸入產品條碼。', 'bg-amber-600');

    const matches = (data.products || []).filter(product =>
        String(product.barcode || '').trim().toLocaleLowerCase() === barcode.toLocaleLowerCase()
    );
    if (matches.length === 0) return showToast(`找不到條碼「${barcode}」對應的產品，請確認產品主檔條碼。`, 'bg-red-500');
    if (matches.length > 1) return showToast(`條碼「${barcode}」重複對應多個產品，請先修正產品主檔。`, 'bg-red-500');

    const product = matches[0];
    const stockItems = (data.inventory || []).filter(item =>
        item.productId === product.id && Number(item.availableQuantity || 0) > 0
    );
    if (stockItems.length === 0 && isSalesBundleProduct(product) && getSalesBundleAvailability(product) > 0) {
        const added = addPosBundle(product.id);
        if (added === false) return;
        if (barcodeInput) {
            barcodeInput.value = '';
            barcodeInput.focus();
        }
        return;
    }
    if (stockItems.length === 0) return showToast(`「${product.name || product.productName || product.id}」目前沒有可用庫存。`, 'bg-amber-600');
    if (stockItems.length > 1) {
        const search = document.getElementById('posSearch');
        if (search) search.value = product.name || product.productName || product.id;
        renderPosProducts();
        return showToast(`「${product.name || product.productName || product.id}」有多筆可用庫存，請從商品清單選擇正確的庫存批次或倉別。`, 'bg-amber-600');
    }

    const added = addPosItem(stockItems[0].id);
    if (added === false) return;
    if (barcodeInput) {
        barcodeInput.value = '';
        barcodeInput.focus();
    }
}

function addPosItem(inventoryId) {
    const inventoryItem = (data.inventory || []).find(item => item.id === inventoryId);
    if (!inventoryItem || Number(inventoryItem.availableQuantity || 0) <= 0) {
        showToast('此商品目前沒有可用庫存。', 'bg-amber-600');
        return false;
    }
    const existing = posCart.find(line => line.inventoryId === inventoryId);
    if (existing) {
        if (existing.quantity >= Number(inventoryItem.availableQuantity || 0)) {
            showToast(`「${inventoryItem.productName || inventoryItem.productId}」已達可用庫存上限。`, 'bg-amber-600');
            return false;
        }
        existing.quantity++;
    } else {
        const product = (data.products || []).find(item => item.id === inventoryItem.productId);
        posCart.push({
            inventoryId,
            bundleMode: isSalesBundleProduct(product) ? 'assembled' : '',
            quantity: 1,
            unitPrice: getInventorySalesPrice(inventoryItem),
            taxStatus: product?.taxStatus || '含稅'
        });
    }
    renderPosCart();
    return true;
}

function getPosLineKey(line) {
    return line.bundleMode === 'components' ? `bundle-components:${line.productId}` : line.inventoryId;
}

function addPosBundle(productId) {
    const product = (data.products || []).find(item => item.id === productId && isSalesBundleProduct(item));
    if (!product || getSalesBundleAvailability(product) <= 0) {
        showToast('促銷組合的組成品庫存不足。', 'bg-amber-600');
        return false;
    }
    const existing = posCart.find(line => line.bundleMode === 'components' && line.productId === productId);
    if (existing) existing.quantity++;
    else posCart.push({
        productId,
        bundleMode: 'components',
        quantity: 1,
        unitPrice: product.salesPrice === '' || product.salesPrice == null ? '' : Number(product.salesPrice) || 0,
        taxStatus: product.taxStatus || '含稅'
    });
    renderPosCart();
    return true;
}

function updatePosCart(lineKey, field, value) {
    const line = posCart.find(item => getPosLineKey(item) === lineKey);
    if (!line) return;
    if (field === 'quantity') {
        const quantity = Number(value);
        if (!Number.isInteger(quantity) || quantity <= 0) return showToast('數量須為正整數。', 'bg-red-500');
        line.quantity = quantity;
    } else if (field === 'unitPrice') {
        if (value === '' || !Number.isFinite(Number(value)) || Number(value) < 0) {
            return showToast('請輸入有效的非負售價。', 'bg-red-500');
        }
        line.unitPrice = Number(value);
    } else if (field === 'taxStatus' && ['含稅', '不含稅', '不計稅'].includes(value)) {
        line.taxStatus = value;
    } else {
        return;
    }
    renderPosCart();
}

function removePosItem(lineKey) {
    posCart = posCart.filter(line => getPosLineKey(line) !== lineKey);
    renderPosCart();
}

function clearPosCart() {
    posCart = [];
    renderPosCart();
}

function getPosDraft() {
    const lines = posCart.map(cartLine => {
        if (cartLine.bundleMode === 'components') {
            const product = (data.products || []).find(item => item.id === cartLine.productId);
            if (!product || !isSalesBundleProduct(product)) return null;
            const estimatedCost = (product.components || []).reduce((sum, component) => {
                const itemCost = (data.inventory || []).filter(item => item.productId === component.productId)
                    .reduce((cost, item) => cost + (Number(item.averageCost || 0) * Number(item.availableQuantity || 0)), 0);
                const itemQuantity = (data.inventory || []).filter(item => item.productId === component.productId)
                    .reduce((amount, item) => amount + Number(item.availableQuantity || 0), 0);
                return sum + Number(component.quantity || 0) * (itemQuantity > 0 ? itemCost / itemQuantity : 0);
            }, 0);
            return {
                ...cartLine,
                inventoryId: '',
                productName: product.prodName || product.id,
                spec: product.spec || '',
                unit: product.unit || 'pcs',
                availableQuantity: getSalesBundleAvailability(product),
                costUnit: estimatedCost
            };
        }
        const item = (data.inventory || []).find(inventoryItem => inventoryItem.id === cartLine.inventoryId);
        if (!item) return null;
        return {
            ...cartLine,
            inventoryId: item.id,
            productId: item.productId || '',
            productName: item.productName || item.productId || '',
            spec: item.spec || '',
            supplierId: item.supplierId || '',
            supplierName: item.supplierName || '',
            warehouse: item.warehouse || '總倉',
            unit: item.unit || 'pcs',
            availableQuantity: Number(item.availableQuantity || 0),
            costUnit: Number(item.averageCost || 0)
        };
    });
    const validLines = lines.filter(Boolean);
    const amounts = calculateFinanceDocumentAmounts(validLines);
    return {
        lines,
        validLines,
        lineAmounts: amounts.lines,
        subtotal: amounts.subtotal,
        taxAmount: amounts.taxAmount,
        totalAmount: amounts.totalAmount
    };
}

function renderPosCart() {
    const container = document.getElementById('posCart');
    if (!container) return;
    const draft = getPosDraft();
    if (!draft.lines.length) {
        container.innerHTML = '<div class="py-10 text-center text-sm text-slate-400">點選左側商品加入銷售</div>';
    } else {
        container.innerHTML = `<table class="min-w-full text-left text-sm">
            <thead><tr class="border-b text-xs text-slate-500"><th class="py-2 pr-2">商品</th><th class="px-1 py-2">數量</th><th class="px-1 py-2">售價</th><th class="px-1 py-2">稅別</th><th class="px-1 py-2 text-right">小計</th><th></th></tr></thead>
            <tbody>${draft.lines.map((line, index) => {
                if (!line) return '';
                const lineTotal = draft.lineAmounts[index]?.totalAmount ?? 0;
                return `<tr class="border-b align-top">
                    <td class="py-2 pr-2"><span class="block font-semibold">${escapeFinanceHtml(line.productName)}</span><span class="text-xs text-slate-500">${escapeFinanceHtml(line.spec)} · ${line.bundleMode === 'components' ? '組成品扣庫' : escapeFinanceHtml(line.warehouse || '')}</span></td>
                    <td class="px-1 py-2"><input aria-label="${escapeFinanceHtml(line.productName)} 數量" data-pos-field="quantity" data-pos-id="${escapeFinanceHtml(getPosLineKey(line))}" type="number" min="1" step="1" value="${escapeFinanceHtml(line.quantity)}" class="w-16 rounded border p-1 text-right"></td>
                    <td class="px-1 py-2"><input aria-label="${escapeFinanceHtml(line.productName)} 售價" data-pos-field="unitPrice" data-pos-id="${escapeFinanceHtml(getPosLineKey(line))}" type="number" min="0" step="0.01" value="${escapeFinanceHtml(line.unitPrice)}" class="w-24 rounded border p-1 text-right"></td>
                    <td class="px-1 py-2"><select aria-label="${escapeFinanceHtml(line.productName)} 稅別" data-pos-field="taxStatus" data-pos-id="${escapeFinanceHtml(getPosLineKey(line))}" class="w-20 rounded border p-1"><option ${line.taxStatus === '含稅' ? 'selected' : ''}>含稅</option><option ${line.taxStatus === '不含稅' ? 'selected' : ''}>不含稅</option><option ${line.taxStatus === '不計稅' ? 'selected' : ''}>不計稅</option></select></td>
                    <td class="px-1 py-2 text-right font-semibold">${formatFinanceMoney(lineTotal)}</td>
                    <td class="px-1 py-2"><button type="button" data-pos-remove="${escapeFinanceHtml(getPosLineKey(line))}" class="font-bold text-red-600" aria-label="移除 ${escapeFinanceHtml(line.productName)}">×</button></td>
                </tr>`;
            }).join('')}</tbody>
        </table>`;
        container.querySelectorAll('[data-pos-field]').forEach(input => {
            input.addEventListener('change', () => updatePosCart(input.dataset.posId, input.dataset.posField, input.value));
        });
        container.querySelectorAll('[data-pos-remove]').forEach(button => {
            button.addEventListener('click', () => removePosItem(button.dataset.posRemove));
        });
    }
    const subtotal = document.getElementById('posSubtotal');
    const tax = document.getElementById('posTax');
    const total = document.getElementById('posTotal');
    if (subtotal) subtotal.textContent = formatFinanceMoney(draft.subtotal);
    if (tax) tax.textContent = formatFinanceMoney(draft.taxAmount);
    if (total) total.textContent = formatFinanceMoney(draft.totalAmount);
}

function completePosSale() {
    const draft = getPosDraft();
    const date = document.getElementById('posDate')?.value || '';
    const customerId = document.getElementById('posCustomer')?.value || '';
    const paymentMethod = document.getElementById('posPaymentMethod')?.value || '';
    const customer = (data.financeCustomers || []).find(item => item.id === customerId);
    if (!draft.lines.length || draft.lines.some(line => !line)) return showToast('請先加入有效的庫存商品。', 'bg-red-500');
    if (!date || !getFinanceDateParts(date)) return showToast('請輸入有效的交易日期。', 'bg-red-500');
    if (!['現金', '匯款', '刷卡'].includes(paymentMethod)) return showToast('請選擇有效的收款方式。', 'bg-red-500');
    for (const line of draft.validLines) {
        if (!Number.isInteger(Number(line.quantity)) || Number(line.quantity) <= 0) return showToast(`「${line.productName}」數量須為正整數。`, 'bg-red-500');
        if (line.unitPrice === '' || line.unitPrice == null ||
            !Number.isFinite(Number(line.unitPrice)) || Number(line.unitPrice) < 0) {
            return showToast(`「${line.productName}」售價無效，請輸入本次成交價。`, 'bg-red-500');
        }
        if (line.bundleMode !== 'components' && Number(line.quantity) > line.availableQuantity) return showToast(`「${line.productName}」可用庫存不足，最新可用數量為 ${line.availableQuantity}。`, 'bg-red-500');
    }
    if (!prepareSalesBundleLineAllocations(draft.validLines)) return showToast('組合組成品或其他銷售品項庫存不足，請重新確認數量。', 'bg-red-500');
    if (!Number.isInteger(draft.totalAmount) || draft.totalAmount < 0) return showToast('銷售總額無效。', 'bg-red-500');
    const customerName = customer?.name || '現場客';
    if (!confirm(`確認向「${customerName}」收款並完成銷售？\n品項：${draft.validLines.length} 項\n收款方式：${paymentMethod}\n應收總額：${formatFinanceMoney(draft.totalAmount)}\n此操作會立即扣庫存並登錄已收帳款。`)) return;

    const previousInventory = JSON.parse(JSON.stringify(data.inventory || []));
    const previousMovements = JSON.parse(JSON.stringify(data.inventoryMovements || []));
    const previousReceivables = JSON.parse(JSON.stringify(data.accountsReceivable || []));
    try {
        if (!Array.isArray(data.accountsReceivable)) data.accountsReceivable = [];
        if (!Array.isArray(data.inventoryMovements)) data.inventoryMovements = [];
        const id = generateFinanceDocumentId('AR', data.accountsReceivable);
        const amountLines = draft.validLines.map((line, index) => {
            const calculated = draft.lineAmounts[index];
            return {
                inventoryId: line.inventoryId,
                productId: line.productId,
                productName: line.productName,
                spec: line.spec,
                bundleMode: line.bundleMode || '',
                quantity: line.quantity,
                unit: line.unit,
                unitPrice: line.unitPrice,
                taxStatus: line.taxStatus,
                amount: calculated.baseAmount,
                taxAmount: calculated.taxAmount,
                totalAmount: calculated.totalAmount
            };
        });
        const documentRecord = {
            id,
            type: 'receivable',
            sourceSalesId: id,
            customerId: customer?.id || '',
            salesNo: id,
            counterpartyName: customerName,
            customerTaxId: customer?.taxId || '',
            customerContactName: customer?.contactName || '',
            customerPhone: customer?.phone || '',
            customerEmail: customer?.email || '',
            customerAddress: customer?.address || '',
            documentDate: date,
            dueDate: date,
            accountingPeriod: date.slice(0, 7),
            invoiceNumber: '',
            invoiceType: '無發票',
            lines: amountLines,
            subtotal: draft.subtotal,
            shipping: 0,
            discount: 0,
            taxAmount: draft.taxAmount,
            totalAmount: draft.totalAmount,
            paidAmount: draft.totalAmount,
            payments: [{ amount: draft.totalAmount, date, method: paymentMethod, note: 'POS 收銀', createdAt: new Date().toISOString() }],
            status: 'paid',
            channel: 'POS收銀',
            createdAt: new Date().toISOString()
        };
        for (const line of draft.validLines) {
            if (line.bundleMode === 'components') {
                applySalesBundleConsumption(line, {
                    orderId: id,
                    date,
                    channel: 'POS收銀',
                    note: `POS 收銀 ${id}`
                });
                continue;
            }
            const inventoryItem = (data.inventory || []).find(item => item.id === line.inventoryId);
            if (!inventoryItem || Number(inventoryItem.availableQuantity || 0) < Number(line.quantity)) {
                throw new Error(`「${line.productName}」庫存已變動，請重新確認後再結帳。`);
            }
            const costUnit = Number(inventoryItem.averageCost || 0);
            inventoryItem.quantity = Number(inventoryItem.quantity || 0) - Number(line.quantity);
            inventoryItem.availableQuantity = Number(inventoryItem.availableQuantity || 0) - Number(line.quantity);
            inventoryItem.totalCost = inventoryItem.quantity * costUnit;
            inventoryItem.status = inventoryItem.quantity > 0 ? inventoryItem.status : '缺貨';
            inventoryItem.lastUpdated = new Date().toISOString();
            data.inventoryMovements.push({
                id: generateOutboundId(),
                type: 'outbound',
                inventoryId: inventoryItem.id,
                orderId: id,
                orderNo: id,
                accountsDocumentId: id,
                salesNo: id,
                productId: inventoryItem.productId,
                productName: inventoryItem.productName,
                spec: inventoryItem.spec,
                supplierId: inventoryItem.supplierId || '',
                supplierName: inventoryItem.supplierName || '',
                warehouse: inventoryItem.warehouse || '總倉',
                batchNo: '',
                quantity: line.quantity,
                unitCost: line.unitPrice,
                salesPrice: line.unitPrice,
                costUnit,
                totalCost: line.unitPrice * line.quantity,
                sourceDate: date,
                arrivalDate: '',
                invoiceType: '無發票',
                invoiceNo: '',
                invoiceDate: date,
                channel: 'POS收銀',
                note: `POS 收銀 ${id}`,
                bundleMode: line.bundleMode || '',
                createdAt: new Date().toISOString()
            });
        }
        data.accountsReceivable.unshift(documentRecord);
        if (!saveData()) throw new Error('POS 交易儲存失敗，資料已還原；請先備份或釋出瀏覽器儲存空間後重試。');
        clearPosCart();
        renderPosProducts();
        renderFinance();
        renderInventory();
        renderShipping();
        renderReports();
        showToast(`POS 交易 ${id} 已結帳，收款與庫存異動已同步。`, 'bg-green-600');
    } catch (error) {
        data.inventory = previousInventory;
        data.inventoryMovements = previousMovements;
        data.accountsReceivable = previousReceivables;
        return showToast(error.message || 'POS 結帳失敗，交易資料已還原。', 'bg-red-500');
    }
}
