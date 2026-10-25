function ensureReturnCollections() {
    if (!Array.isArray(data.returnTransactions)) data.returnTransactions = [];
    if (!Array.isArray(data.inventoryMovements)) data.inventoryMovements = [];
    if (!Array.isArray(data.inventoryBatches)) data.inventoryBatches = [];
    if (!Array.isArray(data.accountsReceivable)) data.accountsReceivable = [];
    if (!Array.isArray(data.accountsPayable)) data.accountsPayable = [];
}

function generateReturnTransactionId() {
    const prefix = `RET${getFinanceToday().replaceAll('-', '')}`;
    const nextNumber = data.returnTransactions
        .filter(transaction => transaction.id?.startsWith(prefix))
        .reduce((maximum, transaction) => Math.max(maximum, Number(transaction.id.slice(prefix.length)) || 0), 0) + 1;
    return `${prefix}${String(nextNumber).padStart(3, '0')}`;
}

function getCustomerReturnableQuantity(outboundId) {
    const outbound = data.inventoryMovements.find(move => move.id === outboundId && move.type === 'outbound');
    if (!outbound) return 0;
    const returned = data.inventoryMovements
        .filter(move => move.type === 'customer-return' && move.sourceOutboundId === outboundId)
        .reduce((sum, move) => sum + Number(move.quantity || 0), 0);
    return Math.max(0, Number(outbound.quantity || 0) - returned);
}

function getReturnOriginalReceivable(move) {
    return data.accountsReceivable.find(item =>
        item.id === move.accountsDocumentId || item.id === move.salesNo || item.id === move.orderId
    ) || null;
}

function getReturnOriginalLine(documentRecord, move) {
    return documentRecord?.lines?.find(line =>
        (line.inventoryId && line.inventoryId === move.inventoryId) ||
        (line.productId === move.productId && (line.spec || '') === (move.spec || ''))
    ) || null;
}

function calculateCustomerReturnAmount(move, quantity, receivable, originalLine) {
    if (receivable && originalLine && Number(originalLine.totalAmount) >= 0) {
        const lineQuantity = Number(originalLine.quantity) || 0;
        const grossTotal = (receivable.lines || []).reduce((sum, line) =>
            sum + (Number(line.unitPrice) || 0) * (Number(line.quantity) || 0), 0
        );
        if (lineQuantity > 0) {
            const lineGross = (Number(originalLine.unitPrice) || 0) * lineQuantity;
            const discountShare = grossTotal > 0
                ? Number(receivable.discount || 0) * lineGross / grossTotal
                : 0;
            const returnLineTotal = Math.max(0, Number(originalLine.totalAmount) - discountShare);
            return roundFinanceMoney(returnLineTotal * quantity / lineQuantity);
        }
    }
    const price = Number(move.salesPrice ?? move.unitCost) || 0;
    return calculateFinanceLine({ unitPrice: price, quantity, taxStatus: '免稅' }).totalAmount;
}

function snapshotReturnState() {
    return JSON.stringify({
        inventory: data.inventory,
        inventoryMovements: data.inventoryMovements,
        inventoryBatches: data.inventoryBatches,
        accountsReceivable: data.accountsReceivable,
        accountsPayable: data.accountsPayable,
        returnTransactions: data.returnTransactions,
        orders: data.orders
    });
}

function restoreReturnState(snapshot) {
    Object.assign(data, JSON.parse(snapshot));
}

function saveReturnState(snapshot) {
    if (saveData() !== false) return true;
    restoreReturnState(snapshot);
    showToast('退換貨資料儲存失敗，庫存與帳款已還原。', 'bg-red-500');
    return false;
}

function createReturnFinanceLine({productId, productName, spec, quantity, unitPrice, amount}) {
    return {
        productId,
        productName,
        spec,
        quantity,
        unit: 'pcs',
        unitPrice,
        taxStatus: '免稅',
        amount,
        taxAmount: 0,
        totalAmount: amount
    };
}

function getSupplierReturnPricing(inventoryItem) {
    const sourceOrderIds = new Set(inventoryItem.relatedOrders || []);
    if (!sourceOrderIds.size) return { unitCredit: Number(inventoryItem.averageCost || 0), unitTax: 0 };
    let grossAmount = 0;
    let taxAmount = 0;
    let sourceQuantity = 0;
    data.accountsPayable.filter(documentRecord =>
        !documentRecord.returnKind && sourceOrderIds.has(documentRecord.sourceOrderId) &&
        (!documentRecord.supplierId || documentRecord.supplierId === inventoryItem.supplierId)
    ).forEach(documentRecord => {
        const lines = documentRecord.lines || [];
        const grossTotal = lines.reduce((sum, line) =>
            sum + (Number(line.unitPrice) || 0) * (Number(line.quantity) || 0) + Number(line.shipping || line.shippingAmount || 0), 0
        );
        lines.filter(line => line.productId === inventoryItem.productId && (line.spec || '') === (inventoryItem.spec || ''))
            .forEach(line => {
                const quantity = Number(line.quantity) || 0;
                if (quantity <= 0) return;
                const lineGross = (Number(line.unitPrice) || 0) * quantity + Number(line.shipping || line.shippingAmount || 0);
                const calculatedAmounts = calculateFinanceLine(line);
                const calculatedLine = line.totalAmount !== undefined && line.totalAmount !== null && Number.isFinite(Number(line.totalAmount))
                    ? Number(line.totalAmount)
                    : calculatedAmounts.totalAmount;
                const discountShare = grossTotal > 0
                    ? roundFinanceMoney(Number(documentRecord.discount || 0) * lineGross / grossTotal)
                    : 0;
                grossAmount += Math.max(0, calculatedLine - discountShare);
                const lineTaxAmount = line.taxAmount !== undefined && line.taxAmount !== null && Number.isFinite(Number(line.taxAmount))
                    ? Number(line.taxAmount)
                    : calculatedAmounts.taxAmount;
                taxAmount += Math.max(0, lineTaxAmount);
                sourceQuantity += quantity;
            });
    });
    return sourceQuantity > 0
        ? { unitCredit: grossAmount / sourceQuantity, unitTax: taxAmount / sourceQuantity }
        : { unitCredit: Number(inventoryItem.averageCost || 0), unitTax: 0 };
}

