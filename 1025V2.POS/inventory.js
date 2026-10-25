        function getInventoryStatus(item) {
            const product = data.products.find(candidate => candidate.id === item.productId);
            const availableQuantity = Number(item.availableQuantity ?? item.quantity) || 0;
            const reorderPoint = Number(product?.reorderPoint) || Number(product?.safetyStock) || Number(item.reorderPoint) || 0;
            if (availableQuantity <= 0) return '缺貨';
            return reorderPoint > 0 && availableQuantity <= reorderPoint ? '低庫存' : '正常';
        }

        function getInventoryMovementLabel(type) {
            const labels = {
                outbound: '出貨',
                'customer-return': '客戶退貨',
                'supplier-return': '退回供應商',
                'manual-inbound': '手動轉入',
                'kit-inbound': '組合包拆套入庫',
                split: '包裝換算轉入',
                'bundle-assembly-consume': '促銷組合組裝扣料',
                'bundle-assembly-inbound': '促銷組合組裝入庫',
                'bundle-component-outbound': '促銷組成品扣庫',
                'bundle-component-return': '促銷組成品退回'
            };
            return labels[type] || '訂單轉入';
        }

        function getInventorySalesPrice(item) {
            const inventoryPrice = Number(item?.salesPrice);
            if (item?.salesPrice !== '' && item?.salesPrice !== null && item?.salesPrice !== undefined && Number.isFinite(inventoryPrice) && inventoryPrice >= 0) {
                return inventoryPrice;
            }
            const product = data.products.find(candidate => candidate.id === item?.productId);
            return product?.salesPrice === '' || product?.salesPrice === null || product?.salesPrice === undefined
                ? ''
                : Number(product.salesPrice) || 0;
        }

        function renderInventory() {
            const container = document.getElementById('inventoryList');
            if (!container) return;
            container.innerHTML = '';
            updateManualInventoryProductOptions();

            const keyword = (document.getElementById('searchInventoryKeyword')?.value || '').trim().toLocaleLowerCase();
            const statusFilter = document.getElementById('filterInventoryStatus')?.value || 'all';

            const inventoryItems = data.inventory.filter(item => {
                item.status = getInventoryStatus(item);
                if (statusFilter !== 'all' && item.status !== statusFilter) return false;
                if (!keyword) return true;

                return [item.id, item.productId, item.productName, item.spec, item.supplierName, item.warehouse, item.relatedOrders?.join(', ')].some(field =>
                    field && String(field).toLocaleLowerCase().includes(keyword)
                );
            });

            const totalAvailable = inventoryItems.reduce((sum, item) => sum + Number(item.availableQuantity || 0), 0);
            const inventoryValue = inventoryItems.reduce((sum, item) => sum + Number(item.totalCost || 0), 0);
            const lowStockCount = inventoryItems.filter(item => item.status === '低庫存').length;
            const summary = document.getElementById('inventorySummary');
            if (summary) {
                summary.innerHTML = `
                    <div class="card px-4 py-3 border-l-4 border-teal-500">
                        <div class="text-xs font-semibold text-gray-500">庫存品項</div>
                        <div class="text-2xl font-bold text-gray-900">${inventoryItems.length}</div>
                    </div>
                    <div class="card px-4 py-3 border-l-4 border-blue-500">
                        <div class="text-xs font-semibold text-gray-500">可用總數</div>
                        <div class="text-2xl font-bold text-gray-900">${totalAvailable.toLocaleString()}</div>
                    </div>
                    <div class="card px-4 py-3 border-l-4 border-amber-500">
                        <div class="text-xs font-semibold text-gray-500">低庫存品項</div>
                        <div class="text-2xl font-bold text-amber-700">${lowStockCount}</div>
                    </div>
                    <div class="card px-4 py-3 border-l-4 border-indigo-500">
                        <div class="text-xs font-semibold text-gray-500">庫存總金額</div>
                        <div class="text-2xl font-bold text-indigo-800">$${Math.round(inventoryValue).toLocaleString()}</div>
                    </div>
                `;
            }

            if (inventoryItems.length === 0) {
                container.innerHTML = '<div class="card p-6 text-center text-sm text-gray-500">沒有符合條件的庫存資料。</div>';
            } else {
                container.innerHTML = `
                    <div class="card overflow-hidden">
                        <div class="overflow-x-auto">
                            <table class="inventory-table min-w-full text-left text-sm">
                                <thead>
                                    <tr class="bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
                                        <th class="px-3 py-2">產品 / 庫存識別</th>
                                        <th class="px-3 py-2">狀態</th>
                                        <th class="px-3 py-2 text-right">庫存 / 可用</th>
                                        <th class="px-3 py-2 text-right">成本單價</th>
                                        <th class="px-3 py-2 text-right">庫存金額</th>
                                        <th class="px-3 py-2">常用操作</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-slate-100">
                                    ${inventoryItems.map(item => {
                                        const batchCount = data.inventoryBatches.filter(batch => batch.inventoryId === item.id).length;
                                        const statusClass = item.status === '正常'
                                            ? 'border-teal-200 bg-teal-50 text-teal-700'
                                            : item.status === '低庫存'
                                                ? 'border-orange-200 bg-orange-50 text-orange-700'
                                                : 'border-red-200 bg-red-50 text-red-700';
                                        return `
                                            <tr class="hover:bg-slate-50">
                                                <td class="px-3 py-2.5">
                                                    <div class="font-bold text-slate-800">${item.productName || '未知產品'}</div>
                                                    <div class="text-xs text-slate-500">${item.spec || '無規格'} · ${item.supplierName || '未知供應商'} · ${item.warehouse || '總倉'}</div>
                                                    <div class="mt-0.5 text-[11px] text-slate-400">庫存 ${item.id} · 產品 ${item.productId}</div>
                                                    <div class="text-[11px] text-slate-500">來源訂單：${item.relatedOrders?.join(', ') || '無'} · ${batchCount} 個批次</div>
                                                </td>
                                                <td class="whitespace-nowrap px-3 py-2.5">
                                                    <span class="rounded-full border px-2 py-1 text-xs font-semibold ${statusClass}">${item.status}</span>
                                                </td>
                                                <td class="whitespace-nowrap px-3 py-2.5 text-right">
                                                    <span class="text-lg font-bold text-slate-900">${Number(item.quantity || 0).toLocaleString()}</span>
                                                    <span class="text-xs text-slate-500"> / </span>
                                                    <span class="font-semibold text-blue-700">${Number(item.availableQuantity || 0).toLocaleString()}</span>
                                                </td>
                                                <td class="whitespace-nowrap px-3 py-2.5 text-right">$${Number(item.lastCost || 0).toLocaleString()}</td>
                                                <td class="whitespace-nowrap px-3 py-2.5 text-right font-bold text-indigo-800">$${Math.round(Number(item.totalCost || 0)).toLocaleString()}</td>
                                                <td class="px-3 py-2.5">
                                                    <div class="flex flex-wrap items-center gap-1.5">
                                                        <button type="button" onclick="openInventoryBatches('${item.id}')" class="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100">批次 ${batchCount}</button>
                                                        <button type="button" onclick="openSalesInvoiceForInventory('${item.id}')" class="rounded px-2 py-1 text-xs font-semibold ${Number(item.availableQuantity || 0) > 0 ? 'bg-red-600 text-white hover:bg-red-700' : 'cursor-not-allowed bg-slate-100 text-slate-400'}" ${Number(item.availableQuantity || 0) > 0 ? '' : 'disabled'}>銷售出貨</button>
                                                        <details class="inventory-row-advanced relative">
                                                            <summary class="cursor-pointer rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">更多</summary>
                                                            <div class="absolute right-0 z-10 mt-1 flex min-w-max flex-col gap-1 rounded border border-slate-200 bg-white p-1.5 shadow-lg">
                                                                <button type="button" onclick="openInventoryAdjustModal('${item.id}')" class="rounded px-2 py-1 text-left text-xs hover:bg-orange-50">盤點調整</button>
                                                                <button type="button" onclick="openInventorySplitModal('${item.id}')" class="rounded px-2 py-1 text-left text-xs hover:bg-teal-50">拆分包裝</button>
                                                                <button type="button" onclick="openDeleteInventoryConfirmModal('${item.id}')" class="rounded px-2 py-1 text-left text-xs text-red-700 hover:bg-red-50">刪除庫存</button>
                                                            </div>
                                                        </details>
                                                    </div>
                                                </td>
                                            </tr>
                                        `;
                                    }).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `;
            }

            const movementSection = document.createElement('div');
            movementSection.className = 'card overflow-hidden border border-gray-200';
            if (!data.inventoryMovements || data.inventoryMovements.length === 0) {
                movementSection.innerHTML = '<div class="p-5 text-center text-sm text-gray-500">尚未產生庫存轉入異動。</div>';
            } else {
                const recentMoves = data.inventoryMovements.slice().sort((a,b)=> new Date(b.createdAt) - new Date(a.createdAt));
                const matchingMoves = recentMoves.filter(move => {
                    if (!keyword) return true;
                    return [move.id, move.orderId, move.orderNo, move.productId, move.productName, move.spec, move.sourceKitName, move.note]
                        .some(field => field && String(field).toLocaleLowerCase().includes(keyword));
                });
                movementSection.innerHTML = `
                    <div class="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                        <div class="font-bold text-slate-800">庫存轉入與異動記錄 <span class="ml-1 text-xs font-normal text-slate-500">最新 20 筆</span></div>
                        <span class="text-xs text-slate-500">符合 ${matchingMoves.length} / ${data.inventoryMovements.length} 筆</span>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="movement-table min-w-full text-left text-sm text-gray-700">
                            <thead>
                                <tr class="bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
                                    <th class="px-3 py-2">異動時間</th>
                                    <th class="px-3 py-2">來源訂單</th>
                                    <th class="px-3 py-2">產品 / 組合來源</th>
                                    <th class="px-3 py-2 text-right">數量</th>
                                    <th class="px-3 py-2 text-right">單價</th>
                                    <th class="px-3 py-2 text-right">金額</th>
                                    <th class="px-3 py-2">異動類型 / 發票</th>
                                    <th class="px-3 py-2">備註</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-100">
                                ${matchingMoves.length ? matchingMoves.slice(0, 20).map(move => `
                                    <tr class="hover:bg-slate-50">
                                        <td class="whitespace-nowrap px-3 py-2 text-xs">${move.createdAt ? new Date(move.createdAt).toLocaleString('zh-TW', { hour12: false }) : ''}</td>
                                        <td class="whitespace-nowrap px-3 py-2">${move.orderId || '手動入庫'}</td>
                                        <td class="px-3 py-2">
                                            <div class="font-semibold">${move.productName || move.productId} ${move.spec || ''}</div>
                                            ${move.sourceKitName ? `<div class="text-xs text-orange-700">組合包來源：${move.sourceKitName} × ${move.sourceKitQuantity}</div>` : ''}
                                        </td>
                                        <td class="whitespace-nowrap px-3 py-2 text-right font-semibold">${Number(move.quantity || 0).toLocaleString()}</td>
                                        <td class="whitespace-nowrap px-3 py-2 text-right">$${Number(move.unitCost || 0).toLocaleString()}</td>
                                        <td class="whitespace-nowrap px-3 py-2 text-right font-bold">$${Math.round(Number(move.totalCost || 0)).toLocaleString()}</td>
                                        <td class="whitespace-nowrap px-3 py-2">
                                            ${getInventoryMovementLabel(move.type)}
                                            <div class="text-xs text-slate-500">${move.invoiceType || (move.type === 'outbound' ? '無發票' : '')}</div>
                                        </td>
                                        <td class="px-3 py-2 text-xs text-slate-600">${move.note || ''}</td>
                                    </tr>
                                `).join('') : '<tr><td colspan="8" class="px-3 py-6 text-center text-sm text-slate-500">沒有符合的異動記錄。</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                `;
            }
            container.appendChild(movementSection);
        }

        function updateManualInventoryProductOptions() {
            const select = document.getElementById('manualInventoryProduct');
            if (!select) return;
            const selectedId = select.value;
            const stockProducts = data.products.filter(product => !isKitProduct(product) && product.productType !== 'sales-bundle');
            select.innerHTML = '<option value="">請選擇單品</option>' + stockProducts.map(product => {
                const supplierName = data.suppliers.find(supplier => supplier.id === product.supplierId)?.name || '未知供應商';
                return `<option value="${product.id}">${product.prodName}｜${product.spec || '無規格'}｜${supplierName}</option>`;
            }).join('');
            select.value = stockProducts.some(product => product.id === selectedId) ? selectedId : '';
        }

        function syncManualInventoryProduct() {
            const productId = document.getElementById('manualInventoryProduct')?.value;
            const product = data.products.find(item => item.id === productId);
            const costInput = document.getElementById('manualInventoryCost');
            if (product && costInput && !costInput.value) {
                const cost = getProductPurchasePriceNtd(product);
                if (Number.isFinite(cost)) costInput.value = cost;
                else showToast('此人民幣產品尚未設定有效匯率，請先修改產品資料。', 'bg-red-500');
            }
        }

        function addManualInventory(event) {
            event.preventDefault();
            const form = event.target;
            const formData = new FormData(form);
            const product = data.products.find(item => item.id === formData.get('productId'));
            const quantity = parseInt(formData.get('quantity'), 10);
            const unitCost = parseFloat(formData.get('unitCost'));
            const warehouse = (formData.get('warehouse') || '總倉').trim() || '總倉';
            const receivedDate = formData.get('receivedDate') || new Date().toISOString().split('T')[0];
            if (!product || isKitProduct(product) || product.productType === 'sales-bundle') {
                return showToast('請選擇一般單品入庫；採購組合包由採購收貨轉入，促銷組合請使用組裝入庫。', 'bg-red-500');
            }
            if (!Number.isInteger(quantity) || quantity <= 0) return showToast('入庫數量必須大於 0', 'bg-red-500');
            if (!Number.isFinite(unitCost) || unitCost < 0) return showToast('請輸入有效的成本單價', 'bg-red-500');

            const supplier = data.suppliers.find(item => item.id === product.supplierId);
            const spec = product.spec || '';
            let inventoryItem = data.inventory.find(item => item.productId === product.id && item.spec === spec && item.supplierId === product.supplierId && item.warehouse === warehouse);
            if (inventoryItem) {
                const oldQuantity = inventoryItem.quantity || 0;
                const oldAverageCost = inventoryItem.averageCost || 0;
                inventoryItem.quantity = oldQuantity + quantity;
                inventoryItem.availableQuantity = (inventoryItem.availableQuantity || 0) + quantity;
                inventoryItem.lastCost = unitCost;
                inventoryItem.averageCost = (oldAverageCost * oldQuantity + unitCost * quantity) / inventoryItem.quantity;
                inventoryItem.totalCost = inventoryItem.quantity * inventoryItem.averageCost;
                inventoryItem.reorderPoint = Number(product.reorderPoint) || 0;
                inventoryItem.status = getInventoryStatus(inventoryItem);
                inventoryItem.lastUpdated = new Date().toISOString();
            } else {
                inventoryItem = {
                    id: generateInventoryId(), productId: product.id, sku: product.sku || '',
                    productName: product.prodName, spec, supplierId: product.supplierId || '',
                    supplierName: supplier?.name || '未知供應商', warehouse, unit: product.unit || 'pcs',
                    quantity, availableQuantity: quantity, averageCost: unitCost, lastCost: unitCost,
                    totalCost: quantity * unitCost, reorderPoint: Number(product.reorderPoint) || 0,
                    status: getInventoryStatus({ quantity, availableQuantity: quantity, productId: product.id, reorderPoint: product.reorderPoint }),
                    lastUpdated: new Date().toISOString(), relatedOrders: []
                };
                data.inventory.push(inventoryItem);
            }

            createInventoryBatch({
                inventoryId: inventoryItem.id, orderId: '', productId: product.id, productName: product.prodName,
                spec, supplierId: product.supplierId || '', supplierName: supplier?.name || '未知供應商',
                quantity, unitCost, sourceDate: receivedDate, arrivalDate: receivedDate, warehouse
            });
            data.inventoryMovements.push({
                id: generateBatchId('mov'), type: 'manual-inbound', orderId: '', orderNo: '', productId: product.id,
                productName: product.prodName, spec, supplierId: product.supplierId || '',
                supplierName: supplier?.name || '未知供應商', warehouse, batchNo: '', quantity, unitCost,
                totalCost: unitCost * quantity, sourceDate: receivedDate, arrivalDate: receivedDate,
                invoiceType: formData.get('invoiceType') || '無發票', note: formData.get('note') || '手動新增庫存',
                createdAt: new Date().toISOString()
            });
            saveData();
            form.reset();
            form.warehouse.value = '總倉';
            document.getElementById('manualInventoryDate').value = new Date().toISOString().split('T')[0];
            renderInventory();
            showToast('庫存已成功新增', 'bg-green-600');
        }

        function isOrderInventoryTransferable(order) {
            return order && !order.inventoryTransferred && (order.status === 'arrived' || order.status === 'completed' || order.status === 'closed');
        }

        function transferOrderToInventory(orderId, receiptContext = null) {
            const order = data.orders.find(o => o.id === orderId);
            if (!order) return showToast('找不到指定訂單', 'bg-red-500');
            if (!receiptContext) {
                const lines = (order.items || []).map((item, itemIndex) => ({
                    itemIndex,
                    receivedQuantity: getOrderLineRemainingQuantity(item),
                    rejectedQuantity: 0
                }));
                return receiveOrderItems(orderId, lines, {
                    receiptDate: getFinanceToday(),
                    warehouse: getConfiguredWarehouses()[0],
                    note: '由訂單頁轉入庫存'
                });
            }
            if (['cancelled', 'completed'].includes(order.status)) {
                return showToast('此訂單尚未完成或已轉入庫存，無法轉入。', 'bg-red-500');
            }

            // v11.9 新增：驗證訂單有項目
            if (!Array.isArray(order.items) || order.items.length === 0) {
                return showToast('訂單無明細項目，無法轉入庫存', 'bg-red-500');
            }

            const inboundRows = [];
            try {
                order.items.forEach((item, itemIndex) => {
                    const acceptedQuantity = Number(receiptContext.quantities[itemIndex]) || 0;
                    if (acceptedQuantity === 0) return;
                    const product = data.products.find(p => p.id === item.productId);
                    const packageQuantity = acceptedQuantity;
                    const packageCost = Number(item.customPrice);
                    const orderedQuantity = Number(item.quantity) || 0;
                    const shipping = orderedQuantity > 0 ? Number(item.customShipping || 0) * acceptedQuantity / orderedQuantity : 0;
                    if (!product) throw new Error(`訂單產品 ${item.productId} 已不存在，無法轉入庫存。`);
                    if (!Number.isInteger(packageQuantity) || packageQuantity <= 0) throw new Error(`產品「${product.prodName}」的採購數量無效。`);
                    if (!Number.isFinite(packageCost) || packageCost < 0 || !Number.isFinite(shipping) || shipping < 0) throw new Error(`產品「${product.prodName}」的採購成本或運費無效。`);

                    if (isKitProduct(product)) {
                        const kitSnapshot = item.kitSnapshot || createKitSnapshot(product);
                        const components = kitSnapshot?.components;
                        if (!Array.isArray(components) || components.length === 0) throw new Error(`組合包「${product.prodName}」沒有有效的 BOM，請先設定組合內容。`);
                        const normalized = components.map(component => ({
                            ...component,
                            quantity: Number(component.quantity),
                            allocationWeight: Number(component.allocationWeight)
                        }));
                        if (normalized.some(component => !component.productId || !Number.isInteger(component.quantity) || component.quantity <= 0 || !Number.isFinite(component.allocationWeight) || component.allocationWeight <= 0)) {
                            throw new Error(`組合包「${product.prodName}」的 BOM 數量或分攤權重無效。`);
                        }
                        const totalWeight = normalized.reduce((sum, component) => sum + component.quantity * component.allocationWeight, 0);
                        const unitKitCost = packageCost + shipping / packageQuantity;
                        let remainingTotalCost = unitKitCost * packageQuantity;

                        normalized.forEach((component, index) => {
                            const componentProduct = data.products.find(candidate => candidate.id === component.productId);
                            const componentQuantity = component.quantity * packageQuantity;
                            const allocatedTotalCost = index === normalized.length - 1
                                ? remainingTotalCost
                                : unitKitCost * packageQuantity * (component.quantity * component.allocationWeight / totalWeight);
                            remainingTotalCost -= allocatedTotalCost;
                            inboundRows.push({
                                productId: component.productId,
                                productName: component.productName || componentProduct?.prodName || '未知產品',
                                spec: component.spec || componentProduct?.spec || '',
                                supplierId: component.supplierId || componentProduct?.supplierId || '',
                                supplierName: component.supplierName || data.suppliers.find(supplier => supplier.id === (component.supplierId || componentProduct?.supplierId))?.name || '未知供應商',
                                unit: component.unit || componentProduct?.unit || 'pcs',
                                quantity: componentQuantity,
                                unitCost: allocatedTotalCost / componentQuantity,
                                totalCost: allocatedTotalCost,
                                sourceKitProductId: product.id,
                                sourceKitName: kitSnapshot.productName || product.prodName,
                                sourceKitQuantity: packageQuantity,
                                componentQuantityPerKit: component.quantity,
                                allocationWeight: component.allocationWeight,
                                purchaseUnitCost: packageCost,
                                purchaseShippingPerKit: shipping / packageQuantity,
                                purchaseShippingPerUnit: 0
                            });
                        });
                    } else {
                        const shippingPerUnit = shipping / packageQuantity;
                        const landedUnitCost = packageCost + shippingPerUnit;
                        const landedTotalCost = packageCost * packageQuantity + shipping;
                        inboundRows.push({
                            productId: item.productId,
                            productName: item.productName || product.prodName || '未知產品',
                            sku: item.sku || product.sku || '',
                            spec: product.spec || item.spec || '',
                            supplierId: item.supplierId || product.supplierId || order.supplierId || '',
                            supplierName: item.supplierName || order.supplierName || data.suppliers.find(supplier => supplier.id === (item.supplierId || product.supplierId || ''))?.name || '未知供應商',
                            unit: item.unit || product.unit || 'pcs',
                            quantity: packageQuantity,
                            unitCost: landedUnitCost,
                            totalCost: landedTotalCost,
                            sourceKitProductId: '',
                            sourceKitName: '',
                            sourceKitQuantity: 0,
                            componentQuantityPerKit: 0,
                            allocationWeight: 0,
                            purchaseUnitCost: packageCost,
                            purchaseShippingPerKit: 0,
                            purchaseShippingPerUnit: shippingPerUnit
                        });
                    }
                });
            } catch (error) {
                return showToast(error.message || '訂單入庫資料驗證失敗。', 'bg-red-500');
            }

            if (!inboundRows.length && !receiptContext) return showToast('訂單沒有有效的入庫明細。', 'bg-red-500');
            if (!receiptContext && !confirm(`確定要將訂單 ${order.id} 的庫存資料轉入庫存嗎？\n組合包會依訂單建立時的 BOM 拆成單品。`)) return;

            const warehouse = receiptContext?.warehouse || '總倉';
            inboundRows.forEach(row => {
                const {productId, productName, spec, supplierId, supplierName, quantity, unitCost, totalCost} = row;
                let inventoryItem = data.inventory.find(inv => inv.productId === productId && inv.spec === spec && inv.supplierId === supplierId && (inv.warehouse || '總倉') === warehouse);
                if (inventoryItem) {
                    const existingQty = inventoryItem.quantity || 0;
                    const combinedCost = (inventoryItem.averageCost || 0) * existingQty + totalCost;
                    inventoryItem.warehouse = warehouse;
                    inventoryItem.quantity = existingQty + quantity;
                    inventoryItem.availableQuantity = (inventoryItem.availableQuantity || 0) + quantity;
                    inventoryItem.lastCost = unitCost;
                    inventoryItem.averageCost = inventoryItem.quantity > 0 ? combinedCost / inventoryItem.quantity : unitCost;
                    inventoryItem.totalCost = inventoryItem.quantity * inventoryItem.averageCost;
                    inventoryItem.status = inventoryItem.quantity > 0 ? '正常' : '缺貨';
                    inventoryItem.reorderPoint = Number(data.products.find(product => product.id === productId)?.reorderPoint) || 0;
                    inventoryItem.status = getInventoryStatus(inventoryItem);
                    inventoryItem.lastUpdated = new Date().toISOString();
                    inventoryItem.relatedOrders = Array.from(new Set([...(inventoryItem.relatedOrders || []), order.id]));
                } else {
                    const newInventoryId = generateInventoryId();
                    inventoryItem = {
                        id: newInventoryId,
                        productId,
                        sku: row.sku || data.products.find(product => product.id === productId)?.sku || '',
                        productName,
                        spec,
                        supplierId,
                        supplierName,
                        warehouse,
                        unit: row.unit,
                        quantity,
                        availableQuantity: quantity,
                        averageCost: unitCost,
                        lastCost: unitCost,
                        totalCost: quantity * unitCost,
                        reorderPoint: Number(data.products.find(product => product.id === productId)?.reorderPoint) || 0,
                        status: getInventoryStatus({ quantity, availableQuantity: quantity, productId, reorderPoint: data.products.find(product => product.id === productId)?.reorderPoint }),
                        lastUpdated: new Date().toISOString(),
                        relatedOrders: [order.id]
                    };
                    data.inventory.push(inventoryItem);
                }

                    const batch = createInventoryBatch({
                    inventoryId: inventoryItem.id,
                    orderId: order.id,
                    productId,
                    productName: inventoryItem.productName,
                    spec,
                    supplierId,
                    supplierName,
                    quantity,
                    unitCost,
                    sourceDate: order.date || '',
                    arrivalDate: receiptContext?.receiptDate || order.arrivalDate || '',
                    warehouse: inventoryItem.warehouse,
                    sourceKitProductId: row.sourceKitProductId,
                    sourceKitName: row.sourceKitName,
                    sourceKitQuantity: row.sourceKitQuantity,
                    componentQuantityPerKit: row.componentQuantityPerKit,
                    allocationWeight: row.allocationWeight,
                    purchaseUnitCost: row.purchaseUnitCost,
                    purchaseShippingPerKit: row.purchaseShippingPerKit,
                    purchaseShippingPerUnit: row.purchaseShippingPerUnit
                });
                batch.receiptId = receiptContext?.receiptId || '';

                data.inventoryMovements.push({
                    id: generateBatchId('mov'),
                    receiptId: receiptContext?.receiptId || '',
                    inventoryId: inventoryItem.id,
                    type: row.sourceKitProductId ? 'kit-inbound' : 'order-inbound',
                    orderId: order.id,
                    orderNo: order.id,
                    productId,
                    productName,
                    spec,
                    supplierId,
                    supplierName,
                    warehouse,
                    batchNo: order.id,
                    quantity,
                    unitCost,
                    totalCost,
                    sourceKitProductId: row.sourceKitProductId,
                    sourceKitName: row.sourceKitName,
                    sourceKitQuantity: row.sourceKitQuantity,
                    componentQuantityPerKit: row.componentQuantityPerKit,
                    allocationWeight: row.allocationWeight,
                    purchaseUnitCost: row.purchaseUnitCost,
                    purchaseShippingPerKit: row.purchaseShippingPerKit,
                    purchaseShippingPerUnit: row.purchaseShippingPerUnit,
                    sourceDate: order.date || '',
                    arrivalDate: receiptContext?.receiptDate || order.arrivalDate || '',
                    note: row.sourceKitProductId
                        ? `組合包「${row.sourceKitName}」${row.sourceKitQuantity} 組拆套入庫；原採購單價 $${row.purchaseUnitCost}`
                        : `由歷史訂單轉入庫存；採購單價 $${row.purchaseUnitCost}，分攤運費 $${row.purchaseShippingPerUnit}/件`,
                    createdAt: new Date().toISOString()
                });
            });

            if (!receiptContext) {
                order.inventoryTransferred = true;
                order.inventoryTransferAt = new Date().toISOString();
            }
            if (receiptContext) return true;
            saveData();
            renderOrders();
            renderInventory();
            showToast('訂單已成功轉入庫存', 'bg-green-600');
            return true;
        }

        function undoTransferOrderToInventory(orderId) {
            const order = data.orders.find(o => o.id === orderId);
            if (!order) return showToast('找不到指定訂單', 'bg-red-500');
            if ((data.goodsReceipts || []).some(receipt => receipt.orderId === orderId)) {
                return showToast('請在「收貨驗收」逐筆撤銷收貨；撤銷收貨會同步扣回庫存，不需再執行整單撤銷。', 'bg-amber-600');
            }
            if (!order.inventoryTransferred) return showToast('此訂單尚未轉入庫存', 'bg-red-500');
            if (!confirm(`確定要撤銷訂單 ${order.id} 的整張轉入庫存操作嗎？`)) return;

            const inboundMoves = data.inventoryMovements.filter(move => ['order-inbound', 'kit-inbound'].includes(move.type) && move.orderId === orderId);
            const hasOutboundSinceTransfer = inboundMoves.some(move =>
                data.inventoryMovements.some(outbound => {
                    const inventoryItem = data.inventory.find(inv => inv.productId === move.productId && inv.spec === move.spec && inv.supplierId === move.supplierId && (inv.warehouse || '總倉') === (move.warehouse || '總倉'));
                    const receivedAt = new Date(move.createdAt || order.inventoryTransferAt || 0).getTime();
                    return inventoryItem &&
                        outbound.type === 'outbound' &&
                        outbound.inventoryId === inventoryItem.id &&
                        new Date(outbound.createdAt || 0).getTime() >= receivedAt;
                })
            );
            if (hasOutboundSinceTransfer) {
                return showToast('此訂單入庫的商品已有出貨記錄，請先更正出貨，再撤銷轉入。', 'bg-red-500');
            }
            const moveTotalsByInventory = new Map();
            inboundMoves.forEach(move => {
                const inventoryItem = data.inventory.find(inv => inv.productId === move.productId && inv.spec === move.spec && inv.supplierId === move.supplierId && (inv.warehouse || '總倉') === (move.warehouse || '總倉'));
                if (inventoryItem) moveTotalsByInventory.set(inventoryItem.id, (moveTotalsByInventory.get(inventoryItem.id) || 0) + Number(move.quantity || 0));
            });
            for (const [inventoryId, quantity] of moveTotalsByInventory) {
                const inventoryItem = data.inventory.find(inv => inv.id === inventoryId);
                if ((inventoryItem?.availableQuantity || 0) < quantity) {
                    return showToast('此訂單入庫的商品已有部分出貨或占用，無法撤銷轉入。', 'bg-red-500');
                }
            }
            inboundMoves.forEach(move => {
                const inventoryItem = data.inventory.find(inv => 
                    inv.productId === move.productId &&
                    inv.spec === move.spec &&
                    inv.supplierId === move.supplierId &&
                    (inv.warehouse || '總倉') === (move.warehouse || '總倉')
                );
                if (!inventoryItem) return;

                const oldQuantity = inventoryItem.quantity || 0;
                const oldTotalCost = Number.isFinite(Number(inventoryItem.totalCost))
                    ? Number(inventoryItem.totalCost)
                    : oldQuantity * (inventoryItem.averageCost || 0);
                inventoryItem.quantity = oldQuantity - (move.quantity || 0);
                inventoryItem.availableQuantity = (inventoryItem.availableQuantity || 0) - (move.quantity || 0);
                inventoryItem.totalCost = Math.max(0, oldTotalCost - Number(move.totalCost ?? (move.unitCost || 0) * (move.quantity || 0)));
                if (inventoryItem.quantity <= 0) {
                    inventoryItem.quantity = 0;
                    inventoryItem.availableQuantity = 0;
                    inventoryItem.totalCost = 0;
                }
                inventoryItem.averageCost = inventoryItem.quantity > 0 ? inventoryItem.totalCost / inventoryItem.quantity : 0;
                inventoryItem.status = inventoryItem.quantity > 0 ? '正常' : '缺貨';
                inventoryItem.lastUpdated = new Date().toISOString();
                inventoryItem.relatedOrders = (inventoryItem.relatedOrders || []).filter(id => id !== orderId);
            });

            // 移除剩餘數量為 0 的庫存項目
            data.inventory = data.inventory.filter(inv => inv.quantity > 0);

            // 移除該訂單的轉入批次與異動記錄
            data.inventoryBatches = data.inventoryBatches.filter(batch => batch.orderId !== orderId);
            data.inventoryMovements = data.inventoryMovements.filter(move => !(['order-inbound', 'kit-inbound'].includes(move.type) && move.orderId === orderId));

            order.inventoryTransferred = false;
            order.inventoryTransferAt = '';

            saveData();
            renderOrders();
            renderInventory();
            showToast('已撤銷轉入，此訂單可重新轉入庫存', 'bg-green-600');
        }

        function undoGoodsReceipt(receiptId) {
            const receipt = (data.goodsReceipts || []).find(item => item.id === receiptId);
            if (!receipt) return showToast('找不到收貨單。', 'bg-red-500');
            const order = (data.orders || []).find(item => item.id === receipt.orderId);
            if (!order) return showToast('找不到收貨單的來源採購單，為避免庫存與收貨數量不一致，無法撤銷。', 'bg-red-500');
            if ((data.accountsPayable || []).some(document => document.sourceOrderId === receipt.orderId && document.status !== 'void')) {
                return showToast('來源採購單已建立應付，請先處理應付單後再撤銷收貨。', 'bg-red-500');
            }
            if (!Array.isArray(receipt.items) || receipt.items.some(line =>
                !Number.isInteger(line.itemIndex) ||
                !order.items[line.itemIndex] ||
                !Number.isInteger(Number(line.receivedQuantity)) ||
                !Number.isInteger(Number(line.acceptedQuantity)) ||
                !Number.isInteger(Number(line.rejectedQuantity)) ||
                Number(line.receivedQuantity) < 0 ||
                Number(line.acceptedQuantity) < 0 ||
                Number(line.rejectedQuantity) < 0 ||
                Number(line.acceptedQuantity) + Number(line.rejectedQuantity) !== Number(line.receivedQuantity)
            )) {
                return showToast('收貨明細資料不完整或與訂單不符，為避免數量錯誤，無法撤銷。', 'bg-red-500');
            }
            const moves = (data.inventoryMovements || []).filter(move => move.receiptId === receiptId);
            const batches = (data.inventoryBatches || []).filter(batch => batch.receiptId === receiptId);
            const stockEntriesByInventory = new Map();
            moves.forEach(move => {
                if (!Number.isInteger(Number(move.quantity)) || Number(move.quantity) <= 0 || !move.inventoryId) return;
                const entry = stockEntriesByInventory.get(move.inventoryId) || {
                    inventoryId: move.inventoryId,
                    quantity: 0,
                    totalCost: 0,
                    createdAt: move.createdAt || receipt.createdAt || ''
                };
                entry.quantity += Number(move.quantity);
                entry.totalCost += Number(move.totalCost ?? (Number(move.unitCost || 0) * Number(move.quantity)));
                stockEntriesByInventory.set(move.inventoryId, entry);
            });
            batches.forEach(batch => {
                if (!Number.isInteger(Number(batch.quantity)) || Number(batch.quantity) <= 0 || !batch.inventoryId ||
                    stockEntriesByInventory.has(batch.inventoryId)) return;
                stockEntriesByInventory.set(batch.inventoryId, {
                    inventoryId: batch.inventoryId,
                    quantity: Number(batch.quantity),
                    totalCost: Number(batch.cost || 0) * Number(batch.quantity),
                    createdAt: batch.createdAt || receipt.createdAt || ''
                });
            });
            if (moves.some(move => !Number.isInteger(Number(move.quantity)) || Number(move.quantity) <= 0 || !move.inventoryId)) {
                return showToast('收貨入庫異動資料格式錯誤，為避免庫存錯誤，無法撤銷。', 'bg-red-500');
            }
            const stockEntries = Array.from(stockEntriesByInventory.values());
            const hasMissingStockLink = receipt.items.some(line => Number(line.acceptedQuantity) > 0) &&
                (stockEntries.length === 0 || stockEntries.some(entry =>
                    !data.inventory.some(item => item.id === entry.inventoryId) ||
                    !moves.some(move => move.inventoryId === entry.inventoryId) ||
                    !batches.some(batch => batch.inventoryId === entry.inventoryId)
                ));
            const hasOutbound = stockEntries.some(entry => (data.inventoryMovements || []).some(outbound =>
                outbound.type === 'outbound' &&
                outbound.inventoryId === entry.inventoryId &&
                (!Number.isFinite(Date.parse(outbound.createdAt || '')) ||
                    !Number.isFinite(Date.parse(entry.createdAt)) ||
                    Date.parse(outbound.createdAt) >= Date.parse(entry.createdAt))
            ));
            if (hasOutbound) return showToast('此收貨入庫批次已有出貨，不能撤銷。', 'bg-red-500');
            if (hasMissingStockLink && !confirm(`收貨單 ${receiptId} 的部分庫存、入庫異動或批次已不存在，可能曾被手動刪除。\n\n繼續將只扣回仍存在且可核對的庫存，移除這筆收貨紀錄並還原訂單收貨數量；已刪除的庫存不會再次扣除。請確認這些入庫庫存已刪除且未出貨，再繼續修復。`)) return;
            if (!confirm(`確定撤銷收貨單 ${receiptId}？此操作會刪除收貨紀錄、扣回仍存在的該筆入庫庫存與批次，並還原訂單收貨數量。完成後可重新收貨，不需再使用訂單頁的「撤銷轉入」。`)) return;

            for (const entry of stockEntries) {
                const inventoryItem = data.inventory.find(item => item.id === entry.inventoryId);
                if (!inventoryItem) continue;
                if (Number(inventoryItem.quantity || 0) < entry.quantity ||
                    Number(inventoryItem.availableQuantity || 0) < entry.quantity) {
                    return showToast('收貨庫存已被出貨或調整占用，無法安全撤銷。', 'bg-red-500');
                }
            }

            const previousInventory = JSON.parse(JSON.stringify(data.inventory || []));
            const previousBatches = JSON.parse(JSON.stringify(data.inventoryBatches || []));
            const previousMovements = JSON.parse(JSON.stringify(data.inventoryMovements || []));
            const previousReceipts = JSON.parse(JSON.stringify(data.goodsReceipts || []));
            const previousItems = JSON.parse(JSON.stringify(order?.items || []));
            const previousStatus = order?.status;
            const previousArrivalDate = order?.arrivalDate;
            const previousTransferred = order?.inventoryTransferred;
            const previousTransferAt = order?.inventoryTransferAt;

            try {
                stockEntries.forEach(entry => {
                    const inventoryItem = data.inventory.find(item => item.id === entry.inventoryId);
                    if (!inventoryItem) return;
                    const oldQuantity = Number(inventoryItem.quantity || 0);
                    const oldTotalCost = Number(inventoryItem.totalCost || 0);
                    inventoryItem.quantity = Math.max(0, oldQuantity - entry.quantity);
                    inventoryItem.availableQuantity = Math.max(0, Number(inventoryItem.availableQuantity || 0) - entry.quantity);
                    inventoryItem.totalCost = Math.max(0, oldTotalCost - entry.totalCost);
                    inventoryItem.averageCost = inventoryItem.quantity > 0 ? inventoryItem.totalCost / inventoryItem.quantity : 0;
                    inventoryItem.lastUpdated = new Date().toISOString();
                    inventoryItem.status = getInventoryStatus(inventoryItem);
                    if (!inventoryItem.quantity) inventoryItem.relatedOrders = (inventoryItem.relatedOrders || []).filter(id => id !== receipt.orderId);
                });
                data.inventory = data.inventory.filter(item => item.quantity > 0);
                data.inventoryBatches = (data.inventoryBatches || []).filter(batch => batch.receiptId !== receiptId);
                data.inventoryMovements = (data.inventoryMovements || []).filter(move => move.receiptId !== receiptId);
                data.goodsReceipts = (data.goodsReceipts || []).filter(item => item.id !== receiptId);
                stockEntries.forEach(entry => {
                    const inventoryItem = data.inventory.find(item => item.id === entry.inventoryId);
                    if (!inventoryItem) return;
                    const hasOrderStock = (data.inventoryBatches || []).some(batch =>
                        batch.inventoryId === entry.inventoryId && batch.orderId === receipt.orderId
                    ) || (data.inventoryMovements || []).some(move =>
                        move.inventoryId === entry.inventoryId &&
                        move.orderId === receipt.orderId &&
                        ['order-inbound', 'kit-inbound'].includes(move.type)
                    );
                    if (!hasOrderStock) {
                        inventoryItem.relatedOrders = (inventoryItem.relatedOrders || []).filter(id => id !== receipt.orderId);
                    }
                });
                receipt.items.forEach(line => {
                    const item = order.items[line.itemIndex];
                    if (!item) return;
                    item.receivedQuantity = Math.max(0, Number(item.receivedQuantity || 0) - Number(line.receivedQuantity || 0));
                    item.rejectedQuantity = Math.max(0, Number(item.rejectedQuantity || 0) - Number(line.rejectedQuantity || 0));
                    item.acceptedQuantity = Math.max(0, Number(item.acceptedQuantity || 0) - Number(line.acceptedQuantity || 0));
                });
                updateOrderAfterReceiptChange(order);
                if (!saveData()) throw new Error('撤銷未能儲存，原資料已復原。');
            } catch (error) {
                data.inventory = previousInventory;
                data.inventoryBatches = previousBatches;
                data.inventoryMovements = previousMovements;
                data.goodsReceipts = previousReceipts;
                order.items = previousItems;
                order.status = previousStatus;
                order.arrivalDate = previousArrivalDate;
                order.inventoryTransferred = previousTransferred;
                order.inventoryTransferAt = previousTransferAt;
                return showToast(error.message || '撤銷未能儲存，原資料已復原。', 'bg-red-500');
            }
            renderReceiving();
            renderOrders();
            renderInventory();
            renderFinance();
            showToast(`收貨單 ${receiptId} 已撤銷，庫存與訂單收貨數量已回復；可在此重新收貨。`, 'bg-green-600');
        }

        function getRocYearMonth(date = new Date()) {
            const year = date.getFullYear() - 1911;
            const month = String(date.getMonth() + 1).padStart(2, '0');
            return `${year}${month}`;
        }

        function generateInventoryId() {
            const prefix = `inv_${getRocYearMonth()}`;
            const sameMonthIds = data.inventory
                .filter(item => item.id && item.id.startsWith(prefix))
                .map(item => parseInt(item.id.slice(prefix.length), 10))
                .filter(num => !isNaN(num));
            const nextSeq = String(Math.max(0, ...sameMonthIds) + 1).padStart(2, '0');
            return `${prefix}${nextSeq}`;
        }

        function generateBatchId(prefix = 'batch') {
            const head = `${prefix}_${getRocYearMonth()}`;
            const sameMonthIds = (prefix === 'mov' ? data.inventoryMovements : data.inventoryBatches)
                .filter(item => item.id && item.id.startsWith(head))
                .map(item => parseInt(item.id.slice(head.length), 10))
                .filter(num => !isNaN(num));
            const nextSeq = String(Math.max(0, ...sameMonthIds) + 1).padStart(2, '0');
            return `${head}${nextSeq}`;
        }

        function createInventoryBatch({inventoryId, orderId, productId, productName, spec, supplierId, supplierName, quantity, unitCost, sourceDate, arrivalDate, warehouse, sourceKitProductId = '', sourceKitName = '', sourceKitQuantity = 0, componentQuantityPerKit = 0, allocationWeight = 0, purchaseUnitCost = 0, purchaseShippingPerKit = 0, purchaseShippingPerUnit = 0}) {
            const batch = {
                id: generateBatchId('batch'),
                inventoryId,
                batchNo: orderId || '',
                receivedDate: sourceDate || new Date().toISOString().split('T')[0],
                sourceDate: sourceDate || '',
                arrivalDate: arrivalDate || '',
                expiryDate: '',
                quantity,
                availableQuantity: quantity,
                cost: unitCost,
                orderId,
                productId,
                productName,
                spec,
                supplierId,
                supplierName,
                warehouse: warehouse || '總倉',
                sourceKitProductId,
                sourceKitName,
                sourceKitQuantity,
                componentQuantityPerKit,
                allocationWeight,
                purchaseUnitCost,
                purchaseShippingPerKit,
                purchaseShippingPerUnit,
                createdAt: new Date().toISOString()
            };
            data.inventoryBatches.push(batch);
            return batch;
        }

        function openInventoryBatches(inventoryId) {
            const item = data.inventory.find(inv => inv.id === inventoryId);
            if (!item) return showToast('找不到庫存項目', 'bg-red-500');
            const content = document.getElementById('inventoryBatchModalContent');
            const batches = data.inventoryBatches.filter(batch => batch.inventoryId === inventoryId);
            let html = `<div class="text-sm text-gray-600 mb-4">${item.productName} (${item.id})</div>`;
            if (batches.length === 0) {
                html += '<div class="text-center text-gray-500 py-6">此庫存尚未建立批次資料。</div>';
            } else {
                html += `
                    <div class="overflow-x-auto max-h-64 overflow-y-auto">
                        <table class="min-w-full text-left text-sm text-gray-700">
                            <thead>
                                <tr class="bg-gray-100">
                                    <th class="px-3 py-2">批次編號</th>
                                    <th class="px-3 py-2">來源訂單／組合包</th>
                                    <th class="px-3 py-2">數量</th>
                                    <th class="px-3 py-2">可用數</th>
                                    <th class="px-3 py-2">成本</th>
                                    <th class="px-3 py-2">到貨日</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${batches.map(batch => `
                                    <tr class="border-b border-gray-200">
                                        <td class="px-3 py-2">${batch.id}</td>
                                        <td class="px-3 py-2">${batch.orderId || '-'}${batch.sourceKitName ? `<div class="text-xs text-orange-700">組合包：${batch.sourceKitName} × ${batch.sourceKitQuantity}</div>` : ''}</td>
                                        <td class="px-3 py-2">${batch.quantity}</td>
                                        <td class="px-3 py-2">${batch.availableQuantity}</td>
                                        <td class="px-3 py-2">$${batch.cost.toLocaleString()}</td>
                                        <td class="px-3 py-2">${batch.arrivalDate || '-'}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `;
            }
            content.innerHTML = html;
            document.getElementById('modal-inventory-batches').classList.add('modal-active');
        }

        function getInventoryActionId() {
            const input = document.getElementById('inventoryActionId');
            return input ? input.value.trim() : '';
        }

        function openInventoryBatchesByInput() {
            const inventoryId = getInventoryActionId();
            if (!inventoryId) return showToast('請先輸入庫存編號', 'bg-red-500');
            openInventoryBatches(inventoryId);
        }

        function openInventoryShippingModalByInput() {
            const inventoryId = getInventoryActionId();
            if (!inventoryId) return showToast('請先輸入庫存編號', 'bg-red-500');
            openInventoryShippingModal(inventoryId);
        }

        function openInventoryAdjustModalByInput() {
            const inventoryId = getInventoryActionId();
            if (!inventoryId) return showToast('請先輸入庫存編號', 'bg-red-500');
            openInventoryAdjustModal(inventoryId);
        }

        function openInventorySplitModalByInput() {
            const inventoryId = getInventoryActionId();
            if (!inventoryId) return showToast('請先輸入庫存編號', 'bg-red-500');
            openInventorySplitModal(inventoryId);
        }

        function openDeleteInventoryConfirmModalByInput() {
            const inventoryId = getInventoryActionId();
            if (!inventoryId) return showToast('請先輸入庫存編號', 'bg-red-500');
            openDeleteInventoryConfirmModal(inventoryId);
        }

        function openInventoryAdjustModal(inventoryId) {
            const item = data.inventory.find(inv => inv.id === inventoryId);
            if (!item) return showToast('找不到庫存項目', 'bg-red-500');
            inventoryModalCurrentId = inventoryId;
            const form = document.getElementById('inventoryAdjustForm');
            if (form) form.inventoryId.value = inventoryId;
            document.getElementById('inventoryAdjustLabel').textContent = `${item.productName} (${item.id}) 現有庫存 ${item.quantity}`;
            document.getElementById('inventoryAdjustmentQty').value = '';
            document.getElementById('inventoryAdjustmentNote').value = '';
            document.getElementById('modal-inventory-adjust').classList.add('modal-active');
        }

        function applyInventoryAdjustment(event) {
            event.preventDefault();
            const form = event.target;
            const inventoryId = inventoryModalCurrentId || form.inventoryId.value;
            const delta = parseInt(form.adjustmentDelta.value, 10);
            const note = form.adjustmentNote.value.trim();
            if (!inventoryId) return showToast('缺少庫存編號', 'bg-red-500');
            if (isNaN(delta) || delta === 0) return showToast('請輸入非零調整數量', 'bg-red-500');
            const item = data.inventory.find(inv => inv.id === inventoryId);
            if (!item) return showToast('找不到庫存項目', 'bg-red-500');
            const newQty = item.quantity + delta;
            const newAvailable = item.availableQuantity + delta;
            if (newQty < 0 || newAvailable < 0) return showToast('調整後庫存不可為負數', 'bg-red-500');
            if (delta < 0 && !confirm(`確定要減少「${item.productName}」${Math.abs(delta)} 件庫存嗎？\n調整後庫存：${newQty} 件。`)) return;
            item.quantity = newQty;
            item.availableQuantity = newAvailable;
            item.totalCost = item.quantity * item.averageCost;
            item.status = item.quantity > 0 ? item.status : '缺貨';
            item.lastUpdated = new Date().toISOString();
            data.inventoryMovements.push({
                id: generateBatchId('mov'),
                type: 'adjustment',
                orderId: '',
                orderNo: '',
                productId: item.productId,
                productName: item.productName,
                spec: item.spec,
                supplierId: item.supplierId,
                supplierName: item.supplierName,
                warehouse: item.warehouse,
                batchNo: '',
                quantity: delta,
                unitCost: item.lastCost,
                totalCost: item.lastCost * delta,
                sourceDate: '',
                arrivalDate: '',
                note: note || '盤點調整',
                createdAt: new Date().toISOString()
            });
            saveData();
            closeModal('modal-inventory-adjust');
            renderInventory();
            showToast('庫存調整已完成', 'bg-green-600');
        }

        function openInventorySplitModal(inventoryId) {
            const item = data.inventory.find(inv => inv.id === inventoryId);
            if (!item) return showToast('找不到庫存項目', 'bg-red-500');
            inventoryModalCurrentId = inventoryId;
            const form = document.getElementById('inventorySplitForm');
            if (form) form.inventoryId.value = inventoryId;
            document.getElementById('inventorySplitLabel').textContent = `${item.productName} (${item.id}) 現有庫存 ${item.quantity}`;
            document.getElementById('inventorySplitFromQty').value = '';
            document.getElementById('inventorySplitToQty').value = '';
            document.getElementById('inventorySplitFromQty').max = Number(item.availableQuantity ?? item.quantity) || 0;
            document.getElementById('inventorySplitSpec').value = '';
            document.getElementById('inventorySplitNote').value = '';
            updateInventorySplitProductPreview();
            document.getElementById('modal-inventory-split').classList.add('modal-active');
        }

        function updateInventorySplitProductPreview() {
            const item = data.inventory.find(inv => inv.id === (inventoryModalCurrentId || document.getElementById('inventorySplitForm')?.inventoryId.value));
            const preview = document.getElementById('inventorySplitProductPreview');
            if (!preview) return;
            if (!item) {
                preview.textContent = '請先選擇庫存品項。';
                return;
            }
            const sourceProduct = data.products.find(product => product.id === item.productId);
            const baseProduct = sourceProduct?.packageBaseProductId
                ? data.products.find(product => product.id === sourceProduct.packageBaseProductId)
                : sourceProduct;
            if (!sourceProduct || !baseProduct) {
                preview.textContent = `來源產品編號 ${item.productId} 找不到對應產品主檔。`;
                return;
            }
            if (baseProduct.packageBaseProductId || baseProduct.productType === 'kit') {
                preview.textContent = `來源產品 ${sourceProduct.id} 的基礎產品關聯不可再包裝，請先修正產品資料。`;
                return;
            }
            const fromQty = Number(document.getElementById('inventorySplitFromQty').value);
            const toQty = Number(document.getElementById('inventorySplitToQty').value);
            if (!Number.isSafeInteger(fromQty) || fromQty <= 0 || !Number.isSafeInteger(toQty) || toQty <= 0) {
                preview.textContent = `來源產品 ${sourceProduct.prodName}（${sourceProduct.id}）；請輸入來源數量與產出數量。`;
                return;
            }
            const availableQuantity = Number(item.availableQuantity ?? item.quantity) || 0;
            if (fromQty > availableQuantity) {
                preview.textContent = `來源產品 ${sourceProduct.id} 可用數量為 ${availableQuantity}，不可超量拆分。`;
                return;
            }
            const sourceUnitsPerPackage = sourceProduct.packageBaseProductId
                ? Number(sourceProduct.packageUnitsPerPackage) || 0
                : 1;
            if (!Number.isSafeInteger(sourceUnitsPerPackage) ||
                sourceUnitsPerPackage < (sourceProduct.packageBaseProductId ? 2 : 1)) {
                preview.textContent = `來源產品 ${sourceProduct.id} 的包裝換算資料無效，請先修正產品關聯。`;
                return;
            }
            const totalBaseUnits = fromQty * sourceUnitsPerPackage;
            if (!Number.isSafeInteger(totalBaseUnits) || totalBaseUnits % toQty !== 0) {
                preview.textContent = `來源產品 ${sourceProduct.id} 無法整數換算成 ${toQty} 件；請確認數量。`;
                return;
            }
            const targetUnitsPerPackage = totalBaseUnits / toQty;
            const targetProduct = targetUnitsPerPackage === 1
                ? baseProduct
                : data.products.find(product =>
                    product.packageBaseProductId === baseProduct.id &&
                    Number(product.packageUnitsPerPackage) === targetUnitsPerPackage
                );
            const packageDescription = targetUnitsPerPackage === 1
                ? '單品'
                : `每包 ${targetUnitsPerPackage} ${baseProduct.unit || '件'}`;
            preview.textContent = targetProduct
                ? `來源 ${sourceProduct.id} → 目標 ${targetProduct.id}（${packageDescription}）；將沿用既有產品編號。`
                : `來源 ${sourceProduct.id} → ${generateProductID()}（${packageDescription}）；相同基礎產品與換算數量會沿用此產品編號。`;
        }

        function createOrFindPackageProduct(sourceProduct, targetUnitsPerPackage, packageSpec, salesPrice, purchaseUnitPrice, shippingUnitPrice) {
            if (!Number.isSafeInteger(targetUnitsPerPackage) || targetUnitsPerPackage < 1) {
                throw new Error('包裝換算數量必須為正整數。');
            }
            const baseProductId = sourceProduct.packageBaseProductId || sourceProduct.id;
            const baseProduct = data.products.find(product => product.id === baseProductId);
            if (!baseProduct) throw new Error('找不到包裝產品的基礎產品資料。');
            if (baseProduct.packageBaseProductId) throw new Error('包裝產品的基礎產品不可再是其他包裝變體。');
            if (baseProduct.productType === 'kit') throw new Error('組合包不可再建立包裝變體，請先處理組合包入庫。');
            if (targetUnitsPerPackage === 1) return baseProduct;

            const existingPackage = data.products.find(product =>
                product.packageBaseProductId === baseProduct.id &&
                Number(product.packageUnitsPerPackage) === targetUnitsPerPackage
            );
            if (existingPackage) return existingPackage;

            const productId = generateProductID();
            const skuPrefix = String(baseProduct.sku || baseProduct.id || 'ITEM').slice(0, 40);
            let sku = `${skuPrefix}-PK${targetUnitsPerPackage}`.slice(0, 60);
            let skuSuffix = 2;
            while (data.products.some(product => String(product.sku || '').toLocaleLowerCase() === sku.toLocaleLowerCase())) {
                const suffix = `-${skuSuffix++}`;
                sku = `${`${skuPrefix}-PK${targetUnitsPerPackage}`.slice(0, 60 - suffix.length)}${suffix}`;
            }
            const now = new Date().toISOString();
            const packageProduct = {
                ...baseProduct,
                id: productId,
                sku,
                barcode: '',
                unit: '包',
                spec: packageSpec || `${targetUnitsPerPackage}${baseProduct.unit || '件'}/包`,
                purchasePrice: purchaseUnitPrice,
                price: purchaseUnitPrice,
                shipping: shippingUnitPrice,
                salesPrice,
                salesPriceHistory: [],
                productType: 'standard',
                components: [],
                packageBaseProductId: baseProduct.id,
                packageUnitsPerPackage: targetUnitsPerPackage,
                packageUnitLabel: '包',
                prodNote: [baseProduct.prodNote, `包裝產品；每包 ${targetUnitsPerPackage} ${baseProduct.unit || '件'}；基礎產品編號 ${baseProduct.id}`].filter(Boolean).join('\n'),
                createdAt: now,
                updatedAt: now
            };
            data.products.push(packageProduct);
            return packageProduct;
        }

        function applyInventorySplit(event) {
            event.preventDefault();
            const form = event.target;
            const inventoryId = inventoryModalCurrentId || form.inventoryId.value;
            const fromQty = Number(form.splitFromQty.value);
            const toQty = Number(form.splitToQty.value);
            const newSpec = form.splitNewSpec.value.trim();
            const note = form.splitNote.value.trim() || '拆分包裝';
            if (!inventoryId) return showToast('缺少庫存編號', 'bg-red-500');
            if (!Number.isSafeInteger(fromQty) || fromQty <= 0 || !Number.isSafeInteger(toQty) || toQty <= 0) {
                return showToast('拆分來源與產出數量必須為大於 0 的整數。', 'bg-red-500');
            }
            const item = data.inventory.find(inv => inv.id === inventoryId);
            if (!item) return showToast('找不到庫存項目', 'bg-red-500');
            const currentQuantity = Number(item.quantity) || 0;
            const availableQuantity = Number(item.availableQuantity ?? currentQuantity) || 0;
            if (fromQty > currentQuantity) return showToast('拆分數量不得大於現有庫存', 'bg-red-500');
            if (fromQty > availableQuantity) return showToast('拆分數量不得大於可用庫存，請先處理已占用數量。', 'bg-red-500');
            const sourceProduct = data.products.find(product => product.id === item.productId);
            if (!sourceProduct) return showToast('找不到庫存對應的產品主檔，無法建立包裝產品編號。', 'bg-red-500');
            const baseProduct = sourceProduct.packageBaseProductId
                ? data.products.find(product => product.id === sourceProduct.packageBaseProductId)
                : sourceProduct;
            if (!baseProduct) return showToast('包裝產品找不到基礎產品資料，請先修復產品關聯。', 'bg-red-500');
            if (!confirm(`確定要拆分「${item.productName}」嗎？\n來源扣除 ${fromQty} 件，新增 ${toQty} 件「${newSpec || `${item.spec} 單件`}」。`)) return;

            const averageCostValue = item.averageCost;
            const fallbackAverageCost = averageCostValue === '' || averageCostValue === null || averageCostValue === undefined
                ? 0
                : Number(averageCostValue);
            if (!Number.isFinite(fallbackAverageCost) || fallbackAverageCost < 0) {
                return showToast('庫存平均成本無效，請先修正成本資料後再拆分。', 'bg-red-500');
            }
            const hasTotalCost = item.totalCost !== null && item.totalCost !== undefined && item.totalCost !== '';
            const sourceTotalCost = hasTotalCost && Number.isFinite(Number(item.totalCost))
                ? Number(item.totalCost)
                : currentQuantity * fallbackAverageCost;
            if (hasTotalCost && !Number.isFinite(Number(item.totalCost))) {
                return showToast('庫存總成本無效，請先修正成本資料後再拆分。', 'bg-red-500');
            }
            if (!Number.isFinite(sourceTotalCost) || sourceTotalCost < 0) {
                return showToast('庫存總成本無效，請先修正成本資料後再拆分。', 'bg-red-500');
            }
            const sourceAverageCost = currentQuantity > 0 ? sourceTotalCost / currentQuantity : 0;
            const sourceLastCost = item.lastCost === '' || item.lastCost === null || item.lastCost === undefined
                ? sourceAverageCost
                : Number(item.lastCost);
            if (!Number.isFinite(sourceLastCost) || sourceLastCost < 0) {
                return showToast('庫存最近成本無效，請先修正成本資料後再拆分。', 'bg-red-500');
            }
            const splitLastCost = sourceLastCost * fromQty / toQty;
            const sourceSalesPrice = getInventorySalesPrice(item);
            const splitSalesPrice = sourceSalesPrice === '' ? '' : sourceSalesPrice * fromQty / toQty;
            const sourceUnitsPerPackage = sourceProduct.packageBaseProductId
                ? Number(sourceProduct.packageUnitsPerPackage) || 0
                : 1;
            if (!Number.isSafeInteger(sourceUnitsPerPackage) ||
                sourceUnitsPerPackage < (sourceProduct.packageBaseProductId ? 2 : 1)) {
                return showToast('來源產品的包裝換算資料無效，請先修正產品關聯。', 'bg-red-500');
            }
            const totalBaseUnits = fromQty * sourceUnitsPerPackage;
            if (!Number.isSafeInteger(totalBaseUnits) || totalBaseUnits <= 0 || totalBaseUnits % toQty !== 0) {
                return showToast('拆分數量無法換算成整數包裝，請確認來源包裝比例與產出數量。', 'bg-red-500');
            }
            const targetUnitsPerPackage = totalBaseUnits / toQty;
            const splitTotalCost = sourceAverageCost * fromQty;
            const splitAverageCost = splitTotalCost / toQty;
            const sourceBatches = (data.inventoryBatches || [])
                .filter(batch => batch.inventoryId === item.id)
                .slice()
                .sort((left, right) =>
                    String(left.receivedDate || left.createdAt || '').localeCompare(String(right.receivedDate || right.createdAt || ''))
                );
            let remainingBatchQuantity = fromQty;
            const batchAllocations = [];
            for (const batch of sourceBatches) {
                const batchAvailable = Number(batch.availableQuantity ?? batch.quantity) || 0;
                if (!Number.isSafeInteger(batchAvailable) || batchAvailable < 0) {
                    return showToast('庫存批次可用數量無效，請先核對批次資料後再拆分。', 'bg-red-500');
                }
                const allocated = Math.min(batchAvailable, remainingBatchQuantity);
                if (allocated > 0) batchAllocations.push({ batch, quantity: allocated });
                remainingBatchQuantity -= allocated;
                if (remainingBatchQuantity === 0) break;
            }
            if (sourceBatches.length && remainingBatchQuantity > 0) {
                return showToast('庫存批次可用數量不足，請先核對批次與庫存主檔後再拆分。', 'bg-red-500');
            }
            const previousData = JSON.parse(JSON.stringify(data));
            const restoreData = () => {
                Object.keys(data).forEach(key => delete data[key]);
                Object.assign(data, previousData);
            };
            try {
                const targetProduct = createOrFindPackageProduct(
                    sourceProduct,
                    targetUnitsPerPackage,
                    newSpec,
                    splitSalesPrice,
                    Number(sourceProduct.purchasePrice ?? sourceProduct.price ?? 0) * fromQty / toQty,
                    Number(sourceProduct.shipping || 0) * fromQty / toQty
                );
                if (targetProduct.id === sourceProduct.id) {
                    restoreData();
                    return showToast('來源與目標包裝相同，無需拆分。', 'bg-amber-600');
                }
                const splitSpec = targetProduct.spec || newSpec || `${item.spec} 單件`;
                const configuredSalesPrice = targetProduct.salesPrice !== '' && targetProduct.salesPrice !== null && targetProduct.salesPrice !== undefined
                    ? Number(targetProduct.salesPrice)
                    : splitSalesPrice;
                const splitInventory = data.inventory.find(inv =>
                    inv.id !== item.id &&
                    inv.productId === targetProduct.id &&
                    inv.supplierId === item.supplierId &&
                    (inv.warehouse || '總倉') === (item.warehouse || '總倉')
                );
                item.quantity -= fromQty;
                item.availableQuantity = availableQuantity - fromQty;
                item.totalCost = Math.max(0, sourceTotalCost - splitTotalCost);
                item.averageCost = item.quantity > 0 ? item.totalCost / item.quantity : 0;
                item.status = getInventoryStatus(item);
                item.lastUpdated = new Date().toISOString();
                batchAllocations.forEach(({ batch, quantity }) => {
                    const batchQuantity = Number(batch.quantity) || 0;
                    const batchAvailable = Number(batch.availableQuantity ?? batchQuantity) || 0;
                    batch.quantity = Math.max(0, batchQuantity - quantity);
                    batch.availableQuantity = Math.max(0, batchAvailable - quantity);
                });

                let splitItem = splitInventory;
                if (splitItem) {
                    splitItem.productName = targetProduct.prodName;
                    splitItem.sku = targetProduct.sku || '';
                    splitItem.spec = splitSpec;
                    const existingQuantity = Number(splitItem.quantity || 0);
                    const existingTotalCost = Number(splitItem.totalCost ?? Number(splitItem.averageCost || 0) * existingQuantity);
                    splitItem.quantity = existingQuantity + toQty;
                    splitItem.availableQuantity = Number(splitItem.availableQuantity ?? existingQuantity) + toQty;
                    splitItem.totalCost = existingTotalCost + splitTotalCost;
                    splitItem.averageCost = splitItem.totalCost / splitItem.quantity;
                    splitItem.lastCost = splitLastCost;
                    if (configuredSalesPrice !== '') splitItem.salesPrice = configuredSalesPrice;
                    splitItem.status = getInventoryStatus(splitItem);
                    splitItem.lastUpdated = new Date().toISOString();
                    splitItem.relatedOrders = Array.from(new Set([...(splitItem.relatedOrders || []), ...(item.relatedOrders || [])]));
                } else {
                    splitItem = {
                        id: generateInventoryId(),
                        productId: targetProduct.id,
                        sku: targetProduct.sku || '',
                        productName: targetProduct.prodName,
                        spec: splitSpec,
                        supplierId: targetProduct.supplierId || item.supplierId,
                        supplierName: item.supplierName || data.suppliers.find(supplier => supplier.id === targetProduct.supplierId)?.name || '',
                        warehouse: item.warehouse,
                        unit: targetProduct.unit || item.unit,
                        quantity: toQty,
                        availableQuantity: toQty,
                        salesPrice: configuredSalesPrice,
                        averageCost: splitAverageCost,
                        lastCost: splitLastCost,
                        totalCost: splitTotalCost,
                        status: toQty > 0 ? '正常' : '缺貨',
                        lastUpdated: new Date().toISOString(),
                        relatedOrders: [...(item.relatedOrders || [])]
                    };
                    data.inventory.push(splitItem);
                }
                createInventoryBatch({
                    inventoryId: splitItem.id,
                    orderId: '',
                    productId: targetProduct.id,
                    productName: targetProduct.prodName,
                    spec: splitItem.spec,
                    supplierId: splitItem.supplierId,
                    supplierName: splitItem.supplierName,
                    quantity: toQty,
                    unitCost: splitAverageCost,
                    sourceDate: '',
                    arrivalDate: '',
                    warehouse: splitItem.warehouse
                });
                data.inventoryMovements.push({
                    unitCost: splitAverageCost,
                    type: 'split',
                    orderId: '',
                    orderNo: '',
                    productId: splitItem.productId,
                    productName: splitItem.productName,
                    spec: splitItem.spec,
                    supplierId: splitItem.supplierId,
                    supplierName: splitItem.supplierName,
                    warehouse: splitItem.warehouse,
                    batchNo: splitItem.id,
                    quantity: toQty,
                    totalCost: splitTotalCost,
                    sourceDate: '',
                    arrivalDate: '',
                    note: `${note}：${item.id} 拆分為 ${splitItem.id}`,
                    createdAt: new Date().toISOString()
                });
                if (saveData() === false) {
                    restoreData();
                    return showToast('拆分未能儲存，庫存與產品資料已復原。', 'bg-red-500');
                }
                if (form.splitFromQty) form.splitFromQty.value = '';
                if (form.splitToQty) form.splitToQty.value = '';
                inventoryModalCurrentId = null;
                closeModal('modal-inventory-split');
                renderInventory();
                if (typeof renderProducts === 'function') renderProducts();
                if (typeof renderPosProducts === 'function') renderPosProducts();
                showToast('拆分包裝已完成', 'bg-green-600');
            } catch (error) {
                restoreData();
                console.error('包裝換算失敗:', error);
                return showToast(`拆分失敗，資料已復原：${error.message || '請檢查庫存資料後重試。'}`, 'bg-red-500');
            }
        }

        // 打開刪除庫存確認 Modal
        function openDeleteInventoryConfirmModal(inventoryId) {
            const item = data.inventory.find(inv => inv.id === inventoryId);
            if (!item) return showToast('找不到庫存項目', 'bg-red-500');
            if (data.inventoryMovements.some(move => move.type === 'outbound' && move.inventoryId === inventoryId && move.accountsDocumentId)) {
                return showToast('此庫存已有連結應收單的出貨記錄，不能刪除庫存主檔。', 'bg-red-500');
            }
            const linkedReceipt = getGoodsReceiptLinkedToInventory(inventoryId);
            if (linkedReceipt) {
                return showToast(`此庫存仍被收貨單 ${linkedReceipt.id} 引用。請先到「收貨驗收」撤銷該收貨，勿直接刪除庫存，以免訂單收貨數量無法還原。`, 'bg-amber-600');
            }
            
            document.getElementById('deleteInventoryConfirmId').value = inventoryId;
            document.getElementById('deleteInventoryConfirmLabel').textContent = `刪除庫存：${item.productName} (${item.spec || '無規格'})`;
            document.getElementById('deleteInventoryConfirmInput').value = '';
            document.getElementById('deleteInventoryConfirmExpectedId').textContent = item.id;
            document.getElementById('modal-delete-inventory-confirm').classList.add('modal-active');
        }

        function getGoodsReceiptLinkedToInventory(inventoryId) {
            const receiptIds = new Set([
                ...(data.inventoryBatches || [])
                    .filter(batch => batch.inventoryId === inventoryId && batch.receiptId)
                    .map(batch => batch.receiptId),
                ...(data.inventoryMovements || [])
                    .filter(move => move.inventoryId === inventoryId && move.receiptId)
                    .map(move => move.receiptId)
            ]);
            return (data.goodsReceipts || []).find(receipt => receiptIds.has(receipt.id));
        }

        function confirmDeleteInventoryItem() {
            const inventoryId = document.getElementById('deleteInventoryConfirmId').value;
            const inputValue = document.getElementById('deleteInventoryConfirmInput').value.trim();
            const expectedId = document.getElementById('deleteInventoryConfirmExpectedId').textContent;
            
            if (inputValue !== expectedId) {
                return showToast(`庫存編號不符。請輸入：${expectedId}`, 'bg-red-500');
            }
            
            closeModal('modal-delete-inventory-confirm');
            deleteInventoryItem(inventoryId);
        }

        // 刪除庫存項目
        function deleteInventoryItem(inventoryId) {
            const item = data.inventory.find(inv => inv.id === inventoryId);
            if (!item) return showToast('找不到庫存項目', 'bg-red-500');
            if (data.inventoryMovements.some(move => move.type === 'outbound' && move.inventoryId === inventoryId && move.accountsDocumentId)) {
                return showToast('此庫存已有連結應收單的出貨記錄，不能刪除庫存主檔。', 'bg-red-500');
            }
            const linkedReceipt = getGoodsReceiptLinkedToInventory(inventoryId);
            if (linkedReceipt) {
                return showToast(`此庫存仍被收貨單 ${linkedReceipt.id} 引用。請先到「收貨驗收」撤銷該收貨，勿直接刪除庫存，以免訂單收貨數量無法還原。`, 'bg-amber-600');
            }

            const previousInventory = JSON.parse(JSON.stringify(data.inventory));
            const previousBatches = JSON.parse(JSON.stringify(data.inventoryBatches));
            const previousMovements = JSON.parse(JSON.stringify(data.inventoryMovements));
            const previousOrders = JSON.parse(JSON.stringify(data.orders));
            // 刪除庫存項目
            data.inventory = data.inventory.filter(inv => inv.id !== inventoryId);

            // 刪除相關批次記錄
            data.inventoryBatches = data.inventoryBatches.filter(batch => batch.inventoryId !== inventoryId);

            // 找出此庫存刪除時影響的歷史訂單
            const affectedOrderIds = new Set();
            data.inventoryMovements.forEach(mov => {
                if (['order-inbound', 'kit-inbound'].includes(mov.type) && mov.orderId) {
                    if (
                        mov.batchNo === inventoryId ||
                        (mov.note && mov.note.includes(inventoryId)) ||
                        (mov.productId === item.productId && item.relatedOrders && item.relatedOrders.includes(mov.orderId))
                    ) {
                        affectedOrderIds.add(mov.orderId);
                    }
                }
            });

            // 刪除相關異動記錄
            data.inventoryMovements = data.inventoryMovements.filter(mov => 
                mov.batchNo === inventoryId || 
                (mov.note && mov.note.includes(inventoryId)) ||
                (mov.productId === item.productId && ['order-inbound', 'kit-inbound'].includes(mov.type) && item.relatedOrders && item.relatedOrders.includes(mov.orderId))
            );

            // 若該訂單已無剩餘轉入記錄，恢復可轉入狀態
            affectedOrderIds.forEach(orderId => {
                const order = data.orders.find(o => o.id === orderId);
                if (!order) return;
                const hasRemainingInbound = data.inventoryMovements.some(mov => ['order-inbound', 'kit-inbound'].includes(mov.type) && mov.orderId === orderId);
                if (!hasRemainingInbound) {
                    order.inventoryTransferred = false;
                    order.inventoryTransferAt = '';
                }
            });

            if (!saveData()) {
                data.inventory = previousInventory;
                data.inventoryBatches = previousBatches;
                data.inventoryMovements = previousMovements;
                previousOrders.forEach(previousOrder => {
                    const order = data.orders.find(item => item.id === previousOrder.id);
                    if (order) Object.assign(order, previousOrder);
                });
                return showToast('刪除未能儲存，原庫存與訂單資料已復原。', 'bg-red-500');
            }
            renderInventory();
            renderOrders();
            showToast(`庫存項目「${item.productName}」已刪除`, 'bg-green-600');
        }

        function getRocYearMonthDay(date = new Date()) {
            const year = date.getFullYear() - 1911;
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}${month}${day}`;
        }

        function generateOutboundId() {
            const prefix = `out_${getRocYearMonthDay()}`;
            const sameDayIds = data.inventoryMovements
                .filter(item => item.id && item.id.startsWith(prefix))
                .map(item => parseInt(item.id.slice(prefix.length), 10))
                .filter(num => !isNaN(num));
            const nextSeq = String(Math.max(0, ...sameDayIds) + 1).padStart(2, '0');
            return `${prefix}${nextSeq}`;
        }

        function openInventoryShippingModal(inventoryId) {
            const item = data.inventory.find(inv => inv.id === inventoryId);
            if (!item) return showToast('找不到庫存項目', 'bg-red-500');
            document.querySelector('#inventoryShipmentForm input[name="inventoryId"]').value = item.id;
            document.querySelector('#inventoryShipmentForm input[name="outboundId"]').value = '';
            document.getElementById('inventoryShipmentLabel').textContent = `出貨：${item.productName || item.productId} (${item.spec || '無規格'})`;
            document.getElementById('inventoryShipmentAvailable').value = item.availableQuantity || 0;
            document.getElementById('inventoryShipmentQty').value = 1;
            document.getElementById('inventoryShipmentPrice').value = getInventorySalesPrice(item);
            document.getElementById('inventoryShipmentInvoice').value = '無發票';
            document.getElementById('inventoryShipmentChannel').value = '未指定';
            document.getElementById('inventoryShipmentInvoiceNo').value = '';
            document.getElementById('inventoryShipmentInvoiceDate').value = '';
            document.getElementById('inventoryShipmentNote').value = '';
            document.getElementById('modal-inventory-shipment').classList.add('modal-active');
        }

        function restoreOutboundQuantity(move) {
            if (!move || !move.inventoryId) return;
            let item = data.inventory.find(inv => inv.id === move.inventoryId);
            if (!item) {
                item = {
                    id: move.inventoryId,
                    productId: move.productId,
                    sku: move.sku || '',
                    productName: move.productName || '',
                    spec: move.spec || '',
                    supplierId: move.supplierId || '',
                    supplierName: move.supplierName || '',
                    warehouse: move.warehouse || '總倉',
                    unit: move.unit || 'pcs',
                    quantity: 0,
                    availableQuantity: 0,
                    averageCost: move.unitCost || 0,
                    lastCost: move.unitCost || 0,
                    totalCost: 0,
                    status: '缺貨',
                    lastUpdated: new Date().toISOString(),
                    relatedOrders: []
                };
                data.inventory.push(item);
            }
            item.quantity = (item.quantity || 0) + (move.quantity || 0);
            item.availableQuantity = (item.availableQuantity || 0) + (move.quantity || 0);
            item.status = item.quantity > 0 ? '正常' : '缺貨';
            item.totalCost = item.quantity * (item.averageCost || 0);
            item.lastUpdated = new Date().toISOString();
        }

        function openEditShippingModal(shippingId) {
            const move = data.inventoryMovements.find(m => m.id === shippingId && m.type === 'outbound');
            if (!move) return showToast('找不到出貨記錄', 'bg-red-500');
            if (move.returnId || getCustomerReturnableQuantity(move.id) < Number(move.quantity || 0)) return showToast('此出貨已有退換貨紀錄，不可單獨修改。', 'bg-amber-600');
            if (move.accountsDocumentId) return showToast('此出貨記錄已連結應收單，請從帳款單據核對；不可單獨修改。', 'bg-red-500');
            const item = data.inventory.find(inv => inv.id === move.inventoryId);
            if (!item) return showToast('找不到對應庫存項目', 'bg-red-500');
            document.querySelector('#inventoryShipmentForm input[name="inventoryId"]').value = item.id;
            document.querySelector('#inventoryShipmentForm input[name="outboundId"]').value = move.id;
            document.getElementById('inventoryShipmentLabel').textContent = `修改出貨：${item.productName || item.productId} (${item.spec || '無規格'})`;
            document.getElementById('inventoryShipmentAvailable').value = (item.availableQuantity || 0) + move.quantity;
            document.getElementById('inventoryShipmentQty').value = move.quantity;
            document.getElementById('inventoryShipmentPrice').value = move.unitCost || 0;
            document.getElementById('inventoryShipmentInvoice').value = move.invoiceType || '無發票';
            document.getElementById('inventoryShipmentInvoiceNo').value = move.invoiceNo || '';
            document.getElementById('inventoryShipmentInvoiceDate').value = move.invoiceDate || '';
            document.getElementById('inventoryShipmentChannel').value = move.channel || '未指定';
            document.getElementById('inventoryShipmentNote').value = move.note || '';
            document.getElementById('modal-inventory-shipment').classList.add('modal-active');
        }

        function applyInventoryShipment(event) {
            event.preventDefault();
            const inventoryId = document.querySelector('#inventoryShipmentForm input[name="inventoryId"]').value;
            const qty = parseInt(document.getElementById('inventoryShipmentQty').value, 10) || 0;
            const price = parseFloat(document.getElementById('inventoryShipmentPrice').value) || 0;
            const invoiceType = document.getElementById('inventoryShipmentInvoice').value || '無發票';
            const invoiceNo = document.getElementById('inventoryShipmentInvoiceNo').value || '';
            const invoiceDate = document.getElementById('inventoryShipmentInvoiceDate').value || '';
            const channel = document.getElementById('inventoryShipmentChannel').value || '未指定';
            const note = document.getElementById('inventoryShipmentNote').value || '';

            const outboundId = document.querySelector('#inventoryShipmentForm input[name="outboundId"]').value;
            let item = data.inventory.find(inv => inv.id === inventoryId);
            if (!item) return showToast('找不到庫存項目', 'bg-red-500');
            if (qty <= 0) return showToast('出貨數量須大於 0', 'bg-red-500');

            if (outboundId) {
                const move = data.inventoryMovements.find(m => m.id === outboundId && m.type === 'outbound');
                if (!move) return showToast('找不到出貨記錄', 'bg-red-500');
                restoreOutboundQuantity(move);
                item = data.inventory.find(inv => inv.id === inventoryId);
                const availableAfterRestore = item ? item.availableQuantity || 0 : 0;
                if (qty > availableAfterRestore) return showToast('出貨數量超過可用庫存', 'bg-red-500');
                item.quantity = (item.quantity || 0) - qty;
                item.availableQuantity = availableAfterRestore - qty;
                if (item.quantity <= 0) {
                    item.quantity = 0;
                    item.availableQuantity = 0;
                    item.status = '缺貨';
                }
                item.totalCost = item.quantity * (item.averageCost || 0);
                item.lastUpdated = new Date().toISOString();
                move.inventoryId = item.id;
                move.productId = item.productId;
                move.productName = item.productName;
                move.spec = item.spec;
                move.supplierId = item.supplierId;
                move.supplierName = item.supplierName;
                move.warehouse = item.warehouse;
                move.quantity = qty;
                move.unitCost = price;
                move.totalCost = price * qty;
                move.invoiceType = invoiceType;
                move.invoiceNo = invoiceNo;
                move.invoiceDate = invoiceDate;
                move.channel = channel;
                move.salesPrice = price;
                move.costUnit = move.costUnit || item.averageCost || 0;
                move.note = note;
                move.createdAt = move.createdAt || new Date().toISOString();
                saveData();
                closeModal('modal-inventory-shipment');
                renderInventory();
                renderShipping();
                showToast('出貨記錄已修改', 'bg-green-600');
                return;
            }

            const available = item.availableQuantity || 0;
            if (qty > available) return showToast('出貨數量超過可用庫存', 'bg-red-500');
            if (!confirm(`確定要出貨「${item.productName}」${qty} 件嗎？\n出貨後可用庫存將為 ${available - qty} 件。`)) return;

            item.quantity = (item.quantity || 0) - qty;
            item.availableQuantity = available - qty;
            if (item.quantity <= 0) {
                item.quantity = 0;
                item.availableQuantity = 0;
                item.status = '缺貨';
            }
            item.totalCost = item.quantity * (item.averageCost || 0);
            item.lastUpdated = new Date().toISOString();

            data.inventoryMovements.push({
                id: generateOutboundId(),
                type: 'outbound',
                inventoryId: item.id,
                orderId: '',
                orderNo: '',
                productId: item.productId,
                productName: item.productName,
                spec: item.spec,
                supplierId: item.supplierId,
                supplierName: item.supplierName,
                warehouse: item.warehouse,
                batchNo: '',
                quantity: qty,
                unitCost: price,
                salesPrice: price,
                costUnit: item.averageCost || 0,
                totalCost: price * qty,
                sourceDate: new Date().toISOString().split('T')[0],
                arrivalDate: '',
                invoiceType,
                invoiceNo,
                invoiceDate,
                channel,
                note,
                createdAt: new Date().toISOString()
            });

            saveData();
            closeModal('modal-inventory-shipment');
            renderInventory();
            renderShipping();
            showToast('出貨紀錄已保存，庫存已扣減', 'bg-green-600');
        }

        function deleteShippingRecord(shippingId) {
            const moveIndex = data.inventoryMovements.findIndex(m => m.id === shippingId && m.type === 'outbound');
            if (moveIndex === -1) return showToast('找不到出貨記錄', 'bg-red-500');
            if (data.inventoryMovements[moveIndex].returnId || getCustomerReturnableQuantity(shippingId) < Number(data.inventoryMovements[moveIndex].quantity || 0)) return showToast('此出貨已有退換貨紀錄，不可單獨刪除。', 'bg-amber-600');
            if (data.inventoryMovements[moveIndex].accountsDocumentId) return showToast('此出貨記錄已連結應收單，不可單獨刪除。', 'bg-red-500');
            if (!confirm('確定要刪除此出貨紀錄嗎？刪除後會回補對應庫存。')) return;
            const move = data.inventoryMovements[moveIndex];
            const item = data.inventory.find(inv => inv.id === move.inventoryId);
            if (item) {
                item.quantity = (item.quantity || 0) + move.quantity;
                item.availableQuantity = (item.availableQuantity || 0) + move.quantity;
                item.status = item.quantity > 0 ? '正常' : item.status;
                item.totalCost = item.quantity * (item.averageCost || 0);
                item.lastUpdated = new Date().toISOString();
            } else {
                data.inventory.push({
                    id: move.inventoryId,
                    productId: move.productId,
                    sku: move.sku || '',
                    productName: move.productName || '',
                    spec: move.spec || '',
                    supplierId: move.supplierId || '',
                    supplierName: move.supplierName || '',
                    warehouse: move.warehouse || '總倉',
                    unit: 'pcs',
                    quantity: move.quantity,
                    availableQuantity: move.quantity,
                    averageCost: move.unitCost || 0,
                    lastCost: move.unitCost || 0,
                    totalCost: (move.quantity || 0) * (move.unitCost || 0),
                    status: move.quantity > 0 ? '正常' : '缺貨',
                    lastUpdated: new Date().toISOString(),
                    relatedOrders: []
                });
            }
            data.inventoryMovements.splice(moveIndex, 1);
            saveData();
            renderInventory();
            renderShipping();
            showToast('出貨紀錄已刪除，庫存已回補', 'bg-green-600');
        }

        function renderShipping() {
            const container = document.getElementById('shippingList');
            if (!container) return;
            const keyword = (document.getElementById('searchShippingKeyword')?.value || '').toLowerCase();
            const startDateStr = document.getElementById('filterShippingStartDate')?.value || '';
            const endDateStr = document.getElementById('filterShippingEndDate')?.value || '';
            
            const startDate = startDateStr ? new Date(startDateStr) : null;
            const endDate = endDateStr ? new Date(endDateStr) : null;

            const shippingItems = data.inventoryMovements.filter(move => move.type === 'outbound');
            const filtered = shippingItems.filter(move => {
                // 關鍵字篩選
                if (keyword && ![move.inventoryId, move.orderId, move.productId, move.productName, move.spec, move.note]
                    .some(field => field && field.toLowerCase().includes(keyword))) {
                    return false;
                }
                
                // 日期範圍篩選
                if (startDate || endDate) {
                    const moveDate = new Date(move.createdAt);
                    if (startDate && moveDate < startDate) return false;
                    if (endDate) {
                        const endDayEnd = new Date(endDate);
                        endDayEnd.setHours(23, 59, 59, 999);
                        if (moveDate > endDayEnd) return false;
                    }
                }
                
                return true;
            });

            if (filtered.length === 0) {
                container.innerHTML = '<div class="text-center text-gray-500 py-10 bg-white rounded">目前沒有出貨記錄。</div>';
            } else {
                const html = filtered.map(move => {
                const returnableQuantity = getCustomerReturnableQuantity(move.id);
                const returnedQuantity = Number(move.quantity || 0) - returnableQuantity;
                return `
                <div class="card p-5 border-l-4 border-red-500">
                    <div class="flex flex-col md:flex-row justify-between gap-4 mb-3">
                        <div>
                            <div class="text-sm text-gray-500">出貨編號：${move.id}</div>
                            <div class="text-lg font-bold text-gray-800">${move.productName || move.productId}</div>
                            <div class="text-sm text-gray-500">庫存編號：${move.inventoryId || '-'} / 規格：${move.spec || '無'} / 供應商：${move.supplierName || '未知'}</div>
                            ${move.customerName ? `<div class="mt-1 text-sm text-slate-600">客戶：${escapeFinanceHtml(move.customerName)}</div>` : ''}
                            ${move.accountsDocumentId ? `<button type="button" onclick="openLinkedFinanceDocument('${escapeFinanceHtml(move.accountsDocumentId)}')" class="mt-1 text-sm font-semibold text-indigo-700 underline">查看關聯應收單 ${escapeFinanceHtml(move.accountsDocumentId)}</button>` : ''}
                            ${returnedQuantity > 0 ? `<div class="mt-1 text-sm font-semibold text-teal-700">已退回 ${returnedQuantity} / ${move.quantity}</div>` : ''}
                        </div>
                        <div class="text-right text-sm text-gray-600">
                            <div>出貨日期：${move.createdAt ? new Date(move.createdAt).toLocaleString('zh-TW', { hour12: false }) : '-'}</div>
                            <div>發票：${move.invoiceType || '無發票'}</div>
                            ${move.invoiceNo ? `<div class="text-blue-600 font-semibold">發票號碼：${move.invoiceNo}</div>` : ''}
                            ${move.invoiceDate ? `<div class="text-blue-600">發票日期：${move.invoiceDate}</div>` : ''}
                        </div>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-700">
                        <div class="bg-gray-50 p-3 rounded shadow-sm">
                            <div class="text-xs text-gray-500">出貨數量</div>
                            <div class="text-2xl font-bold text-gray-900">${move.quantity}</div>
                        </div>
                        <div class="bg-gray-50 p-3 rounded shadow-sm">
                            <div class="text-xs text-gray-500">售出單價</div>
                            <div class="text-2xl font-bold text-gray-900">$${move.unitCost.toLocaleString()}</div>
                        </div>
                        <div class="bg-gray-50 p-3 rounded shadow-sm">
                            <div class="text-xs text-gray-500">總售價</div>
                            <div class="text-2xl font-bold text-gray-900">$${Math.round(move.totalCost).toLocaleString()}</div>
                        </div>
                    </div>
                    ${(move.logisticsProvider || move.logisticsNumber || move.deliveryAddress || move.deliveryPerson || move.shipmentNote) ? `
                        <div class="mt-3 grid grid-cols-1 gap-2 rounded bg-indigo-50 p-3 text-sm text-slate-700 md:grid-cols-2">
                            <div>物流：${escapeFinanceHtml(move.logisticsProvider || '-')} · 編號：${escapeFinanceHtml(move.logisticsNumber || '-')}</div>
                            <div>送貨人：${escapeFinanceHtml(move.deliveryPerson || '-')}</div>
                            <div class="md:col-span-2">出貨地址：${escapeFinanceHtml(move.deliveryAddress || '-')}</div>
                            <div class="md:col-span-2">出貨備註：${escapeFinanceHtml(move.shipmentNote || '-')}</div>
                        </div>
                    ` : ''}
                    <div class="mt-3 text-sm text-gray-500">備註：${move.note || '無'}</div>
                    <div class="mt-4 flex flex-wrap gap-2">
                        ${returnableQuantity > 0 ? `<button type="button" onclick="openCustomerReturnModal('${move.id}')" class="px-3 py-2 bg-teal-700 text-white rounded hover:bg-teal-800 text-sm">退貨／換貨</button>` : '<span class="px-3 py-2 text-sm font-semibold text-teal-700">已全數退回</span>'}
                        <button type="button" onclick="openEditShippingModal('${move.id}')" class="px-3 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600 text-sm">修改</button>
                        <button type="button" onclick="deleteShippingRecord('${move.id}')" class="px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm">刪除</button>
                    </div>
                </div>
            `;
                }).join('');
                container.innerHTML = html;
            }
            renderReturnTransactions();
        }

        function exportOutboundRecords() {
            const outboundRecords = data.inventoryMovements.filter(move => move.type === 'outbound');
            const exportData = [];
            const sheetName = '出貨記錄';
            exportData.push(["出貨編號", "出貨日期", "庫存編號", "來源訂單", "應收單號", "客戶", "物流", "物流編號", "出貨地址", "送貨人", "出貨備註", "產品編號", "產品名稱", "規格", "供應商", "數量", "售出單價", "總售價", "發票狀態", "發票號碼", "發票日期", "備註"]);
            outboundRecords.forEach(move => {
                exportData.push([
                    move.id,
                    move.createdAt || '',
                    move.inventoryId || '',
                    move.orderId || '',
                    move.accountsDocumentId || '',
                    move.customerName || '',
                    move.logisticsProvider || '',
                    move.logisticsNumber || '',
                    move.deliveryAddress || '',
                    move.deliveryPerson || '',
                    move.shipmentNote || '',
                    move.productId || '',
                    move.productName || '',
                    move.spec || '',
                    move.supplierName || '',
                    move.quantity,
                    move.unitCost,
                    move.totalCost,
                    move.invoiceType || '無發票',
                    move.invoiceNo || '',
                    move.invoiceDate || '',
                    move.note || ''
                ]);
            });
            const fileName = `出貨記錄_${getTodayStr()}.xlsx`;
            saveAsExcel(exportData, sheetName, fileName);
            showToast('匯出成功', 'bg-green-600');
        }
