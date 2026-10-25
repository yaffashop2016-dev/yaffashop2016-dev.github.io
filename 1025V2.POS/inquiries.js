        // ================= 供應商詢價單邏輯 (v11.5 狀態升級) =================

        function updateSupplierDatalist() {
            const datalist = document.getElementById('supplierListOptions');
            datalist.innerHTML = '';
            data.suppliers.forEach(s => {
                const option = document.createElement('option');
                option.value = s.name; 
                datalist.appendChild(option);
            });
        }

        function selectSupplierForInquiry(supplierName) {
            const supplier = data.suppliers.find(item => item.name === supplierName);
            if (!supplier) return;
            document.getElementById('inquirySupplierName').value = supplier.name;
            document.getElementById('inquirySupplierContact').value = supplier.contact || '';
        }

        function generateInquiryID() {
            const now = new Date();
            const rocYear = now.getFullYear() - 1911;
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const date = String(now.getDate()).padStart(2, '0');
            const datePrefix = `${rocYear}${month}${date}`;
            const sameDayInquiries = (data.supplierInquiries || []).filter(inquiry =>
                /^\d{8}\d{2}$/.test(inquiry.id || '') && inquiry.id.startsWith(datePrefix)
            );
            const maxSequence = sameDayInquiries.reduce((max, inquiry) => {
                const sequence = Number(String(inquiry.id).slice(datePrefix.length));
                return Number.isFinite(sequence) ? Math.max(max, sequence) : max;
            }, 0);

            return `${datePrefix}${String(maxSequence + 1).padStart(2, '0')}`;
        }

        function openCreateInquiryModal() {
            tempInquiryItems = [];
            const inquiryId = generateInquiryID();
            document.getElementById('inquiryId').value = inquiryId;
            document.getElementById('inquiryIdDisplay').value = inquiryId;
            document.getElementById('inquiryModalTitle').innerText = '建立供應商詢價單 (新產品)';
            document.getElementById('inquirySupplierName').value = '';
            document.getElementById('inquirySupplierContact').value = '';
            document.getElementById('inquiryBuyerCompany').value = '';
            document.getElementById('inquiryBuyerContact').value = '';
            document.getElementById('inqItemName').value = '';
            document.getElementById('inqItemSpec').value = '';
            document.getElementById('inqItemQuantity').value = '';
            document.getElementById('inqItemUom').value = '';
            document.getElementById('inquiryNote').value = '';
            // v11.5: 預設狀態
            document.getElementById('inquiryStatus').value = 'waiting';
            
            const today = new Date().toISOString().split('T')[0];
            document.getElementById('inquiryDate').value = today;

            updateSupplierDatalist();
            renderInquiryTempList();
            document.getElementById('modal-create-inquiry').classList.add('modal-active');
        }

        function openEditInquiry(id) {
            const inq = data.supplierInquiries.find(i => i.id === id);
            if (!inq) return;

            document.getElementById('inquiryId').value = inq.id;
            document.getElementById('inquiryIdDisplay').value = inq.id;
            document.getElementById('inquiryModalTitle').innerText = '修改供應商詢價單';
            document.getElementById('inquirySupplierName').value = inq.supplierName;
            document.getElementById('inquirySupplierContact').value = inq.supplierContact || '';
            document.getElementById('inquiryBuyerCompany').value = inq.buyerCompany || '';
            document.getElementById('inquiryBuyerContact').value = inq.buyerContact || '';
            document.getElementById('inquiryDate').value = inq.date;
            document.getElementById('inquiryNote').value = inq.note || '';
            document.getElementById('inqItemName').value = '';
            document.getElementById('inqItemSpec').value = '';
            document.getElementById('inqItemQuantity').value = '';
            document.getElementById('inqItemUom').value = '';
            // v11.5: 載入狀態，舊資料預設 waiting
            document.getElementById('inquiryStatus').value = inq.status || 'waiting';

            tempInquiryItems = JSON.parse(JSON.stringify(inq.items)).map((item, index) => {
                if (inq.convertedItems && inq.convertedItems.includes(index)) {
                    item._converted = true;
                }
                return item;
            });

            updateSupplierDatalist();
            renderInquiryTempList();
            document.getElementById('modal-create-inquiry').classList.add('modal-active');
        }
        
        function openQuickAddSupplier() {
            document.getElementById('quickAddSupplierForm').reset();
            document.getElementById('modal-quick-add-supplier').classList.add('modal-active');
        }

        function addInquiryItemTemp() {
            const name = document.getElementById('inqItemName').value.trim();
            const spec = document.getElementById('inqItemSpec').value.trim();
            const quantity = Number(document.getElementById('inqItemQuantity').value);
            const uom = document.getElementById('inqItemUom').value.trim();
            if(!name) return showToast('請輸入產品或服務名稱', 'bg-red-500');
            if(!Number.isFinite(quantity) || quantity <= 0) return showToast('預估數量須為大於 0 的數字', 'bg-red-500');
            if(!uom) return showToast('請輸入計價單位（UOM）', 'bg-red-500');

            tempInquiryItems.push({ name, spec, quantity, uom });
            document.getElementById('inqItemName').value = '';
            document.getElementById('inqItemSpec').value = '';
            document.getElementById('inqItemQuantity').value = '';
            document.getElementById('inqItemUom').value = '';
            document.getElementById('inqItemName').focus();
            renderInquiryTempList();
        }

        function renderInquiryTempList() {
            const container = document.getElementById('inquiryTempList');
            container.innerHTML = '';
            
            tempInquiryItems.forEach((item, index) => {
                const tr = document.createElement('tr');
                tr.className = 'border-b';
                
                const statusBadge = item._converted 
                    ? '<span class="text-xs bg-green-100 text-green-700 px-1 rounded ml-1">已轉</span>' 
                    : '';

                tr.innerHTML = `
                    <td class="p-2 text-center text-xs font-mono text-indigo-700">${String(index + 1).padStart(2, '0')}</td>
                    <td class="p-2">${item.name} ${statusBadge}</td>
                    <td class="p-2">${item.spec}</td>
                    <td class="p-2 text-right">${item.quantity}</td>
                    <td class="p-2 text-center">${item.uom}</td>
                    <td class="p-2 text-center"><button onclick="removeInquiryTemp(${index})" class="text-red-500 hover:text-red-700">✕</button></td>
                `;
                container.appendChild(tr);
            });
        }

        function removeInquiryTemp(index) {
            tempInquiryItems.splice(index, 1);
            renderInquiryTempList();
        }

        function saveSupplierInquiry() {
            const supplierName = document.getElementById('inquirySupplierName').value.trim();
            const supplierContact = document.getElementById('inquirySupplierContact').value.trim();
            const buyerCompany = document.getElementById('inquiryBuyerCompany').value.trim();
            const buyerContact = document.getElementById('inquiryBuyerContact').value.trim();
            const note = document.getElementById('inquiryNote').value;
            const inquiryId = document.getElementById('inquiryId').value;
            const status = document.getElementById('inquiryStatus').value; // v11.5

            if(!supplierName) return showToast('請輸入供應商名稱', 'bg-red-500');
            if(!buyerCompany) return showToast('請輸入買方公司全稱', 'bg-red-500');
            if(!buyerContact) return showToast('請輸入採購聯絡窗口', 'bg-red-500');
            if(tempInquiryItems.length === 0) return showToast('請至少新增一個項目', 'bg-red-500');

            const cleanItems = [];
            const newConvertedItems = [];

            tempInquiryItems.forEach((item, index) => {
                if (item._converted) {
                    newConvertedItems.push(index);
                }
                cleanItems.push({
                    name: item.name,
                    spec: item.spec,
                    quantity: item.quantity,
                    uom: item.uom
                });
            });

            const inquiryData = {
                id: inquiryId || generateInquiryID(),
                supplierName: supplierName,
                supplierContact,
                buyerCompany,
                buyerContact,
                date: document.getElementById('inquiryDate').value,
                note: note,
                status: status, // v11.5 儲存狀態
                items: cleanItems,
                convertedItems: newConvertedItems 
            };

            const existingIndex = data.supplierInquiries.findIndex(i => i.id === inquiryId);
            if (existingIndex !== -1) {
                data.supplierInquiries[existingIndex] = inquiryData;
                showToast('詢價單已更新', 'bg-indigo-600');
            } else {
                data.supplierInquiries.unshift(inquiryData);
                showToast('供應商詢價單已建立', 'bg-indigo-600');
            }

            saveData();
            closeModal('modal-create-inquiry');
            renderSupplierInquiries();
        }

        // v11.5: 更新 renderSupplierInquiries 支援搜尋與狀態篩選
        function renderSupplierInquiries() {
            const keyword = document.getElementById('searchInquiryKeyword')?.value.toLowerCase() || '';
            const filterStatus = document.getElementById('filterInquiryStatus')?.value || 'all';
            const container = document.getElementById('supplierInquiryList');
            container.innerHTML = '';

            // 篩選邏輯
            const filtered = data.supplierInquiries.filter(inq => {
                const nameMatch = inq.supplierName.toLowerCase().includes(keyword);
                const noteMatch = (inq.note || '').toLowerCase().includes(keyword);
                const idMatch = inq.id.toLowerCase().includes(keyword);
                const itemMatch = (inq.items || []).some(item => (item.name || '').toLowerCase().includes(keyword));
                
                // v11.5 狀態篩選
                const currentStatus = inq.status || 'waiting'; // 舊資料預設為 waiting
                const statusMatch = filterStatus === 'all' || currentStatus === filterStatus;

                return (nameMatch || noteMatch || idMatch || itemMatch) && statusMatch;
            });

            if (filtered.length === 0) {
                container.innerHTML = '<div class="text-center text-gray-400 py-8">沒有符合的詢價紀錄</div>';
                return;
            }

            filtered.forEach(inq => {
                const div = document.createElement('div');
                div.className = 'card p-4 border-l-4 border-indigo-500';
                
                // v11.5 狀態顯示邏輯
                const statusKey = inq.status || 'waiting';
                const statusInfo = inquiryStatusMap[statusKey] || inquiryStatusMap['waiting'];

                const itemCount = inq.items.length;
                const totalQuantity = inq.items.reduce((total, item) => total + (Number(item.quantity) || 0), 0);
                const itemsHtml = inq.items.map((item, idx) => {
                    const isConverted = inq.convertedItems && inq.convertedItems.includes(idx);
                    const quantityText = item.quantity === undefined || item.quantity === null || item.quantity === '' ? '未設定' : item.quantity;
                    const uomText = item.uom || '未設定';
                    return `
                        <div class="flex justify-between items-center py-1 border-b last:border-0 border-gray-100 text-sm">
                            <span class="text-gray-700">▪ ${item.name} <span class="text-gray-400 text-xs">(${item.spec})</span></span>
                            <span class="text-xs text-gray-500">${quantityText} ${uomText}</span>
                            ${isConverted ? 
                                '<span class="text-xs bg-green-100 text-green-700 px-2 rounded">已轉產品</span>' : 
                                `<button onclick="convertInquiryToProduct('${inq.id}', ${idx})" class="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded hover:bg-indigo-200">轉為正式產品</button>`
                            }
                        </div>
                    `;
                }).join('');

                div.innerHTML = `
                    <div class="flex flex-col md:flex-row justify-between md:items-center mb-2 gap-2">
                        <div class="flex items-center gap-2">
                            <h3 class="font-bold text-lg text-gray-800">${inq.supplierName}</h3>
                            <span class="font-mono text-xs text-indigo-700">${inq.id}</span>
                             <!-- v11.5 狀態 Badge -->
                            <span class="text-xs px-2 py-0.5 rounded border ${statusInfo.class} font-bold">${statusInfo.label}</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <div class="text-xs text-gray-500">日期: ${inq.date} · 預計 ${totalQuantity} 單位</div>
                            <!-- v11.5 快速狀態切換選單 -->
                            <select onchange="quickUpdateInquiryStatus('${inq.id}', this.value)" class="text-xs border rounded p-1 bg-white ml-2 text-gray-600 focus:text-indigo-600 outline-none">
                                <option value="waiting" ${statusKey === 'waiting'?'selected':''}>等回覆</option>
                                <option value="replied" ${statusKey === 'replied'?'selected':''}>已回覆</option>
                                <option value="price_high" ${statusKey === 'price_high'?'selected':''}>價格高</option>
                                <option value="no_stock" ${statusKey === 'no_stock'?'selected':''}>無供貨</option>
                                <option value="converted" ${statusKey === 'converted'?'selected':''}>已轉產品</option>
                            </select>
                        </div>
                    </div>
                    <div class="text-xs text-gray-500 mb-2">備註: ${inq.note || '無'}</div>
                    <details class="inquiry-items-panel bg-gray-50 p-2 rounded mb-3 group">
                        <summary class="cursor-pointer select-none text-sm font-semibold text-gray-700 flex items-center justify-between gap-2">
                            <span>詢價產品（${itemCount} 筆）</span>
                            <span class="text-xs font-normal text-indigo-600">點開顯示完整內容</span>
                        </summary>
                        <div class="mt-2 space-y-1">
                            ${itemsHtml}
                        </div>
                    </details>
                    <div class="flex flex-wrap justify-end gap-2 border-t pt-2">
                         <button onclick="exportInquiryExcel('${inq.id}')" class="px-3 py-1 bg-green-50 text-green-600 hover:bg-green-100 rounded text-sm border border-green-200">匯出 Excel</button>
                         <button onclick="openEditInquiry('${inq.id}')" class="px-3 py-1 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded text-sm">修改</button>
                         <button onclick="deleteInquiry('${inq.id}')" class="px-3 py-1 text-red-500 hover:bg-red-50 rounded text-sm">刪除詢價單</button>
                    </div>
                `;
                container.appendChild(div);
            });
        }

        function exportInquiryExcel(inquiryId) {
            const inquiry = data.supplierInquiries.find(item => item.id === inquiryId);
            if (!inquiry) return showToast('找不到詢價單', 'bg-red-500');

            const statusLabel = inquiryStatusMap[inquiry.status || 'waiting']?.label || '等回覆';
            const exportData = [
                ['供應商詢價單'],
                [],
                ['文件控制', ''],
                ['詢價單號', inquiry.id],
                ['詢價日期', inquiry.date],
                ['詢價狀態', statusLabel],
                ['附件／備註', inquiry.note || ''],
                [],
                ['買方公司資訊', ''],
                ['公司全稱', inquiry.buyerCompany || ''],
                ['聯絡窗口', inquiry.buyerContact || ''],
                [],
                ['供應商（受詢廠商）資訊', ''],
                ['廠商名稱', inquiry.supplierName || ''],
                ['廠商聯絡人', inquiry.supplierContact || ''],
                [],
                ['產品或服務規格明細', ''],
                ['項次（Item No.）', '產品或服務名稱', '產品或服務規格', '預估數量（Quantity）', '計價單位（UOM）', '廠商回覆欄位（預留）', '狀態'],
                ...(inquiry.items || []).map((item, index) => [
                    String(index + 1).padStart(2, '0'),
                    item.name,
                    item.spec,
                    item.quantity ?? '',
                    item.uom ?? '',
                    '',
                    inquiry.convertedItems?.includes(index) ? '已轉正式產品' : '尚未轉換'
                ])
            ];

            const fileName = `供應商詢價_${inquiry.id}_${getTodayStr()}.xlsx`;
            saveAsExcel(exportData, '供應商詢價', fileName);
            showToast('個別詢價單匯出成功', 'bg-green-600');
        }
        
        // v11.5 快速更新狀態功能
        function quickUpdateInquiryStatus(id, newStatus) {
            const inq = data.supplierInquiries.find(i => i.id === id);
            if (inq) {
                inq.status = newStatus;
                saveData();
                renderSupplierInquiries(); // 重新渲染以更新顏色
                showToast('詢價單狀態已更新', 'bg-indigo-600');
            }
        }

        function convertInquiryToProduct(inquiryId, itemIndex) {
            const inq = data.supplierInquiries.find(i => i.id === inquiryId);
            if(!inq) return;
            const item = inq.items[itemIndex];

            const form = document.getElementById('addProductDirectForm');
            form.reset();
            
            const existingSupplier = data.suppliers.find(s => s.name === inq.supplierName);
            if (existingSupplier) {
                form.supplierId.value = existingSupplier.id;
                document.getElementById('directSupplierName').value = existingSupplier.name;
            } else {
                alert(`注意：系統中找不到名為「${inq.supplierName}」的供應商資料，請先至供應商管理新增，或於下拉選單選擇現有供應商。`);
                form.supplierId.value = "";
                document.getElementById('directSupplierName').value = `${inq.supplierName} (尚未建立資料)`;
            }

            form.prodName.value = item.name;
            form.spec.value = item.spec;
            form.prodNote.value = `來源: 詢價單 ${inquiryId}`;

            form.dataset.inquiryId = inquiryId;
            form.dataset.inquiryItemIndex = itemIndex;

            document.getElementById('modal-add-product-direct').classList.add('modal-active');
        }

        document.getElementById('addProductDirectForm').onsubmit = (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const currencyValues = readProductCurrency(formData);
            if (!currencyValues) return;
            
            if (!formData.get('supplierId')) {
                const tempName = document.getElementById('directSupplierName').value.replace(' (尚未建立資料)', '');
                if (tempName) {
                    const newSupId = 's_' + Date.now();
                    const now = new Date().toISOString();
                    data.suppliers.push({ 
                        id: newSupId, 
                        name: tempName, 
                        taxId: '', 
                        contact: '', 
                        phone: '', 
                        address: '', 
                        note: '由詢價單自動建立',
                        createdAt: now,
                        updatedAt: now
                    });
                    formData.set('supplierId', newSupId); 
                    updateSupplierDatalist(); 
                } else {
                    return showToast('供應商資料有誤', 'bg-red-500');
                }
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
                isActive: true,
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

            const form = e.target;
            if (form.dataset.inquiryId) {
                const inq = data.supplierInquiries.find(i => i.id === form.dataset.inquiryId);
                if (inq) {
                    if (!inq.convertedItems) inq.convertedItems = [];
                    inq.convertedItems.push(parseInt(form.dataset.inquiryItemIndex));
                    delete form.dataset.inquiryId;
                    delete form.dataset.inquiryItemIndex;
                    
                    // v11.5 優化：若轉換成功，提示是否將整張詢價單改為「已轉正式產品」
                    if (confirm('產品已建立！是否將此詢價單狀態更新為「已轉正式產品」？')) {
                        inq.status = 'converted';
                    }
                    
                    renderSupplierInquiries(); 
                }
            }

            saveData();
            e.target.reset();
            closeModal('modal-add-product-direct');
            showToast('產品已成功新增！', 'bg-green-600');
            renderProducts();
            renderSuppliers(); 
        };


        function deleteInquiry(id) {
            if(confirm('確定刪除此詢價單？')) {
                data.supplierInquiries = data.supplierInquiries.filter(i => i.id !== id);
                saveData();
                renderSupplierInquiries();
            }
        }

        // ================= 渲染邏輯 (更新) =================