function createCustomerReturnFinanceDocument({kind, returnId, sourceMove, customerName, amount, line, documentDate}) {
    if (amount <= 0) return null;
    const receivable = getReturnOriginalReceivable(sourceMove);
    const collection = kind === 'receivable' ? data.accountsReceivable : data.accountsPayable;
    const id = generateFinanceDocumentId(kind === 'receivable' ? 'AR' : 'AP', collection);
    const documentRecord = {
        id,
        type: kind,
        returnKind: kind === 'receivable' ? 'exchange-charge' : 'customer-refund',
        sourceReturnId: returnId,
        sourceSalesId: sourceMove.salesNo || sourceMove.accountsDocumentId || sourceMove.id,
        sourceOrderId: sourceMove.salesNo || sourceMove.accountsDocumentId || sourceMove.id,
        customerId: receivable?.customerId || '',
        counterpartyName: customerName || receivable?.counterpartyName || '未指定客戶',
        customerTaxId: receivable?.customerTaxId || '',
        customerContactName: receivable?.customerContactName || '',
        customerPhone: receivable?.customerPhone || '',
        customerEmail: receivable?.customerEmail || '',
        customerAddress: receivable?.customerAddress || '',
        documentDate,
        dueDate: '',
        accountingPeriod: documentDate.slice(0, 7),
        invoiceNumber: '',
        invoiceType: '無發票',
        lines: [line],
        subtotal: amount,
        shipping: 0,
        discount: 0,
        taxAmount: 0,
        totalAmount: amount,
        paidAmount: 0,
        payments: [],
        status: 'unpaid',
        createdAt: new Date().toISOString()
    };
    collection.unshift(documentRecord);
    return documentRecord;
}

