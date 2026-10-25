function isSalesBundleProduct(product) {
    return product?.productType === 'sales-bundle';
}

function getSalesBundleAvailability(product) {
    if (!isSalesBundleProduct(product) || !Array.isArray(product.components) || product.components.length === 0) return 0;
    const limits = product.components.map(component => {
        const required = Number(component.quantity);
        if (!Number.isInteger(required) || required <= 0) return 0;
        const available = (data.inventory || [])
            .filter(item => item.productId === component.productId)
            .reduce((sum, item) => sum + Math.max(0, Number(item.availableQuantity ?? item.quantity) || 0), 0);
        return Math.floor(available / required);
    });
    return limits.length ? Math.min(...limits) : 0;
}

function allocateSalesBundleUnits(product, quantity, reserved = new Map()) {
    if (!isSalesBundleProduct(product) || !Number.isInteger(quantity) || quantity <= 0) return null;
    if (!Array.isArray(product.components) || product.components.length === 0) return null;
    const units = [];
    const reservations = new Map(reserved);

    for (let unitIndex = 0; unitIndex < quantity; unitIndex++) {
        const allocations = [];
        for (const component of product.components) {
            const required = Number(component.quantity);
            if (!component.productId || !Number.isInteger(required) || required <= 0) return null;
            let remaining = required;
            const inventoryItems = (data.inventory || []).filter(item => item.productId === component.productId);
            for (const item of inventoryItems) {
                const stockQuantity = Number(item.availableQuantity ?? item.quantity);
                if (!Number.isFinite(stockQuantity) || stockQuantity < 0) continue;
                const available = stockQuantity - (reservations.get(item.id) || 0);
                const allocated = Math.min(remaining, available);
                if (allocated <= 0) continue;
                const costUnit = Number(item.averageCost || 0);
                if (!Number.isFinite(costUnit) || costUnit < 0) return null;
                allocations.push({
                    inventoryId: item.id,
                    productId: item.productId,
                    productName: item.productName || component.productName || '',
                    spec: item.spec || component.spec || '',
                    supplierId: item.supplierId || component.supplierId || '',
                    supplierName: item.supplierName || component.supplierName || '',
                    warehouse: item.warehouse || '總倉',
                    unit: item.unit || component.unit || 'pcs',
                    quantity: allocated,
                    costUnit
                });
                reservations.set(item.id, (reservations.get(item.id) || 0) + allocated);
                remaining -= allocated;
                if (remaining === 0) break;
            }
            if (remaining > 0) return null;
        }
        units.push({ allocations });
    }
    reserved.clear();
    reservations.forEach((value, key) => reserved.set(key, value));
    return units;
}

function prepareSalesBundleLineAllocations(lines) {
    const reserved = new Map();
    for (const line of lines) {
        if (line.bundleMode === 'assembled' || line.bundleMode !== 'components') {
            if (line.inventoryId) reserved.set(line.inventoryId, (reserved.get(line.inventoryId) || 0) + Number(line.quantity || 0));
        }
    }
    for (const [inventoryId, quantity] of reserved) {
        const item = (data.inventory || []).find(inventoryItem => inventoryItem.id === inventoryId);
        const availableQuantity = Number(item?.availableQuantity ?? item?.quantity);
        if (!item || !Number.isInteger(quantity) || !Number.isFinite(availableQuantity) ||
            availableQuantity < 0 || quantity > availableQuantity || quantity <= 0) return false;
    }
    for (const line of lines) {
        if (line.bundleMode !== 'components') continue;
        const product = (data.products || []).find(item => item.id === line.productId);
        const units = allocateSalesBundleUnits(product, Number(line.quantity), reserved);
        if (!units) return false;
        line.bundleUnits = units;
        line.costUnit = units.reduce((sum, unit) =>
            sum + unit.allocations.reduce((unitCost, allocation) => unitCost + allocation.quantity * allocation.costUnit, 0), 0
        ) / units.length;
        line.availableQuantity = getSalesBundleAvailability(product);
    }
    return true;
}

