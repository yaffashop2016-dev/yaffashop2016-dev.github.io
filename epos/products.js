        // 產品表單處理 (新增 - 原始頁籤)
        function isKitProduct(product) {
            return product?.productType === 'kit';
        }

        function getProductTypeFromForm(formData) {
            if (formData.get('productType') !== 'combination') return 'standard';
            return formData.get('compositionMode') === 'sales-bundle' ? 'sales-bundle' : 'kit';
        }

        function updateProductCurrencyFields(form, currencyChanged = false) {
            const currency = form?.elements.namedItem('currency');
            const exchangeRate = form?.elements.namedItem('exchangeRate');
            if (!currency || !exchangeRate) return;
            if (currencyChanged && currency.value === 'RMB') exchangeRate.value = '';
            exchangeRate.disabled = currency.value !== 'RMB';
            exchangeRate.required = currency.value === 'RMB';
            if (currency.value !== 'RMB') exchangeRate.value = '1';
        }

        function readProductCurrency(formData) {
            const currency = formData.get('currency') === 'RMB' ? 'RMB' : 'NTD';
            const exchangeRate = currency === 'NTD' ? 1 : Number(formData.get('exchangeRate'));
            if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
                showToast('人民幣產品請輸入大於 0 的匯率（1 RMB = NTD）。', 'bg-red-500');
                return null;
            }
            return { currency, exchangeRate };
        }

        function getSalesPriceHistory(previous, nextPrice, changedAt) {
            const history = Array.isArray(previous?.salesPriceHistory) ? previous.salesPriceHistory : [];
            if (!previous) return history;
            const previousValue = previous.salesPrice === '' || previous.salesPrice == null
                ? null
                : Number(previous.salesPrice);
            const nextValue = nextPrice === '' ? null : Number(nextPrice);
            if (previousValue === nextValue) return history.slice(-2);
            return [...history, {
                from: previous.salesPrice ?? '',
                to: nextPrice,
                changedAt
            }].slice(-2);
        }

        function formatProductPrice(value) {
            return (Number(value) || 0).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
        }

        function renderSalesPriceHistory(product) {
            const container = document.getElementById('editProductSalesPriceHistory');
            if (!container) return;
            const history = (product.salesPriceHistory || []).slice(-2).reverse();
            if (!history.length) {
                container.textContent = '尚無售價異動';
                return;
            }
            container.replaceChildren(...history.map(change => {
                const row = document.createElement('div');
                const from = change.from === '' || change.from == null ? '未設定' : `$${formatProductPrice(change.from)}`;
                const to = change.to === '' || change.to == null ? '未設定' : `$${formatProductPrice(change.to)}`;
                const date = change.changedAt ? new Date(change.changedAt).toLocaleString('zh-TW') : '時間未記錄';
                row.textContent = `${date}：${from} → ${to}`;
                return row;
            }));
        }

        function toggleProductCompositionFields(typeId, kitFieldsId, salesFieldsId, modeFieldsId, modeId) {
            const type = document.getElementById(typeId)?.value;
            const mode = document.getElementById(modeId)?.value;
            const isCombination = type === 'combination';
            document.getElementById(modeFieldsId)?.classList.toggle('hidden', !isCombination);
            document.getElementById(kitFieldsId)?.classList.toggle('hidden', !isCombination || mode !== 'kit');
            document.getElementById(salesFieldsId)?.classList.toggle('hidden', !isCombination || mode !== 'sales-bundle');
        }

        function addKitComponentRow(containerId, component = {}) {
            const container = document.getElementById(containerId);
            if (!container) return;
            const row = document.createElement('div');
            row.className = 'grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_100px_120px_auto] gap-2 items-center';

            const productPicker = document.createElement('div');
            productPicker.className = 'relative w-full';
            const productSearch = document.createElement('input');
            productSearch.type = 'search';
            productSearch.className = 'kit-component-search w-full p-2 border rounded bg-white';
            productSearch.placeholder = '搜尋產品名稱後點選...';
            productSearch.setAttribute('aria-label', '搜尋組合單品名稱');
            const productIdInput = document.createElement('input');
            productIdInput.type = 'hidden';
            productIdInput.className = 'kit-component-product';
            const selectedProductLabel = document.createElement('span');
            selectedProductLabel.className = 'kit-component-selected mt-1 block text-[11px] text-teal-700';
            const productResults = document.createElement('div');
            productResults.className = 'kit-component-results absolute z-20 mt-1 hidden max-h-56 w-full overflow-y-auto rounded border border-gray-200 bg-white shadow-lg';
            const selectedProduct = data.products.find(product => product.id === component.productId &&
                !isKitProduct(product) && !isSalesBundleProduct(product));
            const getProductDescription = product => {
                const supplier = data.suppliers.find(item => item.id === product.supplierId)?.name || '未知供應商';
                return [product.prodName || '未命名產品', product.spec, supplier, product.id].filter(Boolean).join(' · ');
            };
            if (selectedProduct) {
                productSearch.value = selectedProduct.prodName || '';
                selectedProductLabel.textContent = `已選：${getProductDescription(selectedProduct)}`;
            }

            const renderProductResults = () => {
                const keyword = productSearch.value.trim().toLocaleLowerCase();
                productResults.replaceChildren();
                if (!keyword) {
                    productResults.classList.add('hidden');
                    return;
                }

                const matches = data.products.filter(product => {
                    if (isKitProduct(product) || isSalesBundleProduct(product)) return false;
                    return (product.prodName || '').toLocaleLowerCase().includes(keyword) ||
                        (product.spec || '').toLocaleLowerCase().includes(keyword) ||
                        (product.id || '').toLocaleLowerCase().includes(keyword);
                });
                if (matches.length === 0) {
                    const emptyMessage = document.createElement('div');
                    emptyMessage.className = 'px-3 py-2 text-sm text-gray-500';
                    emptyMessage.textContent = '找不到符合的單品';
                    productResults.appendChild(emptyMessage);
                    productResults.classList.remove('hidden');
                    return;
                }

                matches.slice(0, 30).forEach(product => {
                    const supplier = data.suppliers.find(item => item.id === product.supplierId)?.name || '未知供應商';
                    const option = document.createElement('button');
                    option.type = 'button';
                    option.className = 'block w-full border-b border-gray-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-orange-50';
                    const name = document.createElement('span');
                    name.className = 'block font-semibold text-gray-800';
                    name.textContent = product.prodName || '未命名產品';
                    const details = document.createElement('span');
                    details.className = 'block text-xs text-gray-500';
                    details.textContent = [product.spec, supplier, product.id].filter(Boolean).join(' · ');
                    option.append(name, details);
                    option.addEventListener('click', () => {
                        productIdInput.value = product.id;
                        productSearch.value = product.prodName || '';
                        selectedProductLabel.textContent = `已選：${getProductDescription(product)}`;
                        productResults.classList.add('hidden');
                        const purchasePrice = getProductPurchasePriceNtd(product);
                        const defaultWeight = purchasePrice > 0 ? purchasePrice : 1;
                        if (!weightInput.value || !component.productId) weightInput.value = defaultWeight;
                    });
                    productResults.appendChild(option);
                });
                if (matches.length > 30) {
                    const moreMessage = document.createElement('div');
                    moreMessage.className = 'px-3 py-2 text-xs text-gray-500';
                    moreMessage.textContent = `符合 ${matches.length} 項，請輸入更多關鍵字`;
                    productResults.appendChild(moreMessage);
                }
                productResults.classList.remove('hidden');
            };

            productSearch.addEventListener('input', () => {
                productIdInput.value = '';
                selectedProductLabel.textContent = '';
                renderProductResults();
            });
            productSearch.addEventListener('focus', renderProductResults);
            productSearch.addEventListener('keydown', event => {
                if (event.key === 'Escape') productResults.classList.add('hidden');
            });
            productPicker.append(productSearch, selectedProductLabel, productIdInput, productResults);
            if (selectedProduct) productIdInput.value = selectedProduct.id;

            const quantityInput = document.createElement('input');
            quantityInput.type = 'number';
            quantityInput.min = '1';
            quantityInput.step = '1';
            quantityInput.value = component.quantity ?? 1;
            quantityInput.className = 'kit-component-quantity w-full p-2 border rounded';
            quantityInput.setAttribute('aria-label', '每組單品數量');
            quantityInput.title = '每組包含數量';
            const quantityLabel = document.createElement('label');
            quantityLabel.className = 'block';
            const quantityLabelText = document.createElement('span');
            quantityLabelText.className = 'block text-xs text-gray-500 md:hidden';
            quantityLabelText.textContent = '每組數量';
            quantityLabel.append(quantityLabelText, quantityInput);

            const weightInput = document.createElement('input');
            weightInput.type = 'number';
            weightInput.min = '0.0001';
            weightInput.step = 'any';
            const purchasePrice = getProductPurchasePriceNtd(selectedProduct);
            weightInput.value = component.allocationWeight ?? (purchasePrice > 0 ? purchasePrice : 1);
            weightInput.className = 'kit-component-weight w-full p-2 border rounded';
            weightInput.setAttribute('aria-label', '成本分攤權重');
            weightInput.title = '成本分攤權重（用相對比例即可）';
            const weightLabel = document.createElement('label');
            weightLabel.className = 'block';
            const weightLabelText = document.createElement('span');
            weightLabelText.className = 'block text-xs text-gray-500 md:hidden';
            weightLabelText.textContent = '成本權重';
            weightLabel.append(weightLabelText, weightInput);

            const removeButton = document.createElement('button');
            removeButton.type = 'button';
            removeButton.textContent = '移除';
            removeButton.className = 'px-3 py-2 text-red-600 hover:bg-red-50 rounded';
            removeButton.addEventListener('click', () => row.remove());

            row.append(productPicker, quantityLabel, weightLabel, removeButton);
            container.appendChild(row);
        }

        function readKitComponents(containerId) {
            const rows = Array.from(document.getElementById(containerId)?.children || []);
            const components = [];
            const seenProductIds = new Set();
            const requireWeight = !containerId.includes('SalesBundle');
            for (const row of rows) {
                const productId = row.querySelector('.kit-component-product')?.value || '';
                const quantity = Number(row.querySelector('.kit-component-quantity')?.value);
                const weightInput = row.querySelector('.kit-component-weight');
                const allocationWeight = requireWeight ? Number(weightInput?.value) : 1;
                if (!productId || !Number.isInteger(quantity) || quantity <= 0 ||
                    (requireWeight && (!Number.isFinite(allocationWeight) || allocationWeight <= 0))) {
                    return { error: requireWeight
                        ? '請為每個採購組合單品選擇產品，並輸入大於 0 的數量與成本分攤權重。'
                        : '請為每個銷售組合選擇單品並輸入大於 0 的數量。' };
                }
                if (seenProductIds.has(productId)) return { error: '同一產品組合不可重複加入相同單品，請合併其數量。' };
                if (!data.products.some(product => product.id === productId &&
                    !isKitProduct(product) && !isSalesBundleProduct(product))) {
                    return { error: '組合內容只能選擇已建立的一般單品。' };
                }
                seenProductIds.add(productId);
                components.push({ productId, quantity, allocationWeight });
            }
            if (components.length === 0) return { error: '產品組合至少需要一項單品內容。' };
            return { components };
        }

        function createKitSnapshot(product) {
            if (!isKitProduct(product)) return null;
            return {
                productId: product.id,
                productName: product.prodName || '未知組合包',
                spec: product.spec || '',
                components: (product.components || []).map(component => {
                    const componentProduct = data.products.find(item => item.id === component.productId);
                    const supplier = data.suppliers.find(item => item.id === (componentProduct?.supplierId || ''));
                    return {
                        productId: component.productId,
                        productName: componentProduct?.prodName || component.productName || '未知產品',
                        sku: componentProduct?.sku || component.sku || '',
                        spec: componentProduct?.spec || component.spec || '',
                        supplierId: componentProduct?.supplierId || component.supplierId || '',
                        supplierName: supplier?.name || component.supplierName || '未知供應商',
                        unit: componentProduct?.unit || component.unit || 'pcs',
                        quantity: Number(component.quantity),
                        allocationWeight: Number(component.allocationWeight)
                    };
                })
            };
        }

        document.getElementById('productForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const currencyValues = readProductCurrency(formData);
            if (!currencyValues) return;
            const productType = getProductTypeFromForm(formData);
            let components = [];
            if (productType === 'kit') {
                const result = readKitComponents('newKitComponents');
                if (result.error) return showToast(result.error, 'bg-red-500');
                components = result.components;
            } else if (productType === 'sales-bundle') {
                const result = readKitComponents('newSalesBundleComponents');
                if (result.error) return showToast(result.error, 'bg-red-500');
                components = result.components;
            }
            const sku = String(formData.get('sku') || '').trim();
            const barcode = String(formData.get('barcode') || '').trim();
            if (isDuplicateProductIdentifier('sku', sku) || isDuplicateProductIdentifier('barcode', barcode)) {
                return showToast('SKU 或條碼已被其他產品使用。', 'bg-red-500');
            }
            const newProduct = {
                id: generateProductID(),
                supplierId: formData.get('supplierId'),
                prodName: formData.get('prodName'),
                sku,
                barcode,
                category: String(formData.get('category') || '').trim(),
                unit: String(formData.get('unit') || 'pcs').trim(),
                safetyStock: Number(formData.get('safetyStock')) || 0,
                reorderPoint: Number(formData.get('reorderPoint')) || 0,
                isActive: formData.get('isActive') !== 'false',
                productType,
                components,
                brandName: formData.get('brandName'),
                deliveryTime: formData.get('deliveryTime'),
                spec: formData.get('spec'),
                prodUrl: formData.get('prodUrl'),
                purchasePrice: parseFloat(formData.get('purchasePrice')) || 0,
                salesPrice: formData.get('salesPrice') === '' ? '' : parseFloat(formData.get('salesPrice')) || 0,
                price: parseFloat(formData.get('purchasePrice')) || 0,
                ...currencyValues,
                salesPriceHistory: [],
                isTaxIncl: formData.get('isTaxIncl'),
                shipping: parseFloat(formData.get('shipping')) || 0,
                prodNote: formData.get('prodNote'),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            data.products.push(newProduct);
            if (saveData() === false) {
                data.products.pop();
                return showToast('產品資料未能儲存，新增內容已復原。', 'bg-red-500');
            }
            e.target.reset();
            document.getElementById('newKitComponents').innerHTML = '';
            document.getElementById('newKitFields').classList.add('hidden');
            document.getElementById('newSalesBundleComponents').innerHTML = '';
            document.getElementById('newSalesBundleFields').classList.add('hidden');
            document.getElementById('newProductCompositionModeFields').classList.add('hidden');
            showToast('產品報價已儲存！', 'bg-orange-500');
            renderProducts();
        });

        // 表單驗證輔助函數
        function validateField(field) {
            const value = field.value.trim();
            const isRequired = field.hasAttribute('required');
            
            if (isRequired && !value) {
                showFieldError(field, '此欄位為必填');
                return false;
            }
            
            clearFieldError(field);
            return true;
        }
        
        function showFieldError(field, message) {
            clearFieldError(field);
            field.classList.add('border-red-500', 'focus:ring-red-500', 'focus:border-red-500');
            
            const errorDiv = document.createElement('div');
            errorDiv.className = 'text-red-500 text-xs mt-1 error-message';
            errorDiv.textContent = message;
            
            field.parentNode.appendChild(errorDiv);
        }
        
        function clearFieldError(field) {
            field.classList.remove('border-red-500', 'focus:ring-red-500', 'focus:border-red-500');
            
            const errorMessage = field.parentNode.querySelector('.error-message');
            if (errorMessage) {
                errorMessage.remove();
            }
        }
        const editProductForm = document.getElementById('editProductForm');
        if (editProductForm) {
            const requiredFields = ['supplierId', 'prodName'];
            requiredFields.forEach(fieldName => {
                const field = editProductForm[fieldName];
                if (field) {
                    field.addEventListener('blur', () => {
                        validateField(field);
                    });
                }
            });
            
            // 供應商搜尋輸入驗證
            const supplierSearchInput = document.getElementById('editSupplierSearchInput');
            if (supplierSearchInput) {
                supplierSearchInput.addEventListener('blur', () => {
                    const supplierId = document.getElementById('editSupplierId').value;
                    if (!supplierId) {
                        showFieldError(supplierSearchInput, '請選擇有效的供應商');
                    } else {
                        clearFieldError(supplierSearchInput);
                    }
                });
            }
        }
        document.getElementById('editProductForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const originalId = formData.get('id');
            const newId = document.getElementById('editProductId').value.trim();
            const productName = formData.get('prodName');
            const existingProduct = data.products.find(p => p.id === originalId);
            const productType = getProductTypeFromForm(formData);
            const currencyValues = readProductCurrency(formData);
            if (!currencyValues) return;
            const hasReferences = hasProductReferences(originalId);
            if (!newId) {
                showToast('產品編號不可空白。', 'bg-red-500');
                return;
            }
            if (newId !== originalId && hasReferences) {
                showToast('此產品已有產品、報價、訂單、庫存或帳款資料引用，為保留歷史關聯，不可修改產品編號。', 'bg-red-500');
                return;
            }
            if (productType !== (existingProduct?.productType || 'standard') && hasReferences) {
                return showToast('此產品已有庫存、交易或其他產品引用，不可變更產品類型或組合處理方式。', 'bg-red-500');
            }
            let components = [];
            if (productType === 'kit' || productType === 'sales-bundle') {
                const containerId = productType === 'kit' ? 'editKitComponents' : 'editSalesBundleComponents';
                const result = readKitComponents(containerId);
                if (result.error) return showToast(result.error, 'bg-red-500');
                components = result.components;
            } else {
                components = [];
            }
            
            // 檢查產品編號是否重複
            if (checkProductIdDuplicate(newId, originalId)) {
                showToast('產品編號重複，請使用其他編號', 'bg-red-500');
                return;
            }
            const sku = String(formData.get('sku') || '').trim();
            const barcode = String(formData.get('barcode') || '').trim();
            if (isDuplicateProductIdentifier('sku', sku, originalId) || isDuplicateProductIdentifier('barcode', barcode, originalId)) {
                return showToast('SKU 或條碼已被其他產品使用。', 'bg-red-500');
            }
            
            // 確認編輯
            if (!confirm(`確定要修改產品「${productName}」(編號: ${newId}) 的報價資訊嗎？`)) {
                return;
            }
            
            // 顯示載入狀態
            const submitBtn = document.getElementById('editProductSubmitBtn');
            const submitText = document.getElementById('editProductSubmitText');
            const originalText = submitText.textContent;
            submitBtn.disabled = true;
            submitBtn.classList.add('opacity-75', 'cursor-not-allowed');
            submitText.textContent = '更新中...';
            
            try {
                const index = data.products.findIndex(p => p.id === originalId);
                if (index !== -1) {
                    const updatedProduct = {
                        ...data.products[index],
                        id: newId,
                        productType,
                        components,
                        supplierId: formData.get('supplierId'),
                        prodName: formData.get('prodName'),
                        sku,
                        barcode,
                        category: String(formData.get('category') || '').trim(),
                        unit: String(formData.get('unit') || 'pcs').trim(),
                        safetyStock: Number(formData.get('safetyStock')) || 0,
                        reorderPoint: Number(formData.get('reorderPoint')) || 0,
                        isActive: formData.get('isActive') !== 'false',
                        brandName: formData.get('brandName'),
                        deliveryTime: formData.get('deliveryTime'), 
                        spec: formData.get('spec'),
                        prodUrl: formData.get('prodUrl'),
                        purchasePrice: parseFloat(formData.get('purchasePrice')) || 0,
                        salesPrice: formData.get('salesPrice') === '' ? '' : parseFloat(formData.get('salesPrice')) || 0,
                        price: parseFloat(formData.get('purchasePrice')) || 0,
                        ...currencyValues,
                        salesPriceHistory: getSalesPriceHistory(
                            data.products[index],
                            formData.get('salesPrice') === '' ? '' : parseFloat(formData.get('salesPrice')) || 0,
                            new Date().toISOString()
                        ),
                        isTaxIncl: formData.get('isTaxIncl'),
                        shipping: parseFloat(formData.get('shipping')) || 0,
                        prodNote: formData.get('prodNote'),
                        updatedAt: new Date().toISOString()
                    };
                    
                    // 如果是新建產品，設置 createdAt
                    if (!updatedProduct.createdAt) {
                        updatedProduct.createdAt = new Date().toISOString();
                    }
                    
                    data.products[index] = updatedProduct;
                    if (saveData() === false) {
                        data.products[index] = existingProduct;
                        return showToast('產品資料未能儲存，修改內容已復原。', 'bg-red-500');
                    }
                    renderProducts();
                    closeModal('modal-edit-product');
                    showToast('產品報價已更新！', 'bg-orange-600');
                }
            } catch (error) {
                console.error('更新產品失敗:', error);
                showToast('更新失敗，請重試', 'bg-red-500');
            } finally {
                // 恢復按鈕狀態
                submitBtn.disabled = false;
                submitBtn.classList.remove('opacity-75', 'cursor-not-allowed');
                submitText.textContent = originalText;
            }
        });
        function renderProducts() {
            const keyword = getInputValue('searchProduct').toLowerCase();
            const supplierMap = new Map((data.suppliers || []).map(s => [s.id, s.name]));

            const filtered = filterSafe(data.products, p => {
                const supplierName = supplierMap.get(p.supplierId) || '';
                return (p.prodName || '').toLowerCase().includes(keyword) || 
                      ((p.id || '').toLowerCase().includes(keyword)) ||
                       ((p.spec || '').toLowerCase().includes(keyword)) ||
                      ((p.sku || '').toLowerCase().includes(keyword)) ||
                      ((p.barcode || '').toLowerCase().includes(keyword)) ||
                      ((p.category || '').toLowerCase().includes(keyword)) ||
                       supplierName.toLowerCase().includes(keyword);
            });

            renderList('productList', filtered, (fragment, p) => {
                const supplierName = supplierMap.get(p.supplierId) || '';
                const purchasePriceNtd = getProductPurchasePriceNtd(p);
                const shippingNtd = convertCurrencyToNtd(p.shipping || 0, getProductCurrency(p), getProductExchangeRate(p));
                const urlLink = p.prodUrl ? `<a href="${p.prodUrl}" target="_blank" class="text-blue-500 hover:text-blue-700 ml-1 inline-block align-middle" title="開啟產品網頁"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg></a>` : '';
                const tr = document.createElement('tr');
                tr.className = 'border-b hover:bg-gray-50 group';
                tr.innerHTML = `
                    <td class="p-4 align-top">
                        <div class="font-bold text-gray-800 flex items-center">${p.prodName}${urlLink}</div>
                        <div class="text-xs text-slate-500">產品編號 ${escapeFinanceHtml(p.id)} · SKU ${escapeFinanceHtml(p.sku || '-')} · ${escapeFinanceHtml(p.category || '未分類')} · ${escapeFinanceHtml(p.unit || 'pcs')} · ${p.isActive === false ? '停用' : '啟用'}</div>
                        <div class="text-xs ${isKitProduct(p) ? 'text-orange-700 font-semibold' : isSalesBundleProduct(p) ? 'text-emerald-700 font-semibold' : p.packageBaseProductId ? 'text-teal-700 font-semibold' : 'text-gray-500'}">${isKitProduct(p) || isSalesBundleProduct(p) ? `產品組合（${isSalesBundleProduct(p) ? '銷售時扣組成品' : '收貨時拆成單品'}）：${(p.components || []).map(component => { const child = data.products.find(product => product.id === component.productId); return `${child?.prodName || component.productId} × ${component.quantity}`; }).join('、') || '尚未設定內容'}` : p.packageBaseProductId ? `包裝：${p.spec || '無規格'} · 每包 ${p.packageUnitsPerPackage} ${data.products.find(product => product.id === p.packageBaseProductId)?.unit || '件'} · 基礎產品 ${p.packageBaseProductId}` : (p.spec || '無規格')}</div>
                        <div class="product-note text-xs text-gray-400 mt-1">${p.prodNote || ''}</div>
                    </td>
                    <td class="p-4 align-top text-sm">
                        <div class="font-medium">${supplierName ? supplierName : '<span class="text-red-400">未知供應商</span>'}</div>
                    </td>
                    <td class="p-4 align-top text-sm">
                        <span class="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs font-bold">${p.deliveryTime || '未定'}</span>
                    </td>
                    <td class="p-4 align-top font-mono text-blue-600 font-bold">${getProductCurrency(p)} ${formatProductPrice(getProductPurchasePrice(p))}<div class="text-xs font-normal text-gray-500">${Number.isFinite(purchasePriceNtd) ? `約 NTD $${formatProductPrice(purchasePriceNtd)}` : '匯率未設定'}</div></td>
                    <td class="p-4 align-top font-mono text-emerald-700 font-bold">${p.salesPrice === '' || p.salesPrice === undefined ? '未設定' : `NTD $${formatProductPrice(getProductSalesPrice(p))}`}</td>
                    <td class="p-4 align-top text-sm">${p.isTaxIncl}</td>
                    <td class="p-4 align-top text-sm text-gray-500">${getProductCurrency(p)} ${formatProductPrice(p.shipping || 0)}${getProductCurrency(p) === 'RMB' ? `<div class="text-xs">${Number.isFinite(shippingNtd) ? `約 NTD $${formatProductPrice(shippingNtd)}` : '匯率未設定'}</div>` : ''}</td>
                    <td class="p-4 align-top">
                        <div class="flex flex-col gap-2">
                            <button onclick="addToCart('${p.id}')" ${p.isActive === false ? 'disabled' : ''} class="px-3 py-1 ${p.isActive === false ? 'bg-gray-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'} text-white rounded transition text-sm shadow-sm">採購</button>
                            <div class="flex gap-2 text-xs">
                                <button onclick="openEditProduct('${p.id}')" class="text-orange-500 hover:underline">修改</button>
                                <button onclick="deleteProduct('${p.id}')" class="text-red-500 hover:underline">刪除</button>
                            </div>
                        </div>
                    </td>
                `;
                fragment.appendChild(tr);
            }, '<tr><td colspan="8" class="p-8 text-center text-gray-400">沒有符合搜尋條件的產品</td></tr>');
        }

        function openEditProduct(id) {
            const p = data.products.find(item => item.id === id);
            if (!p) return;
            updateSupplierSelect(); 
            const form = document.getElementById('editProductForm');
            const supplier = data.suppliers.find(s => s.id === p.supplierId);
            
            // 顯示產品編號和時間戳
            document.getElementById('editProductId').value = p.id;
            document.getElementById('editProductCreatedAt').textContent = p.createdAt ? new Date(p.createdAt).toLocaleString('zh-TW') : '-';
            document.getElementById('editProductUpdatedAt').textContent = p.updatedAt ? new Date(p.updatedAt).toLocaleString('zh-TW') : '-';
            
            form.id.value = p.id;
            document.getElementById('editSupplierId').value = p.supplierId;
            document.getElementById('editSupplierSearchInput').value = supplier ? supplier.name : '';
            form.prodName.value = p.prodName;
            form.sku.value = p.sku || '';
            form.barcode.value = p.barcode || '';
            form.category.value = p.category || '';
            form.unit.value = p.unit || 'pcs';
            form.safetyStock.value = p.safetyStock || 0;
            form.reorderPoint.value = p.reorderPoint || 0;
            form.isActive.value = p.isActive === false ? 'false' : 'true';
            form.productType.value = isKitProduct(p) || isSalesBundleProduct(p) ? 'combination' : 'standard';
            document.getElementById('editProductCompositionMode').value = isSalesBundleProduct(p) ? 'sales-bundle' : 'kit';
            form.brandName.value = p.brandName || '';
            form.deliveryTime.value = p.deliveryTime || '';
            form.spec.value = p.spec || '';
            form.prodUrl.value = p.prodUrl || '';
            form.purchasePrice.value = getProductPurchasePrice(p);
            form.salesPrice.value = p.salesPrice ?? '';
            form.currency.value = getProductCurrency(p);
            form.exchangeRate.value = getProductExchangeRate(p);
            updateProductCurrencyFields(form);
            form.isTaxIncl.value = p.isTaxIncl || '含稅';
            form.shipping.value = p.shipping || 0;
            form.prodNote.value = p.prodNote || '';
            renderSalesPriceHistory(p);
            const kitFields = document.getElementById('editKitFields');
            kitFields.classList.toggle('hidden', !isKitProduct(p));
            const kitComponents = document.getElementById('editKitComponents');
            kitComponents.innerHTML = '';
            if (isKitProduct(p)) {
                (p.components || []).forEach(component => addKitComponentRow('editKitComponents', component));
            }
            const salesBundleFields = document.getElementById('editSalesBundleFields');
            salesBundleFields.classList.toggle('hidden', !isSalesBundleProduct(p));
            toggleProductCompositionFields(
                'editProductType',
                'editKitFields',
                'editSalesBundleFields',
                'editProductCompositionModeFields',
                'editProductCompositionMode'
            );
            const salesBundleComponents = document.getElementById('editSalesBundleComponents');
            salesBundleComponents.innerHTML = '';
            if (isSalesBundleProduct(p)) {
                (p.components || []).forEach(component => addKitComponentRow('editSalesBundleComponents', component));
            }
            document.getElementById('modal-edit-product').classList.add('modal-active');
        }

        // 產品編號重複檢查函數
        function checkProductIdDuplicate(productId, excludeId = null) {
            return data.products.some(p => p.id === productId && p.id !== excludeId);
        }

        function isDuplicateProductIdentifier(field, value, excludeId = null) {
            if (!value) return false;
            const normalized = value.toLocaleLowerCase();
            return data.products.some(product => product.id !== excludeId &&
                String(product[field] || '').trim().toLocaleLowerCase() === normalized);
        }

        // 產品編號輸入驗證
        const editProductIdInput = document.getElementById('editProductId');
        if (editProductIdInput) {
            editProductIdInput.addEventListener('input', (e) => {
                const newId = e.target.value.trim();
                const originalId = document.getElementById('editProductForm').id.value;
                const errorDiv = document.getElementById('productIdError');
                
                if (newId && checkProductIdDuplicate(newId, originalId)) {
                    errorDiv.classList.remove('hidden');
                    errorDiv.textContent = '此編號已存在，請使用其他編號';
                    e.target.classList.add('border-red-500', 'focus:ring-red-500', 'focus:border-red-500');
                } else {
                    errorDiv.classList.add('hidden');
                    e.target.classList.remove('border-red-500', 'focus:ring-red-500', 'focus:border-red-500');
                }
            });
        }

        function openAddProductModal(supplierId) {
            const s = data.suppliers.find(item => item.id === supplierId);
            if (!s) return;
            
            const form = document.getElementById('addProductDirectForm');
            form.reset(); 
            form.supplierId.value = s.id;
            document.getElementById('directSupplierName').value = s.name;
            
            document.getElementById('modal-add-product-direct').classList.add('modal-active');
        }
        function deleteProduct(id) {
            if (hasProductReferences(id)) {
                return showToast('此產品仍被其他產品或交易資料引用，請先處理相關資料後再刪除。', 'bg-red-500');
            }
            if (confirm('確定刪除此產品報價？')) {
                const previousProducts = data.products;
                data.products = data.products.filter(p => p.id !== id);
                if (saveData() === false) {
                    data.products = previousProducts;
                    return showToast('產品資料未能儲存，刪除已取消。', 'bg-red-500');
                }
                renderProducts();
            }
        }