function saveCustomerReturn(event) {
    event.preventDefault();
    ensureReturnCollections();
    const outboundId = document.getElementById('customerReturnOutbound').value;
    const quantity = Number(document.getElementById('customerReturnQuantity').value);
    const customerName = document.getElementById('customerReturnName').value.trim();
    const reason = document.getElementById('customerReturnReason').value.trim();
    const exchangeInventoryId = document.getElementById('exchangeInventory').value;
    const exchangeQuantity = Number(document.getElementById('exchangeQuantity').value) || 0;
    const exchangeUnitPrice = Number(document.getElementById('exchangeUnitPrice').value) || 0;
    const sourceMove = data.inventoryMovements.find(move => move.id === outboundId && move.type === 'outbound');
    if (!sourceMove) return showToast('請選擇有效的原出貨紀錄。', 'bg-red-500');
    const returnableQuantity = getCustomerReturnableQuantity(outboundId);
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > returnableQuantity) {
        return showToast(`退貨數量須介於 1 至 ${returnableQuantity}。`, 'bg-red-500');
    }
    if (!exchangeInventoryId && (exchangeQuantity > 0 || exchangeUnitPrice > 0)) {
        return showToast('請選擇換出商品，或將換貨數量與單價清空。', 'bg-red-500');
    }
    if (exchangeInventoryId && (!Number.isInteger(exchangeQuantity) || exchangeQuantity <= 0)) {
        return showToast('換貨數量須為大於 0 的整數。', 'bg-red-500');
    }

    const exchangeItem = exchangeInventoryId
        ? data.inventory.find(item => item.id === exchangeInventoryId)
        : null;
    if (exchangeInventoryId && !exchangeItem) return showToast('找不到換出商品庫存。', 'bg-red-500');
    if (exchangeItem && exchangeQuantity > Number(exchangeItem.availableQuantity || 0)) {
        return showToast('換出商品數量超過可用庫存。', 'bg-red-500');
    }

    const originalReceivable = getReturnOriginalReceivable(sourceMove);
    const originalLine = getReturnOriginalLine(originalReceivable, sourceMove);
    const returnAmount = calculateCustomerReturnAmount(sourceMove, quantity, originalReceivable, originalLine);
    const exchangeAmount = exchangeItem
        ? calculateFinanceLine({ unitPrice: exchangeUnitPrice, quantity: exchangeQuantity, taxStatus: '免稅' }).totalAmount
        : 0;
    const inventoryItem = data.inventory.find(item => item.id === sourceMove.inventoryId);
    const costUnit = Number(sourceMove.costUnit ?? inventoryItem?.averageCost) || 0;
    const returnId = generateReturnTransactionId();
    const documentDate = getFinanceToday();
    const snapshot = snapshotReturnState();

    if (sourceMove.bundleMode === 'components' && !Array.isArray(sourceMove.bundleUnits)) {
        return showToast('促銷組合出貨缺少組成品快照，無法安全退貨。', 'bg-red-500');
    }
    const isComponentBundleReturn = sourceMove.bundleMode === 'components';
    let bundleUnitIndexes = [];
    if (isComponentBundleReturn) {
        try {
            bundleUnitIndexes = restoreSalesBundleComponents(sourceMove, quantity, returnId, documentDate);
        } catch (error) {
            restoreReturnState(snapshot);
            return showToast(error.message || '促銷組合退貨失敗，庫存未變更。', 'bg-red-500');
        }
    }
    let returnInventory = inventoryItem;
    if (isComponentBundleReturn) {
        returnInventory = {
            id: '',
            productId: sourceMove.productId,
            productName: sourceMove.productName || '',
            spec: sourceMove.spec || '',
            supplierId: sourceMove.supplierId || '',
            supplierName: sourceMove.supplierName || '',
            warehouse: sourceMove.warehouse || '組合扣料',
            unit: sourceMove.unit || 'pcs'
        };
    } else if (!returnInventory) {
        returnInventory = {
            id: sourceMove.inventoryId,
            productId: sourceMove.productId,
            sku: sourceMove.sku || '',
            productName: sourceMove.productName || '',
            spec: sourceMove.spec || '',
            supplierId: sourceMove.supplierId || '',
            supplierName: sourceMove.supplierName || '',
            warehouse: sourceMove.warehouse || '總倉',
            unit: sourceMove.unit || 'pcs',
            quantity: 0,
            availableQuantity: 0,
            averageCost: costUnit,
            lastCost: costUnit,
            totalCost: 0,
            status: '缺貨',
            lastUpdated: new Date().toISOString(),
            relatedOrders: []
        };
        data.inventory.push(returnInventory);
    }
    if (!isComponentBundleReturn) {
        const oldQuantity = Number(returnInventory.quantity || 0);
        const oldTotalCost = Number(returnInventory.totalCost ?? oldQuantity * Number(returnInventory.averageCost || 0));
        returnInventory.quantity = oldQuantity + quantity;
        returnInventory.availableQuantity = Number(returnInventory.availableQuantity ?? oldQuantity) + quantity;
        returnInventory.totalCost = oldTotalCost + costUnit * quantity;
        returnInventory.averageCost = returnInventory.quantity > 0 ? returnInventory.totalCost / returnInventory.quantity : costUnit;
        returnInventory.lastCost = costUnit;
        returnInventory.status = '正常';
        returnInventory.lastUpdated = new Date().toISOString();

        const returnBatch = createInventoryBatch({
            inventoryId: returnInventory.id,
            orderId: '',
            productId: returnInventory.productId,
            productName: returnInventory.productName,
            spec: returnInventory.spec,
            supplierId: returnInventory.supplierId,
            supplierName: returnInventory.supplierName,
            quantity,
            unitCost: costUnit,
            sourceDate: documentDate,
            arrivalDate: documentDate,
            warehouse: returnInventory.warehouse
        });
        returnBatch.returnId = returnId;
    }

    const openReceivable = originalReceivable ? getFinanceBalance(originalReceivable) : 0;
    const creditToReceivable = Math.min(returnAmount, openReceivable);
    const excessReturn = Math.max(0, returnAmount - creditToReceivable);
    const refundAmount = Math.max(0, excessReturn - exchangeAmount);
    const extraChargeAmount = Math.max(0, exchangeAmount - excessReturn);
    const financeDocumentIds = [];

    if (originalReceivable) {
        if (creditToReceivable > 0) {
            originalReceivable.totalAmount = Number(originalReceivable.totalAmount || 0) - creditToReceivable;
            originalReceivable.adjustmentAmount = Number(originalReceivable.adjustmentAmount || 0) - creditToReceivable;
        }
        originalReceivable.returnAdjustments = Array.isArray(originalReceivable.returnAdjustments)
            ? originalReceivable.returnAdjustments
            : [];
        originalReceivable.returnAdjustments.push({
            returnId,
            returnAmount,
            exchangeAmount,
            amount: creditToReceivable,
            createdAt: new Date().toISOString()
        });
        originalReceivable.updatedAt = new Date().toISOString();
    }

    if (refundAmount > 0) {
        const refundLine = createReturnFinanceLine({
            productId: sourceMove.productId,
            productName: sourceMove.productName,
            spec: sourceMove.spec,
            quantity,
            unitPrice: refundAmount / quantity,
            amount: refundAmount
        });
        const refundDocument = createCustomerReturnFinanceDocument({
            kind: 'payable', returnId, sourceMove, customerName, amount: refundAmount, line: refundLine, documentDate
        });
        financeDocumentIds.push(refundDocument.id);
    }
    if (extraChargeAmount > 0) {
        const chargeLine = createReturnFinanceLine({
            productId: exchangeItem.productId,
            productName: `換貨價差：${exchangeItem.productName}`,
            spec: exchangeItem.spec,
            quantity: 1,
            unitPrice: extraChargeAmount,
            amount: extraChargeAmount
        });
        const chargeDocument = createCustomerReturnFinanceDocument({
            kind: 'receivable', returnId, sourceMove, customerName, amount: extraChargeAmount, line: chargeLine, documentDate
        });
        financeDocumentIds.push(chargeDocument.id);
    }

    data.inventoryMovements.push({
        id: generateOutboundId(),
        type: 'customer-return',
        returnId,
        sourceOutboundId: sourceMove.id,
        inventoryId: returnInventory.id,
        productId: returnInventory.productId,
        productName: returnInventory.productName,
        spec: returnInventory.spec,
        supplierId: returnInventory.supplierId || '',
        supplierName: returnInventory.supplierName || '',
        warehouse: returnInventory.warehouse || '總倉',
        quantity,
        unitCost: Number(sourceMove.salesPrice ?? sourceMove.unitCost) || 0,
        costUnit,
        totalCost: returnAmount,
        bundleUnitIndexes,
        sourceDate: documentDate,
        note: reason || `客戶退貨 ${returnId}`,
        createdAt: new Date().toISOString()
    });

    if (exchangeItem) {
        const exchangeCost = Number(exchangeItem.averageCost || 0);
        exchangeItem.quantity -= exchangeQuantity;
        exchangeItem.availableQuantity -= exchangeQuantity;
        exchangeItem.totalCost = exchangeItem.quantity * exchangeCost;
        exchangeItem.status = exchangeItem.quantity > 0 ? '正常' : '缺貨';
        exchangeItem.lastUpdated = new Date().toISOString();
        data.inventoryMovements.push({
            id: generateOutboundId(),
            type: 'outbound',
            returnId,
            sourceOutboundId: sourceMove.id,
            inventoryId: exchangeItem.id,
            orderId: returnId,
            orderNo: returnId,
            accountsDocumentId: financeDocumentIds.find(id => data.accountsReceivable.some(item => item.id === id)) || '',
            productId: exchangeItem.productId,
            productName: exchangeItem.productName,
            spec: exchangeItem.spec,
            supplierId: exchangeItem.supplierId || '',
            supplierName: exchangeItem.supplierName || '',
            warehouse: exchangeItem.warehouse || '總倉',
            quantity: exchangeQuantity,
            unitCost: exchangeUnitPrice,
            salesPrice: exchangeUnitPrice,
            costUnit: exchangeCost,
            totalCost: exchangeAmount,
            sourceDate: documentDate,
            channel: '退換貨',
            note: `換出商品 ${returnId}`,
            createdAt: new Date().toISOString()
        });
    }

    data.returnTransactions.unshift({
        id: returnId,
        kind: 'customer-return',
        sourceOutboundId: sourceMove.id,
        customerName: customerName || originalReceivable?.counterpartyName || '',
        productId: sourceMove.productId,
        productName: sourceMove.productName,
        spec: sourceMove.spec,
        quantity,
        returnAmount,
        exchangeInventoryId: exchangeItem?.id || '',
        exchangeQuantity,
        exchangeAmount,
        creditToReceivable,
        refundAmount,
        extraChargeAmount,
        financeDocumentIds,
        reason,
        createdAt: new Date().toISOString()
    });
    if (!saveReturnState(snapshot)) return;
    closeModal('returnExchangeModal');
    renderInventory();
    renderShipping();
    renderFinance();
    showToast(`退換貨 ${returnId} 已完成`, 'bg-green-600');
}

