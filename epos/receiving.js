function escapeReceivingHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);
}

function getOrderLineRemainingQuantity(item) {
    return Math.max(0, (Number(item.quantity) || 0) - (Number(item.acceptedQuantity) || 0));
}

function updateOrderAfterReceiptChange(order) {
    const receipts = (data.goodsReceipts || []).filter(receipt => receipt.orderId === order.id);
    const hasReceivedQuantity = order.items.some(item => Number(item.receivedQuantity) > 0);
    const isFullyAccepted = order.items.length > 0 && order.items.every(item => getOrderLineRemainingQuantity(item) === 0);
    order.inventoryTransferred = isFullyAccepted;
    order.inventoryTransferAt = '';
    order.arrivalDate = '';
    if (isFullyAccepted) {
        const latestAcceptedReceipt = receipts
            .filter(receipt => (receipt.items || []).some(line => Number(line.acceptedQuantity) > 0))
            .sort((a, b) =>
                String(b.receiptDate || '').localeCompare(String(a.receiptDate || '')) ||
                String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
            )[0];
        order.status = 'arrived';
        order.arrivalDate = latestAcceptedReceipt?.receiptDate || '';
        order.inventoryTransferAt = latestAcceptedReceipt?.createdAt || '';
    } else {
        order.status = hasReceivedQuantity ? 'partially_received' : 'ordered';
    }
}

function generateGoodsReceiptId() {
    const date = getFinanceToday().replaceAll('-', '');
    const prefix = `GR${date}`;
    const lastNumber = (data.goodsReceipts || []).reduce((maximum, receipt) => {
        if (!receipt.id?.startsWith(prefix)) return maximum;
        return Math.max(maximum, Number(receipt.id.slice(prefix.length)) || 0);
    }, 0);
    return `${prefix}${String(lastNumber + 1).padStart(3, '0')}`;
}

function receiveOrderItems(orderId, lines, details) {
    const order = (data.orders || []).find(item => item.id === orderId);
    if (!order || !Array.isArray(order.items)) return showToast('找不到有效的採購單。', 'bg-red-500');
    if (order.status === 'cancelled') return showToast('已取消的採購單不可收貨。', 'bg-red-500');
    const receiptDate = details.receiptDate;
    const warehouse = String(details.warehouse || '').trim();
    if (!receiptDate || !/^\d{4}-\d{2}-\d{2}$/.test(receiptDate)) return showToast('請輸入有效的收貨日期。', 'bg-red-500');
    if (!getConfiguredWarehouses().includes(warehouse)) return showToast('請從「設定」的入庫倉別清單選擇有效倉別。', 'bg-red-500');

    const receiptLines = [];
    for (const line of lines) {
        const item = order.items[line.itemIndex];
        if (!item) return showToast('收貨明細已變更，請重新整理後再試。', 'bg-red-500');
        const receivedQuantity = Number(line.receivedQuantity);
        const rejectedQuantity = Number(line.rejectedQuantity);
        const remaining = getOrderLineRemainingQuantity(item);
        if (!Number.isInteger(receivedQuantity) || receivedQuantity < 0 ||
            !Number.isInteger(rejectedQuantity) || rejectedQuantity < 0 ||
            rejectedQuantity > receivedQuantity || receivedQuantity > remaining) {
            return showToast(`「${item.productName || item.productId}」收貨數量無效；拒收不可大於實收，合格數不可超過待收量 ${remaining}。`, 'bg-red-500');
        }
        if (receivedQuantity > 0) receiptLines.push({
            itemIndex: line.itemIndex,
            productId: item.productId,
            productName: item.productName || item.kitSnapshot?.productName || item.productId,
            sku: item.sku || '',
            unit: item.unit || 'pcs',
            receivedQuantity,
            rejectedQuantity,
            acceptedQuantity: receivedQuantity - rejectedQuantity
        });
    }
    if (!receiptLines.length) return showToast('請至少輸入一項本次實收數量。', 'bg-red-500');
    if (!confirm(`確認採購單 ${order.id} 本次收貨 ${receiptLines.reduce((sum, line) => sum + line.receivedQuantity, 0)} 件？合格品將入庫，拒收品不計入庫存。`)) return;

    const previousInventory = JSON.parse(JSON.stringify(data.inventory || []));
    const previousBatches = JSON.parse(JSON.stringify(data.inventoryBatches || []));
    const previousMovements = JSON.parse(JSON.stringify(data.inventoryMovements || []));
    const previousReceipts = JSON.parse(JSON.stringify(data.goodsReceipts || []));
    const previousItems = JSON.parse(JSON.stringify(order.items));
    const previousStatus = order.status;
    const previousArrivalDate = order.arrivalDate;
    const previousTransferred = order.inventoryTransferred;
    const previousTransferAt = order.inventoryTransferAt;
    const receiptId = generateGoodsReceiptId();
    const receipt = {
        id: receiptId,
        orderId,
        supplierId: order.supplierId || '',
        supplierName: order.supplierName || receiptLines[0].supplierName || '未指定供應商',
        receiptDate,
        warehouse,
        note: String(details.note || '').trim(),
        items: receiptLines,
        createdAt: new Date().toISOString()
    };
    const acceptedByLine = Object.fromEntries(receiptLines.map(line => [line.itemIndex, line.acceptedQuantity]));
    try {
        if (receiptLines.some(line => line.acceptedQuantity > 0) &&
            transferOrderToInventory(orderId, { receiptId, receiptDate, warehouse, quantities: acceptedByLine }) !== true) {
            throw new Error('庫存入帳失敗。');
        }
        receiptLines.forEach(line => {
            const item = order.items[line.itemIndex];
            item.receivedQuantity = (Number(item.receivedQuantity) || 0) + line.receivedQuantity;
            item.rejectedQuantity = (Number(item.rejectedQuantity) || 0) + line.rejectedQuantity;
            item.acceptedQuantity = (Number(item.acceptedQuantity) || 0) + line.acceptedQuantity;
        });
        data.goodsReceipts.unshift(receipt);
        updateOrderAfterReceiptChange(order);
        if (!saveData()) throw new Error('無法儲存收貨資料，瀏覽器儲存空間可能已滿。');
    } catch (error) {
        data.inventory = previousInventory;
        data.inventoryBatches = previousBatches;
        data.inventoryMovements = previousMovements;
        order.items = previousItems;
        order.status = previousStatus;
        order.arrivalDate = previousArrivalDate;
        order.inventoryTransferred = previousTransferred;
        order.inventoryTransferAt = previousTransferAt;
        data.goodsReceipts = previousReceipts;
        return showToast(error.message || '收貨儲存失敗。', 'bg-red-500');
    }
    renderReceiving();
    renderOrders();
    renderInventory();
    renderFinance();
    showToast(`收貨單 ${receiptId} 已建立。`, 'bg-green-600');
}