function applySalesBundleConsumption(line, details) {
    const product = (data.products || []).find(item => item.id === line.productId);
    if (!product || line.bundleMode !== 'components' || !Array.isArray(line.bundleUnits)) {
        throw new Error('促銷組合資料不完整，無法扣除組成品庫存。');
    }
    const parentId = generateOutboundId();
    const now = new Date().toISOString();
    const totalCost = line.bundleUnits.reduce((sum, unit) =>
        sum + unit.allocations.reduce((unitCost, allocation) => unitCost + allocation.quantity * allocation.costUnit, 0), 0
    );
    const bundleUnits = line.bundleUnits.map(unit => ({
        allocations: unit.allocations.map(allocation => ({ ...allocation }))
    }));
    const movement = {
        id: parentId,
        type: 'outbound',
        inventoryId: '',
        orderId: details.orderId,
        orderNo: details.orderId,
        accountsDocumentId: details.orderId,
        salesNo: details.orderId,
        customerId: details.customerId || '',
        customerName: details.customerName || '',
        logisticsProvider: details.logisticsProvider || '',
        logisticsNumber: details.logisticsNumber || '',
        deliveryAddress: details.deliveryAddress || '',
        deliveryPerson: details.deliveryPerson || '',
        shipmentNote: details.shipmentNote || '',
        productId: product.id,
        productName: product.prodName || '',
        spec: product.spec || '',
        warehouse: '組合扣料',
        unit: product.unit || 'pcs',
        quantity: bundleUnits.length,
        unitCost: line.unitPrice,
        salesPrice: line.unitPrice,
        costUnit: totalCost / bundleUnits.length,
        totalCost: line.unitPrice * bundleUnits.length,
        bundleMode: 'components',
        bundleUnits,
        sourceDate: details.date,
        invoiceType: details.invoiceType || '無發票',
        invoiceNo: details.invoiceNumber || '',
        invoiceDate: details.date,
        channel: details.channel,
        note: `${details.note}（組成品扣庫）`,
        createdAt: now
    };
    data.inventoryMovements.push(movement);

    bundleUnits.forEach(unit => unit.allocations.forEach(allocation => {
        const inventoryItem = (data.inventory || []).find(item => item.id === allocation.inventoryId);
        if (!inventoryItem || Number(inventoryItem.availableQuantity ?? inventoryItem.quantity) < allocation.quantity) {
            throw new Error(`促銷組合組成品「${allocation.productName}」庫存已變動，請重新確認。`);
        }
        inventoryItem.quantity = Number(inventoryItem.quantity || 0) - allocation.quantity;
        inventoryItem.availableQuantity = Number(inventoryItem.availableQuantity || 0) - allocation.quantity;
        inventoryItem.totalCost = inventoryItem.quantity * Number(inventoryItem.averageCost || 0);
        inventoryItem.status = inventoryItem.quantity > 0 ? inventoryItem.status : '缺貨';
        inventoryItem.lastUpdated = now;
        data.inventoryMovements.push({
            id: generateOutboundId(),
            type: 'bundle-component-outbound',
            parentOutboundId: parentId,
            bundleProductId: product.id,
            orderId: details.orderId,
            orderNo: details.orderId,
            accountsDocumentId: details.orderId,
            salesNo: details.orderId,
            customerId: details.customerId || '',
            customerName: details.customerName || '',
            logisticsProvider: details.logisticsProvider || '',
            logisticsNumber: details.logisticsNumber || '',
            deliveryAddress: details.deliveryAddress || '',
            deliveryPerson: details.deliveryPerson || '',
            shipmentNote: details.shipmentNote || '',
            inventoryId: inventoryItem.id,
            productId: inventoryItem.productId,
            productName: inventoryItem.productName,
            spec: inventoryItem.spec || '',
            warehouse: inventoryItem.warehouse || '總倉',
            quantity: allocation.quantity,
            unitCost: allocation.costUnit,
            costUnit: allocation.costUnit,
            totalCost: allocation.quantity * allocation.costUnit,
            sourceDate: details.date,
            channel: details.channel,
            note: `促銷組合 ${product.prodName} 組成品扣庫`,
            createdAt: now
        });
    }));

    return movement;
}

