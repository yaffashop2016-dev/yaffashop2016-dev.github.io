function getFinanceToday() {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function formatFinanceMoney(amount) {
    const value = Math.round(Number(amount) || 0);
    return value < 0 ? `-$${Math.abs(value).toLocaleString('zh-TW')}` : `$${value.toLocaleString('zh-TW')}`;
}

function formatFinanceUnitPrice(amount) {
    return `$${(Number(amount) || 0).toLocaleString('zh-TW', { maximumFractionDigits: 2 })}`;
}

function roundFinanceMoney(amount) {
    return Math.round(Number(amount) || 0);
}

function escapeFinanceHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);
}

function getFinanceBalance(document) {
    if (document.returnKind === 'supplier-credit') {
        return Math.min(0, roundFinanceMoney(Number(document.totalAmount || 0) - Number(document.paidAmount || 0)));
    }
    return Math.max(0, roundFinanceMoney(Number(document.totalAmount || 0) - Number(document.paidAmount || 0)));
}

function getPurchaseOrderPaymentStatus(order) {
    const payables = (data.accountsPayable || []).filter(document => document.sourceOrderId === order.id);
    if (!payables.length) return order.paymentStatus || 'unpaid';
    const total = payables.reduce((sum, document) => sum + Number(document.totalAmount || 0), 0);
    const paid = payables.reduce((sum, document) => sum + Number(document.paidAmount || 0), 0);
    if (total <= paid) return 'paid';
    return paid > 0 ? 'partial' : 'unpaid';
}

function getFinanceStatus(document) {
    if (document.status === 'void') return '已作廢';
    if (document.returnKind === 'supplier-credit') return '退貨折讓';
    if (getFinanceBalance(document) <= 0) return '已結清';
    if (document.dueDate && document.dueDate < getFinanceToday()) return '已逾期';
    if (Number(document.paidAmount || 0) > 0) return '部分收付';
    return '未收付';
}

function getFinanceStatusClass(document) {
    const status = getFinanceStatus(document);
    if (document.returnKind === 'supplier-credit') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (status === '已結清') return 'bg-green-50 text-green-700 border-green-200';
    if (status === '部分收付') return 'bg-amber-50 text-amber-700 border-amber-200';
    if (status === '已作廢') return 'bg-gray-100 text-gray-500 border-gray-200';
    return 'bg-red-50 text-red-700 border-red-200';
}