function saveSupplierReturn(event) {
    event.preventDefault();
    ensureReturnCollections();
    const inventoryId = document.getElementById('supplierReturnInventory').value;
    const quantity = Number(document.getElementById('supplierReturnQuantity').value);
    const enteredCreditAmount = document.getElementById('supplierReturnAmount').value;
    const reason = document.getElementById('supplierReturnReason').value.trim();
    const item = data.inventory.find(inventoryItem => inventoryItem.id === inventoryId);
    if (!item) return showToast('請選擇有效的庫存項目。', 'bg-red-500');
    const availableQuantity = Number(item.availableQuantity || 0);
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > availableQuantity) {
        return showToast(`退貨數量須介於 1 至 ${availableQuantity}。`, 'bg-red-500');
    }

    const unitCost = Number(item.averageCost || 0);
    const totalCost = unitCost * quantity;
    const { unitCredit, unitTax } = getSupplierReturnPricing(item);
    const creditAmount = enteredCreditAmount === '' ? roundFinanceMoney(unitCredit * quantity) : Number(enteredCreditAmount);
    if (!Number.isInteger(creditAmount) || creditAmount < 0) return showToast('應付折讓金額須為非負整數。', 'bg-red-500');
    const creditTaxAmount = Math.min(creditAmount, roundFinanceMoney(unitTax * quantity));
    const creditBaseAmount = creditAmount - creditTaxAmount;
    const returnId = generateReturnTransactionId();
    const documentDate = getFinanceToday();
    const sourceOrderId = (item.relatedOrders || []).find(orderId =>
        data.accountsPayable.some(documentRecord => documentRecord.sourceOrderId === orderId)
    ) || (item.relatedOrders || [])[0] || '';
    const sourceOrder = data.orders.find(order => order.id === sourceOrderId);
    let sourceOrderItemIndex = -1;
    if (sourceOrder) {
        sourceOrderItemIndex = sourceOrder.items.findIndex(orderItem => {
            const matchesProduct = orderItem.productId === item.productId && (orderItem.spec || '') === (item.spec || '');
            const acceptedQuantity = Number(orderItem.acceptedQuantity ?? (sourceOrder.inventoryTransferred ? orderItem.quantity : 0));
            return matchesProduct && acceptedQuantity >= quantity;
        });
        if (sourceOrderItemIndex < 0) {
            return showToast('找不到足夠的來源採購收貨數量，無法將退貨釋回待收貨。請確認庫存來源或分次退貨。', 'bg-red-500');
        }
    }
    const snapshot = snapshotReturnState();
    const creditDocumentId = generateFinanceDocumentId('AP', data.accountsPayable);
    const creditLine = createReturnFinanceLine({
        productId: item.productId,
        productName: item.productName,
        spec: item.spec,
        quantity,
        unitPrice: quantity > 0 ? creditAmount / quantity : 0,
        amount: -creditBaseAmount
    });
    creditLine.taxStatus = creditTaxAmount > 0 ? '含稅' : '免稅';
    creditLine.taxAmount = -creditTaxAmount;
    creditLine.totalAmount = -creditAmount;
    const creditDocument = {
        id: creditDocumentId,
        type: 'payable',
        returnKind: 'supplier-credit',
        sourceReturnId: returnId,
        sourceOrderId,
        supplierId: item.supplierId || '',
        counterpartyName: item.supplierName || '未知供應商',
        documentDate,
        dueDate: '',
        accountingPeriod: documentDate.slice(0, 7),
        invoiceNumber: '',
        invoiceType: '',
        lines: [creditLine],
        subtotal: -creditBaseAmount,
        shipping: 0,
        discount: 0,
        taxAmount: -creditTaxAmount,
        totalAmount: -creditAmount,
        paidAmount: 0,
        payments: [],
        status: 'credit',
        createdAt: new Date().toISOString()
    };

    const oldQuantity = Number(item.quantity || 0);
    const oldTotalCost = Number(item.totalCost ?? oldQuantity * unitCost);
    item.quantity = oldQuantity - quantity;
    item.availableQuantity = availableQuantity - quantity;
    item.totalCost = Math.max(0, oldTotalCost - totalCost);
    item.averageCost = item.quantity > 0 ? item.totalCost / item.quantity : 0;
    item.status = getInventoryStatus(item);
    item.lastUpdated = new Date().toISOString();
    if (sourceOrderItemIndex >= 0) {
        const orderItem = sourceOrder.items[sourceOrderItemIndex];
        const acceptedQuantity = Number(orderItem.acceptedQuantity ?? (sourceOrder.inventoryTransferred ? orderItem.quantity : 0));
        const receivedQuantity = Number(orderItem.receivedQuantity ?? acceptedQuantity);
        orderItem.acceptedQuantity = Math.max(0, acceptedQuantity - quantity);
        orderItem.receivedQuantity = Math.max(0, receivedQuantity - quantity);
        if (typeof updateOrderAfterReceiptChange === 'function') updateOrderAfterReceiptChange(sourceOrder);
    }
    data.accountsPayable.unshift(creditDocument);
    data.inventoryMovements.push({
        id: generateOutboundId(),
        type: 'supplier-return',
        returnId,
        sourceOrderItemIndex,
        accountsDocumentId: creditDocumentId,
        inventoryId: item.id,
        orderId: sourceOrderId,
        orderNo: sourceOrderId,
        productId: item.productId,
        productName: item.productName,
        spec: item.spec,
        supplierId: item.supplierId || '',
        supplierName: item.supplierName || '',
        warehouse: item.warehouse || '總倉',
        quantity: -quantity,
        unitCost,
        costUnit: unitCost,
        totalCost: -totalCost,
        sourceDate: documentDate,
        note: reason || `退供應商折讓 ${returnId}`,
        createdAt: new Date().toISOString()
    });
    data.returnTransactions.unshift({
        id: returnId,
        kind: 'supplier-return',
        inventoryId: item.id,
        sourceOrderId,
        sourceOrderItemIndex,
        supplierId: item.supplierId || '',
        supplierName: item.supplierName || '',
        productId: item.productId,
        productName: item.productName,
        spec: item.spec,
        quantity,
        unitCost,
        unitCredit: quantity > 0 ? creditAmount / quantity : 0,
        taxAmount: creditTaxAmount,
        creditAmount,
        financeDocumentIds: [creditDocumentId],
        reason,
        createdAt: new Date().toISOString()
    });
    if (!saveReturnState(snapshot)) return;
    closeModal('returnExchangeModal');
    renderInventory();
    renderShipping();
    renderFinance();
    renderOrders();
    showToast(`供應商退貨 ${returnId} 已完成，應付折讓已建立`, 'bg-green-600');
}