function getUnreturnedSalesBundleUnits(sourceMove) {
    const returnedIndexes = new Set((data.inventoryMovements || [])
        .filter(move => move.type === 'customer-return' && move.sourceOutboundId === sourceMove.id)
        .flatMap(move => move.bundleUnitIndexes || []));
    return (sourceMove.bundleUnits || [])
        .map((unit, index) => ({ unit, index }))
        .filter(item => !returnedIndexes.has(item.index));
}

function validateSalesBundleUnits(units) {
    return Array.isArray(units) && units.length > 0 && units.every(unit =>
        Array.isArray(unit.allocations) && unit.allocations.length > 0 && unit.allocations.every(allocation =>
            Boolean(allocation.inventoryId && allocation.productId) &&
            Number.isInteger(Number(allocation.quantity)) && Number(allocation.quantity) > 0 &&
            Number.isFinite(Number(allocation.costUnit)) && Number(allocation.costUnit) >= 0
        )
    );
}

function restoreSalesBundleComponents(sourceMove, quantity, returnId, documentDate) {
    if (!validateSalesBundleUnits(sourceMove.bundleUnits) ||
        Number(sourceMove.quantity) !== sourceMove.bundleUnits.length) {
        throw new Error('促銷組合出貨快照不完整，無法安全退回組成品。');
    }
    const availableUnits = getUnreturnedSalesBundleUnits(sourceMove);
    if (availableUnits.length < quantity) throw new Error('促銷組合可退數量已變動，請重新確認。');
    const selected = availableUnits.slice(0, quantity);
    const now = new Date().toISOString();
    selected.forEach(({ unit }) => unit.allocations.forEach(allocation => {
        let inventoryItem = (data.inventory || []).find(item => item.id === allocation.inventoryId);
        if (!inventoryItem) {
            inventoryItem = {
                id: allocation.inventoryId,
                productId: allocation.productId,
                productName: allocation.productName,
                spec: allocation.spec,
                supplierId: allocation.supplierId,
                supplierName: allocation.supplierName,
                warehouse: allocation.warehouse,
                unit: allocation.unit,
                quantity: 0,
                availableQuantity: 0,
                averageCost: allocation.costUnit,
                lastCost: allocation.costUnit,
                totalCost: 0,
                status: '缺貨',
                lastUpdated: now,
                relatedOrders: []
            };
            data.inventory.push(inventoryItem);
        }
        const oldQuantity = Number(inventoryItem.quantity || 0);
        const oldTotalCost = Number(inventoryItem.totalCost ?? oldQuantity * Number(inventoryItem.averageCost || 0));
        inventoryItem.quantity = oldQuantity + allocation.quantity;
        inventoryItem.availableQuantity = Number(inventoryItem.availableQuantity ?? oldQuantity) + allocation.quantity;
        inventoryItem.totalCost = oldTotalCost + allocation.costUnit * allocation.quantity;
        inventoryItem.averageCost = inventoryItem.quantity > 0 ? inventoryItem.totalCost / inventoryItem.quantity : allocation.costUnit;
        inventoryItem.lastCost = allocation.costUnit;
        inventoryItem.status = '正常';
        inventoryItem.lastUpdated = now;
        const batch = createInventoryBatch({
            inventoryId: inventoryItem.id,
            orderId: '',
            productId: inventoryItem.productId,
            productName: inventoryItem.productName,
            spec: inventoryItem.spec,
            supplierId: inventoryItem.supplierId,
            supplierName: inventoryItem.supplierName,
            quantity: allocation.quantity,
            unitCost: allocation.costUnit,
            sourceDate: documentDate,
            arrivalDate: documentDate,
            warehouse: inventoryItem.warehouse
        });
        batch.returnId = returnId;
        data.inventoryMovements.push({
            id: generateOutboundId(),
            type: 'bundle-component-return',
            returnId,
            sourceOutboundId: sourceMove.id,
            inventoryId: inventoryItem.id,
            productId: inventoryItem.productId,
            productName: inventoryItem.productName,
            spec: inventoryItem.spec,
            warehouse: inventoryItem.warehouse || '總倉',
            quantity: allocation.quantity,
            unitCost: allocation.costUnit,
            costUnit: allocation.costUnit,
            totalCost: allocation.costUnit * allocation.quantity,
            sourceDate: documentDate,
            createdAt: now
        });
    }));
    return selected.map(item => item.index);
}

