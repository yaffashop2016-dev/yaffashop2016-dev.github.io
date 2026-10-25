        function validateSupplierFinanceTerms(formData) {
            const closingDay = formData.get('closingDay');
            const paymentDay = formData.get('paymentDay');
            if (!closingDay && !paymentDay) return true;
            const validDay = value => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 31;
            if (!closingDay || !paymentDay || !validDay(closingDay) || !validDay(paymentDay)) {
                showToast('關帳日與指定付款日請同時填入 1 至 31 日。', 'bg-red-500');
                return false;
            }
            return true;
        }

        // 快速新增供應商表單處理 (Nested Modal) - v11.4: 加入建檔日
        document.getElementById('quickAddSupplierForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const name = formData.get('quickName');
            const now = new Date().toISOString();
            
            const newSupplier = {
                id: 's_' + Date.now(),
                name: name,
                taxId: '',
                phone: formData.get('quickPhone'),
                contact: formData.get('quickContact'),
                website: '',
                address: '',
                paymentType: '現金',
                monthlyDays: '',
                closingDay: '',
                paymentDay: '',
                note: '快速建立',
                createdAt: now,
                updatedAt: now
            };
            data.suppliers.push(newSupplier);
            saveData();
            updateSupplierDatalist();
            
            // 自動帶入詢價單欄位
            document.getElementById('inquirySupplierName').value = name;
            
            closeModal('modal-quick-add-supplier');
            e.target.reset();
            showToast('供應商已建立！', 'bg-green-600');
        });

        // 供應商表單處理 (修改) - v11.4: 更新修改日
        document.getElementById('editSupplierForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            if (!validateSupplierFinanceTerms(formData)) return;
            const id = formData.get('id');
            const index = data.suppliers.findIndex(s => s.id === id);
            if (index !== -1) {
                data.suppliers[index] = {
                    ...data.suppliers[index],
                    name: formData.get('name'),
                    taxId: formData.get('taxId'),
                    phone: formData.get('phone'),
                    contact: formData.get('contact'),
                    companyPhone: formData.get('companyPhone'),
                    website: formData.get('website'),
                    address: formData.get('address'),
                    paymentType: formData.get('paymentType'),
                    monthlyDays: formData.get('monthlyDays'),
                    closingDay: formData.get('closingDay'),
                    paymentDay: formData.get('paymentDay'),
                    remittanceAccount: formData.get('remittanceAccount'),
                    remittanceBank: formData.get('remittanceBank'),
                    remittanceBranch: formData.get('remittanceBranch'),
                    note: formData.get('note'),
                    updatedAt: new Date().toISOString() // v11.4 更新修改時間
                };
                saveData();
                updateSupplierDatalist();
                renderSuppliers();
                renderProducts(); // 更新產品列表中的供應商名稱
                closeModal('modal-edit-supplier');
                showToast('供應商資料已更新！', 'bg-blue-600');
            }
        });

        // 供應商搜尋相關事件監聽器
        // 新增產品表單的供應商搜尋
        const supplierSearchInput = document.getElementById('supplierSearchInput');
        const supplierIdField = document.getElementById('supplierId');
        if (supplierSearchInput) {
            supplierSearchInput.addEventListener('change', (e) => {
                const selectedName = e.target.value;
                const selectedSupplier = data.suppliers.find(s => s.name === selectedName);
                if (selectedSupplier) {
                    supplierIdField.value = selectedSupplier.id;
                } else {
                    supplierIdField.value = '';
                    e.target.value = '';
                }
            });
            supplierSearchInput.addEventListener('input', (e) => {
                const inputVal = e.target.value;
                const supplierIdHidden = document.getElementById('supplierId');
                // 如果输入值不在下拉选项中，清空hidden字段
                const matchedSupplier = data.suppliers.find(s => s.name === inputVal);
                if (!matchedSupplier && inputVal.length > 0) {
                    supplierIdHidden.value = '';
                }
            });
        }

        // 編輯產品表單的供應商搜尋
        const editSupplierSearchInput = document.getElementById('editSupplierSearchInput');
        const editSupplierIdField = document.getElementById('editSupplierId');
        if (editSupplierSearchInput) {
            editSupplierSearchInput.addEventListener('change', (e) => {
                const selectedName = e.target.value;
                const selectedSupplier = data.suppliers.find(s => s.name === selectedName);
                if (selectedSupplier) {
                    editSupplierIdField.value = selectedSupplier.id;
                } else {
                    editSupplierIdField.value = '';
                    e.target.value = '';
                }
            });
            editSupplierSearchInput.addEventListener('input', (e) => {
                const inputVal = e.target.value;
                const supplierIdHidden = document.getElementById('editSupplierId');
                // 如果输入值不在下拉选项中，清空hidden字段
                const matchedSupplier = data.suppliers.find(s => s.name === inputVal);
                if (!matchedSupplier && inputVal.length > 0) {
                    supplierIdHidden.value = '';
                }
            });
        }
        // 供應商渲染 - v11.4: 顯示建檔日與修改日
        function toggleCounterpartyFields() {
            const role = document.getElementById('counterpartyRole')?.value || 'supplier';
            document.getElementById('counterpartySupplierFields')?.classList.toggle('hidden', role !== 'supplier');
            document.getElementById('counterpartyCustomerFields')?.classList.toggle('hidden', role !== 'customer');
            const paymentType = document.getElementById('counterpartyPaymentType');
            if (paymentType) toggleMonthlyDays(paymentType, 'counterpartyMonthlyDaysWrapper');
        }

        function resetCounterpartyForm() {
            document.getElementById('counterpartyForm')?.reset();
            document.getElementById('counterpartyId').value = '';
            document.getElementById('counterpartyRole').disabled = false;
            document.getElementById('counterpartyFormTitle').textContent = '新增往來對象';
            document.getElementById('counterpartySubmit').textContent = '儲存往來對象';
            toggleCounterpartyFields();
        }

        function editCounterparty(role, id) {
            const record = role === 'supplier'
                ? data.suppliers.find(item => item.id === id)
                : (data.financeCustomers || []).find(item => item.id === id);
            if (!record) return showToast('找不到往來對象資料。', 'bg-red-500');
            switchTab('add');
            document.getElementById('counterpartyRole').value = role;
            document.getElementById('counterpartyRole').disabled = true;
            document.getElementById('counterpartyId').value = id;
            document.getElementById('counterpartyName').value = record.name || '';
            document.getElementById('counterpartyTaxId').value = record.taxId || '';
            document.getElementById('counterpartyContact').value = record.contact || record.contactName || '';
            document.getElementById('counterpartyPhone').value = record.phone || '';
            document.getElementById('counterpartyCompanyPhone').value = record.companyPhone || '';
            document.getElementById('counterpartyEmail').value = record.email || '';
            document.getElementById('counterpartyWebsite').value = record.website || '';
            document.getElementById('counterpartyAddress').value = record.address || '';
            document.getElementById('counterpartyPaymentType').value = record.paymentType || '';
            document.getElementById('counterpartyClosingDay').value = record.closingDay || '';
            document.getElementById('counterpartyPaymentDay').value = record.paymentDay || '';
            document.getElementById('counterpartyMonthlyDays').value = record.monthlyDays || '';
            document.getElementById('counterpartyRemittanceAccount').value = record.remittanceAccount || '';
            document.getElementById('counterpartyRemittanceBank').value = record.remittanceBank || '';
            document.getElementById('counterpartyRemittanceBranch').value = record.remittanceBranch || '';
            document.getElementById('counterpartyCustomerRemittanceBank').value = record.remittanceBank || '';
            document.getElementById('counterpartyCustomerRemittanceBranch').value = record.remittanceBranch || '';
            document.getElementById('counterpartyRemittance').value = record.remittance || '';
            document.getElementById('counterpartyNote').value = record.note || '';
            document.getElementById('counterpartyFormTitle').textContent = role === 'supplier' ? '修改供應商' : '修改客戶';
            document.getElementById('counterpartySubmit').textContent = '儲存修改';
            toggleCounterpartyFields();
            document.getElementById('counterpartyName').focus();
        }

        function saveCounterparty(event) {
            event.preventDefault();
            const form = event.currentTarget;
            const formData = new FormData(form);
            const role = document.getElementById('counterpartyRole').value;
            const id = document.getElementById('counterpartyId').value;
            const name = String(formData.get('name') || '').trim();
            const closingText = String(formData.get('closingDay') || '');
            const paymentText = String(formData.get('paymentDay') || '');
            const isValidDay = value => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 31;
            if ((closingText || paymentText) && (!closingText || !paymentText || !isValidDay(closingText) || !isValidDay(paymentText))) {
                return showToast('關帳日與指定付款日請同時填入 1 至 31 日。', 'bg-red-500');
            }
            const collection = role === 'supplier' ? data.suppliers : data.financeCustomers;
            const previousCollection = collection.slice();
            const duplicate = collection.some(item => item.id !== id && String(item.name || '').trim().toLocaleLowerCase() === name.toLocaleLowerCase());
            if (duplicate) return showToast(`已有相同名稱的${role === 'supplier' ? '供應商' : '客戶'}，請修改既有資料以避免重複。`, 'bg-red-500');
            const previous = collection.find(item => item.id === id);
            const now = new Date().toISOString();
            const common = {
                ...(previous || {}),
                id: previous?.id || `${role === 'supplier' ? 's' : 'fc'}_${Date.now()}`,
                name,
                taxId: String(formData.get('taxId') || '').trim(),
                phone: String(formData.get('phone') || '').trim(),
                address: String(formData.get('address') || '').trim(),
                paymentType: String(formData.get('paymentType') || ''),
                closingDay: closingText,
                paymentDay: paymentText,
                remittanceBank: String(formData.get(role === 'supplier' ? 'supplierRemittanceBank' : 'customerRemittanceBank') || '').trim(),
                remittanceBranch: String(formData.get(role === 'supplier' ? 'supplierRemittanceBranch' : 'customerRemittanceBranch') || '').trim(),
                note: String(formData.get('note') || '').trim(),
                updatedAt: now
            };
            const record = role === 'supplier'
                ? {
                    ...common,
                    contact: String(formData.get('contact') || '').trim(),
                    companyPhone: String(formData.get('companyPhone') || '').trim(),
                    email: String(formData.get('email') || '').trim(),
                    website: String(formData.get('website') || '').trim(),
                    monthlyDays: String(formData.get('monthlyDays') || ''),
                    remittanceAccount: String(formData.get('remittanceAccount') || '').trim()
                }
                : {
                    ...common,
                    contactName: String(formData.get('contact') || '').trim(),
                    email: String(formData.get('email') || '').trim(),
                    remittance: String(formData.get('remittance') || '').trim()
                };
            if (!previous) record.createdAt = now;
            if (previous) collection[collection.indexOf(previous)] = record;
            else collection.push(record);
            if (!saveData()) {
                if (role === 'supplier') data.suppliers = previousCollection;
                else data.financeCustomers = previousCollection;
                return showToast('儲存失敗，請先匯出備份並確認瀏覽器儲存空間。', 'bg-red-500');
            }
            resetCounterpartyForm();
            updateSupplierDatalist();
            updateSupplierSelect();
            renderCounterparties();
            renderProducts();
            renderFinance();
            showToast(previous ? '往來對象資料已更新。' : '往來對象已新增。', 'bg-green-600');
        }

        function deleteCounterparty(role, id) {
            const previousCollection = (role === 'supplier' ? data.suppliers : data.financeCustomers).slice();
            if (role === 'supplier') {
                const supplier = data.suppliers.find(item => item.id === id);
                if (!supplier) return;
                const references = data.products.some(product => product.supplierId === id);
                const warning = references ? '相關產品仍會保留，但供應商名稱將無法顯示。' : '此操作無法復原。';
                if (!confirm(`確定刪除供應商「${supplier.name}」？${warning}`)) return;
                data.suppliers = data.suppliers.filter(item => item.id !== id);
            } else {
                const customer = (data.financeCustomers || []).find(item => item.id === id);
                if (!customer || !confirm(`確定刪除客戶「${customer.name}」？既有應收單據與報價不會受影響。`)) return;
                data.financeCustomers = data.financeCustomers.filter(item => item.id !== id);
            }
            if (!saveData()) {
                if (role === 'supplier') data.suppliers = previousCollection;
                else data.financeCustomers = previousCollection;
                return showToast('刪除未能儲存，原資料已復原。請檢查瀏覽器儲存空間。', 'bg-red-500');
            }
            updateSupplierDatalist();
            updateSupplierSelect();
            renderCounterparties();
            renderProducts();
            renderFinance();
        }

        function renderCounterparties() {
            const container = document.getElementById('counterpartyList');
            if (!container) return;
            const keyword = String(document.getElementById('counterpartyKeyword')?.value || '').trim().toLocaleLowerCase();
            const roleFilter = document.getElementById('counterpartyRoleFilter')?.value || 'all';
            const records = [
                ...(data.suppliers || []).map(record => ({ ...record, role: 'supplier' })),
                ...(data.financeCustomers || []).map(record => ({ ...record, role: 'customer' }))
            ].filter(record => (roleFilter === 'all' || record.role === roleFilter) &&
                [record.name, record.taxId, record.contact, record.contactName, record.phone, record.companyPhone, record.email, record.address]
                    .some(value => String(value || '').toLocaleLowerCase().includes(keyword)))
                .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant'));
            if (!records.length) {
                container.innerHTML = '<div class="rounded border bg-white p-5 text-center text-sm text-slate-500">沒有符合條件的往來對象。</div>';
                return;
            }
            container.innerHTML = records.map(record => {
                const roleLabel = record.role === 'supplier' ? '供應商' : '客戶';
                const roleBadgeClass = record.role === 'supplier' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700';
                const contact = record.contact || record.contactName || '-';
                const roleTerms = record.role === 'supplier' && record.paymentType === '月結' && record.monthlyDays
                    ? `月結 ${escapeFinanceHtml(record.monthlyDays)} 天`
                    : '';
                const terms = [record.paymentType || '未設定', record.closingDay && record.paymentDay ? `關帳 ${record.closingDay} 日／付款 ${record.paymentDay} 日` : '', roleTerms]
                    .filter(Boolean).map(escapeFinanceHtml).join(' · ');
                const escapedId = escapeFinanceHtml(record.id);
                return `<article class="rounded border bg-white p-4 shadow-sm">
                    <div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                        <div class="min-w-0">
                            <div class="mb-1 flex flex-wrap items-center gap-2">
                                <h3 class="font-bold text-slate-800">${escapeFinanceHtml(record.name || '')}</h3>
                                <span class="rounded px-2 py-0.5 text-xs font-semibold ${roleBadgeClass}">${roleLabel}</span>
                            </div>
                            <div class="grid grid-cols-1 gap-x-4 gap-y-1 text-sm text-slate-600 sm:grid-cols-2">
                                <span>統編：${escapeFinanceHtml(record.taxId || '-')}</span>
                                <span>聯絡人：${escapeFinanceHtml(contact)}</span>
                                <span>電話：${escapeFinanceHtml(record.phone || record.companyPhone || '-')}</span>
                                <span>Email：${escapeFinanceHtml(record.email || '-')}</span>
                                <span>收款銀行：${escapeFinanceHtml(record.remittanceBank || '-')}</span>
                                <span>分行：${escapeFinanceHtml(record.remittanceBranch || '-')}</span>
                                ${record.role === 'supplier' ? `<span>匯款帳號：${escapeFinanceHtml(record.remittanceAccount || '-')}</span>` : ''}
                                <span>付款條件：${terms}</span>
                                <span class="sm:col-span-2">地址：${escapeFinanceHtml(record.address || '-')}</span>
                            </div>
                            ${record.note ? `<p class="mt-2 border-t pt-2 text-sm text-slate-500">備註：${escapeFinanceHtml(record.note)}</p>` : ''}
                        </div>
                        <div class="flex shrink-0 gap-2">
                            ${record.role === 'supplier' ? `<button type="button" onclick="openAddProductModal('${escapedId}')" class="rounded bg-green-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-700">新增產品</button>` : ''}
                            <button type="button" onclick="editCounterparty('${record.role}', '${escapedId}')" class="rounded bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-100">修改</button>
                            <button type="button" onclick="deleteCounterparty('${record.role}', '${escapedId}')" class="rounded bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-100">刪除</button>
                        </div>
                    </div>
                </article>`;
            }).join('');
        }

        function renderSuppliers() {
            renderCounterparties();
        }