function deleteSupplierReturnCredit(documentId) {
    const documentIndex = data.accountsPayable.findIndex(item =>
        item.id === documentId && item.returnKind === 'supplier-credit'
    );
    if (documentIndex < 0) return showToast('找不到供應商退貨折讓單。', 'bg-red-500');
    const creditDocument = data.accountsPayable[documentIndex];
    if (Number(creditDocument.paidAmount || 0) !== 0 || (creditDocument.payments || []).length > 0) {
        return showToast('此折讓單已有付款紀錄，不能刪除；請修改折讓金額並保留付款追溯。', 'bg-amber-600');
    }
    const transactionIndex = data.returnTransactions.findIndex(item => item.id === creditDocument.sourceReturnId);
    const transaction = data.returnTransactions[transactionIndex];
    const movementIndex = data.inventoryMovements.findIndex(move =>
        move.type === 'supplier-return' && move.returnId === creditDocument.sourceReturnId
    );
    if (!transaction || movementIndex < 0) return showToast('找不到關聯退貨或庫存異動，為避免帳實不符無法刪除。', 'bg-red-500');
    const movement = data.inventoryMovements[movementIndex];
    const inventoryItem = data.inventory.find(item => item.id === movement.inventoryId);
    if (!inventoryItem) return showToast('找不到退貨庫存，無法安全回復退貨。', 'bg-red-500');
    const returnTime = Date.parse(transaction.createdAt || movement.createdAt || '');
    const hasLaterInventoryMovement = data.inventoryMovements.some(move => {
        if (move.inventoryId !== movement.inventoryId || move.id === movement.id) return false;
        const moveTime = Date.parse(move.createdAt || '');
        return Number.isFinite(returnTime) && Number.isFinite(moveTime) && moveTime > returnTime;
    });
    if (hasLaterInventoryMovement) {
        return showToast('退貨後此庫存已有其他異動，不能刪除退貨；可修改折讓金額以更正帳款。', 'bg-amber-600');
    }

    const sourceOrder = data.orders.find(order => order.id === transaction.sourceOrderId);
    const itemIndex = Number(transaction.sourceOrderItemIndex ?? movement.sourceOrderItemIndex);
    const sourceOrderItem = Number.isInteger(itemIndex) && itemIndex >= 0 ? sourceOrder?.items?.[itemIndex] : null;
    if (sourceOrder && !sourceOrderItem) return showToast('找不到退貨來源採購品項，無法安全恢復待收數量。', 'bg-red-500');
    if (sourceOrderItem && Number(sourceOrderItem.receivedQuantity || 0) + Number(transaction.quantity || 0) > Number(sourceOrderItem.quantity || 0)) {
        return showToast('來源採購單已重新收貨，不能刪除此退貨；可修改折讓金額以更正帳款。', 'bg-amber-600');
    }
    if (!confirm(`確定刪除退貨折讓單 ${documentId}？\n此操作會撤銷供應商退貨、回補庫存，並恢復採購單待收數量。`)) return;

    const snapshot = snapshotReturnState();
    const quantity = Number(transaction.quantity || 0);
    const costAmount = Math.abs(Number(movement.totalCost ?? movement.costUnit * quantity));
    const oldQuantity = Number(inventoryItem.quantity || 0);
    const oldTotalCost = Number(inventoryItem.totalCost ?? oldQuantity * Number(inventoryItem.averageCost || 0));
    inventoryItem.quantity = oldQuantity + quantity;
    inventoryItem.availableQuantity = Number(inventoryItem.availableQuantity || 0) + quantity;
    inventoryItem.totalCost = oldTotalCost + costAmount;
    inventoryItem.averageCost = inventoryItem.quantity > 0 ? inventoryItem.totalCost / inventoryItem.quantity : 0;
    inventoryItem.lastCost = Number(movement.costUnit ?? inventoryItem.averageCost) || 0;
    inventoryItem.status = getInventoryStatus(inventoryItem);
    inventoryItem.lastUpdated = new Date().toISOString();
    if (sourceOrderItem) {
        sourceOrderItem.receivedQuantity = Number(sourceOrderItem.receivedQuantity || 0) + quantity;
        sourceOrderItem.acceptedQuantity = Number(sourceOrderItem.acceptedQuantity || 0) + quantity;
        updateOrderAfterReceiptChange(sourceOrder);
    }
    data.accountsPayable.splice(documentIndex, 1);
    data.inventoryMovements.splice(movementIndex, 1);
    data.returnTransactions.splice(transactionIndex, 1);
    if (!saveReturnState(snapshot)) return;
    renderInventory();
    renderReceiving();
    renderOrders();
    renderFinance();
    showToast('退貨折讓單已刪除，庫存與採購待收數量已回復。', 'bg-green-600');
}