function restoreSalesBundleConsumption(sourceMove) {
    if (sourceMove.bundleMode !== 'components' ||
        !validateSalesBundleUnits(sourceMove.bundleUnits) ||
        Number(sourceMove.quantity) !== sourceMove.bundleUnits.length) {
        throw new Error('促銷組合出貨缺少組成品快照，無法安全回補庫存。');
    }
    const allocations = sourceMove.bundleUnits.flatMap(unit => unit.allocations || []);
    const totals = new Map();
    allocations.forEach(allocation => {
        const current = totals.get(allocation.inventoryId) || { ...allocation, quantity: 0, totalCost: 0 };
        current.quantity += Number(allocation.quantity) || 0;
        current.totalCost += (Number(allocation.costUnit) || 0) * (Number(allocation.quantity) || 0);
        totals.set(allocation.inventoryId, current);
    });
    totals.forEach(allocation => {
        let inventoryItem = (data.inventory || []).find(item => item.id === allocation.inventoryId);
        if (!inventoryItem) {
            inventoryItem = {
                id: allocation.inventoryId,
                productId: allocation.productId,
                productName: allocation.productName,
                spec: allocation.spec,
                supplierId: allocation.supplierId,
                supplierName: allocation.supplierName,
                warehouse: allocation.warehouse,
                unit: allocation.unit,
                quantity: 0,
                availableQuantity: 0,
                averageCost: allocation.costUnit,
                lastCost: allocation.costUnit,
                totalCost: 0,
                status: '缺貨',
                relatedOrders: []
            };
            data.inventory.push(inventoryItem);
        }
        const oldQuantity = Number(inventoryItem.quantity || 0);
        const oldCost = Number(inventoryItem.totalCost ?? oldQuantity * Number(inventoryItem.averageCost || 0));
        inventoryItem.quantity = oldQuantity + allocation.quantity;
        inventoryItem.availableQuantity = Number(inventoryItem.availableQuantity ?? oldQuantity) + allocation.quantity;
        inventoryItem.totalCost = oldCost + allocation.totalCost;
        inventoryItem.averageCost = inventoryItem.quantity > 0
            ? inventoryItem.totalCost / inventoryItem.quantity
            : Number(allocation.costUnit || 0);
        inventoryItem.lastCost = Number(allocation.costUnit || 0);
        inventoryItem.status = '正常';
        inventoryItem.lastUpdated = new Date().toISOString();
    });
}