function generateFinanceDocumentId(kind, collection) {
    const now = new Date();
    const prefix = `${kind}${String(now.getFullYear() - 1911).padStart(3, '0')}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const nextNumber = collection
        .filter(document => document.id?.startsWith(prefix))
        .reduce((maximum, document) => Math.max(maximum, Number(document.id.slice(prefix.length)) || 0), 0) + 1;
    return `${prefix}${String(nextNumber).padStart(3, '0')}`;
}

function allocateFinanceWholeAmount(total, components) {
    const weightTotal = components.reduce((sum, component) => sum + component.weight, 0);
    if (total <= 0 || weightTotal <= 0) return components.map(() => 0);
    const allocations = components.map(component => {
        const exact = total * component.weight / weightTotal;
        return { value: Math.floor(exact), remainder: exact - Math.floor(exact) };
    });
    let remaining = total - allocations.reduce((sum, allocation) => sum + allocation.value, 0);
    const order = allocations.map((allocation, index) => ({ index, remainder: allocation.remainder }))
        .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
    for (let index = 0; remaining > 0; index++, remaining--) {
        allocations[order[index % order.length].index].value++;
    }
    return allocations.map(allocation => allocation.value);
}

function calculateFinanceDocumentAmounts(lines) {
    const calculatedLines = lines.map(line => ({
        ...line,
        productGross: (Number(line.unitPrice) || 0) * (Number(line.quantity) || 0),
        shippingGross: Number(line.shipping) || 0,
        baseAmount: 0,
        shippingAmount: 0,
        taxAmount: 0,
        totalAmount: 0
    }));
    const buckets = new Map();
    calculatedLines.forEach((line, index) => {
        const taxStatus = line.taxStatus || '含稅';
        if (!buckets.has(taxStatus)) buckets.set(taxStatus, []);
        buckets.get(taxStatus).push(index);
    });
    let totalAmount = 0;
    let taxAmount = 0;
    for (const [taxStatus, indices] of buckets) {
        const components = indices.flatMap(index => [
            { lineIndex: index, field: 'baseAmount', weight: calculatedLines[index].productGross },
            { lineIndex: index, field: 'shippingAmount', weight: calculatedLines[index].shippingGross }
        ]);
        const grossAmount = components.reduce((sum, component) => sum + component.weight, 0);
        let bucketBase = grossAmount;
        let bucketTax = 0;
        let bucketTotal = roundFinanceMoney(grossAmount);
        if (taxStatus === '含稅') {
            bucketBase = roundFinanceMoney(bucketTotal / 1.05);
            bucketTax = bucketTotal - bucketBase;
        } else if (taxStatus === '不含稅') {
            bucketBase = roundFinanceMoney(grossAmount);
            bucketTax = roundFinanceMoney(grossAmount * 0.05);
            bucketTotal = bucketBase + bucketTax;
        } else {
            bucketBase = roundFinanceMoney(grossAmount);
        }
        const baseAllocations = allocateFinanceWholeAmount(bucketBase, components);
        components.forEach((component, index) => {
            calculatedLines[component.lineIndex][component.field] = baseAllocations[index];
        });
        if (taxStatus === '含稅' || taxStatus === '不含稅') {
            const taxAllocations = allocateFinanceWholeAmount(bucketTax, indices.map(index => ({
                weight: calculatedLines[index].productGross + calculatedLines[index].shippingGross
            })));
            indices.forEach((lineIndex, index) => {
                calculatedLines[lineIndex].taxAmount = taxAllocations[index];
            });
        }
        indices.forEach(index => {
            const line = calculatedLines[index];
            line.totalAmount = line.baseAmount + line.shippingAmount + line.taxAmount;
        });
        totalAmount += bucketTotal;
        taxAmount += bucketTax;
    }
    return {
        lines: calculatedLines,
        subtotal: calculatedLines.reduce((sum, line) => sum + line.baseAmount, 0),
        shipping: calculatedLines.reduce((sum, line) => sum + line.shippingAmount, 0),
        taxAmount,
        totalAmount
    };
}

function calculateFinanceLine(line) {
    return calculateFinanceDocumentAmounts([line]).lines[0];
}

function parseFinanceTermDay(value) {
    if (value === '' || value === null || value === undefined) return null;
    const day = Number(value);
    return Number.isInteger(day) && day >= 1 && day <= 31 ? day : null;
}

function getFinanceDateParts(dateString) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString || '');
    if (!match) return null;
    const [, yearText, monthText, dayText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return { year, month, day };
}

function formatFinanceDate(date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function calculateCounterpartyTerms(counterparty, transactionDate, fallbackMonthlyDays = '') {
    const parts = getFinanceDateParts(transactionDate);
    if (!parts) return { dueDate: '', accountingPeriod: '', closingDay: '', paymentDay: '' };
    const closingDay = parseFinanceTermDay(counterparty?.closingDay);
    const paymentDay = parseFinanceTermDay(counterparty?.paymentDay);
    if (closingDay && paymentDay) {
        const closingDate = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
        const accountingMonth = parts.month - 1 + (parts.day > Math.min(closingDay, closingDate) ? 1 : 0);
        const paymentMonth = accountingMonth + (paymentDay <= closingDay ? 1 : 0);
        const accountingDate = new Date(Date.UTC(parts.year, accountingMonth, 1));
        const dueDate = new Date(Date.UTC(parts.year, paymentMonth, 1));
        dueDate.setUTCDate(Math.min(paymentDay, new Date(Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth() + 1, 0)).getUTCDate()));
        return {
            dueDate: formatFinanceDate(dueDate),
            accountingPeriod: `${accountingDate.getUTCFullYear()}-${String(accountingDate.getUTCMonth() + 1).padStart(2, '0')}`,
            closingDay,
            paymentDay
        };
    }

    const monthlyDays = Number.parseInt(fallbackMonthlyDays || counterparty?.monthlyDays, 10);
    if (counterparty?.paymentType !== '月結' || !Number.isInteger(monthlyDays) || monthlyDays <= 0) {
        return { dueDate: '', accountingPeriod: `${parts.year}-${String(parts.month).padStart(2, '0')}`, closingDay: '', paymentDay: '' };
    }
    const dueDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + monthlyDays));
    return {
        dueDate: formatFinanceDate(dueDate),
        accountingPeriod: `${parts.year}-${String(parts.month).padStart(2, '0')}`,
        closingDay: '',
        paymentDay: ''
    };
}

function calculateSupplierDueDate(supplier, receivedDate) {
    return calculateCounterpartyTerms(supplier, receivedDate, supplier?.monthlyDays).dueDate;
}

function findFinanceCustomer(name) {
    const normalizedName = String(name || '').trim().toLocaleLowerCase();
    return (data.financeCustomers || []).find(customer =>
        String(customer.name || '').trim().toLocaleLowerCase() === normalizedName
    );
}

function searchFinanceCustomersForSales(query) {
    const suggestions = document.getElementById('salesCustomerSuggestions');
    if (!suggestions) return;
    const normalizedQuery = String(query || '').trim().toLocaleLowerCase();
    const exactMatch = findFinanceCustomer(query);
    document.getElementById('salesCustomerClosingDay').value = exactMatch?.closingDay || '';
    document.getElementById('salesCustomerPaymentDay').value = exactMatch?.paymentDay || '';
    if (!normalizedQuery) {
        suggestions.innerHTML = '';
        suggestions.classList.add('hidden');
        return;
    }
    const matches = (data.financeCustomers || []).map(customer => {
        const fields = [customer.name, customer.taxId, customer.contactName, customer.phone, customer.email];
        const normalizedFields = fields.map(value => String(value || '').toLocaleLowerCase());
        const matchIndex = normalizedFields.findIndex(value => value.includes(normalizedQuery));
        return { customer, rank: matchIndex === 0 ? 0 : matchIndex > 0 ? 1 : 2 };
    }).filter(match => match.rank < 2)
        .sort((a, b) => a.rank - b.rank || String(a.customer.name).localeCompare(String(b.customer.name), 'zh-Hant'))
        .slice(0, 8);
    if (!matches.length) {
        suggestions.innerHTML = '<div class="px-3 py-2 text-sm text-slate-500">沒有符合的客戶，可先至「客戶管理」新增資料。</div>';
        suggestions.classList.remove('hidden');
        return;
    }
    suggestions.innerHTML = matches.map(({ customer }) => `
        <button type="button" class="block w-full border-b px-3 py-2 text-left last:border-b-0 hover:bg-emerald-50"
            onmousedown="event.preventDefault()" onclick="selectFinanceCustomerForSales('${escapeFinanceHtml(customer.id)}')">
            <span class="block font-semibold text-slate-800">${escapeFinanceHtml(customer.name)}</span>
            <span class="block text-xs text-slate-500">${customer.taxId ? `統編 ${escapeFinanceHtml(customer.taxId)} · ` : ''}${customer.contactName ? `聯絡人 ${escapeFinanceHtml(customer.contactName)} · ` : ''}${customer.phone ? escapeFinanceHtml(customer.phone) : '未留電話'}</span>
        </button>
    `).join('');
    suggestions.classList.remove('hidden');
}

function selectFinanceCustomerForSales(customerId) {
    const customer = (data.financeCustomers || []).find(item => item.id === customerId);
    if (!customer) return showToast('找不到客戶資料，請重新搜尋。', 'bg-red-500');
    document.getElementById('salesCustomerName').value = customer.name;
    document.getElementById('salesCustomerSuggestions').classList.add('hidden');
    loadFinanceCustomerTerms();
}

function updateSalesFinanceTermsPreview() {
    const name = document.getElementById('salesCustomerName')?.value || '';
    const closingDay = document.getElementById('salesCustomerClosingDay')?.value || '';
    const paymentDay = document.getElementById('salesCustomerPaymentDay')?.value || '';
    const date = document.getElementById('salesInvoiceDate')?.value || '';
    const dueDateInput = document.getElementById('salesDueDate');
    const preview = document.getElementById('salesDueDatePreview');
    if (!preview || !dueDateInput) return;
    if (!closingDay && !paymentDay) {
        preview.textContent = '填寫關帳日及付款日後自動試算帳期與到期日。';
        return;
    }
    if (!closingDay || !paymentDay || !parseFinanceTermDay(closingDay) || !parseFinanceTermDay(paymentDay)) {
        preview.textContent = '請同時填入 1 至 31 日的關帳日與指定付款日。';
        return;
    }
    const terms = calculateCounterpartyTerms({ closingDay, paymentDay }, date);
    if (!terms.dueDate) {
        preview.textContent = '請先選擇有效出貨日期。';
        return;
    }
    dueDateInput.value = terms.dueDate;
    preview.textContent = `${name ? `${name} · ` : ''}帳款期別 ${terms.accountingPeriod}，指定於 ${terms.dueDate} 付款`;
}

function loadFinanceCustomerTerms() {
    const name = document.getElementById('salesCustomerName')?.value || '';
    const customer = findFinanceCustomer(name);
    document.getElementById('salesCustomerClosingDay').value = customer?.closingDay || '';
    document.getElementById('salesCustomerPaymentDay').value = customer?.paymentDay || '';
    document.getElementById('salesDeliveryAddress').value = customer?.address || '';
    document.getElementById('salesDueDate').value = '';
    updateSalesFinanceTermsPreview();
}

function saveFinanceCustomerTerms(name, closingDay, paymentDay) {
    if (!closingDay || !paymentDay) return;
    if (!Array.isArray(data.financeCustomers)) data.financeCustomers = [];
    const existing = findFinanceCustomer(name);
    if (existing) {
        existing.closingDay = closingDay || '';
        existing.paymentDay = paymentDay || '';
        existing.updatedAt = new Date().toISOString();
    } else if (closingDay && paymentDay) {
        data.financeCustomers.push({
            id: `fc_${Date.now()}`,
            name: name.trim(),
            closingDay,
            paymentDay,
            createdAt: new Date().toISOString()
        });
    }
}

function resetFinanceCustomerForm() {
        const form = document.getElementById('financeCustomerForm');
        if (form) form.reset();
        document.getElementById('financeCustomerId').value = '';
        document.getElementById('financeCustomerFormTitle').textContent = '新增客戶';
        document.getElementById('financeCustomerSubmit').textContent = '儲存客戶';
}

function editFinanceCustomer(customerId) {
        const customer = (data.financeCustomers || []).find(item => item.id === customerId);
        if (!customer) return showToast('找不到客戶資料。', 'bg-red-500');
        document.getElementById('financeCustomerId').value = customer.id;
        document.getElementById('financeCustomerName').value = customer.name || '';
        document.getElementById('financeCustomerTaxId').value = customer.taxId || '';
        document.getElementById('financeCustomerContact').value = customer.contactName || '';
        document.getElementById('financeCustomerPhone').value = customer.phone || '';
        document.getElementById('financeCustomerEmail').value = customer.email || '';
        document.getElementById('financeCustomerAddress').value = customer.address || '';
        document.getElementById('financeCustomerPaymentType').value = customer.paymentType || '';
        document.getElementById('financeCustomerClosingDay').value = customer.closingDay || '';
        document.getElementById('financeCustomerPaymentDay').value = customer.paymentDay || '';
        document.getElementById('financeCustomerRemittance').value = customer.remittance || '';
        document.getElementById('financeCustomerNote').value = customer.note || '';
        document.getElementById('financeCustomerFormTitle').textContent = '修改客戶';
        document.getElementById('financeCustomerSubmit').textContent = '更新客戶';
        document.getElementById('financeCustomerName').focus();
}

function saveFinanceCustomer(event) {
        event.preventDefault();
        if (!Array.isArray(data.financeCustomers)) data.financeCustomers = [];
        const id = document.getElementById('financeCustomerId').value;
        const name = document.getElementById('financeCustomerName').value.trim();
        const closingDayValue = document.getElementById('financeCustomerClosingDay').value;
        const paymentDayValue = document.getElementById('financeCustomerPaymentDay').value;
        const closingDay = parseFinanceTermDay(closingDayValue);
        const paymentDay = parseFinanceTermDay(paymentDayValue);
        if ((closingDayValue || paymentDayValue) && (!closingDay || !paymentDay)) {
            return showToast('關帳日與指定付款日請同時填入 1 至 31 日。', 'bg-red-500');
        }
        const normalizedName = name.toLocaleLowerCase();
        if (data.financeCustomers.some(customer =>
            customer.id !== id && String(customer.name || '').trim().toLocaleLowerCase() === normalizedName
        )) return showToast('已有相同名稱的客戶，請修改既有資料以避免重複。', 'bg-red-500');

        const previous = data.financeCustomers.find(customer => customer.id === id);
        const customer = {
            ...(previous || {}),
            id: previous?.id || `fc_${Date.now()}`,
            name,
            taxId: document.getElementById('financeCustomerTaxId').value.trim(),
            contactName: document.getElementById('financeCustomerContact').value.trim(),
            phone: document.getElementById('financeCustomerPhone').value.trim(),
            email: document.getElementById('financeCustomerEmail').value.trim(),
            address: document.getElementById('financeCustomerAddress').value.trim(),
            paymentType: document.getElementById('financeCustomerPaymentType').value,
            closingDay: closingDay || '',
            paymentDay: paymentDay || '',
            remittance: document.getElementById('financeCustomerRemittance').value.trim(),
            note: document.getElementById('financeCustomerNote').value.trim(),
            updatedAt: new Date().toISOString()
        };
        if (!previous) customer.createdAt = customer.updatedAt;
        if (previous) data.financeCustomers[data.financeCustomers.indexOf(previous)] = customer;
        else data.financeCustomers.push(customer);
        saveData();
        resetFinanceCustomerForm();
        renderFinanceCustomers();
        showToast(previous ? '客戶資料已更新。' : '客戶已新增。', 'bg-green-600');
}

function deleteFinanceCustomer(customerId) {
        const customer = (data.financeCustomers || []).find(item => item.id === customerId);
        if (!customer) return showToast('找不到客戶資料。', 'bg-red-500');
        if (!confirm(`確定刪除客戶「${customer.name}」？既有應收單據不會受影響。`)) return;
        data.financeCustomers = data.financeCustomers.filter(item => item.id !== customerId);
        saveData();
        renderFinanceCustomers();
        showToast('客戶資料已刪除。', 'bg-green-600');
}

function renderFinanceCustomers() {
        const container = document.getElementById('financeCustomerList');
        if (!container) return;
        const keyword = (document.getElementById('searchFinanceCustomer')?.value || '').trim().toLocaleLowerCase();
        const customers = (data.financeCustomers || []).filter(customer =>
            !keyword || [customer.name, customer.taxId, customer.contactName, customer.phone, customer.email]
                .some(value => String(value || '').toLocaleLowerCase().includes(keyword))
        ).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant'));
        if (!customers.length) {
            container.innerHTML = '<div class="rounded border bg-white p-5 text-center text-sm text-slate-500">尚無客戶資料，請先新增客戶。</div>';
            return;
        }
        container.innerHTML = customers.map(customer => `
            <article class="rounded border bg-white p-4 shadow-sm">
                <div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                    <div class="min-w-0">
                        <h3 class="font-bold text-slate-800">${escapeFinanceHtml(customer.name)}</h3>
                        <div class="mt-1 grid grid-cols-1 gap-x-4 gap-y-1 text-sm text-slate-600 sm:grid-cols-2">
                            <span>統編：${escapeFinanceHtml(customer.taxId || '-')}</span>
                            <span>聯絡人：${escapeFinanceHtml(customer.contactName || '-')}</span>
                            <span>電話：${escapeFinanceHtml(customer.phone || '-')}</span>
                            <span>Email：${escapeFinanceHtml(customer.email || '-')}</span>
                            <span>付款方式：${escapeFinanceHtml(customer.paymentType || '-')}</span>
                            <span>條件：${customer.closingDay && customer.paymentDay ? `關帳 ${escapeFinanceHtml(customer.closingDay)} 日／付款 ${escapeFinanceHtml(customer.paymentDay)} 日` : '未設定'}</span>
                            <span class="sm:col-span-2">地址：${escapeFinanceHtml(customer.address || '-')}</span>
                        </div>
                    </div>
                    <div class="flex shrink-0 gap-2">
                        <button type="button" onclick="editFinanceCustomer('${escapeFinanceHtml(customer.id)}')" class="rounded bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-100">修改</button>
                        <button type="button" onclick="deleteFinanceCustomer('${escapeFinanceHtml(customer.id)}')" class="rounded bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-100">刪除</button>
                    </div>
                </div>
                ${customer.note ? `<p class="mt-2 border-t pt-2 text-sm text-slate-500">備註：${escapeFinanceHtml(customer.note)}</p>` : ''}
            </article>
        `).join('');
}

function createPayablesFromOrder(orderId) {
    if (!Array.isArray(data.accountsPayable)) data.accountsPayable = [];
    const order = data.orders.find(item => item.id === orderId);
    if (!order) return showToast('找不到指定訂單', 'bg-red-500');
    if (!['arrived', 'completed', 'closed'].includes(order.status)) {
        return showToast('請先將訂單狀態更新為已收貨或已驗收完成，再建立應付單。', 'bg-red-500');
    }
    if (!Array.isArray(order.items) || order.items.length === 0) return showToast('訂單沒有明細，無法建立應付單。', 'bg-red-500');
    if (order.items.some(item => Number(item.acceptedQuantity ?? (order.inventoryTransferred ? item.quantity : 0)) < Number(item.quantity || 0))) {
        return showToast('訂單尚有未驗收合格數量，請完成收貨驗收後再建立應付單。', 'bg-red-500');
    }

    const groups = new Map();
    for (const item of order.items) {
        const product = data.products.find(candidate => candidate.id === item.productId);
        if (!product) return showToast(`找不到產品 ${item.productId}，請先修正訂單資料。`, 'bg-red-500');
        const supplierId = item.supplierId || order.supplierId || product.supplierId || '';
        const supplier = data.suppliers.find(candidate => candidate.id === supplierId);
        const supplierName = item.supplierName || order.supplierName || supplier?.name || '未指定供應商';
        const key = supplierId || supplierName;
        if (!groups.has(key)) groups.set(key, { supplierId, supplierName, supplier, lines: [], subtotal: 0 });

        const quantity = Number(item.quantity) || 0;
        if (!Number.isFinite(quantity) || quantity <= 0) return showToast(`產品「${product.prodName}」的數量無效。`, 'bg-red-500');
        const line = {
            productId: item.productId,
            productName: item.productName || product.prodName || '未知產品',
            spec: item.spec || product.spec || '',
            quantity,
            unitPrice: Number(item.customPrice) || 0,
            shipping: Number(item.customShipping) || 0,
            taxStatus: item.taxStatus || '含稅'
        };
        const group = groups.get(key);
        group.lines.push(line);
    }

    const receivedDate = order.arrivalDate || getFinanceToday();
    const existingSupplierIds = new Set(data.accountsPayable
        .filter(document => document.sourceOrderId === order.id)
        .map(document => document.supplierId || document.supplierName));
    const newDocuments = [];
    const groupEntries = Array.from(groups.values()).map(group => {
        const amounts = calculateFinanceDocumentAmounts(group.lines);
        return { ...group, amounts, subtotal: amounts.totalAmount };
    });
    const groupTotal = roundFinanceMoney(groupEntries.reduce((sum, group) => sum + group.subtotal, 0));
    let remainingDiscount = roundFinanceMoney(Math.min(Math.max(0, Number(order.discount || 0)), groupTotal));

    groupEntries.forEach((group, index) => {
        const sourceKey = group.supplierId || group.supplierName;
        if (existingSupplierIds.has(sourceKey)) return;
        const allocatedDiscount = index === groupEntries.length - 1
            ? remainingDiscount
            : groupTotal > 0 ? Math.min(group.subtotal, roundFinanceMoney(remainingDiscount * group.subtotal / groupTotal)) : 0;
        remainingDiscount = roundFinanceMoney(remainingDiscount - allocatedDiscount);
        const totalAmount = Math.max(0, roundFinanceMoney(group.subtotal - allocatedDiscount));
        const id = generateFinanceDocumentId('AP', [...data.accountsPayable, ...newDocuments]);
        newDocuments.push({
            id,
            type: 'payable',
            sourceOrderId: order.id,
            supplierId: group.supplierId,
            counterpartyName: group.supplierName,
            documentDate: receivedDate,
            ...calculateCounterpartyTerms(group.supplier, receivedDate, group.supplier?.monthlyDays),
            invoiceNumber: order.invoiceNumber || '',
            invoiceType: '',
            lines: group.amounts.lines.map(line => {
                const { productGross, shippingGross, ...snapshot } = line;
                return snapshot;
            }),
            subtotal: group.amounts.subtotal,
            shipping: group.amounts.shipping,
            discount: allocatedDiscount,
            taxAmount: group.amounts.taxAmount,
            totalAmount,
            paidAmount: 0,
            payments: [],
            status: 'unpaid',
            createdAt: new Date().toISOString()
        });
    });

    if (newDocuments.length === 0) return showToast('此訂單的應付單已全部建立，沒有重複新增。', 'bg-amber-600');
    const summary = newDocuments.map(document => `${document.counterpartyName} ${formatFinanceMoney(document.totalAmount)}`).join('\n');
    if (!confirm(`將依供應商建立 ${newDocuments.length} 張應付單：\n${summary}\n\n來源訂單：${order.id}\n確認建立？`)) return;

    data.accountsPayable.push(...newDocuments);
    saveData();
    renderFinance();
    renderOrders();
    showToast(`已建立 ${newDocuments.length} 張應付單`, 'bg-green-600');
}

function addSalesInvoiceLine() {
    const tbody = document.getElementById('salesInvoiceLines');
    if (!tbody) return;
    const row = document.createElement('tr');
    row.className = 'sales-invoice-line border-t';

    const productCell = document.createElement('td');
    productCell.className = 'min-w-64 px-2 py-2';
    const productSelect = document.createElement('select');
    productSelect.className = 'sales-inventory-id w-full rounded border p-2';
    productSelect.required = true;
    productSelect.innerHTML = '<option value="">選擇可用庫存</option>';
    data.inventory.filter(item => Number(item.availableQuantity || 0) > 0).forEach(item => {
        const option = document.createElement('option');
        option.value = item.id;
        const product = (data.products || []).find(candidate => candidate.id === item.productId);
        option.textContent = `${item.productName || item.productId} · ${item.spec || '無規格'}${isSalesBundleProduct(product) ? ' · 已組裝 C 庫存' : ''} · 可用 ${item.availableQuantity} · ${item.id}`;
        productSelect.appendChild(option);
    });
    (data.products || []).filter(product => isSalesBundleProduct(product) && getSalesBundleAvailability(product) > 0)
        .forEach(product => {
            const option = document.createElement('option');
            option.value = `bundle-components:${product.id}`;
            option.textContent = `${product.prodName || product.id} · 組成品扣庫 · 可組 ${getSalesBundleAvailability(product)}`;
            productSelect.appendChild(option);
        });
    productSelect.addEventListener('change', () => {
        const isBundle = productSelect.value.startsWith('bundle-components:');
        const bundleProduct = isBundle
            ? data.products.find(product => product.id === productSelect.value.slice('bundle-components:'.length))
            : null;
        const inventoryItem = data.inventory.find(item => item.id === productSelect.value);
        row.querySelector('.sales-available').textContent = bundleProduct
            ? String(getSalesBundleAvailability(bundleProduct))
            : inventoryItem ? String(inventoryItem.availableQuantity) : '-';
        const priceInput = row.querySelector('.sales-unit-price');
        const selectedPrice = bundleProduct
            ? (bundleProduct.salesPrice === '' || bundleProduct.salesPrice == null ? '' : Number(bundleProduct.salesPrice) || 0)
            : inventoryItem ? getInventorySalesPrice(inventoryItem) : null;
        const selectionKey = bundleProduct ? `bundle:${bundleProduct.id}` : inventoryItem?.id;
        if (selectionKey && selectionKey !== priceInput.dataset.inventoryId) {
            priceInput.value = selectedPrice;
            priceInput.dataset.inventoryId = selectionKey;
        }
        updateSalesInvoiceTotal();
    });
    productCell.appendChild(productSelect);

    const availableCell = document.createElement('td');
    availableCell.className = 'sales-available px-2 py-2 text-center text-slate-500';
    availableCell.textContent = '-';

    const quantityCell = document.createElement('td');
    quantityCell.className = 'px-2 py-2';
    quantityCell.innerHTML = '<input type="number" min="1" step="1" value="1" required class="sales-quantity w-24 rounded border p-2 text-right" oninput="updateSalesInvoiceTotal()">';

    const priceCell = document.createElement('td');
    priceCell.className = 'px-2 py-2';
    priceCell.innerHTML = '<input type="number" min="0" step="0.01" required class="sales-unit-price w-28 rounded border p-2 text-right" placeholder="售價" oninput="updateSalesInvoiceTotal()">';

    const taxCell = document.createElement('td');
    taxCell.className = 'px-2 py-2';
    taxCell.innerHTML = '<select class="sales-tax-status rounded border p-2" onchange="updateSalesInvoiceTotal()"><option value="含稅">含稅</option><option value="不含稅">未稅</option><option value="不計稅">不計稅</option></select>';

    const removeCell = document.createElement('td');
    removeCell.className = 'px-2 py-2';
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'rounded px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50';
    removeButton.textContent = '移除';
    removeButton.addEventListener('click', () => {
        row.remove();
        updateSalesInvoiceTotal();
    });
    removeCell.appendChild(removeButton);

    row.append(productCell, availableCell, quantityCell, priceCell, taxCell, removeCell);
    tbody.appendChild(row);
    updateSalesInvoiceTotal();
}

function openSalesInvoiceForInventory(inventoryId) {
    const item = data.inventory.find(inventoryItem => inventoryItem.id === inventoryId);
    if (!item) return showToast('找不到庫存項目。', 'bg-red-500');
    if (Number(item.availableQuantity || 0) <= 0) return showToast('此品項沒有可用庫存。', 'bg-red-500');
    switchTab('finance');
    const formDetails = document.querySelector('#page-finance details');
    if (formDetails) formDetails.open = true;
    addSalesInvoiceLine();
    const rows = document.querySelectorAll('#salesInvoiceLines .sales-invoice-line');
    const row = rows[rows.length - 1];
    const productSelect = row?.querySelector('.sales-inventory-id');
    if (productSelect) {
        productSelect.value = inventoryId;
        productSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    document.getElementById('salesCustomerName').focus();
}

function getSalesInvoiceDraft() {
    const rows = Array.from(document.querySelectorAll('#salesInvoiceLines .sales-invoice-line'));
    const lines = rows.map(row => {
        const selection = row.querySelector('.sales-inventory-id')?.value || '';
        const bundleProduct = selection.startsWith('bundle-components:')
            ? data.products.find(product => product.id === selection.slice('bundle-components:'.length))
            : null;
        const inventoryItem = data.inventory.find(item => item.id === selection);
        const quantity = Number(row.querySelector('.sales-quantity')?.value);
        const unitPriceValue = row.querySelector('.sales-unit-price')?.value;
        const unitPrice = unitPriceValue === '' ? '' : Number(unitPriceValue);
        const taxStatus = row.querySelector('.sales-tax-status')?.value || '含稅';
        const product = bundleProduct || (data.products || []).find(item => item.id === inventoryItem?.productId);
        return bundleProduct ? {
            inventoryId: '',
            productId: bundleProduct.id,
            productName: bundleProduct.prodName || '',
            spec: bundleProduct.spec || '',
            supplierName: '',
            warehouse: '組合扣料',
            unit: bundleProduct.unit || 'pcs',
            availableQuantity: getSalesBundleAvailability(bundleProduct),
            costUnit: 0,
            bundleMode: 'components',
            quantity,
            unitPrice,
            taxStatus
        } : inventoryItem ? {
            inventoryId: inventoryItem.id,
            productId: inventoryItem.productId,
            productName: inventoryItem.productName || '',
            spec: inventoryItem.spec || '',
            supplierName: inventoryItem.supplierName || '',
            warehouse: inventoryItem.warehouse || '總倉',
            unit: inventoryItem.unit || 'pcs',
            availableQuantity: Number(inventoryItem.availableQuantity || 0),
            costUnit: Number(inventoryItem.averageCost || 0),
            bundleMode: isSalesBundleProduct(product) ? 'assembled' : '',
            quantity,
            unitPrice,
            taxStatus
        } : null;
    });
    const validLines = lines.filter(Boolean);
    const amounts = calculateFinanceDocumentAmounts(validLines);
    const shipping = roundFinanceMoney(Number(document.getElementById('salesInvoiceShipping')?.value) || 0);
    const discount = roundFinanceMoney(Number(document.getElementById('salesInvoiceDiscount')?.value) || 0);
    return {
        rows,
        lines,
        validLines,
        lineAmounts: amounts.lines,
        subtotal: amounts.subtotal,
        taxAmount: amounts.taxAmount,
        shipping,
        discount,
        totalAmount: roundFinanceMoney(amounts.totalAmount + shipping - discount)
    };
}

function updateSalesInvoiceTotal() {
    const totalElement = document.getElementById('salesInvoiceTotal');
    if (!totalElement) return;
    const draft = getSalesInvoiceDraft();
    totalElement.textContent = formatFinanceMoney(draft.totalAmount);
}

function createSalesInvoice(event) {
    event.preventDefault();
    const customerName = document.getElementById('salesCustomerName').value.trim();
    const documentDate = document.getElementById('salesInvoiceDate').value;
    const closingDayValue = document.getElementById('salesCustomerClosingDay').value;
    const paymentDayValue = document.getElementById('salesCustomerPaymentDay').value;
    if (!customerName) return showToast('請輸入客戶名稱。', 'bg-red-500');
    const closingDay = parseFinanceTermDay(closingDayValue);
    const paymentDay = parseFinanceTermDay(paymentDayValue);
    const customer = findFinanceCustomer(customerName);
    if (!customer) return showToast('此客戶尚未建檔，請先至「客戶管理」新增並選取客戶，再建立出貨單。', 'bg-red-500');
    if ((closingDayValue || paymentDayValue) && (!closingDay || !paymentDay)) {
        return showToast('客戶關帳日及指定付款日請同時填入 1 至 31 日。', 'bg-red-500');
    }
    const draft = getSalesInvoiceDraft();
    if (!documentDate) return showToast('請選擇出貨日期。', 'bg-red-500');
    if (draft.rows.length === 0 || draft.lines.some(line => !line)) return showToast('請至少選擇一個有效庫存品項。', 'bg-red-500');
    if (draft.validLines.length !== draft.lines.length) return showToast('出貨品項無效，請重新選擇庫存。', 'bg-red-500');

    const seenInventoryIds = new Set();
    for (const line of draft.validLines) {
        const lineKey = line.bundleMode === 'components' ? `bundle:${line.productId}` : line.inventoryId;
        if (seenInventoryIds.has(lineKey)) return showToast('同一出貨品項請合併數量後再出貨。', 'bg-red-500');
        seenInventoryIds.add(lineKey);
        if (!Number.isInteger(line.quantity) || line.quantity <= 0) return showToast(`「${line.productName}」的出貨數量須為正整數。`, 'bg-red-500');
        if (line.bundleMode !== 'components' && line.quantity > line.availableQuantity) return showToast(`「${line.productName}」可用庫存不足，現有 ${line.availableQuantity} 件。`, 'bg-red-500');
        if (line.unitPrice === '' || line.unitPrice == null || !Number.isFinite(line.unitPrice) || line.unitPrice < 0) {
            return showToast(`「${line.productName}」售價無效，請輸入本次成交價。`, 'bg-red-500');
        }
    }
    if (!prepareSalesBundleLineAllocations(draft.validLines)) return showToast('組合組成品或其他出貨品項庫存不足，請重新確認數量。', 'bg-red-500');
    if (draft.totalAmount < 0) return showToast('折扣不可大於應收金額。', 'bg-red-500');
    if (!confirm(`確定為「${customerName}」建立出貨單並扣除 ${draft.validLines.length} 項庫存嗎？\n應收總額：${formatFinanceMoney(draft.totalAmount)}\n此操作會建立應收單及出貨異動。`)) return;

    if (!Array.isArray(data.accountsReceivable)) data.accountsReceivable = [];
    const id = generateFinanceDocumentId('AR', data.accountsReceivable);
    const invoiceNumber = document.getElementById('salesInvoiceNumber').value.trim();
    const invoiceType = document.getElementById('salesInvoiceType').value;
    const logisticsProvider = document.getElementById('salesLogisticsProvider').value.trim();
    const logisticsNumber = document.getElementById('salesLogisticsNumber').value.trim();
    const deliveryAddress = document.getElementById('salesDeliveryAddress').value.trim();
    const deliveryPerson = document.getElementById('salesDeliveryPerson').value.trim();
    const shipmentNote = document.getElementById('salesShipmentNote').value.trim();
    const paymentTerms = calculateCounterpartyTerms({ closingDay, paymentDay }, documentDate);
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
        logisticsProvider,
        logisticsNumber,
        deliveryAddress,
        deliveryPerson,
        shipmentNote,
        documentDate,
        dueDate: document.getElementById('salesDueDate').value || paymentTerms.dueDate,
        closingDay: paymentTerms.closingDay,
        paymentDay: paymentTerms.paymentDay,
        accountingPeriod: paymentTerms.accountingPeriod,
        invoiceNumber,
        invoiceType,
        lines: draft.validLines.map((line, index) => ({
            inventoryId: line.inventoryId,
            productId: line.productId,
            productName: line.productName,
            spec: line.spec,
            bundleMode: line.bundleMode || '',
            quantity: line.quantity,
            unit: line.unit,
            unitPrice: line.unitPrice,
            taxStatus: line.taxStatus,
            amount: draft.lineAmounts[index].baseAmount,
            taxAmount: draft.lineAmounts[index].taxAmount,
            totalAmount: draft.lineAmounts[index].totalAmount
        })),
        subtotal: draft.subtotal,
        shipping: draft.shipping,
        discount: draft.discount,
        taxAmount: draft.taxAmount,
        totalAmount: draft.totalAmount,
        paidAmount: 0,
        payments: [],
        status: 'unpaid',
        createdAt: new Date().toISOString()
    };

    const previousState = JSON.stringify({
        inventory: data.inventory,
        inventoryMovements: data.inventoryMovements,
        accountsReceivable: data.accountsReceivable,
        financeCustomers: data.financeCustomers
    });
    try {
        if (!Array.isArray(data.inventoryMovements)) data.inventoryMovements = [];
        documentRecord.lines.forEach((line, index) => {
            const draftLine = draft.validLines[index];
            if (draftLine.bundleMode === 'components') {
                applySalesBundleConsumption(draftLine, {
                    orderId: id,
                    customerId: customer.id,
                    customerName,
                    date: documentDate,
                    invoiceType: documentRecord.invoiceType,
                    invoiceNumber,
                    logisticsProvider,
                    logisticsNumber,
                    deliveryAddress,
                    deliveryPerson,
                    shipmentNote,
                    channel: '銷售單',
                    note: `銷售出貨 ${id}`
                });
                return;
            }
            const inventoryItem = data.inventory.find(item => item.id === line.inventoryId);
            if (!inventoryItem || Number(inventoryItem.availableQuantity || 0) < line.quantity) {
                throw new Error(`「${line.productName}」庫存已變動，請重新確認後再出貨。`);
            }
            const costUnit = Number(inventoryItem.averageCost || 0);
            inventoryItem.quantity -= line.quantity;
            inventoryItem.availableQuantity -= line.quantity;
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
                customerId: customer.id,
                customerName,
                logisticsProvider,
                logisticsNumber,
                deliveryAddress,
                deliveryPerson,
                shipmentNote,
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
                bundleMode: line.bundleMode || '',
                sourceDate: documentDate,
                arrivalDate: '',
                invoiceType: documentRecord.invoiceType,
                invoiceNo: invoiceNumber,
                invoiceDate: documentDate,
                channel: '銷售單',
                note: `銷售出貨 ${id}`,
                createdAt: new Date().toISOString()
            });
        });

        saveFinanceCustomerTerms(customerName, closingDay, paymentDay);
        data.accountsReceivable.unshift(documentRecord);
        if (saveData() === false) throw new Error('出貨單儲存失敗，庫存、出貨異動及應收資料已還原。');
    } catch (error) {
        Object.assign(data, JSON.parse(previousState));
        return showToast(error.message || '建立出貨單失敗，資料已還原。', 'bg-red-500');
    }
    event.target.reset();
    document.getElementById('salesInvoiceDate').value = getFinanceToday();
    document.getElementById('salesInvoiceLines').replaceChildren();
    addSalesInvoiceLine();
    updateSalesFinanceTermsPreview();
    renderFinance();
    renderInventory();
    renderShipping();
    showToast(`出貨單 ${id} 已建立，應收款已登錄`, 'bg-green-600');
}

function openFinancePayment(type, id) {
    const collection = type === 'receivable' ? data.accountsReceivable : data.accountsPayable;
    const documentRecord = collection.find(item => item.id === id);
    if (!documentRecord) return showToast('找不到帳款單據。', 'bg-red-500');
    const balance = getFinanceBalance(documentRecord);
    if (balance <= 0) return showToast('此單據已結清。', 'bg-amber-600');
    document.getElementById('financePaymentType').value = type;
    document.getElementById('financePaymentId').value = id;
    document.getElementById('financePaymentTitle').textContent = type === 'receivable' ? '登記收款' : '登記付款';
    document.getElementById('financePaymentBalance').textContent = `${documentRecord.counterpartyName} · 單號 ${id} · 未結餘額 ${formatFinanceMoney(balance)}`;
    document.getElementById('financePaymentAmount').value = String(balance);
    document.getElementById('financePaymentAmount').max = String(balance);
    document.getElementById('financePaymentDate').value = getFinanceToday();
    document.getElementById('financePaymentMethod').value = '現金';
    document.getElementById('financePaymentNote').value = '';
    document.getElementById('financePaymentModal').classList.add('modal-active');
}

function openFinanceLinkedShipping(id) {
    const linkedMovements = (data.inventoryMovements || []).filter(move =>
        move.type === 'outbound' && move.accountsDocumentId === id
    );
    if (!linkedMovements.length) return showToast('找不到此應收單關聯的出貨紀錄。', 'bg-red-500');
    document.getElementById('searchShippingKeyword').value = id;
    document.getElementById('filterShippingStartDate').value = '';
    document.getElementById('filterShippingEndDate').value = '';
    switchTab('shipping');
}

function openLinkedFinanceDocument(id) {
    const documentRecord = (data.accountsReceivable || []).find(item => item.id === id);
    if (!documentRecord) return showToast('找不到此出貨紀錄關聯的應收單。', 'bg-red-500');
    document.getElementById('searchReceivable').value = id;
    switchTab('finance');
}

function saveFinancePayment(event) {
    event.preventDefault();
    const type = document.getElementById('financePaymentType').value;
    const collection = type === 'receivable' ? data.accountsReceivable : data.accountsPayable;
    const documentRecord = collection.find(item => item.id === document.getElementById('financePaymentId').value);
    if (!documentRecord) return showToast('找不到帳款單據。', 'bg-red-500');
    const amount = Number(document.getElementById('financePaymentAmount').value);
    const date = document.getElementById('financePaymentDate').value;
    const method = document.getElementById('financePaymentMethod').value;
    const note = document.getElementById('financePaymentNote').value.trim();
    const balance = getFinanceBalance(documentRecord);
    if (!Number.isInteger(amount) || amount <= 0 || amount > balance) return showToast(`收／付款金額須為大於 0 的整數，且不得超過未結餘額 ${formatFinanceMoney(balance)}。`, 'bg-red-500');
    if (!date) return showToast('請選擇收／付款日期。', 'bg-red-500');
    if (!['現金', '匯款', '支票', '刷卡'].includes(method)) return showToast('請選擇有效的收／付款方式。', 'bg-red-500');
    documentRecord.payments = Array.isArray(documentRecord.payments) ? documentRecord.payments : [];
    documentRecord.payments.push({ amount, date, method, note, createdAt: new Date().toISOString() });
    documentRecord.paidAmount = roundFinanceMoney(Number(documentRecord.paidAmount || 0) + amount);
    documentRecord.status = getFinanceStatus(documentRecord) === '已結清' ? 'paid' : 'partial';
    documentRecord.lastPaymentDate = date;
    saveData();
    closeModal('financePaymentModal');
    renderFinance();
    renderOrders();
    showToast(type === 'receivable' ? '收款已登錄' : '付款已登錄', 'bg-green-600');
}

function openFinanceDocumentEdit(type, id) {
    const collection = type === 'receivable' ? data.accountsReceivable : data.accountsPayable;
    const item = collection.find(document => document.id === id);
    if (!item) return showToast('找不到帳款單據。', 'bg-red-500');
    const isSupplierCredit = type === 'payable' && item.returnKind === 'supplier-credit';
    if ((item.returnKind && !isSupplierCredit) || item.returnAdjustments?.length) return showToast('退換貨帳款請由原退換貨交易核對，不可直接修改。', 'bg-amber-600');
    document.getElementById('financeDocumentType').value = type;
    document.getElementById('financeDocumentId').value = id;
    document.getElementById('financeDocumentModalTitle').textContent = isSupplierCredit ? `修改應付退貨折讓單 ${id}` : `修改${type === 'receivable' ? '應收' : '應付'}單 ${id}`;
    document.getElementById('financeDocumentCounterparty').value = item.counterpartyName || '';
    document.getElementById('financeDocumentDate').value = item.documentDate || '';
    document.getElementById('financeDocumentDueDate').value = item.dueDate || '';
    document.getElementById('financeDocumentInvoiceType').value = item.invoiceType || '';
    document.getElementById('financeDocumentInvoiceNumber').value = item.invoiceNumber || '';
    const amountSign = isSupplierCredit ? -1 : 1;
    document.getElementById('financeDocumentSubtotal').value = roundFinanceMoney(Number(item.subtotal || 0) * amountSign);
    document.getElementById('financeDocumentShipping').value = roundFinanceMoney(Number(item.shipping || 0) * amountSign);
    document.getElementById('financeDocumentTaxAmount').value = roundFinanceMoney(Number(item.taxAmount || 0) * amountSign);
    document.getElementById('financeDocumentDiscount').value = roundFinanceMoney(Number(item.discount || 0) * amountSign);
    updateFinanceDocumentEditTotal();
    document.getElementById('financeDocumentModal').classList.add('modal-active');
}

function updateFinanceDocumentEditTotal() {
    const subtotal = Number(document.getElementById('financeDocumentSubtotal').value) || 0;
    const shipping = Number(document.getElementById('financeDocumentShipping').value) || 0;
    const taxAmount = Number(document.getElementById('financeDocumentTaxAmount').value) || 0;
    const discount = Number(document.getElementById('financeDocumentDiscount').value) || 0;
    document.getElementById('financeDocumentEditTotal').textContent = formatFinanceMoney(subtotal + shipping + taxAmount - discount);
}

function saveFinanceDocumentEdit(event) {
    event.preventDefault();
    const type = document.getElementById('financeDocumentType').value;
    const collection = type === 'receivable' ? data.accountsReceivable : data.accountsPayable;
    const item = collection.find(record => record.id === document.getElementById('financeDocumentId').value);
    if (!item) return showToast('找不到帳款單據。', 'bg-red-500');
    const isSupplierCredit = type === 'payable' && item.returnKind === 'supplier-credit';
    if ((item.returnKind && !isSupplierCredit) || item.returnAdjustments?.length) return showToast('退換貨帳款不可直接修改，請保留原退換貨紀錄。', 'bg-amber-600');
    if (isSupplierCredit && (Number(item.paidAmount || 0) > 0 || (item.payments || []).length > 0)) {
        return showToast('此折讓單已有付款紀錄，不能修改已付金額。', 'bg-amber-600');
    }
    const subtotal = Number(document.getElementById('financeDocumentSubtotal').value);
    const shipping = Number(document.getElementById('financeDocumentShipping').value);
    const taxAmount = Number(document.getElementById('financeDocumentTaxAmount').value);
    const discount = Number(document.getElementById('financeDocumentDiscount').value);
    const totalAmount = subtotal + shipping + taxAmount - discount;
    if (![subtotal, shipping, taxAmount, discount].every(Number.isInteger) ||
        [subtotal, shipping, taxAmount, discount].some(value => value < 0) ||
        !Number.isInteger(totalAmount) || totalAmount < 0) {
        return showToast('金額欄位須為非負整數，且折扣不可大於帳款金額。', 'bg-red-500');
    }
    if (totalAmount < Number(item.paidAmount || 0)) {
        return showToast(`修改後總額不可低於已收／付款金額 ${formatFinanceMoney(item.paidAmount)}。`, 'bg-red-500');
    }
    const documentDate = document.getElementById('financeDocumentDate').value;
    if (!documentDate) return showToast('請選擇單據日期。', 'bg-red-500');
    const closingDay = parseFinanceTermDay(item.closingDay);
    const paymentDay = parseFinanceTermDay(item.paymentDay);
    const terms = calculateCounterpartyTerms({ closingDay, paymentDay }, documentDate);
    const previousDocument = isSupplierCredit ? JSON.parse(JSON.stringify(item)) : null;
    const returnTransaction = isSupplierCredit
        ? (data.returnTransactions || []).find(transaction => transaction.id === item.sourceReturnId)
        : null;
    const previousReturnTransaction = returnTransaction ? JSON.parse(JSON.stringify(returnTransaction)) : null;
    item.counterpartyName = document.getElementById('financeDocumentCounterparty').value.trim();
    item.documentDate = documentDate;
    item.dueDate = document.getElementById('financeDocumentDueDate').value;
    item.accountingPeriod = terms.accountingPeriod || item.accountingPeriod || '';
    item.invoiceType = document.getElementById('financeDocumentInvoiceType').value;
    item.invoiceNumber = document.getElementById('financeDocumentInvoiceNumber').value.trim();
    const amountSign = isSupplierCredit ? -1 : 1;
    item.subtotal = amountSign * subtotal;
    item.shipping = amountSign * shipping;
    item.taxAmount = amountSign * taxAmount;
    item.discount = amountSign * discount;
    item.totalAmount = amountSign * totalAmount;
    if (isSupplierCredit) {
        const line = item.lines?.[0];
        if (line) {
            const lineQuantity = Number(line.quantity) || 1;
            line.unitPrice = totalAmount / lineQuantity;
            line.amount = -subtotal;
            line.shippingAmount = -shipping;
            line.taxStatus = taxAmount > 0 ? '含稅' : '免稅';
            line.taxAmount = -taxAmount;
            line.totalAmount = -totalAmount;
        }
        item.adjustmentAmount = 0;
        if (returnTransaction) {
            returnTransaction.creditAmount = totalAmount;
            returnTransaction.taxAmount = taxAmount;
            returnTransaction.unitCredit = Number(returnTransaction.quantity) > 0
                ? totalAmount / Number(returnTransaction.quantity)
                : 0;
        }
    } else {
        const detailTotal = (item.lines || []).reduce((sum, line) =>
            sum + Number(line.amount || 0) + Number(line.shippingAmount || 0) + Number(line.taxAmount || 0), 0
        );
        const detailBaseline = detailTotal + (type === 'receivable' ? Number(item.shipping || 0) : 0) - discount;
        item.adjustmentAmount = totalAmount - detailBaseline;
    }
    item.updatedAt = new Date().toISOString();
    if (type === 'receivable') {
        (data.inventoryMovements || []).filter(move => move.accountsDocumentId === item.id).forEach(move => {
            move.sourceDate = documentDate;
            move.invoiceDate = documentDate;
            move.invoiceType = item.invoiceType;
            move.invoiceNo = item.invoiceNumber;
        });
    }
    if (!saveData() && isSupplierCredit) {
        Object.keys(item).forEach(key => delete item[key]);
        Object.assign(item, previousDocument);
        if (returnTransaction && previousReturnTransaction) {
            Object.keys(returnTransaction).forEach(key => delete returnTransaction[key]);
            Object.assign(returnTransaction, previousReturnTransaction);
        }
        return showToast('折讓單儲存失敗，原金額已還原。', 'bg-red-500');
    }
    closeModal('financeDocumentModal');
    renderFinance();
    showToast(isSupplierCredit ? '應付退貨折讓單已更新。' : '帳款單據已更新。', 'bg-green-600');
}

function deleteFinanceDocument(type, id) {
    const collection = type === 'receivable' ? data.accountsReceivable : data.accountsPayable;
    const item = collection.find(document => document.id === id);
    if (!item) return showToast('找不到帳款單據。', 'bg-red-500');
    if (item.returnKind === 'supplier-credit' && type === 'payable') return deleteSupplierReturnCredit(id);
    if (item.returnKind) return showToast('退換貨帳款不可單獨刪除，以免庫存與退款紀錄不一致。', 'bg-amber-600');
    if (type === 'receivable' && item.returnAdjustments?.length) {
        return showToast('此應收單已有退換貨折抵，請保留原單以維持帳款追溯。', 'bg-amber-600');
    }
    const linkedMovements = type === 'receivable'
        ? (data.inventoryMovements || []).filter(move =>
            move.type === 'outbound' && (move.accountsDocumentId === id || move.orderId === id)
        )
        : [];
    const linkedBundleMovements = linkedMovements.filter(move => move.bundleMode === 'components');
    if (linkedBundleMovements.some(move => !Array.isArray(move.bundleUnits))) {
        return showToast('無法刪除此應收單：促銷組合出貨缺少組成品快照，請先修復交易資料。', 'bg-red-500');
    }
    const linkedInventory = linkedMovements.map(move => ({
        move,
        inventoryItem: data.inventory.find(inventoryItem => inventoryItem.id === move.inventoryId)
    })).filter(entry => entry.move.bundleMode !== 'components');
    if (linkedInventory.some(entry => !entry.inventoryItem)) {
        return showToast('無法刪除此應收單：找不到關聯庫存，請先修復庫存資料以免帳實不符。', 'bg-red-500');
    }
    const componentMovements = (data.inventoryMovements || []).filter(move =>
        move.type === 'bundle-component-outbound' &&
        linkedBundleMovements.some(parent => parent.id === move.parentOutboundId)
    );
    const paymentWarning = item.payments?.length
        ? `\n此單有 ${item.payments.length} 筆收／付款紀錄，刪除後紀錄也會一併移除。`
        : '';
    const inventoryWarning = linkedMovements.length
        ? `\n將回補 ${linkedMovements.length} 筆出貨庫存並移除相關出貨異動。`
        : '';
    const bundleWarning = linkedBundleMovements.length ? '\n組合扣料出貨會回補原始 A、B 組成品庫存，不會新增虛擬組合產品庫存。' : '';
    if (!confirm(`確定刪除${type === 'receivable' ? '應收' : '應付'}單「${id}／${item.counterpartyName}」？${paymentWarning}${inventoryWarning}${bundleWarning}\n此操作無法復原。`)) return;
    const previousState = JSON.stringify({
        inventory: data.inventory,
        inventoryMovements: data.inventoryMovements,
        accountsReceivable: data.accountsReceivable,
        accountsPayable: data.accountsPayable
    });
    try {
        linkedBundleMovements.forEach(move => restoreSalesBundleConsumption(move));
        linkedInventory.forEach(({ move, inventoryItem }) => {
        const quantity = Number(move.quantity) || 0;
        const costUnit = Number(move.costUnit ?? inventoryItem.averageCost) || 0;
        inventoryItem.quantity = Number(inventoryItem.quantity || 0) + quantity;
        inventoryItem.availableQuantity = Number(inventoryItem.availableQuantity || 0) + quantity;
        inventoryItem.totalCost = roundFinanceMoney(Number(inventoryItem.totalCost || 0) + costUnit * quantity);
        inventoryItem.averageCost = inventoryItem.quantity > 0 ? inventoryItem.totalCost / inventoryItem.quantity : costUnit;
        if (!inventoryItem.status || inventoryItem.status === '缺貨') inventoryItem.status = '正常';
        inventoryItem.lastUpdated = new Date().toISOString();
        });
        if (linkedMovements.length) {
            data.inventoryMovements = data.inventoryMovements.filter(move =>
                !linkedMovements.includes(move) && !componentMovements.includes(move)
            );
        }
        const index = collection.findIndex(document => document.id === id);
        collection.splice(index, 1);
        if (saveData() === false) throw new Error('應收單刪除儲存失敗，庫存與交易資料已還原。');
    } catch (error) {
        Object.assign(data, JSON.parse(previousState));
        return showToast(error.message || '刪除帳款單失敗，資料已還原。', 'bg-red-500');
    }
    renderFinance();
    if (linkedMovements.length) {
        renderInventory();
        renderShipping();
    }
    if (type === 'payable') renderOrders();
    showToast(`${type === 'receivable' ? '應收' : '應付'}單已刪除。`, 'bg-green-600');
}

function renderFinanceDocumentTable(type) {
    const collection = type === 'receivable' ? data.accountsReceivable : data.accountsPayable;
    const searchId = type === 'receivable' ? 'searchReceivable' : 'searchPayable';
    const containerId = type === 'receivable' ? 'receivableList' : 'payableList';
    const container = document.getElementById(containerId);
    if (!container) return;
    const keyword = (document.getElementById(searchId)?.value || '').trim().toLocaleLowerCase();
    const documents = collection.filter(item => !keyword ||
        [item.id, item.counterpartyName, item.sourceOrderId, item.invoiceNumber].some(value => String(value || '').toLocaleLowerCase().includes(keyword)))
        .slice().sort((a, b) => String(b.documentDate || '').localeCompare(String(a.documentDate || '')));

    if (documents.length === 0) {
        container.innerHTML = `<div class="rounded border bg-white p-5 text-center text-sm text-slate-500">目前沒有${type === 'receivable' ? '應收' : '應付'}單據。</div>`;
        return;
    }

    container.innerHTML = `
        <div class="overflow-x-auto rounded border bg-white">
            <table class="finance-table min-w-full text-left text-sm">
                <thead class="bg-slate-100 text-xs text-slate-600">
                    <tr>
                        <th class="px-3 py-2">單據／來源</th>
                        <th class="px-3 py-2">客戶／供應商</th>
                        <th class="px-3 py-2">日期／到期</th>
                        <th class="px-3 py-2 text-right">總額</th>
                        <th class="px-3 py-2 text-right">已${type === 'receivable' ? '收' : '付'}</th>
                        <th class="px-3 py-2 text-right">未結</th>
                        <th class="px-3 py-2">狀態</th>
                        <th class="px-3 py-2">操作</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                    ${documents.map(item => {
                        const balance = getFinanceBalance(item);
                        const sourceText = item.returnKind === 'supplier-credit'
                            ? `退貨折讓 ${item.sourceOrderId || '-'}`
                            : item.returnKind === 'customer-refund'
                                ? `客戶退款 ${item.sourceSalesId || item.sourceReturnId}`
                                : item.returnKind === 'exchange-charge'
                                    ? `換貨補差 ${item.sourceSalesId || item.sourceReturnId}`
                                    : type === 'receivable'
                                        ? `出貨 ${item.salesNo || item.id}`
                                        : `採購 ${item.sourceOrderId || '-'}`;
                        return `
                            <tr class="hover:bg-slate-50">
                                <td class="whitespace-nowrap px-3 py-2">
                                    <div class="font-mono font-bold text-slate-800">${escapeFinanceHtml(item.id)}</div>
                                    <div class="text-xs text-slate-500">${escapeFinanceHtml(sourceText)}${item.invoiceNumber ? ` · 發票 ${escapeFinanceHtml(item.invoiceNumber)}` : ''}</div>
                                    ${type === 'receivable' ? `
                                        <details class="mt-1 text-xs text-slate-600">
                                            <summary class="cursor-pointer">出貨物流資料</summary>
                                            <div class="mt-1 space-y-1 whitespace-normal">
                                                <div>物流：${escapeFinanceHtml(item.logisticsProvider || '-')} · 編號：${escapeFinanceHtml(item.logisticsNumber || '-')}</div>
                                                <div>出貨地址：${escapeFinanceHtml(item.deliveryAddress || '-')}</div>
                                                <div>送貨人：${escapeFinanceHtml(item.deliveryPerson || '-')}</div>
                                                <div>備註：${escapeFinanceHtml(item.shipmentNote || '-')}</div>
                                                <button type="button" onclick="openFinanceLinkedShipping('${escapeFinanceHtml(item.id)}')" class="mt-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-1 font-semibold text-indigo-700 hover:bg-indigo-100">查看關聯出貨紀錄</button>
                                            </div>
                                        </details>
                                    ` : ''}
                                    ${item.payments?.length ? `<details class="mt-1 text-xs text-slate-600"><summary class="cursor-pointer">${item.payments.length} 筆收／付款紀錄</summary><div class="mt-1 space-y-1">${item.payments.map(payment => `<div class="whitespace-normal">${escapeFinanceHtml(payment.date || '-')} · ${escapeFinanceHtml(payment.method || '未記錄')} · ${formatFinanceMoney(payment.amount)}${payment.note ? `<div class="pl-2 text-slate-500">備註：${escapeFinanceHtml(payment.note)}</div>` : ''}</div>`).join('')}</div></details>` : ''}
                                </td>
                                <td class="px-3 py-2 font-semibold">${escapeFinanceHtml(item.counterpartyName)}</td>
                                <td class="whitespace-nowrap px-3 py-2 text-xs">
                                    <div>${escapeFinanceHtml(item.documentDate || '-')}</div>
                                    <div class="text-slate-500">帳期 ${escapeFinanceHtml(item.accountingPeriod || '-')}</div>
                                    <div class="text-slate-500">${item.closingDay && item.paymentDay ? `關帳 ${escapeFinanceHtml(item.closingDay)} 日 · 付款 ${escapeFinanceHtml(item.paymentDay)} 日` : '付款條件未設定'}</div>
                                    <div class="text-slate-500">到期 ${escapeFinanceHtml(item.dueDate || '-')}</div>
                                </td>
                                <td class="whitespace-nowrap px-3 py-2 text-right font-bold">
                                    ${formatFinanceMoney(item.totalAmount)}
                                    ${Number(item.adjustmentAmount || 0) !== 0 ? `<div class="text-xs font-normal text-amber-700">調整 ${formatFinanceMoney(item.adjustmentAmount)}</div>` : ''}
                                </td>
                                <td class="whitespace-nowrap px-3 py-2 text-right">${formatFinanceMoney(item.paidAmount)}</td>
                                <td class="whitespace-nowrap px-3 py-2 text-right font-bold ${balance > 0 ? 'text-red-700' : 'text-green-700'}">${formatFinanceMoney(balance)}</td>
                                <td class="whitespace-nowrap px-3 py-2"><span class="rounded-full border px-2 py-1 text-xs font-semibold ${getFinanceStatusClass(item)}">${getFinanceStatus(item)}</span></td>
                                <td class="whitespace-nowrap px-3 py-2">
                                    <div class="flex gap-1">
                                        ${balance > 0 ? `<button type="button" onclick="openFinancePayment('${type}', '${escapeFinanceHtml(item.id)}')" class="rounded bg-blue-600 px-2 py-1 text-xs font-bold text-white hover:bg-blue-700">${type === 'receivable' ? '收款' : '付款'}</button>` : ''}
                                        ${(!item.returnKind || item.returnKind === 'supplier-credit') && !item.returnAdjustments?.length ? `<button type="button" onclick="openFinanceDocumentEdit('${type}', '${escapeFinanceHtml(item.id)}')" class="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100">修改</button>` : ''}
                                        <button type="button" onclick="printFinanceDocument('${type}', '${escapeFinanceHtml(item.id)}')" class="rounded border px-2 py-1 text-xs font-semibold hover:bg-slate-100">A4 列印</button>
                                        ${(!item.returnKind || item.returnKind === 'supplier-credit') && !item.returnAdjustments?.length ? `<button type="button" onclick="deleteFinanceDocument('${type}', '${escapeFinanceHtml(item.id)}')" class="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100">刪除</button>` : ''}
                                    </div>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderFinance() {
    if (!Array.isArray(data.accountsReceivable)) data.accountsReceivable = [];
    if (!Array.isArray(data.accountsPayable)) data.accountsPayable = [];
    const receivableTotal = data.accountsReceivable.reduce((sum, item) => sum + getFinanceBalance(item), 0);
    const payableTotal = data.accountsPayable.reduce((sum, item) => sum + getFinanceBalance(item), 0);
    const summary = document.getElementById('financeSummary');
    if (summary) {
        summary.innerHTML = `
            <div class="card border-l-4 border-emerald-500 p-3">
                <div class="text-xs font-semibold text-slate-500">應收未結</div>
                <div class="text-2xl font-bold text-emerald-800">${formatFinanceMoney(receivableTotal)}</div>
                <div class="text-xs text-slate-500">${data.accountsReceivable.length} 張單據</div>
            </div>
            <div class="card border-l-4 border-orange-500 p-3">
                <div class="text-xs font-semibold text-slate-500">應付未結</div>
                <div class="text-2xl font-bold text-orange-800">${formatFinanceMoney(payableTotal)}</div>
                <div class="text-xs text-slate-500">${data.accountsPayable.length} 張單據</div>
            </div>
            <div class="card border-l-4 border-blue-500 p-3">
                <div class="text-xs font-semibold text-slate-500">應收已收</div>
                <div class="text-2xl font-bold text-blue-800">${formatFinanceMoney(data.accountsReceivable.reduce((sum, item) => sum + Number(item.paidAmount || 0), 0))}</div>
            </div>
            <div class="card border-l-4 border-purple-500 p-3">
                <div class="text-xs font-semibold text-slate-500">應付已付</div>
                <div class="text-2xl font-bold text-purple-800">${formatFinanceMoney(data.accountsPayable.reduce((sum, item) => sum + Number(item.paidAmount || 0), 0))}</div>
            </div>
        `;
    }
    renderFinanceDocumentTable('receivable');
    renderFinanceDocumentTable('payable');
}

function exportFinanceToExcel(type) {
    if (typeof XLSX === 'undefined') return showToast('Excel 匯出元件尚未載入，請重新整理後再試。', 'bg-red-500');
    const isReceivable = type === 'receivable';
    const collection = isReceivable ? data.accountsReceivable : data.accountsPayable;
    const sheetName = isReceivable ? '應收帳款' : '應付帳款';
    const summaryRows = [[
        '單據編號', '客戶／供應商', '客戶統編', '客戶聯絡人', '客戶電話', '來源訂單／出貨單', '物流', '物流編號', '出貨地址', '送貨人', '出貨備註', '單據日期', '帳款期別', '關帳日', '指定付款日', '到期日', '發票類型', '發票號碼',
        '未稅小計', '運費', '折扣', '稅額', '單據調整', '單據總額', '已收／付款', '未結餘額', '帳款狀態', '收／付款紀錄'
    ]];
    const detailRows = [['單據編號', '客戶／供應商', '產品名稱', '規格', '數量', '單價', '運費', '稅別', '未稅金額']];
    collection.forEach(item => {
        const paymentsText = (item.payments || []).map(payment =>
            `${payment.date} ${payment.method || '未記錄'} ${payment.amount}${payment.note ? ` 備註：${payment.note}` : ''}`
        ).join('；');
        summaryRows.push([
            item.id,
            item.counterpartyName,
            isReceivable ? item.customerTaxId || '' : '',
            isReceivable ? item.customerContactName || '' : '',
            isReceivable ? item.customerPhone || '' : '',
            isReceivable ? item.salesNo || item.id : item.sourceOrderId || '',
            isReceivable ? item.logisticsProvider || '' : '',
            isReceivable ? item.logisticsNumber || '' : '',
            isReceivable ? item.deliveryAddress || '' : '',
            isReceivable ? item.deliveryPerson || '' : '',
            isReceivable ? item.shipmentNote || '' : '',
            item.documentDate || '',
            item.accountingPeriod || '',
            item.closingDay || '',
            item.paymentDay || '',
            item.dueDate || '',
            item.invoiceType || '',
            item.invoiceNumber || '',
            item.subtotal || 0,
            item.shipping || 0,
            item.discount || 0,
            item.taxAmount || 0,
            item.adjustmentAmount || 0,
            item.totalAmount,
            item.paidAmount || 0,
            getFinanceBalance(item),
            getFinanceStatus(item),
            paymentsText
        ]);
        (item.lines || []).forEach(line => detailRows.push([
            item.id,
            item.counterpartyName,
            line.productName || '',
            line.spec || '',
            line.quantity || '',
            line.unitPrice ?? '',
            line.shippingAmount ?? line.shipping ?? 0,
            line.taxStatus || '',
            line.amount || 0
        ]));
    });
    const workbook = XLSX.utils.book_new();
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
    summarySheet['!cols'] = [18, 24, 14, 18, 16, 20, 18, 20, 30, 16, 30, 14, 14, 10, 12, 14, 12, 18, 14, 12, 12, 12, 14, 14, 14, 14, 12, 28].map(width => ({ wch: width }));
    const detailSheet = XLSX.utils.aoa_to_sheet(detailRows);
    detailSheet['!cols'] = [18, 24, 28, 18, 10, 12, 12, 12, 14].map(width => ({ wch: width }));
    XLSX.utils.book_append_sheet(workbook, summarySheet, sheetName);
    XLSX.utils.book_append_sheet(workbook, detailSheet, `${sheetName}明細`);
    const suffix = getFinanceToday().replaceAll('-', '');
    XLSX.writeFile(workbook, `${isReceivable ? '應收帳款' : '應付帳款'}_${suffix}.xlsx`);
}

function printFinanceDocument(type, id) {
    const collection = type === 'receivable' ? data.accountsReceivable : data.accountsPayable;
    const item = collection.find(document => document.id === id);
    if (!item) return showToast('找不到帳款單據。', 'bg-red-500');
    const isReceivable = type === 'receivable';
    const printArea = document.getElementById('financePrintArea');
    const lineRows = (item.lines || []).map((line, index) => `
        <tr>
            <td>${index + 1}</td>
            <td>${escapeFinanceHtml(line.productName || '')}</td>
            <td>${escapeFinanceHtml(line.spec || '')}</td>
            <td class="number">${escapeFinanceHtml(line.quantity || '')} ${escapeFinanceHtml(line.unit || '')}</td>
            <td class="number">${formatFinanceUnitPrice(line.unitPrice)}</td>
            <td>${escapeFinanceHtml(line.taxStatus || '')}</td>
            <td class="number">${formatFinanceMoney(line.amount)}</td>
        </tr>
    `).join('');
    const payments = (item.payments || []).map(payment =>
        `${payment.date} ${payment.method || '未記錄'} ${formatFinanceMoney(payment.amount)}${payment.note ? `（${payment.note}）` : ''}`
    ).join('、') || '尚無收／付款紀錄';
    const shippingRow = Number(item.shipping || 0) !== 0
        ? `<tr><td colspan="6" class="number">運費</td><td class="number">${formatFinanceMoney(item.shipping)}</td></tr>`
        : '';
    const discountRow = Number(item.discount || 0) > 0
        ? `<tr><td colspan="6" class="number">折扣</td><td class="number">-${formatFinanceMoney(item.discount)}</td></tr>`
        : '';
    const adjustmentRow = Number(item.adjustmentAmount || 0) !== 0
        ? `<tr><td colspan="6" class="number">單據調整</td><td class="number">${formatFinanceMoney(item.adjustmentAmount)}</td></tr>`
        : '';
    printArea.innerHTML = `
        <article class="finance-print-document">
            <header class="finance-print-header">
                <h1>${item.returnKind === 'supplier-credit' ? '應付折讓／供應商退貨單' : item.returnKind === 'customer-refund' ? '應付款／客戶退款單' : item.returnKind === 'exchange-charge' ? '應收款／換貨補差單' : isReceivable ? '應收款／客戶出貨單' : '應付款／供應商收貨單'}</h1>
                <div class="finance-print-meta">
                    <div><strong>單據編號：</strong>${escapeFinanceHtml(item.id)}</div>
                    <div><strong>${isReceivable ? '客戶' : '供應商'}：</strong>${escapeFinanceHtml(item.counterpartyName)}</div>
                    ${isReceivable && item.customerTaxId ? `<div><strong>統一編號：</strong>${escapeFinanceHtml(item.customerTaxId)}</div>` : ''}
                    ${isReceivable && item.customerContactName ? `<div><strong>聯絡人：</strong>${escapeFinanceHtml(item.customerContactName)}</div>` : ''}
                    ${isReceivable && item.customerPhone ? `<div><strong>電話：</strong>${escapeFinanceHtml(item.customerPhone)}</div>` : ''}
                    ${isReceivable && item.customerAddress ? `<div><strong>地址：</strong>${escapeFinanceHtml(item.customerAddress)}</div>` : ''}
                    ${isReceivable && item.logisticsProvider ? `<div><strong>物流：</strong>${escapeFinanceHtml(item.logisticsProvider)}</div>` : ''}
                    ${isReceivable && item.logisticsNumber ? `<div><strong>物流編號：</strong>${escapeFinanceHtml(item.logisticsNumber)}</div>` : ''}
                    ${isReceivable && item.deliveryAddress ? `<div><strong>出貨地址：</strong>${escapeFinanceHtml(item.deliveryAddress)}</div>` : ''}
                    ${isReceivable && item.deliveryPerson ? `<div><strong>送貨人：</strong>${escapeFinanceHtml(item.deliveryPerson)}</div>` : ''}
                    <div><strong>單據日期：</strong>${escapeFinanceHtml(item.documentDate || '-')}</div>
                    <div><strong>帳款期別：</strong>${escapeFinanceHtml(item.accountingPeriod || '-')}</div>
                    <div><strong>付款條件：</strong>${item.closingDay && item.paymentDay ? `關帳 ${escapeFinanceHtml(item.closingDay)} 日／指定付款 ${escapeFinanceHtml(item.paymentDay)} 日` : '未設定'}</div>
                    <div><strong>到期日：</strong>${escapeFinanceHtml(item.dueDate || '-')}</div>
                    <div><strong>發票：</strong>${escapeFinanceHtml(item.invoiceType || '無發票')} ${escapeFinanceHtml(item.invoiceNumber || '')}</div>
                    <div><strong>${isReceivable ? '出貨單號' : '採購單號'}：</strong>${escapeFinanceHtml(isReceivable ? item.salesNo || item.id : item.sourceOrderId || '-')}</div>
                </div>
            </header>
            <table class="finance-print-table">
                <thead><tr><th>#</th><th>產品</th><th>規格</th><th class="number">數量</th><th class="number">單價</th><th>稅別</th><th class="number">金額</th></tr></thead>
                <tbody>${lineRows || '<tr><td colspan="7">無品項</td></tr>'}</tbody>
                <tfoot>
                    <tr><td colspan="6" class="number">小計</td><td class="number">${formatFinanceMoney(item.subtotal)}</td></tr>
                    ${shippingRow}
                    ${discountRow}
                    <tr><td colspan="6" class="number">稅額</td><td class="number">${formatFinanceMoney(item.taxAmount)}</td></tr>
                    ${adjustmentRow}
                    <tr class="grand-total"><td colspan="6" class="number">單據總額</td><td class="number">${formatFinanceMoney(item.totalAmount)}</td></tr>
                    <tr><td colspan="6" class="number">已${isReceivable ? '收' : '付'}</td><td class="number">${formatFinanceMoney(item.paidAmount)}</td></tr>
                    <tr><td colspan="6" class="number">未結餘額</td><td class="number">${formatFinanceMoney(getFinanceBalance(item))}</td></tr>
                </tfoot>
            </table>
            ${isReceivable && item.shipmentNote ? `<div class="finance-print-payments"><strong>出貨備註：</strong>${escapeFinanceHtml(item.shipmentNote)}</div>` : ''}
            <div class="finance-print-payments"><strong>收／付款紀錄：</strong>${escapeFinanceHtml(payments)}</div>
            <footer class="finance-print-footer">列印日期：${getFinanceToday()}</footer>
        </article>
    `;
    document.body.classList.add('printing-finance');
    const cleanup = () => document.body.classList.remove('printing-finance');
    window.addEventListener('afterprint', cleanup, { once: true });
    window.print();
}