function openReturnModal(mode = 'customer', outboundId = '') {
    ensureReturnCollections();
    const outboundSelect = document.getElementById('customerReturnOutbound');
    const exchangeSelect = document.getElementById('exchangeInventory');
    const supplierSelect = document.getElementById('supplierReturnInventory');
    outboundSelect.innerHTML = '<option value="">選擇原出貨紀錄</option>' + data.inventoryMovements
        .filter(move => move.type === 'outbound' && getCustomerReturnableQuantity(move.id) > 0)
        .map(move => `<option value="${escapeFinanceHtml(move.id)}">${escapeFinanceHtml(move.createdAt?.slice(0, 10) || '')} · ${escapeFinanceHtml(move.productName || move.productId)} ${escapeFinanceHtml(move.spec || '')} · 剩餘可退 ${getCustomerReturnableQuantity(move.id)} · ${escapeFinanceHtml(move.id)}</option>`)
        .join('');
    exchangeSelect.innerHTML = '<option value="">不換貨，僅退貨</option>' + data.inventory
        .filter(item => Number(item.availableQuantity || 0) > 0)
        .map(item => `<option value="${escapeFinanceHtml(item.id)}">${escapeFinanceHtml(item.productName || item.productId)} ${escapeFinanceHtml(item.spec || '')} · 可用 ${Number(item.availableQuantity || 0)} · ${escapeFinanceHtml(item.id)}</option>`)
        .join('');
    supplierSelect.innerHTML = '<option value="">選擇退貨庫存</option>' + data.inventory
        .filter(item => Number(item.availableQuantity || 0) > 0)
        .map(item => `<option value="${escapeFinanceHtml(item.id)}">${escapeFinanceHtml(item.productName || item.productId)} ${escapeFinanceHtml(item.spec || '')} · ${escapeFinanceHtml(item.supplierName || '未知供應商')} · 可退 ${Number(item.availableQuantity || 0)}</option>`)
        .join('');
    outboundSelect.value = outboundId;
    document.getElementById('customerReturnQuantity').value = '1';
    document.getElementById('customerReturnName').value = '';
    document.getElementById('customerReturnName').dataset.manual = 'false';
    document.getElementById('customerReturnReason').value = '';
    document.getElementById('exchangeQuantity').value = '';
    document.getElementById('exchangeUnitPrice').value = '';
    document.getElementById('exchangeUnitPrice').required = false;
    document.getElementById('supplierReturnQuantity').value = '1';
    document.getElementById('supplierReturnAmount').value = '';
    document.getElementById('supplierReturnAmount').dataset.manual = 'false';
    document.getElementById('supplierReturnReason').value = '';
    updateCustomerReturnDetails();
    updateExchangeReturnDetails();
    updateSupplierReturnDetails();
    setReturnMode(mode);
    document.getElementById('returnExchangeModal').classList.add('modal-active');
}