function assembleSalesBundle(productId, quantity, warehouse) {
    const product = (data.products || []).find(item => item.id === productId);
    if (!isSalesBundleProduct(product)) throw new Error('請選擇有效的促銷組合產品。');
    if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('組裝數量須為正整數。');
    const units = allocateSalesBundleUnits(product, quantity);
    if (!units) throw new Error('組成品可用庫存不足，無法完成組裝。');
    const snapshot = JSON.stringify({
        inventory: data.inventory,
        inventoryMovements: data.inventoryMovements,
        inventoryBatches: data.inventoryBatches
    });
    const assemblyId = generateOutboundId();
    const now = new Date().toISOString();
    try {
        const movementIndex = data.inventoryMovements.length;
        data.inventoryMovements.push({
            id: assemblyId,
            type: 'bundle-assembly-inbound',
            assemblyId
        });
        const totalCost = units.reduce((sum, unit) =>
            sum + unit.allocations.reduce((unitCost, allocation) => unitCost + allocation.quantity * allocation.costUnit, 0), 0
        );
        units.forEach(unit => unit.allocations.forEach(allocation => {
            const item = data.inventory.find(inventoryItem => inventoryItem.id === allocation.inventoryId);
            if (!item || Number(item.availableQuantity ?? item.quantity) < allocation.quantity) throw new Error('組成品庫存已變動，請重新整理後再組裝。');
            item.quantity -= allocation.quantity;
            item.availableQuantity -= allocation.quantity;
            item.totalCost = item.quantity * Number(item.averageCost || 0);
            item.status = item.quantity > 0 ? item.status : '缺貨';
            item.lastUpdated = now;
            data.inventoryMovements.push({
                id: generateOutboundId(),
                type: 'bundle-assembly-consume',
                assemblyId,
                bundleProductId: product.id,
                inventoryId: item.id,
                productId: item.productId,
                productName: item.productName,
                spec: item.spec || '',
                warehouse: item.warehouse || '總倉',
                quantity: allocation.quantity,
                unitCost: allocation.costUnit,
                totalCost: allocation.quantity * allocation.costUnit,
                sourceDate: getFinanceToday(),
                createdAt: now
            });
        }));
        const supplier = (data.suppliers || []).find(item => item.id === product.supplierId);
        const targetWarehouse = warehouse || '總倉';
        let output = data.inventory.find(item => item.productId === product.id &&
            item.warehouse === targetWarehouse && item.supplierId === (product.supplierId || ''));
        const unitCost = totalCost / quantity;
        if (output) {
            const oldQuantity = Number(output.quantity || 0);
            output.quantity = oldQuantity + quantity;
            output.availableQuantity = Number(output.availableQuantity || 0) + quantity;
            output.totalCost = Number(output.totalCost || 0) + totalCost;
            output.averageCost = output.totalCost / output.quantity;
            output.lastCost = unitCost;
            output.status = '正常';
            output.lastUpdated = now;
        } else {
            output = {
                id: generateInventoryId(),
                productId: product.id,
                sku: product.sku || '',
                productName: product.prodName || '',
                spec: product.spec || '',
                supplierId: product.supplierId || '',
                supplierName: supplier?.name || '',
                warehouse: targetWarehouse,
                unit: product.unit || 'pcs',
                quantity,
                availableQuantity: quantity,
                averageCost: unitCost,
                lastCost: unitCost,
                totalCost,
                status: '正常',
                lastUpdated: now,
                relatedOrders: []
            };
            data.inventory.push(output);
        }
        createInventoryBatch({
            inventoryId: output.id,
            orderId: assemblyId,
            productId: product.id,
            productName: product.prodName || '',
            spec: product.spec || '',
            supplierId: product.supplierId || '',
            supplierName: supplier?.name || '',
            quantity,
            unitCost,
            sourceDate: getFinanceToday(),
            arrivalDate: getFinanceToday(),
            warehouse: targetWarehouse
        });
        data.inventoryMovements[movementIndex] = {
            id: assemblyId,
            type: 'bundle-assembly-inbound',
            assemblyId,
            inventoryId: output.id,
            productId: product.id,
            productName: product.prodName || '',
            spec: product.spec || '',
            warehouse: targetWarehouse,
            quantity,
            unitCost,
            totalCost,
            sourceDate: getFinanceToday(),
            createdAt: now
        };
        if (!saveData()) throw new Error('組裝入庫儲存失敗，資料已還原。');
        renderInventory();
        renderPosProducts();
        showToast(`${product.prodName} 已組裝 ${quantity} ${product.unit || '件'}入庫。`, 'bg-green-600');
    } catch (error) {
        Object.assign(data, JSON.parse(snapshot));
        throw error;
    }
}

function submitSalesBundleAssembly(event) {
    event.preventDefault();
    const productId = document.getElementById('bundleAssemblyProduct')?.value || '';
    const quantity = Number(document.getElementById('bundleAssemblyQuantity')?.value);
    const warehouse = String(document.getElementById('bundleAssemblyWarehouse')?.value || '').trim() || '總倉';
    try {
        assembleSalesBundle(productId, quantity, warehouse);
        closeModal('bundleAssemblyModal');
        event.target.reset();
    } catch (error) {
        showToast(error.message || '組合產品組裝失敗，資料未變更。', 'bg-red-500');
    }
}