function toggleSupplierDetails(id) {
            const details = document.getElementById(`details-${id}`);
            const icon = document.getElementById(`icon-${id}`);
            if (details.classList.contains('hidden')) {
                details.classList.remove('hidden');
                icon.classList.add('rotate-180');
            } else {
                details.classList.add('hidden');
                icon.classList.remove('rotate-180');
            }
        }

        function updateSupplierSelect() {
            // 更新新增產品表單的datalist
            const newProductDatalist = document.getElementById('supplierListForProduct');
            if (newProductDatalist) {
                newProductDatalist.innerHTML = '';
                data.suppliers.forEach(s => {
                    const opt = document.createElement('option');
                    opt.value = s.name;
                    opt.dataset.id = s.id;
                    newProductDatalist.appendChild(opt);
                });
            }
            
            // 更新編輯產品表單的datalist
            const editProductDatalist = document.getElementById('editSupplierListForProduct');
            if (editProductDatalist) {
                editProductDatalist.innerHTML = '';
                data.suppliers.forEach(s => {
                    const opt = document.createElement('option');
                    opt.value = s.name;
                    opt.dataset.id = s.id;
                    editProductDatalist.appendChild(opt);
                });
            }
        }
        function openEditSupplier(id) {
            const s = data.suppliers.find(item => item.id === id);
            if (!s) return;
            const form = document.getElementById('editSupplierForm');
            form.id.value = s.id;
            form.name.value = s.name;
            form.taxId.value = s.taxId || '';
            form.phone.value = s.phone || '';
            form.contact.value = s.contact || '';
            form.companyPhone.value = s.companyPhone || '';
            form.website.value = s.website || '';
            form.address.value = s.address || '';
            form.paymentType.value = s.paymentType || '現金';
            form.monthlyDays.value = s.monthlyDays || '';
            form.closingDay.value = s.closingDay || '';
            form.paymentDay.value = s.paymentDay || '';
            form.remittanceAccount.value = s.remittanceAccount || '';
            form.remittanceBank.value = s.remittanceBank || '';
            form.remittanceBranch.value = s.remittanceBranch || '';
            form.note.value = s.note || '';
            
            // 觸發顯示切換
            toggleMonthlyDays(form.paymentType, 'editMonthlyDaysWrapper');
            
            document.getElementById('modal-edit-supplier').classList.add('modal-active');
        }

        function deleteSupplier(id) {
            if (confirm('確定刪除此供應商？相關產品與訂單可能無法正確顯示。')) {
                data.suppliers = data.suppliers.filter(s => s.id !== id);
                saveData();
                renderSuppliers();
                renderProducts();
            }
        }