function openCustomerReturnModal(outboundId) {
    openReturnModal('customer', outboundId);
}

function setReturnMode(mode) {
    const customerMode = mode !== 'supplier';
    document.getElementById('customerReturnSection').classList.toggle('hidden', !customerMode);
    document.getElementById('supplierReturnSection').classList.toggle('hidden', customerMode);
    document.getElementById('returnCustomerTab').className = customerMode
        ? 'rounded bg-teal-700 px-3 py-2 text-sm font-semibold text-white'
        : 'rounded border px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50';
    document.getElementById('returnSupplierTab').className = customerMode
        ? 'rounded border px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50'
        : 'rounded bg-teal-700 px-3 py-2 text-sm font-semibold text-white';
}

function updateCustomerReturnDetails() {
    const outboundId = document.getElementById('customerReturnOutbound').value;
    const move = data.inventoryMovements.find(item => item.id === outboundId && item.type === 'outbound');
    const quantityInput = document.getElementById('customerReturnQuantity');
    const returnableQuantity = getCustomerReturnableQuantity(outboundId);
    quantityInput.max = String(returnableQuantity);
    if (move) {
        if (!Number.isInteger(Number(quantityInput.value)) || Number(quantityInput.value) <= 0 || Number(quantityInput.value) > returnableQuantity) {
            quantityInput.value = returnableQuantity > 0 ? '1' : '';
        }
        const receivable = getReturnOriginalReceivable(move);
        const customerName = document.getElementById('customerReturnName');
        if (customerName.dataset.manual !== 'true' && receivable?.counterpartyName) customerName.value = receivable.counterpartyName;
        document.getElementById('customerReturnSourceLabel').textContent =
            `${move.productName || move.productId} ${move.spec || ''} · 原出貨 ${move.quantity} · 已退 ${Number(move.quantity) - getCustomerReturnableQuantity(move.id)} · 可退 ${quantityInput.max}`;
    } else {
        quantityInput.value = '';
        document.getElementById('customerReturnSourceLabel').textContent = '請先選擇原出貨紀錄。';
    }
}

function updateSupplierReturnDetails() {
    const inventoryId = document.getElementById('supplierReturnInventory').value;
    const item = data.inventory.find(inventoryItem => inventoryItem.id === inventoryId);
    const quantityInput = document.getElementById('supplierReturnQuantity');
    const availableQuantity = Number(item?.availableQuantity || 0);
    quantityInput.max = String(availableQuantity);
    if (item && (!Number.isInteger(Number(quantityInput.value)) || Number(quantityInput.value) <= 0 || Number(quantityInput.value) > availableQuantity)) {
        quantityInput.value = availableQuantity > 0 ? '1' : '';
    } else if (!item) {
        quantityInput.value = '';
    }
    updateSupplierReturnAmount();
    document.getElementById('supplierReturnSourceLabel').textContent = item
        ? `${item.supplierName || '未知供應商'} · ${item.productName || item.productId} ${item.spec || ''} · 可用 ${item.availableQuantity} · 庫存成本 $${Number(item.averageCost || 0).toLocaleString()} · 預估含稅折讓 $${roundFinanceMoney(getSupplierReturnPricing(item).unitCredit).toLocaleString()}/件`
        : '請選擇要退回供應商的庫存。';
}

function updateSupplierReturnAmount() {
    const amountInput = document.getElementById('supplierReturnAmount');
    if (amountInput.dataset.manual === 'true') return;
    const item = data.inventory.find(inventoryItem => inventoryItem.id === document.getElementById('supplierReturnInventory').value);
    const quantity = Number(document.getElementById('supplierReturnQuantity').value) || 0;
    amountInput.value = item ? String(roundFinanceMoney(getSupplierReturnPricing(item).unitCredit * quantity)) : '';
}

