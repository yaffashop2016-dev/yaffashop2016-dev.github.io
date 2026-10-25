        // ================= 購物車與訂單邏輯 (v10.0 核心修改) =================

        function addToCart(productId) {
            if (!Array.isArray(data.products)) data.products = [];
            const product = data.products.find(p => p.id === productId);
            if (!product) {
                showToast('找不到該產品，請重新整理後再試。', 'bg-red-500');
                return;
            }
            if (product.isActive === false) return showToast('此產品已停用，不能加入採購清單。', 'bg-red-500');
            const currency = getProductCurrency(product);
            const exchangeRate = getProductExchangeRate(product);
            if (exchangeRate <= 0) return showToast('此人民幣產品尚未設定有效匯率，請先修改產品資料。', 'bg-red-500');
            
            if (!Array.isArray(data.cart)) data.cart = [];
            
            const existing = data.cart.find(item => item.productId === productId);
            if (existing) {
                existing.quantity += 1;
            } else {
                data.cart.push({
                    productId: productId,
                    quantity: 1,
                    customPrice: getProductPurchasePrice(product),
                    customShipping: product.shipping,
                    currency,
                    exchangeRate,
                    customNote: '',
                    taxStatus: product.isTaxIncl || '含稅'
                });
            }
            saveData();
            updateCartCount();
            showToast('已加入採購單', 'bg-blue-500');
            // 如果目前已在採購頁面，立即更新列表
            if (document.getElementById('page-purchase') && !document.getElementById('page-purchase').classList.contains('hidden')) {
                renderCart();
            }
        }

        function updateCartCount() {
            const badge = document.getElementById('cartCount');
            const count = data.cart?.length || 0;
            badge.textContent = count;
            badge.classList.toggle('hidden', count === 0);
        }

        function renderCart() {
            const container = document.getElementById('cartList');
            container.innerHTML = '';
            updateCartCount();
            
            selectedCartItems = new Set([...selectedCartItems].filter(pid => data.cart.some(item => item.productId === pid)));

            if (!data.cart || data.cart.length === 0) {
                container.innerHTML = '<tr><td colspan="9" class="p-8 text-center text-gray-400">清單目前為空</td></tr>';
                recalcCartSummary();
                return;
            }

            data.cart.forEach((item, index) => {
                const p = data.products.find(prod => prod.id === item.productId);
                if (!p) { return; }
                const supplier = data.suppliers.find(s => s.id === p.supplierId);
                
                const unitPrice = item.customPrice !== undefined ? item.customPrice : getProductPurchasePrice(p);
                const shipFee = item.customShipping !== undefined ? item.customShipping : p.shipping;
                const currency = item.currency || 'NTD';
                const exchangeRate = currency === 'NTD' ? 1 : Number(item.exchangeRate);
                const unitPriceNtd = convertCurrencyToNtd(unitPrice, currency, exchangeRate);
                const shipFeeNtd = convertCurrencyToNtd(shipFee, currency, exchangeRate);
                const qty = item.quantity || 1;
                const taxStatus = item.taxStatus || '含稅'; 

                let rowBase = (unitPriceNtd * qty) + shipFeeNtd;
                let rowTotal = rowBase;
                if (taxStatus === '不含稅') rowTotal = rowBase * 1.05;

                const tr = document.createElement('tr');
                tr.className = 'hover:bg-blue-50 transition-colors';
                const isChecked = selectedCartItems.has(item.productId) ? 'checked' : '';

                tr.innerHTML = `
                    <td class="p-3 text-center">
                        <input type="checkbox" class="cart-checkbox w-4 h-4" value="${item.productId}" ${isChecked} onchange="toggleCartItemSelection(this)">
                    </td>
                    <td class="p-3">
                        <div class="font-bold text-gray-800">${p.prodName}</div>
                        ${isKitProduct(p) ? `<div class="text-xs text-orange-700">採購組合包；收貨時將依訂單 BOM 拆分為單品庫存</div>` : ''}
                        <div class="text-xs text-gray-500">${supplier?.name || '未知'}</div>
                        <div class="text-xs bg-gray-200 inline-block px-1 rounded mt-1">交期: ${p.deliveryTime || '未定'}</div>
                        ${p.spec ? `<div class="text-xs text-gray-600 bg-blue-50 inline-block px-2 py-1 rounded mt-1 ml-1"><strong>規格:</strong> ${p.spec}</div>` : ''}
                    </td>
                    <td class="p-3">
                        <div class="flex items-center">
                            <span class="text-gray-400 mr-1">${currency === 'RMB' ? '¥' : '$'}</span>
                            <input type="number" step="0.01" value="${unitPrice}" 
                                class="w-24 p-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 text-right font-mono"
                                onchange="updateCartItem(${index}, 'price', this.value)">
                        </div>
                        ${currency === 'RMB'
                            ? `<label class="mt-1 block text-xs text-gray-500">採購匯率 (1 RMB = NTD)
                                <input type="number" min="0.000001" step="any" value="${exchangeRate}"
                                    class="mt-1 w-28 rounded border p-1 text-right"
                                    onchange="updateCartItem(${index}, 'exchangeRate', this.value)">
                            </label>`
                            : '<div class="text-xs text-gray-400 mt-1">匯率 1 NTD = 1 NTD</div>'}
                        <div class="text-xs text-gray-400 mt-1">進價: ${currency} ${getProductPurchasePrice(p)}（約 NTD $${getProductPurchasePriceNtd(p)}）</div>
                        <div class="text-xs text-blue-600">本次折合單價：NTD $${formatProductPrice(unitPriceNtd)}</div>
                    </td>
                    <td class="p-3">
                        <input type="number" value="${qty}" min="1" 
                            class="w-16 p-1 border border-gray-300 rounded text-center"
                            onchange="updateCartItem(${index}, 'qty', this.value)">
                    </td>
                    <td class="p-3">
                        <select class="p-1 border border-gray-300 rounded text-xs w-full" 
                                onchange="updateCartItem(${index}, 'taxStatus', this.value)">
                            <option value="含稅" ${taxStatus === '含稅' ? 'selected' : ''}>含稅</option>
                            <option value="不含稅" ${taxStatus === '不含稅' ? 'selected' : ''}>未稅 (+5%)</option>
                            <option value="不計稅" ${taxStatus === '不計稅' ? 'selected' : ''}>不計稅 (收據)</option>
                        </select>
                    </td>
                    <td class="p-3">
                         <div class="flex items-center">
                            <span class="text-gray-400 mr-1">${currency === 'RMB' ? '¥' : '$'}</span>
                            <input type="number" step="0.01" value="${shipFee}" 
                                class="w-20 p-1 border border-gray-300 rounded text-right"
                                onchange="updateCartItem(${index}, 'shipping', this.value)">
                        </div>
                        <div class="text-xs text-blue-600">折合 NTD $${formatProductPrice(shipFeeNtd)}</div>
                    </td>
                    <td class="p-3">
                        <input type="text" value="${item.customNote || ''}" placeholder="填寫備註..."
                            class="w-full p-1 border border-gray-300 rounded text-sm"
                            onchange="updateCartItem(${index}, 'note', this.value)">
                    </td>
                    <td class="p-3 font-mono text-blue-700 font-bold text-right">
                        NTD $${Math.round(rowTotal).toLocaleString()}
                        ${taxStatus === '不含稅' ? '<div class="text-[10px] text-red-500">(含稅額)</div>' : ''}
                        ${taxStatus === '不計稅' ? '<div class="text-[10px] text-gray-400">(無稅額)</div>' : ''}
                    </td>
                    <td class="p-3 text-center">
                        <div class="flex flex-col gap-2 items-center">
                            <button onclick="confirmOrder(${index})" class="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200 w-full font-bold">單獨下單</button>
                            <button onclick="removeFromCart(${index})" class="text-red-400 hover:text-red-600 hover:bg-red-50 p-1 rounded transition text-xs flex items-center">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg> 移除
                            </button>
                        </div>
                    </td>
                `;
                container.appendChild(tr);
            });
            recalcCartSummary();
            recalcCartSummary();
        }

        // v11.3 更新: 採購清單稅務計算邏輯同步更新
        function recalcCartSummary() {
            let shippingTotal = 0;
            const selectedLines = [];
            selectedCartItems.forEach(productId => {
                const item = data.cart.find(cartItem => cartItem.productId === productId);
                if (!item) return;

                const currency = item.currency || 'NTD';
                const exchangeRate = currency === 'NTD' ? 1 : Number(item.exchangeRate);
                const price = convertCurrencyToNtd(Number(item.customPrice) || 0, currency, exchangeRate);
                const qty = parseInt(item.quantity) || 1;
                const shipping = convertCurrencyToNtd(Number(item.customShipping) || 0, currency, exchangeRate);
                shippingTotal += shipping;
                selectedLines.push({
                    unitPrice: price,
                    quantity: qty,
                    shipping,
                    taxStatus: item.taxStatus || '含稅'
                });
            });

            const amounts = calculateFinanceDocumentAmounts(selectedLines);
            document.getElementById('selectedCount').textContent = selectedCartItems.size;
            document.getElementById('cartSubtotal').textContent = amounts.subtotal.toLocaleString('zh-TW');
            document.getElementById('cartTax').textContent = amounts.taxAmount.toLocaleString('zh-TW');
            document.getElementById('cartShipping').textContent = Math.round(shippingTotal).toLocaleString();
            document.getElementById('cartTotal').textContent = amounts.totalAmount.toLocaleString('zh-TW');
        }

        function toggleSelectAllCart(source) {
            const checkboxes = document.querySelectorAll('.cart-checkbox');
            checkboxes.forEach(cb => {
                cb.checked = source.checked;
                toggleCartItemSelection(cb, false); // false = 不要每次都重繪，最後再一次
            });
            recalcCartSummary();
        }

        function toggleCartItemSelection(checkbox, triggerRecalc = true) {
            const productId = checkbox.value;
            if (checkbox.checked) {
                selectedCartItems.add(productId);
            } else {
                selectedCartItems.delete(productId);
            }
            if (triggerRecalc) recalcCartSummary();
        }

        function updateCartItem(index, type, value) {
            if (type === 'price') {
                data.cart[index].customPrice = parseFloat(value) || 0;
            } else if (type === 'qty') {
                data.cart[index].quantity = parseInt(value) || 1;
            } else if (type === 'shipping') {
                data.cart[index].customShipping = parseFloat(value) || 0;
            } else if (type === 'exchangeRate') {
                const exchangeRate = Number(value);
                if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
                    renderCart();
                    return showToast('採購匯率必須大於 0（1 RMB = NTD）。', 'bg-red-500');
                }
                data.cart[index].exchangeRate = exchangeRate;
            } else if (type === 'note') {
                data.cart[index].customNote = value;
            } else if (type === 'taxStatus') {
                data.cart[index].taxStatus = value; 
            }
            saveData();
            renderCart(); 
        }

        function removeFromCart(index) {
            data.cart.splice(index, 1);
            selectedCartItems.clear();
            document.getElementById('selectAllCart').checked = false;
            saveData();
            renderCart();
        }

        function clearCart() {
            if (confirm('確定要清空採購清單嗎？')) {
                data.cart = [];
                selectedCartItems.clear();
                saveData();
                renderCart();
            }
        }

        function confirmOrder(specificIndex = null) {
            let itemsToOrder = [];
            let indicesToRemove = [];

            if (specificIndex !== null) {
                itemsToOrder.push(data.cart[specificIndex]);
                indicesToRemove.push(specificIndex);
            } else {
                if (selectedCartItems.size === 0) {
                    return showToast('請先勾選要下單的項目，或使用「單獨下單」按鈕', 'bg-red-500');
                }
                
                const selectedProductIds = Array.from(selectedCartItems);
                selectedProductIds.forEach(productId => {
                    const idx = data.cart.findIndex(item => item.productId === productId);
                    if (idx !== -1) {
                        itemsToOrder.push(data.cart[idx]);
                        indicesToRemove.push(idx);
                    }
                });
            }

            const invalidProduct = itemsToOrder.map(item => ({
                item,
                product: data.products.find(candidate => candidate.id === item.productId)
            })).find(({ item, product }) => {
                if (!product || (item.currency || getProductCurrency(product)) !== 'RMB') return false;
                const exchangeRate = Number(item.exchangeRate ?? getProductExchangeRate(product));
                return !Number.isFinite(exchangeRate) || exchangeRate <= 0;
            });
            if (invalidProduct) {
                return showToast(`產品「${invalidProduct.product.prodName || ''}」的匯率無效，請更新後再下單。`, 'bg-red-500');
            }

            const itemsBySupplier = new Map();
            const orderDate = new Date().toISOString().split('T')[0];
            const createdAt = new Date().toISOString();
            itemsToOrder.forEach(cartItem => {
                const product = data.products.find(candidate => candidate.id === cartItem.productId);
                if (!product) return;
                const supplierId = product.supplierId || '';
                const supplier = data.suppliers.find(candidate => candidate.id === supplierId);
                const key = supplierId || `unassigned:${product.id}`;
                if (!itemsBySupplier.has(key)) {
                    itemsBySupplier.set(key, {
                        supplierId,
                        supplierName: supplier?.name || '未指定供應商',
                        items: []
                    });
                }
                const item = JSON.parse(JSON.stringify(cartItem));
                const currency = item.currency || getProductCurrency(product);
                const exchangeRate = currency === 'NTD' ? 1 : Number(item.exchangeRate ?? getProductExchangeRate(product));
                item.sourceCurrency = currency;
                item.exchangeRate = exchangeRate;
                item.sourceUnitPrice = Number(item.customPrice) || 0;
                item.sourceShipping = Number(item.customShipping) || 0;
                item.customPrice = convertCurrencyToNtd(item.sourceUnitPrice, currency, exchangeRate);
                item.customShipping = convertCurrencyToNtd(item.sourceShipping, currency, exchangeRate);
                item.supplierId = supplierId;
                item.supplierName = supplier?.name || '未指定供應商';
                item.productName = product.prodName || '';
                item.spec = product.spec || '';
                item.sku = product.sku || '';
                item.unit = product.unit || 'pcs';
                item.receivedQuantity = 0;
                item.rejectedQuantity = 0;
                if (isKitProduct(product)) item.kitSnapshot = createKitSnapshot(product);
                else delete item.kitSnapshot;
                itemsBySupplier.get(key).items.push(item);
            });
            if (!itemsBySupplier.size) return showToast('所選項目找不到有效產品，無法建立訂單。', 'bg-red-500');
            const supplierGroups = Array.from(itemsBySupplier.values());
            const confirmation = specificIndex !== null
                ? `確定要為「${supplierGroups[0].supplierName}」建立此採購訂單嗎？`
                : `將依供應商拆成 ${supplierGroups.length} 張採購單，含 ${itemsToOrder.length} 筆項目。\n確認下單？`;
            if (!confirm(confirmation)) return;

            const firstOrderId = generateOrderID();
            const orderIdPrefix = `${new Date().getFullYear() - 1911}${String(new Date().getMonth() + 1).padStart(2, '0')}`;
            const firstOrderSequence = Number(firstOrderId.slice(orderIdPrefix.length)) || 1;
            const newOrders = supplierGroups.map((group, index) => ({
                id: `${orderIdPrefix}${String(firstOrderSequence + index).padStart(2, '0')}`,
                supplierId: group.supplierId,
                supplierName: group.supplierName,
                createdAt,
                date: orderDate,
                status: 'ordered',
                paymentStatus: 'unpaid',
                paymentDate: '',
                invoiceNumber: '',
                supplierInvoiceDate: '',
                originalOrderNo: '',
                quotationNo: '',
                logisticsProvider: '',
                trackingNumber: '',
                shipDate: '',
                arrivalDate: '',
                orderNote: '',
                discount: 0,
                inventoryTransferred: false,
                inventoryTransferAt: '',
                items: group.items
            }));
            if (!data.orders) data.orders = [];
            data.orders.unshift(...newOrders);

            indicesToRemove.sort((a, b) => b - a);
            indicesToRemove.forEach(idx => {
                data.cart.splice(idx, 1);
            });
            
            selectedCartItems.clear();
            document.getElementById('selectAllCart').checked = false;

            saveData();
            // 確保 UI 的購物車計數與小計會被即時更新
            updateCartCount();
            recalcCartSummary();
            renderCart();
            switchTab('orders');
            showToast(`已建立 ${newOrders.length} 張採購訂單！`, 'bg-green-600');
        }

        // ================= 計算預計到貨日 =================
        function populateOrderDateFilters() {
            const yearSelect = document.getElementById('filterOrderYear');
            if (!yearSelect) return;
            const currentYear = yearSelect.value || 'all';
            const years = Array.from(new Set((data.orders || []).map(order => {
                if (!order.date) return null;
                return order.date.split('-')[0];
            }).filter(Boolean))).sort((a, b) => parseInt(b) - parseInt(a));

            yearSelect.innerHTML = '<option value="all">全部年份</option>' + years.map(year => `
                <option value="${year}">${year}</option>`).join('');
            if (years.includes(currentYear)) {
                yearSelect.value = currentYear;
            }
        }

        function renderOrders() {
            if (!Array.isArray(data.orders)) data.orders = [];
            const container = document.getElementById('orderList');
            if (!container) return;
            container.innerHTML = '';

            populateOrderDateFilters();
            const keyword = (document.getElementById('searchOrderKeyword')?.value || '').toLowerCase();
            const statusFilter = document.getElementById('filterOrderStatus')?.value || 'all';
            const paymentFilter = document.getElementById('filterPaymentStatus')?.value || 'all';
            const yearFilter = document.getElementById('filterOrderYear')?.value || 'all';
            const monthFilter = document.getElementById('filterOrderMonth')?.value || 'all';

            if (!data.orders || data.orders.length === 0) {
                container.innerHTML = '<div class="text-center text-gray-500 py-10 bg-white rounded">目前沒有歷史訂單。</div>';
                return;
            }

            const filteredOrders = data.orders.filter(order => {
                // v11.1 兼容舊資料: 將舊 pending 對應到 ordered
                let currentStatus = order.status;
                if(currentStatus === 'pending') currentStatus = 'ordered';
                if(!currentStatus) currentStatus = 'ordered'; // 舊資料沒有 status 預設為 ordered

                if (statusFilter !== 'all' && currentStatus !== statusFilter) return false;
                
                // 付款狀態篩選邏輯
                const payStatus = getPurchaseOrderPaymentStatus(order);
                if (paymentFilter !== 'all' && payStatus !== paymentFilter) return false;

                if (yearFilter !== 'all' || monthFilter !== 'all') {
                    if (!order.date) {
                        // 舊資料沒有 date，跳過篩選
                        if (yearFilter !== 'all' || monthFilter !== 'all') return false;
                    } else {
                        const [orderYear, orderMonth] = order.date.split('-');
                        if (yearFilter !== 'all' && orderYear !== yearFilter) return false;
                        if (monthFilter !== 'all' && orderMonth !== monthFilter) return false;
                    }
                }

                if (keyword) {
                    const idMatch = order.id.toLowerCase().includes(keyword);
                    const invoiceMatch = (order.invoiceNumber || '').toLowerCase().includes(keyword);
                    const originalOrderMatch = (order.originalOrderNo || '').toLowerCase().includes(keyword);
                    // v11.0: 增加搜尋報價單號
                    const quoteMatch = (order.quotationNo || '').toLowerCase().includes(keyword);
                    
                    const itemsMatch = order.items.some(item => {
                        const p = data.products.find(prod => prod.id === item.productId);
                        const prodName = (item.productName || p?.prodName || item.kitSnapshot?.productName || '').toLowerCase();
                        const supplier = item.supplierName || order.supplierName || (p ? (data.suppliers.find(s => s.id === p.supplierId)?.name || '') : '');
                        return prodName.includes(keyword) || supplier.toLowerCase().includes(keyword);
                    });
                    return idMatch || invoiceMatch || originalOrderMatch || quoteMatch || itemsMatch;
                }
                return true;
            });

            if (filteredOrders.length === 0) {
                container.innerHTML = `<div class="text-center text-gray-500 py-10 bg-white rounded">
                    沒有符合篩選條件的訂單。<br>
                    <small>關鍵字: "${keyword}", 狀態: "${statusFilter}", 付款: "${paymentFilter}", 年: "${yearFilter}", 月: "${monthFilter}"</small>
                </div>`;
                return;
            }

            filteredOrders.forEach(order => {
                // 資料補全
                order.paymentStatus = order.paymentStatus || 'unpaid';
                const effectivePaymentStatus = getPurchaseOrderPaymentStatus(order);
                if(order.status === 'pending') order.status = 'ordered'; // Migration on render

                // v11.3: 稅務邏輯核心修正
                const orderAmounts = calculateFinanceDocumentAmounts(order.items.map(item => ({
                    unitPrice: item.customPrice || 0,
                    quantity: item.quantity || 1,
                    shipping: item.customShipping || 0,
                    taxStatus: item.taxStatus || '含稅'
                })));
                const totalNetSales = orderAmounts.subtotal + orderAmounts.shipping;
                const totalTaxAmount = orderAmounts.taxAmount;
                const discount = Math.round(parseFloat(order.discount) || 0);
                const totalPayable = Math.max(0, orderAmounts.totalAmount - discount);

                const createdDateDisplay = order.createdAt 
                    ? new Date(order.createdAt).toLocaleString('zh-TW', { hour12: false }) 
                    : `${order.date} (歷史單)`;
                const estimatedDate = calculateEstimatedArrival(order.date, order.items);
                const todayStr = new Date().toISOString().split('T')[0];
                const isOverdue = estimatedDate !== "--" && estimatedDate < todayStr && order.status !== 'completed' && order.status !== 'cancelled' && order.status !== 'arrived';
                const estimatedDateClass = isOverdue ? 'text-red-600 font-bold' : 'text-gray-400 font-normal';

                const inventoryTransferred = order.inventoryTransferred === true;
                const inventoryCanTransfer = !inventoryTransferred && (order.status === 'arrived' || order.status === 'completed' || order.status === 'closed');
                const transferButtonLabel = inventoryTransferred ? '已轉入' : inventoryCanTransfer ? '轉入庫存' : '不可轉入';
                const transferButtonClasses = inventoryCanTransfer ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-gray-200 text-gray-500 cursor-not-allowed';
                const hasGoodsReceipts = (data.goodsReceipts || []).some(receipt => receipt.orderId === order.id);
                const undoTransferButtonHtml = inventoryTransferred && !hasGoodsReceipts
                    ? `<button onclick="undoTransferOrderToInventory('${order.id}')" class="px-3 py-1 rounded text-sm font-bold bg-yellow-500 text-white hover:bg-yellow-600 ml-2">撤銷轉入</button>`
                    : inventoryTransferred
                        ? '<span class="ml-2 text-xs text-slate-500">分批收貨請至「收貨驗收」逐筆撤銷</span>'
                        : '';
                const orderSupplierKeys = new Set(order.items.map(item => {
                    const product = data.products.find(candidate => candidate.id === item.productId);
                    const supplierId = item.supplierId || order.supplierId || product?.supplierId || '';
                    const supplierName = item.supplierName || order.supplierName || data.suppliers.find(supplier => supplier.id === supplierId)?.name || '未指定供應商';
                    return supplierId || supplierName;
                }));
                const existingPayableCount = (data.accountsPayable || []).filter(document => document.sourceOrderId === order.id).length;
                const canCreatePayable = ['arrived', 'completed', 'closed'].includes(order.status);
                const payableButtonLabel = existingPayableCount >= orderSupplierKeys.size && orderSupplierKeys.size > 0
                    ? `應付已建立 (${existingPayableCount})`
                    : existingPayableCount > 0 ? `補建應付 (${existingPayableCount}/${orderSupplierKeys.size})` : '轉應付單';
                const payableButtonHtml = canCreatePayable
                    ? `<button onclick="createPayablesFromOrder('${order.id}')" class="rounded px-3 py-1 text-sm font-bold ${existingPayableCount >= orderSupplierKeys.size && orderSupplierKeys.size > 0 ? 'cursor-not-allowed bg-gray-100 text-gray-500' : 'bg-orange-600 text-white hover:bg-orange-700'}" ${existingPayableCount >= orderSupplierKeys.size && orderSupplierKeys.size > 0 ? 'disabled' : ''}>${payableButtonLabel}</button>`
                    : '';

                // v11.1: 物流狀態 Badge 與 顏色
                let statusBadge = '';
                let statusColor = '';
                let borderColor = 'border-l-4 border-gray-400';

                switch(order.status) {
                    case 'ordered': 
                        statusBadge = '已下單'; 
                        statusColor = 'bg-gray-100 text-gray-800 border-gray-300'; 
                        borderColor = 'border-l-4 border-gray-400';
                        break;
                    case 'partial_shipped': 
                        statusBadge = '部分出貨'; 
                        statusColor = 'bg-orange-100 text-orange-800 border-orange-200'; 
                        borderColor = 'border-l-4 border-orange-400';
                        break;
                    case 'partially_received':
                        statusBadge = '部分收貨';
                        statusColor = 'bg-amber-100 text-amber-800 border-amber-200';
                        borderColor = 'border-l-4 border-amber-400';
                        break;
                    case 'shipped': 
                        statusBadge = '全部出貨'; 
                        statusColor = 'bg-blue-100 text-blue-800 border-blue-200'; 
                        borderColor = 'border-l-4 border-blue-400';
                        break;
                    case 'arrived': 
                        statusBadge = '已收貨'; 
                        statusColor = 'bg-indigo-100 text-indigo-800 border-indigo-200'; 
                        borderColor = 'border-l-4 border-indigo-400';
                        break;
                    case 'completed': 
                        statusBadge = '已驗收完成'; 
                        statusColor = 'bg-green-100 text-green-800 border-green-200'; 
                        borderColor = 'border-l-4 border-green-500 opacity-75';
                        break;
                    case 'cancelled': 
                        statusBadge = '已取消(退)'; 
                        statusColor = 'bg-red-100 text-red-800 border-red-200 line-through'; 
                        borderColor = 'border-l-4 border-red-500 opacity-60';
                        break;
                    default: 
                        statusBadge = '未知狀態'; 
                        statusColor = 'bg-gray-100';
                }

                // 付款狀態樣式
                let payClass = '';
                if(effectivePaymentStatus === 'paid') payClass = 'bg-green-50 border-green-300 text-green-700';
                else if(effectivePaymentStatus === 'partial') payClass = 'bg-amber-50 border-amber-300 text-amber-700';
                else if(effectivePaymentStatus === 'monthly') payClass = 'bg-purple-50 border-purple-300 text-purple-700';
                else if(effectivePaymentStatus === '刷卡') payClass = 'bg-blue-50 border-blue-300 text-blue-700';
                else if(effectivePaymentStatus === '匯款') payClass = 'bg-orange-50 border-orange-300 text-orange-700';
                else if(effectivePaymentStatus === '現金') payClass = 'bg-teal-50 border-teal-300 text-teal-700';
                else payClass = 'bg-red-50 border-red-300 text-red-700';
                const hasLinkedPayable = (data.accountsPayable || []).some(document => document.sourceOrderId === order.id);
                const purchasePaymentLabels = { unpaid: '未付款', partial: '部分付款', paid: '已結清', monthly: '月結', '刷卡': '刷卡', '匯款': '匯款', '現金': '現金' };

                // v11.0: 訂單項目改為可編輯輸入框
                let itemsHtml = '';
                order.items.forEach((item, idx) => {
                    const p = data.products.find(prod => prod.id === item.productId);
                    const prodName = item.productName || (p ? p.prodName : (item.kitSnapshot?.productName || '(已刪除產品)'));
                    const deliveryTime = item.deliveryTime || p?.deliveryTime || '未知';
                    const supplierName = item.supplierName || order.supplierName || (p ? data.suppliers.find(s=>s.id === p.supplierId)?.name : '');
                    const taxStatus = item.taxStatus || '含稅';

                    // 計算該行的小計顯示 (僅供參考)
                    const lineTotal = orderAmounts.lines[idx]?.totalAmount || 0;

                    itemsHtml += `
                        <div class="flex flex-col md:flex-row gap-2 items-start md:items-center py-2 border-b last:border-0 border-gray-100 bg-gray-50/50 p-2 rounded mb-1">
                            <div class="flex-1">
                                <div class="font-bold text-gray-700">${prodName}</div>
                                ${item.kitSnapshot ? `<div class="text-xs text-orange-700">採購組合包（收貨時拆套入庫）</div>` : ''}
                                <div class="text-xs text-gray-400">
                                    ${supplierName} | 交期: ${deliveryTime}
                                </div>
                                ${item.sourceCurrency === 'RMB' ? `<div class="text-xs text-gray-500">原幣單價 RMB ${formatProductPrice(item.sourceUnitPrice)}，匯率 1 RMB = ${item.exchangeRate} NTD；換算單價 NTD $${formatProductPrice(item.customPrice)}</div>` : ''}
                                ${item.kitSnapshot ? `<div class="text-xs text-orange-700 mt-1">下單 BOM：${(item.kitSnapshot.components || []).map(component => `${component.productName} × ${component.quantity}`).join('、')}</div>` : ''}
                                ${(item.spec || p?.spec || item.kitSnapshot?.spec) ? `<div class="text-xs text-gray-600 bg-blue-50 inline-block px-2 py-1 rounded mt-1"><strong>規格:</strong> ${item.spec || p?.spec || item.kitSnapshot.spec}</div>` : ''}
                                <div class="flex gap-2 mt-1">
                                    <input type="text" value="${item.customNote || ''}" placeholder="備註..." 
                                        class="text-xs p-1 border rounded w-full md:w-48 bg-white"
                                        onchange="updateOrderItem('${order.id}', ${idx}, 'customNote', this.value)">
                                </div>
                            </div>
                            <div class="flex flex-wrap gap-2 items-center">
                                <div class="flex flex-col">
                                    <span class="text-[10px] text-gray-500">單價（NTD）</span>
                                    <input type="number" step="0.01" value="${item.customPrice}" 
                                        class="w-20 p-1 text-sm border rounded text-right"
                                        onchange="updateOrderItem('${order.id}', ${idx}, 'customPrice', this.value)">
                                </div>
                                <div class="flex flex-col">
                                    <span class="text-[10px] text-gray-500">數量</span>
                                    <input type="number" min="1" value="${item.quantity}" 
                                        class="w-16 p-1 text-sm border rounded text-center"
                                        onchange="updateOrderItem('${order.id}', ${idx}, 'quantity', this.value)">
                                </div>
                                <div class="flex flex-col">
                                    <span class="text-[10px] text-gray-500">稅別</span>
                                    <select class="p-1 text-xs border rounded w-20"
                                            onchange="updateOrderItem('${order.id}', ${idx}, 'taxStatus', this.value)">
                                        <option value="含稅" ${taxStatus==='含稅'?'selected':''}>含稅</option>
                                        <option value="不含稅" ${taxStatus==='不含稅'?'selected':''}>未稅</option>
                                        <option value="不計稅" ${taxStatus==='不計稅'?'selected':''}>不計稅</option>
                                    </select>
                                </div>
                                <div class="flex flex-col">
                                    <span class="text-[10px] text-gray-500">運費（NTD）</span>
                                    <input type="number" min="0" step="0.01" value="${item.customShipping}" 
                                        class="w-16 p-1 text-sm border rounded text-right"
                                        onchange="updateOrderItem('${order.id}', ${idx}, 'customShipping', this.value)">
                                </div>
                            </div>
                            <div class="text-right min-w-[80px]">
                                <div class="font-mono text-sm font-bold text-blue-700">$${Math.round(lineTotal).toLocaleString()}</div>
                                ${taxStatus==='不含稅' ? '<span class="text-[10px] text-red-500">(含稅)</span>' : ''}
                            </div>
                            <button onclick="deleteOrderItem('${order.id}', ${idx})" class="text-gray-400 hover:text-red-600 hover:bg-red-50 p-1 rounded" title="刪除此項目${lineTotal === 0 ? ' (金額為0)' : ''}">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                    <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                                </svg>
                            </button>
                        </div>
                    `;
                });

                const div = document.createElement('div');
                div.className = `order-card card p-3 ${borderColor}`;
                
                div.innerHTML = `
                    <div class="flex flex-col md:flex-row justify-between md:items-center mb-2 pb-3 border-b border-gray-100">
                        <div class="mb-2 md:mb-0">
                            <div class="flex flex-col gap-1">
                                <div class="text-xs text-gray-400 font-mono">
                                    訂單編號: ${order.id} | 建檔時間: ${createdDateDisplay}
                                </div>
                                <div class="flex flex-wrap items-center gap-2 mt-1">
                                    <label class="text-sm font-bold text-gray-700">下單日:</label>
                                    <input type="date" value="${order.date}" 
                                        class="text-sm border rounded px-2 py-0.5 focus:ring-2 focus:ring-blue-500 bg-white"
                                        onchange="updateOrderMeta('${order.id}', 'date', this.value)">
                                    <span class="text-xs ${estimatedDateClass}">預估到貨：${estimatedDate}</span>
                                    <label class="flex items-center gap-1 text-xs font-semibold text-slate-600">
                                        實際到貨
                                        <input type="date" value="${order.arrivalDate || ''}" title="實際到貨日"
                                            class="text-sm border rounded px-2 py-0.5 font-normal"
                                            onchange="updateOrderMeta('${order.id}', 'arrivalDate', this.value)">
                                    </label>
                                </div>
                            </div>
                        </div>
                        <div class="flex flex-wrap items-center gap-3 justify-end mt-2 md:mt-0">
                            <!-- v10.0: 付款狀態選單 -->
                            <div class="flex items-center gap-1">
                                <span class="text-xs font-bold text-gray-500">付款:</span>
                                ${hasLinkedPayable ? `<span class="rounded border px-2 py-1 text-xs font-bold ${payClass}">${purchasePaymentLabels[effectivePaymentStatus] || effectivePaymentStatus}（應付）</span>` : `<select onchange="updateOrderMeta('${order.id}', 'paymentStatus', this.value)" 
                                        class="text-sm border rounded p-1 font-bold cursor-pointer outline-none ${payClass}">
                                    <option value="unpaid" ${order.paymentStatus === 'unpaid'?'selected':''}>未付款</option>
                                    <option value="paid" ${order.paymentStatus === 'paid'?'selected':''}>已付款</option>
                                    <option value="monthly" ${order.paymentStatus === 'monthly'?'selected':''}>月結</option>
                                    <option value="刷卡" ${order.paymentStatus === '刷卡'?'selected':''}>刷卡</option>
                                    <option value="匯款" ${order.paymentStatus === '匯款'?'selected':''}>匯款</option>
                                    <option value="現金" ${order.paymentStatus === '現金'?'selected':''}>現金</option>
                                </select>`}
                                ${hasLinkedPayable ? '' : `<details class="order-advanced-fields">
                                    <summary>付款詳情</summary>
                                    <div class="order-payment-details">
                                        <label class="text-xs text-gray-500">付款日期
                                            <input type="date" title="付款日期" value="${order.paymentDate || ''}" 
                                                class="text-sm border rounded p-1 w-32" 
                                                onchange="updateOrderMeta('${order.id}', 'paymentDate', this.value)">
                                        </label>
                                        <label class="text-xs text-gray-500">刷卡認證碼
                                            <input type="text" title="刷卡認證碼" value="${order.cardAuthCode || ''}" placeholder="刷卡認證碼"
                                                class="text-sm border rounded p-1 w-32" 
                                                onchange="updateOrderMeta('${order.id}', 'cardAuthCode', this.value)">
                                        </label>
                                    </div>
                                </details>`}
                            </div>

                            <span class="px-3 py-1 rounded-full text-sm font-bold border ${statusColor}">${statusBadge}</span>
                            
                            <!-- v11.1 升級後的狀態選單 -->
                            <select onchange="updateOrderStatus('${order.id}', this.value)" class="text-sm border rounded p-1 bg-white">
                                <option value="ordered" ${order.status === 'ordered'?'selected':''}>變更: 已下單</option>
                                <option value="partial_shipped" ${order.status === 'partial_shipped'?'selected':''}>變更: 部分出貨</option>
                                <option value="partially_received" ${order.status === 'partially_received'?'selected':''}>變更: 部分收貨</option>
                                <option value="shipped" ${order.status === 'shipped'?'selected':''}>變更: 全部出貨</option>
                                <option value="arrived" ${order.status === 'arrived'?'selected':''}>變更: 已收貨</option>
                                <option value="completed" ${order.status === 'completed'?'selected':''}>變更: 已驗收完成</option>
                                <option value="cancelled" ${order.status === 'cancelled'?'selected':''}>變更: 已取消(退)</option>
                            </select>

                            <button onclick="transferOrderToInventory('${order.id}')" class="px-3 py-1 rounded text-sm font-bold ${transferButtonClasses} ml-2" ${inventoryCanTransfer ? '' : 'disabled'}>
                                ${transferButtonLabel}
                            </button>
                            ${undoTransferButtonHtml}
                            ${payableButtonHtml}

                            <button onclick="deleteOrder('${order.id}')" class="text-gray-400 hover:text-red-500 ml-2">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                    <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    <!-- 訂單資訊編輯區塊 -->
                    <details class="advanced-panel order-advanced">
                        <summary>進階訂單資料：單號、物流與溝通紀錄</summary>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 mt-3 bg-gray-50 p-3 rounded">
                        <div>
                             <label class="block text-xs font-bold text-gray-500 mb-1">供應商(訂單)單號</label>
                             <input type="text" value="${order.originalOrderNo || ''}" placeholder="輸入供應商單號..."
                                class="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:bg-white"
                                onchange="updateOrderMeta('${order.id}', 'originalOrderNo', this.value)">
                        </div>
                        <!-- v11.0 新增: 報價單號 -->
                        <div>
                             <label class="block text-xs font-bold text-gray-500 mb-1">報價單號</label>
                             <input type="text" value="${order.quotationNo || ''}" placeholder="輸入報價單號..."
                                class="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:bg-white"
                                onchange="updateOrderMeta('${order.id}', 'quotationNo', this.value)">
                        </div>
                        <div>
                             <label class="block text-xs font-bold text-gray-500 mb-1">供應商發票號碼</label>
                             <input type="text" value="${order.invoiceNumber || ''}" placeholder="輸入發票號..."
                                class="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:bg-white"
                                onchange="updateOrderMeta('${order.id}', 'invoiceNumber', this.value)">
                        </div>
                        <div>
                             <label class="block text-xs font-bold text-gray-500 mb-1">發票日期</label>
                             <input type="date" value="${order.supplierInvoiceDate || ''}"
                                class="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:bg-white"
                                onchange="updateOrderMeta('${order.id}', 'supplierInvoiceDate', this.value)">
                        </div>
                        <div>
                             <label class="block text-xs font-bold text-gray-500 mb-1">物流商</label>
                             <input type="text" value="${order.logisticsProvider || ''}" placeholder="例如: 黑貓/順豐"
                                class="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:bg-white"
                                onchange="updateOrderMeta('${order.id}', 'logisticsProvider', this.value)">
                        </div>
                         <div>
                             <label class="block text-xs font-bold text-gray-500 mb-1">物流單號</label>
                             <input type="text" value="${order.trackingNumber || ''}" placeholder="輸入追蹤碼..."
                                class="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:bg-white"
                                onchange="updateOrderMeta('${order.id}', 'trackingNumber', this.value)">
                        </div>
                        <div>
                             <label class="block text-xs font-bold text-gray-500 mb-1">出貨日</label>
                             <input type="date" value="${order.shipDate || ''}"
                                class="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:bg-white"
                                onchange="updateOrderMeta('${order.id}', 'shipDate', this.value)">
                        </div>
                        <div>
                             <label class="block text-xs font-bold text-gray-500 mb-1">訂單折扣 (折抵總額)</label>
                             <input type="number" value="${order.discount || 0}" placeholder="0"
                                class="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:bg-white text-red-600 font-bold"
                                onchange="updateOrderMeta('${order.id}', 'discount', this.value)">
                        </div>
                        <div>
                             <label class="block text-xs font-bold text-gray-500 mb-1">訂單備註 (溝通紀錄)</label>
                             <textarea rows="4" placeholder="紀錄廠商溝通細節..."
                                class="w-full resize-y border border-gray-300 rounded px-2 py-1 text-sm focus:bg-white"
                                onchange="updateOrderMeta('${order.id}', 'orderNote', this.value)">${escapeFinanceHtml(order.orderNote || '')}</textarea>
                        </div>
                    </div>
                    </details>

                    <div class="px-2 mb-3">
                        <div class="text-xs font-bold text-gray-500 mb-2">訂單明細 (修改數值後自動更新金額)</div>
                        ${itemsHtml}
                    </div>
                    
                    <div class="flex justify-end items-center pt-2 border-t text-sm">
                        <div class="text-right space-y-1">
                            <div class="text-gray-500 flex justify-end gap-4">
                                <span>銷售額(未稅+運費): $${totalNetSales.toLocaleString('zh-TW')}</span>
                                <span>稅額 (5%): $${totalTaxAmount.toLocaleString('zh-TW')}</span>
                            </div>
                            ${discount > 0 ? `<div class="text-red-500">折扣: -$${Math.round(discount).toLocaleString()}</div>` : ''}
                            <div class="text-xl font-bold text-blue-800 border-t pt-1 mt-1">應付總額: $${Math.round(totalPayable).toLocaleString()}</div>
                        </div>
                    </div>
                `;
                container.appendChild(div);
            });
        }

        function updateOrderItem(orderId, itemIndex, field, value) {
            const order = data.orders.find(o => o.id === orderId);
            if (!order || !order.items[itemIndex]) return;
            const hasReceipts = order.inventoryTransferred || (data.goodsReceipts || []).some(receipt => receipt.orderId === orderId);
            if (hasReceipts && ['customPrice', 'quantity', 'customShipping', 'taxStatus'].includes(field)) {
                renderOrders();
                return showToast('此訂單已有收貨紀錄，數量與成本條件已鎖定。', 'bg-red-500');
            }
            if ((data.accountsPayable || []).some(document => document.sourceOrderId === orderId) &&
                ['customPrice', 'quantity', 'customShipping', 'taxStatus'].includes(field)) {
                renderOrders();
                return showToast('此訂單已轉為應付單，品項金額與數量已鎖定。', 'bg-red-500');
            }

            // 深拷貝一份訂單以計算新金額
            const tempOrder = JSON.parse(JSON.stringify(order));
            const item = tempOrder.items[itemIndex];

            // 數值轉換
            let newVal = value;
            if (field === 'customPrice' || field === 'customShipping') newVal = parseFloat(value) || 0;
            if (field === 'quantity') newVal = parseInt(value) || 1;
            
            // 更新暫存值
            item[field] = newVal;

            // 計算原總額
            const oldTotal = calculateOrderTotal(order);
            // 計算新總額
            const newTotal = calculateOrderTotal(tempOrder);

            // 如果金額有變動，跳出確認框
            if (oldTotal !== newTotal) {
                if (confirm(`修改此項目將導致訂單總金額由 $${Math.round(oldTotal)} 變更為 $${Math.round(newTotal)}。\n\n確定要更新嗎？`)) {
                     // 使用者確認，寫入真實資料
                     order.items[itemIndex][field] = newVal;
                     saveData();
                     renderOrders();
                     showToast('訂單明細與金額已更新', 'bg-blue-600');
                } else {
                    // 使用者取消，重繪介面以還原數值
                    renderOrders();
                }
            } else {
                // 金額無變動 (例如只改備註)，直接存檔
                order.items[itemIndex][field] = newVal;
                saveData();
                // 只有備註不一定要重繪整個列表，但為了保險起見還是重繪
                if (field !== 'customNote') renderOrders(); 
            }
        }

        // v11.3 更新 Helper: 符合新稅務邏輯
        function calculateOrderTotal(order) {
            const amounts = calculateFinanceDocumentAmounts(order.items.map(item => ({
                unitPrice: item.customPrice || 0,
                quantity: item.quantity || 1,
                shipping: item.customShipping || 0,
                taxStatus: item.taxStatus || '含稅'
            })));
            return Math.max(0, amounts.totalAmount - Math.round(order.discount || 0));
        }

        function updateOrderStatus(orderId, status) {
            const order = data.orders.find(o => o.id === orderId);
            if (order) {
                const hasReceipts = order.inventoryTransferred || (data.goodsReceipts || []).some(receipt => receipt.orderId === orderId);
                if (hasReceipts && status === 'cancelled') {
                    renderOrders();
                    return showToast('此訂單已有收貨紀錄，請先逐筆撤銷收貨後再取消。', 'bg-red-500');
                }
                if (status === 'partially_received' && !order.items.some(item => Number(item.acceptedQuantity) > 0)) {
                    renderOrders();
                    return showToast('尚未驗收任何品項，不能設定為部分收貨。', 'bg-red-500');
                }
                if (['arrived', 'completed', 'closed'].includes(status) &&
                    order.items.some(item => Number(item.acceptedQuantity ?? (order.inventoryTransferred ? item.quantity : 0)) < Number(item.quantity || 0))) {
                    renderOrders();
                    return showToast('尚有未驗收合格數量，請先至「收貨驗收」完成收貨。', 'bg-red-500');
                }
                const hasPayableDocuments = (data.accountsPayable || []).some(document => document.sourceOrderId === orderId);
                if (hasPayableDocuments && !['arrived', 'completed', 'closed'].includes(status)) {
                    renderOrders();
                    return showToast('此訂單已建立應付單，狀態需維持已收貨或已驗收完成。', 'bg-red-500');
                }
                if (status === 'cancelled' && order.status !== 'cancelled' &&
                    !confirm(`確定要將訂單 ${order.id} 標記為已取消嗎？`)) {
                    renderOrders();
                    return;
                }
                order.status = status;
                saveData();
                renderOrders();
                showToast('訂單狀態已更新', 'bg-blue-500');
            }
        }

        function updateOrderMeta(orderId, field, value) {
            const order = data.orders.find(o => o.id === orderId);
            if (order) {
                if (field === 'discount' && (data.accountsPayable || []).some(document => document.sourceOrderId === orderId)) {
                    renderOrders();
                    return showToast('此訂單已轉為應付單，折扣金額已鎖定。', 'bg-red-500');
                }
                if (field === 'discount') {
                    const oldTotal = calculateOrderTotal(order);
                    const tempOrder = JSON.parse(JSON.stringify(order));
                    tempOrder.discount = parseFloat(value) || 0;
                    const newTotal = calculateOrderTotal(tempOrder);

                    if (confirm(`修改折扣將導致訂單總金額由 $${Math.round(oldTotal)} 變更為 $${Math.round(newTotal)}。\n確定要更新嗎？`)) {
                         order[field] = parseFloat(value) || 0;
                         saveData();
                         renderOrders();
                         return;
                    } else {
                        renderOrders();
                        return;
                    }
                }
                order[field] = value;
                saveData();
                if (field === 'date' || field === 'paymentStatus') { // 更新渲染
                    renderOrders();
                }
            }
        }

        // v11.8: 新增訂單項目刪除功能 (金額為0的品項可刪除)
        function deleteOrderItem(orderId, itemIndex) {
            const order = data.orders.find(o => o.id === orderId);
            if (!order || !order.items[itemIndex]) return;
            if (order.inventoryTransferred || (data.goodsReceipts || []).some(receipt => receipt.orderId === orderId)) {
                return showToast('此訂單已有收貨紀錄，不能刪除訂單品項。', 'bg-red-500');
            }
            if ((data.accountsPayable || []).some(document => document.sourceOrderId === orderId)) {
                return showToast('此訂單已轉為應付單，不能刪除訂單品項。', 'bg-red-500');
            }

            const item = order.items[itemIndex];
            const price = item.customPrice || 0;
            const qty = item.quantity || 1;
            const shipping = item.customShipping || 0;
            const taxStatus = item.taxStatus || '含稅';
            
            // 計算該項目的金額
            const itemBase = (price * qty) + shipping;
            let itemTotal = itemBase;
            if (taxStatus === '不含稅') {
                itemTotal = itemBase * 1.05;
            }

            // 構建提示消息
            let message = '';
            const p = data.products.find(prod => prod.id === item.productId);
            const prodName = p ? p.prodName : '(已刪除產品)';
            
            if (itemTotal === 0) {
                message = `確定要刪除此品項嗎？\n\n產品: ${prodName}\n金額: $0 (金額為零)\n\n此操作無法復原。`;
            } else {
                message = `確定要刪除此品項嗎？\n\n產品: ${prodName}\n金額: $${Math.round(itemTotal).toLocaleString()}\n\n此操作無法復原。`;
            }

            if (confirm(message)) {
                // 移除該項目
                order.items.splice(itemIndex, 1);
                
                // 如果訂單已無項目，詢問是否刪除整個訂單
                if (order.items.length === 0) {
                    showToast('訂單明細已全部刪除，該訂單將自動移除', 'bg-orange-500');
                    data.orders = data.orders.filter(o => o.id !== orderId);
                } else {
                    showToast(`已刪除品項: ${prodName}`, 'bg-green-600');
                }
                
                saveData();
                renderOrders();
            }
        }

        function deleteOrder(orderId) {
            const order = data.orders.find(item => item.id === orderId);
            if (order?.inventoryTransferred || (data.goodsReceipts || []).some(receipt => receipt.orderId === orderId)) {
                return showToast('此訂單已有收貨紀錄，請先逐筆撤銷收貨。', 'bg-red-500');
            }
            if ((data.accountsPayable || []).some(document => document.sourceOrderId === orderId)) {
                return showToast('此訂單已建立應付單，不能刪除來源訂單。', 'bg-red-500');
            }
            if (confirm('確定要刪除這筆訂單記錄嗎？')) {
                data.orders = data.orders.filter(o => o.id !== orderId);
                saveData();
                renderOrders();
            }
        }
        function exportCartToExcel() {
            if (!data.cart || data.cart.length === 0) return showToast('清單為空，無法匯出', 'bg-red-500');
            
            const exportData = [];
            const headers = ["供應商", "產品名稱", "規格", "交期", "數量", "原幣單價", "稅別", "原幣運費", "備註", "小計(NTD)", "幣別", "匯率（1 外幣 = NTD）", "換算單價(NTD)", "換算運費(NTD)"];
            exportData.push(headers);
            const cartAmounts = calculateFinanceDocumentAmounts(data.cart.map(item => {
                const currency = item.currency || 'NTD';
                const exchangeRate = currency === 'NTD' ? 1 : Number(item.exchangeRate);
                return {
                    unitPrice: convertCurrencyToNtd(Number(item.customPrice) || 0, currency, exchangeRate),
                    quantity: Number(item.quantity) || 1,
                    shipping: convertCurrencyToNtd(Number(item.customShipping) || 0, currency, exchangeRate),
                    taxStatus: item.taxStatus || '含稅'
                };
            }));
            
            data.cart.forEach((item, index) => {
                const p = data.products.find(prod => prod.id === item.productId);
                if (!p) return;
                const supplier = data.suppliers.find(s => s.id === p.supplierId)?.name || '未知';
                
                const currency = item.currency || 'NTD';
                const exchangeRate = currency === 'NTD' ? 1 : Number(item.exchangeRate);
                const price = parseFloat(item.customPrice);
                const qty = parseInt(item.quantity);
                const taxStatus = item.taxStatus || '含稅';
                const unitPriceNtd = convertCurrencyToNtd(price, currency, exchangeRate);
                const shippingNtd = convertCurrencyToNtd(Number(item.customShipping) || 0, currency, exchangeRate);
                const subtotal = cartAmounts.lines[index]?.totalAmount || 0;

                exportData.push([
                    supplier,
                    p.prodName,
                    p.spec || '',
                    p.deliveryTime || '',
                    qty,
                    price,
                    taxStatus,
                    item.customShipping,
                    item.customNote || '',
                    subtotal,
                    currency,
                    exchangeRate,
                    unitPriceNtd,
                    shippingNtd
                ]);
            });

            saveAsExcel(exportData, "採購清單", `採購清單匯出_${getTodayStr()}.xlsx`);
            showToast('已下載採購清單 Excel', 'bg-green-600');
        }

        function exportInvoiceExcel() {
            if (!data.orders || data.orders.length === 0) return showToast('無訂單資料可匯出', 'bg-red-500');

            const exportData = [];
            const headers = ["訂單編號", "出貨日", "到貨日", "產品名稱", "規格", "數量", "成交單價(NTD)", "發票日期", "發票號碼", "供應商", "原幣", "匯率（1 外幣 = NTD）", "原幣單價", "原幣運費"];
            exportData.push(headers);

            data.orders.forEach(order => {
                order.items.forEach(item => {
                    const p = data.products.find(prod => prod.id === item.productId);
                    const prodName = p ? p.prodName : (item.kitSnapshot?.productName || '(已刪除)');
                    const spec = p?.spec || item.kitSnapshot?.spec || '';
                    const supplierName = p ? (data.suppliers.find(s => s.id === p.supplierId)?.name) : '未知';

                    exportData.push([
                        order.id,
                        order.shipDate || '',
                        order.arrivalDate || '',
                        prodName,
                        spec,
                        item.quantity,
                        item.customPrice,
                        order.supplierInvoiceDate || '',
                        order.invoiceNumber || '',
                        supplierName,
                        item.sourceCurrency || item.currency || 'NTD',
                        item.exchangeRate || 1,
                        item.sourceUnitPrice ?? item.customPrice,
                        item.sourceShipping ?? item.customShipping
                    ]);
                });
            });

            saveAsExcel(exportData, "發票明細", `發票明細匯出_${getTodayStr()}.xlsx`);
            showToast('已下載發票明細 Excel', 'bg-green-600');
        }