function renderReceiving() {
    const container = document.getElementById('receivingOrderList');
    if (!container) return;
    const orders = (data.orders || []).filter(order =>
        order.status !== 'cancelled' &&
        (order.items || []).some(item => getOrderLineRemainingQuantity(item) > 0)
    );
    if (!orders.length) {
        container.innerHTML = '<div class="card p-6 text-center text-sm text-gray-500">目前沒有待收貨的採購單。</div>';
    } else {
        container.innerHTML = orders.map(order => {
            const supplierName = order.supplierName || order.items?.[0]?.supplierName || '未指定供應商';
            const lines = order.items.map((item, index) => {
                const ordered = Number(item.quantity) || 0;
                const received = Number(item.receivedQuantity) || 0;
                const accepted = Number(item.acceptedQuantity) || 0;
                const remaining = getOrderLineRemainingQuantity(item);
                if (remaining <= 0) return '';
                return `<tr class="border-t">
                    <td class="p-2"><div class="font-semibold">${escapeReceivingHtml(item.productName || item.kitSnapshot?.productName || item.productId)}</div>
                        <div class="text-xs text-slate-500">${escapeReceivingHtml(item.spec || item.kitSnapshot?.spec || '')} · SKU ${escapeReceivingHtml(item.sku || '-')}</div></td>
                    <td class="p-2 text-right">${ordered} ${escapeReceivingHtml(item.unit || 'pcs')}</td>
                    <td class="p-2 text-right">${received}</td>
                    <td class="p-2 text-right">${accepted}</td>
                    <td class="p-2"><label class="sr-only" for="receipt-${order.id}-${index}">本次實收數量</label>
                        <input id="receipt-${order.id}-${index}" name="received-${index}" type="number" min="0" max="${remaining}" step="1" value="0" class="w-24 rounded border p-2 text-right" aria-label="本次實收數量"></td>
                    <td class="p-2"><label class="sr-only" for="rejected-${order.id}-${index}">本次拒收數量</label>
                        <input id="rejected-${order.id}-${index}" name="rejected-${index}" type="number" min="0" max="${remaining}" step="1" value="0" class="w-24 rounded border p-2 text-right" aria-label="本次拒收數量"></td>
                </tr>`;
            }).join('');
            const receipts = (data.goodsReceipts || []).filter(receipt => receipt.orderId === order.id);
            const warehouseOptions = getConfiguredWarehouses().map((warehouse, index) =>
                `<option value="${escapeReceivingHtml(warehouse)}"${index === 0 ? ' selected' : ''}>${escapeReceivingHtml(warehouse)}</option>`
            ).join('');
            return `<article class="card overflow-hidden">
                <div class="flex flex-col gap-2 border-b bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div><h3 class="font-bold text-slate-800">${escapeReceivingHtml(supplierName)}</h3>
                        <div class="text-xs text-slate-500">採購單 ${escapeReceivingHtml(order.id)} · 下單日 ${escapeReceivingHtml(order.date || '-')}</div></div>
                    <span class="rounded border px-2 py-1 text-xs font-semibold text-indigo-700">${escapeReceivingHtml(order.status || 'ordered')}</span>
                </div>
                <form data-order-id="${escapeReceivingHtml(order.id)}" onsubmit="submitPurchaseReceipt(event, this.dataset.orderId)" class="space-y-3 p-4">
                    <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <label class="text-xs font-semibold text-slate-600">收貨日期
                            <input name="receiptDate" type="date" required value="${getFinanceToday()}" class="mt-1 w-full rounded border p-2 text-sm"></label>
                        <label class="text-xs font-semibold text-slate-600">入庫倉別
                            <select name="warehouse" required class="mt-1 w-full rounded border p-2 text-sm">${warehouseOptions}</select></label>
                        <label class="text-xs font-semibold text-slate-600">收貨備註
                            <input name="note" maxlength="300" class="mt-1 w-full rounded border p-2 text-sm" placeholder="送貨單號、包裝狀況等"></label>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="min-w-full text-left text-sm">
                            <thead class="bg-slate-100 text-xs text-slate-600"><tr>
                                <th class="p-2">採購品項</th><th class="p-2 text-right">訂購</th><th class="p-2 text-right">累計實收</th>
                                <th class="p-2 text-right">累計合格</th><th class="p-2">本次實收</th><th class="p-2">本次拒收</th>
                            </tr></thead><tbody>${lines}</tbody>
                        </table>
                    </div>
                    <div class="flex flex-wrap items-center justify-between gap-3">
                        <details class="text-xs text-slate-500"><summary class="cursor-pointer">已登錄收貨 ${receipts.length} 次</summary>
                            <div class="mt-2 space-y-1">${receipts.map(receipt => `<div>${escapeReceivingHtml(receipt.receiptDate)} · ${escapeReceivingHtml(receipt.id)} · ${receipt.items.reduce((sum, item) => sum + Number(item.acceptedQuantity || 0), 0)} 件合格</div>`).join('') || '尚無收貨紀錄'}</div>
                        </details>
                        <button type="submit" class="rounded bg-teal-700 px-4 py-2 font-bold text-white hover:bg-teal-800">確認本次收貨</button>
                    </div>
                </form>
            </article>`;
        }).join('');
    }
    const history = document.getElementById('receivingReceiptHistory');
    if (history) {
        const receipts = (data.goodsReceipts || []).slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        history.innerHTML = receipts.length ? receipts.map(receipt => `
            <article class="rounded border bg-white p-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div><div class="font-semibold">${escapeReceivingHtml(receipt.supplierName || '未指定供應商')} · 收貨單 ${escapeReceivingHtml(receipt.id)}</div>
                        <div class="text-xs text-slate-500">採購單 ${escapeReceivingHtml(receipt.orderId)} · ${escapeReceivingHtml(receipt.receiptDate)} · ${escapeReceivingHtml(receipt.warehouse || '總倉')}</div></div>
                    <button type="button" data-receipt-id="${escapeReceivingHtml(receipt.id)}" onclick="undoGoodsReceipt(this.dataset.receiptId)" class="rounded border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50">撤銷收貨並扣回入庫</button>
                </div>
                <div class="mt-2 text-xs text-slate-600">${receipt.items.map(line => `${escapeReceivingHtml(line.productName)}：實收 ${line.receivedQuantity}、合格 ${line.acceptedQuantity}、拒收 ${line.rejectedQuantity}`).join('；')}</div>
                ${receipt.note ? `<div class="mt-1 text-xs text-slate-500">備註：${escapeReceivingHtml(receipt.note)}</div>` : ''}
            </article>`).join('') : '<div class="rounded border bg-white p-4 text-sm text-slate-500">尚無收貨單紀錄。</div>';
    }
}

function submitPurchaseReceipt(event, orderId) {
    event.preventDefault();
    const order = (data.orders || []).find(item => item.id === orderId);
    if (!order) return showToast('找不到採購單。', 'bg-red-500');
    const formData = new FormData(event.currentTarget);
    const lines = order.items.map((item, index) => ({
        itemIndex: index,
        receivedQuantity: Number(formData.get(`received-${index}`)) || 0,
        rejectedQuantity: Number(formData.get(`rejected-${index}`)) || 0
    }));
    receiveOrderItems(orderId, lines, {
        receiptDate: String(formData.get('receiptDate') || ''),
        warehouse: String(formData.get('warehouse') || '').trim(),
        note: String(formData.get('note') || '').trim()
    });
}