function updateExchangeReturnDetails() {
    const inventoryId = document.getElementById('exchangeInventory').value;
    const item = data.inventory.find(inventoryItem => inventoryItem.id === inventoryId);
    const quantityInput = document.getElementById('exchangeQuantity');
    const availableQuantity = Number(item?.availableQuantity || 0);
    quantityInput.max = String(availableQuantity);
    if (item && (!Number.isInteger(Number(quantityInput.value)) || Number(quantityInput.value) <= 0 || Number(quantityInput.value) > availableQuantity)) {
        quantityInput.value = availableQuantity > 0 ? '1' : '';
    } else if (!item) {
        quantityInput.value = '';
    }
    const priceInput = document.getElementById('exchangeUnitPrice');
    priceInput.required = Boolean(item);
    if (item && !priceInput.value) {
        priceInput.value = getInventorySalesPrice(item);
    }
    if (item && priceInput.value === '') priceInput.required = true;
    const sourceMove = data.inventoryMovements.find(move =>
        move.id === document.getElementById('customerReturnOutbound').value && move.type === 'outbound'
    );
    const returnQuantity = Number(document.getElementById('customerReturnQuantity').value) || 0;
    const returnAmount = sourceMove
        ? calculateCustomerReturnAmount(sourceMove, returnQuantity, getReturnOriginalReceivable(sourceMove), getReturnOriginalLine(getReturnOriginalReceivable(sourceMove), sourceMove))
        : 0;
    const exchangeQuantity = item ? Number(quantityInput.value) || 0 : 0;
    const exchangeAmount = item && exchangeQuantity > 0
        ? calculateFinanceLine({ unitPrice: Number(priceInput.value) || 0, quantity: exchangeQuantity, taxStatus: '免稅' }).totalAmount
        : 0;
    const openReceivable = sourceMove ? getFinanceBalance(getReturnOriginalReceivable(sourceMove) || { totalAmount: 0 }) : 0;
    const excessReturn = Math.max(0, returnAmount - Math.min(returnAmount, openReceivable));
    const refundAmount = Math.max(0, excessReturn - exchangeAmount);
    const extraChargeAmount = Math.max(0, exchangeAmount - excessReturn);
    document.getElementById('exchangeReturnPreview').textContent =
        `退貨金額 ${formatFinanceMoney(returnAmount)} · 換出金額 ${formatFinanceMoney(exchangeAmount)} · 退款 ${formatFinanceMoney(refundAmount)} · 補收 ${formatFinanceMoney(extraChargeAmount)}`;
}

function renderReturnTransactions() {
    const container = document.getElementById('returnTransactionList');
    if (!container) return;
    const transactions = data.returnTransactions || [];
    if (!transactions.length) {
        container.innerHTML = '<div class="rounded border bg-white p-4 text-center text-sm text-slate-500">目前沒有退換貨紀錄。</div>';
        return;
    }
    container.innerHTML = transactions.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).map(item => {
        const isSupplierReturn = item.kind === 'supplier-return';
        const title = isSupplierReturn ? '退回供應商' : item.exchangeInventoryId ? '客戶換貨' : '客戶退貨';
        const counterparty = isSupplierReturn ? item.supplierName : item.customerName;
        const documents = (item.financeDocumentIds || []).join('、') || '無新增帳款單';
        return `<article class="rounded border bg-white p-4">
            <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <div class="font-mono text-xs text-slate-500">${escapeFinanceHtml(item.id)} · ${escapeFinanceHtml(item.createdAt?.slice(0, 10) || '')}</div>
                    <div class="font-bold text-slate-800">${title} · ${escapeFinanceHtml(item.productName || '')} ${escapeFinanceHtml(item.spec || '')}</div>
                    <div class="text-sm text-slate-600">${escapeFinanceHtml(counterparty || '未指定對象')} · 數量 ${Number(item.quantity || 0)} · 原出貨／採購 ${escapeFinanceHtml(item.sourceOutboundId || item.sourceOrderId || '-')}</div>
                    ${item.exchangeInventoryId ? `<div class="text-sm text-teal-700">換出 ${escapeFinanceHtml(item.exchangeInventoryId)} × ${Number(item.exchangeQuantity || 0)} · ${formatFinanceMoney(item.exchangeAmount)}</div>` : ''}
                    <div class="text-xs text-slate-500">帳款：${escapeFinanceHtml(documents)}${item.reason ? ` · 原因：${escapeFinanceHtml(item.reason)}` : ''}</div>
                </div>
                <div class="text-right text-sm font-semibold ${isSupplierReturn ? 'text-orange-800' : 'text-teal-800'}">
                    ${isSupplierReturn ? `應付折讓 ${formatFinanceMoney(item.creditAmount)}` : `退貨 ${formatFinanceMoney(item.returnAmount)} · 應收折抵 ${formatFinanceMoney(item.creditToReceivable)} · 退款 ${formatFinanceMoney(item.refundAmount)} · 補收 ${formatFinanceMoney(item.extraChargeAmount)}`}
                </div>
            </div>
        </article>`;
    }).join('');
}

function exportReturnTransactions() {
    const rows = [[
        '退換貨單號', '類型', '日期', '客戶／供應商', '原出貨／採購單', '產品', '規格', '退貨數量',
        '退貨金額', '應收折抵', '換出庫存', '換出數量', '換出金額', '退款', '補收', '供應商應付折讓', '帳款單號', '原因'
    ]];
    (data.returnTransactions || []).forEach(item => {
        rows.push([
            item.id,
            item.kind === 'supplier-return' ? '退回供應商' : item.exchangeInventoryId ? '客戶換貨' : '客戶退貨',
            item.createdAt || '',
            item.kind === 'supplier-return' ? item.supplierName || '' : item.customerName || '',
            item.sourceOutboundId || item.sourceOrderId || '',
            item.productName || item.productId || '',
            item.spec || '',
            item.quantity || 0,
            item.returnAmount || 0,
            item.creditToReceivable || 0,
            item.exchangeInventoryId || '',
            item.exchangeQuantity || 0,
            item.exchangeAmount || 0,
            item.refundAmount || 0,
            item.extraChargeAmount || 0,
            item.creditAmount || 0,
            (item.financeDocumentIds || []).join(', '),
            item.reason || ''
        ]);
    });
    saveAsExcel(rows, '退換貨紀錄', `退換貨紀錄_${getTodayStr()}.xlsx`);
    showToast('退換貨紀錄已匯出', 'bg-green-600');
}