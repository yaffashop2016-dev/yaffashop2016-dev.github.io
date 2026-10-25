        // ================= 客戶報價單邏輯 (v11.4: 報價單號邏輯QT+日期+流水號) =================

        // Helper: 生成訂單編號 (民國年月 + 流水號)
        function generateOrderID() {
            const now = new Date();
            // 民國年 = 西元年 - 1911
            const year = now.getFullYear() - 1911;
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const datePrefix = `${year}${month}`;
            
            // 找出今天已經開了幾張單
            const sameMonthOrders = data.orders.filter(o => o.id && o.id.startsWith(datePrefix));
            
            let maxSeq = 0;
            sameMonthOrders.forEach(o => {
                // 取出最後兩位數當作序號
                const seqStr = o.id.substring(datePrefix.length); 
                const seq = parseInt(seqStr);
                if (!isNaN(seq) && seq > maxSeq) {
                    maxSeq = seq;
                }
            });

            const nextSeq = String(maxSeq + 1).padStart(2, '0');
            return `${datePrefix}${nextSeq}`;
        }

        function openCreateQuoteModal() {
            tempQuoteItems = [];
            document.getElementById('quoteId').value = ''; 
            document.getElementById('quoteModalTitle').textContent = '建立客戶報價單';
            document.getElementById('quoteClientName').value = '';
            document.getElementById('quoteCustomerId').value = '';
            document.getElementById('quoteContactName').value = '';
            document.getElementById('quoteContactPhone').value = '';
            document.getElementById('quoteContactEmail').value = '';
            document.getElementById('quoteCustomerSuggestions').classList.add('hidden');
            document.getElementById('quoteNote').value = '';
            document.getElementById('quoteSearchProduct').value = '';
            document.getElementById('quoteStatus').value = 'open';
            document.getElementById('quoteLossReason').value = '';
            toggleLossReason(); 
            
            renderQuoteProductSelection();
            renderQuoteSelected();
            document.getElementById('modal-create-quote').classList.add('modal-active');
        }

        function openEditQuote(quoteId) {
            const quote = data.clientQuotes.find(q => q.id === quoteId);
            if (!quote) return;

            tempQuoteItems = JSON.parse(JSON.stringify(quote.items)).map(item => ({
                ...item,
                costPrice: item.costPrice !== undefined ? item.costPrice : item.price,
                salesPrice: item.salesPrice !== undefined ? item.salesPrice : item.price
            }));
            
            document.getElementById('quoteId').value = quote.id;
            document.getElementById('quoteModalTitle').textContent = `修改客戶報價單 (${quote.id})`;
            document.getElementById('quoteClientName').value = quote.clientName;
            document.getElementById('quoteCustomerId').value = quote.customerId || findFinanceCustomer(quote.clientName)?.id || '';
            document.getElementById('quoteCustomerSuggestions').classList.add('hidden');
            const customer = (data.financeCustomers || []).find(item => item.id === quote.customerId) || findFinanceCustomer(quote.clientName);
            document.getElementById('quoteContactName').value = quote.customerContactName ?? customer?.contactName ?? '';
            document.getElementById('quoteContactPhone').value = quote.customerPhone ?? customer?.phone ?? '';
            document.getElementById('quoteContactEmail').value = quote.customerEmail ?? customer?.email ?? '';
            document.getElementById('quoteDate').value = quote.date;
            document.getElementById('quoteNote').value = quote.note;
            document.getElementById('quoteStatus').value = quote.status || 'open';
            document.getElementById('quoteLossReason').value = quote.lossReason || '';
            toggleLossReason();

            renderQuoteProductSelection();
            renderQuoteSelected();
            document.getElementById('modal-create-quote').classList.add('modal-active');
        }

        function searchFinanceCustomersForQuote(query) {
            document.getElementById('quoteCustomerId').value = '';
            const suggestions = document.getElementById('quoteCustomerSuggestions');
            const normalizedQuery = String(query || '').trim().toLocaleLowerCase();
            if (!normalizedQuery) {
                suggestions.innerHTML = '';
                suggestions.classList.add('hidden');
                return;
            }
            const matches = (data.financeCustomers || []).map(customer => {
                const fields = [customer.name, customer.taxId, customer.contactName, customer.phone, customer.email];
                const matchIndex = fields.findIndex(value => String(value || '').toLocaleLowerCase().includes(normalizedQuery));
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
                <button type="button" class="block w-full border-b px-3 py-2 text-left last:border-b-0 hover:bg-purple-50"
                    onmousedown="event.preventDefault()" onclick="selectFinanceCustomerForQuote('${escapeFinanceHtml(customer.id)}')">
                    <span class="block font-semibold text-slate-800">${escapeFinanceHtml(customer.name)}</span>
                    <span class="block text-xs text-slate-500">${customer.taxId ? `統編 ${escapeFinanceHtml(customer.taxId)} · ` : ''}${customer.contactName ? `聯絡人 ${escapeFinanceHtml(customer.contactName)} · ` : ''}${customer.phone ? escapeFinanceHtml(customer.phone) : '未留電話'}</span>
                </button>
            `).join('');
            suggestions.classList.remove('hidden');
        }

        function selectFinanceCustomerForQuote(customerId) {
            const customer = (data.financeCustomers || []).find(item => item.id === customerId);
            if (!customer) return showToast('找不到客戶資料，請重新搜尋。', 'bg-red-500');
            document.getElementById('quoteClientName').value = customer.name;
            document.getElementById('quoteCustomerId').value = customer.id;
            document.getElementById('quoteContactName').value = customer.contactName || '';
            document.getElementById('quoteContactPhone').value = customer.phone || '';
            document.getElementById('quoteContactEmail').value = customer.email || '';
            document.getElementById('quoteCustomerSuggestions').classList.add('hidden');
        }

        function toggleLossReason() {
            const status = document.getElementById('quoteStatus').value;
            const reasonDiv = document.getElementById('lossReasonDiv');
            if (status === 'lost') {
                reasonDiv.classList.remove('hidden');
            } else {
                reasonDiv.classList.add('hidden');
            }
        }

        function renderQuoteProductSelection() {
            const keyword = document.getElementById('quoteSearchProduct').value.trim().toLowerCase();
            const container = document.getElementById('quoteProductList');
            container.innerHTML = '';

            // 不要預先列出所有產品：要求至少輸入 2 個字以上再顯示篩選結果
            if (keyword.length < 2) {
                container.innerHTML = '<p class="text-gray-400 text-center mt-6">請輸入至少 2 個字以篩選產品</p>';
                return;
            }

            const filtered = data.products.filter(p => {
                return [p.prodName, p.spec, p.id, p.sku, p.barcode]
                    .some(value => String(value || '').toLowerCase().includes(keyword));
            });

            if (filtered.length === 0) {
                container.innerHTML = '<p class="text-gray-500 text-center mt-6">找不到符合的產品</p>';
                return;
            }

            filtered.forEach(p => {
                const supplier = data.suppliers.find(s => s.id === p.supplierId)?.name || '未知';
                const baseProduct = p.packageBaseProductId
                    ? data.products.find(product => product.id === p.packageBaseProductId)
                    : null;
                const packageDetails = baseProduct
                    ? `基礎產品 ${p.packageBaseProductId} · 每包 ${p.packageUnitsPerPackage} ${baseProduct.unit || '件'}`
                    : `產品編號 ${p.id}${p.sku ? ` · SKU ${p.sku}` : ''}`;
                const div = document.createElement('div');
                div.className = 'flex justify-between items-center p-2 border rounded hover:bg-gray-50 text-sm';
                div.innerHTML = `
                    <div>
                        <div class="font-bold">${escapeFinanceHtml(p.prodName)}</div>
                        <div class="text-xs text-gray-500">${escapeFinanceHtml(packageDetails)} · ${escapeFinanceHtml(p.spec || '')} | ${escapeFinanceHtml(supplier)} | 進價: ${getProductCurrency(p)} ${getProductPurchasePrice(p)}（${Number.isFinite(getProductPurchasePriceNtd(p)) ? `約 NTD $${getProductPurchasePriceNtd(p)}` : '匯率未設定'}） | 售價: ${p.salesPrice === '' || p.salesPrice === undefined ? '未設定' : `NTD $${getProductSalesPrice(p)}`}</div>
                    </div>
                    <button onclick="addToQuoteTemp('${p.id}')" class="px-2 py-1 bg-purple-100 text-purple-700 rounded hover:bg-purple-200 font-bold">+</button>
                `;
                container.appendChild(div);
            });
        }

        function addToQuoteTemp(productId) {
            const product = data.products.find(p => p.id === productId);
            if(!product) return;
            if (!Number.isFinite(getProductPurchasePriceNtd(product))) {
                return showToast('此人民幣產品尚未設定有效匯率，請先修改產品資料。', 'bg-red-500');
            }
            
            const existing = tempQuoteItems.find(i => i.productId === productId);
            if(existing) {
                existing.quantity++;
            } else {
                tempQuoteItems.push({
                    productId: productId,
                    prodName: product.prodName,
                    spec: product.spec,
                    costPrice: getProductPurchasePriceNtd(product),
                    salesPrice: getProductSalesPrice(product),
                    quantity: 1
                });
            }
            renderQuoteSelected();
        }

        function renderQuoteSelected() {
            const container = document.getElementById('quoteSelectedList');
            container.innerHTML = '';
            
            if(tempQuoteItems.length === 0) {
                container.innerHTML = '<p class="text-gray-400 text-center mt-10">尚未選擇產品</p>';
                // Reset summary
                document.getElementById('summaryTotalCost').textContent = '$0';
                document.getElementById('summaryTotalSales').textContent = '$0';
                document.getElementById('summaryProfitVal').textContent = '$0';
                document.getElementById('summaryMarginVal').textContent = '0%';
                document.getElementById('summaryMarginVal').className = 'font-bold text-2xl text-gray-400';
                return;
            }

            let totalCost = 0;
            let totalSales = 0;

            tempQuoteItems.forEach((item, index) => {
                // v11.1 計算總計
                const costSub = item.costPrice * item.quantity;
                const salesSub = item.salesPrice * item.quantity;
                totalCost += costSub;
                totalSales += salesSub;

                // 該項目的毛利 (Tooltip or simple display)
                const itemProfit = salesSub - costSub;
                const itemMargin = salesSub > 0 ? ((itemProfit / salesSub) * 100).toFixed(0) : 0;
                const marginColor = itemMargin < 0 ? 'text-red-500' : 'text-green-600';

                const div = document.createElement('div');
                div.className = 'flex flex-col sm:flex-row sm:justify-between sm:items-center p-2 bg-white rounded shadow-sm text-sm gap-2 border-l-4 ' + (itemProfit < 0 ? 'border-red-400' : 'border-purple-400');
                div.innerHTML = `
                    <div class="flex-1">
                        <div class="font-bold">${item.prodName}</div>
                        <div class="text-xs text-gray-500">${item.spec || ''}</div>
                        <div class="flex gap-2 mt-1 items-center">
                            <span class="text-xs text-gray-400">成本: $${item.costPrice}</span>
                            <span class="text-xs font-bold ${marginColor}">毛利: ${itemMargin}%</span>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                         <div class="flex flex-col">
                            <span class="text-[10px] text-gray-500">報價</span>
                            <input type="number" min="0" step="0.01" value="${item.salesPrice}" class="w-20 p-1 border rounded text-right text-purple-700 font-bold"
                            onchange="updateQuoteTempPrice(${index}, this.value)">
                         </div>
                         <div class="flex flex-col">
                            <span class="text-[10px] text-gray-500">數量</span>
                            <input type="number" min="1" value="${item.quantity}" class="w-16 p-1 border rounded text-center"
                            onchange="updateQuoteTempQty(${index}, this.value)">
                         </div>
                         <button onclick="removeQuoteTemp(${index})" class="text-red-500 hover:text-red-700 ml-1">✕</button>
                    </div>
                `;
                container.appendChild(div);
            });

            // v11.1 更新毛利分析儀表板
            const profit = totalSales - totalCost;
            const margin = totalSales > 0 ? ((profit / totalSales) * 100).toFixed(1) : 0;
            
            document.getElementById('summaryTotalCost').textContent = '$' + Math.round(totalCost).toLocaleString();
            document.getElementById('summaryTotalSales').textContent = '$' + Math.round(totalSales).toLocaleString();
            
            const profitEl = document.getElementById('summaryProfitVal');
            profitEl.textContent = '$' + Math.round(profit).toLocaleString();
            profitEl.className = profit < 0 ? 'font-bold text-lg text-red-400' : 'font-bold text-lg text-white';

            const marginEl = document.getElementById('summaryMarginVal');
            marginEl.textContent = margin + '%';
            if (margin < 0) marginEl.className = 'font-bold text-2xl text-red-500';
            else if (margin < 15) marginEl.className = 'font-bold text-2xl text-yellow-400';
            else marginEl.className = 'font-bold text-2xl text-green-400';
        }

        function updateQuoteTempQty(index, val) {
            tempQuoteItems[index].quantity = parseInt(val) || 1;
            renderQuoteSelected(); // 重繪以更新毛利
        }

        function updateQuoteTempPrice(index, val) {
            tempQuoteItems[index].salesPrice = parseFloat(val) || 0;
            renderQuoteSelected(); // 重繪以更新毛利
        }

        function removeQuoteTemp(index) {
            tempQuoteItems.splice(index, 1);
            renderQuoteSelected();
        }

        function saveClientQuote() {
            if (!Array.isArray(data.clientQuotes)) data.clientQuotes = [];
            const clientName = document.getElementById('quoteClientName').value.trim();
            const customer = (data.financeCustomers || []).find(item =>
                item.id === document.getElementById('quoteCustomerId').value
            );
            let quoteId = document.getElementById('quoteId').value;
            const status = document.getElementById('quoteStatus').value;
            const lossReason = document.getElementById('quoteLossReason').value;

            if(!clientName) return showToast('請輸入客戶名稱', 'bg-red-500');
            if(tempQuoteItems.length === 0) return showToast('請至少選擇一項產品', 'bg-red-500');
            if(status === 'lost' && !lossReason) return showToast('請填寫未成交原因', 'bg-red-500');

            // v11.4: 如果沒有 quoteId (新單)，則生成新格式
            let isNew = false;
            if (!quoteId) {
                quoteId = generateQuoteID();
                isNew = true;
            }

            const quoteData = {
                id: quoteId,
                clientName: clientName,
                customerId: customer?.id || '',
                customerTaxId: customer?.taxId || '',
                customerContactName: document.getElementById('quoteContactName').value.trim(),
                customerPhone: document.getElementById('quoteContactPhone').value.trim(),
                customerEmail: document.getElementById('quoteContactEmail').value.trim(),
                customerAddress: customer?.address || '',
                issuer: { ...(data.companyProfile || {}) },
                date: document.getElementById('quoteDate').value,
                note: document.getElementById('quoteNote').value,
                status: status,
                lossReason: status === 'lost' ? lossReason : '',
                items: [...tempQuoteItems]
            };

            if (!isNew) {
                const index = data.clientQuotes.findIndex(q => q.id === quoteId);
                if (index !== -1) {
                    data.clientQuotes[index] = quoteData;
                    showToast('報價單已更新', 'bg-purple-600');
                }
            } else {
                data.clientQuotes.unshift(quoteData);
                showToast(`客戶報價單 ${quoteId} 已建立`, 'bg-purple-600');
            }

            saveData();
            closeModal('modal-create-quote');
            renderClientQuotes();
        }

        function renderClientQuotes() {
            const keyword = document.getElementById('searchQuoteKeyword')?.value.toLowerCase() || '';
            const statusFilter = document.getElementById('filterQuoteStatus')?.value || 'all';
            const startDate = document.getElementById('filterQuoteStart')?.value;
            const endDate = document.getElementById('filterQuoteEnd')?.value;

            const container = document.getElementById('clientQuoteList');
            container.innerHTML = '';

            const filtered = (data.clientQuotes || []).filter(q => {
                const items = q.items || [];

                // 關鍵字篩選 (客戶名稱 或 單號)
                const matchKeyword = (q.clientName || '').toLowerCase().includes(keyword) || (q.id || '').toLowerCase().includes(keyword);
                
                // 狀態篩選
                const matchStatus = statusFilter === 'all' || q.status === statusFilter;

                // 日期篩選
                let matchDate = true;
                if (startDate && q.date < startDate) matchDate = false;
                if (endDate && q.date > endDate) matchDate = false;

                return matchKeyword && matchStatus && matchDate;
            });

            if (filtered.length === 0) {
                container.innerHTML = '<div class="text-center text-gray-400 py-8">沒有符合條件的報價單</div>';
                return;
            }

            filtered.forEach(q => {
                const div = document.createElement('div');
                div.className = 'card p-4 border-l-4 border-purple-500';
                
                const itemsData = q.items || [];
                const itemsSummary = itemsData.map(i => `${i.prodName} x${i.quantity}`).join(', ');
                const totalAmt = itemsData.reduce((acc, i) => acc + ((i.salesPrice !== undefined ? i.salesPrice : i.price || 0) * (i.quantity || 0)), 0);

                let statusText = '';
                let statusClass = 'bg-gray-100 text-gray-600';
                
                switch(q.status) {
                    case 'open': statusText = '處理中'; statusClass = 'bg-yellow-100 text-yellow-800'; break;
                    case 'quoted': statusText = '已報價'; statusClass = 'bg-blue-100 text-blue-800'; break;
                    case 'waiting': statusText = '等回應'; statusClass = 'bg-indigo-100 text-indigo-800'; break;
                    case 'lost': statusText = '未成交'; statusClass = 'bg-red-100 text-red-800'; break;
                    case 'converted': statusText = '已成交'; statusClass = 'bg-green-100 text-green-800'; break;
                    default: statusText = '未處理';
                }

                div.innerHTML = `
                    <div class="flex flex-col md:flex-row justify-between md:items-center mb-2">
                        <div>
                            <h3 class="font-bold text-lg text-gray-800">${q.clientName}</h3>
                            ${(q.customerContactName || q.customerPhone || q.customerEmail) ? `<div class="text-xs text-gray-500">${q.customerContactName ? `聯絡人：${escapeFinanceHtml(q.customerContactName)} · ` : ''}${q.customerPhone ? `電話：${escapeFinanceHtml(q.customerPhone)} · ` : ''}${q.customerEmail ? `Email：${escapeFinanceHtml(q.customerEmail)}` : ''}</div>` : ''}
                            <div class="text-xs text-gray-500">日期: ${q.date} | 編號: <span class="font-mono font-bold">${q.id}</span></div>
                        </div>
                        <div class="text-right mt-2 md:mt-0">
                            <div class="font-bold text-purple-700">$${Math.round(totalAmt).toLocaleString()}</div>
                            <span class="text-xs px-2 py-0.5 rounded ${statusClass}">
                                ${statusText}
                            </span>
                        </div>
                    </div>
                    <div class="text-sm text-gray-600 mb-3 line-clamp-2">${itemsSummary}</div>
                    <div class="text-xs text-gray-400 mb-2">備註: ${q.note || '無'}</div>
                    ${q.status === 'lost' ? `<div class="text-xs text-red-500 mb-2 bg-red-50 p-1 rounded">原因: ${q.lossReason}</div>` : ''}
                    
                    <div class="flex flex-wrap justify-end gap-2 border-t pt-2">
                        <button onclick="exportQuoteExcel('${q.id}')" class="px-3 py-1 bg-green-50 text-green-600 hover:bg-green-100 rounded text-sm border border-green-200">
                            匯出客戶報價
                        </button>
                        <button onclick="openEditQuote('${q.id}')" class="px-3 py-1 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded text-sm">
                            修改
                        </button>
                        <button onclick="deleteQuote('${q.id}')" class="px-3 py-1 text-red-500 hover:bg-red-50 rounded text-sm">刪除</button>
                        ${q.status !== 'converted' ? 
                            `<button onclick="convertQuoteToCart('${q.id}')" class="px-3 py-1 bg-purple-600 text-white rounded hover:bg-purple-700 text-sm font-bold shadow-sm">
                                轉入採購
                            </button>` : 
                            '<button disabled class="px-3 py-1 bg-gray-200 text-gray-400 rounded text-sm cursor-not-allowed">已轉單</button>'
                        }
                    </div>
                `;
                container.appendChild(div);
            });
        }

        function convertQuoteToCart(quoteId) {
            const quote = data.clientQuotes.find(q => q.id === quoteId);
            if(!quote) return;
            const invalidProduct = (quote.items || []).map(item => data.products.find(product => product.id === item.productId))
                .find(product => product && getProductCurrency(product) === 'RMB' && getProductExchangeRate(product) <= 0);
            if (invalidProduct) return showToast(`產品「${invalidProduct.prodName || ''}」尚未設定有效匯率，無法轉入採購。`, 'bg-red-500');

            if(!confirm(`確定要將 ${quote.clientName} 的報價單轉入採購清單嗎？`)) return;

            (quote.items || []).forEach(item => {
                const prod = data.products.find(p => p.id === item.productId);
                if(prod) {
                    const existing = data.cart.find(c => c.productId === item.productId);
                    if(existing) {
                        existing.quantity += item.quantity;
                        existing.customNote = (existing.customNote ? existing.customNote + '; ' : '') + `追加: 報價單 ${quoteId}`;
                    } else {
                        data.cart.push({
                            productId: item.productId,
                            quantity: item.quantity,
                            customPrice: getProductPurchasePrice(prod),
                            customShipping: prod.shipping,
                            currency: getProductCurrency(prod),
                            exchangeRate: getProductExchangeRate(prod),
                            customNote: `來源: 客戶報價 ${quote.clientName} (${quoteId})`,
                            taxStatus: prod.isTaxIncl || '含稅' 
                        });
                    }
                }
            });

            quote.status = 'converted';
            saveData();
            renderClientQuotes();
            updateCartCount();
            showToast('已成功轉入採購清單！', 'bg-green-600');
            switchTab('purchase');
        }

        function deleteQuote(id) {
            if(confirm('確定刪除此報價單？')) {
                data.clientQuotes = data.clientQuotes.filter(q => q.id !== id);
                saveData();
                renderClientQuotes();
            }
        }

        function exportQuoteExcel(quoteId) {
            const quote = data.clientQuotes.find(q => q.id === quoteId);
            if (!quote) return;

            const exportData = [];
            const issuer = quote.issuer || data.companyProfile || {};
            exportData.push(["報價公司資訊"]);
            exportData.push(["公司名稱", issuer.companyName || ""]);
            exportData.push(["統一編號", issuer.taxId || ""]);
            exportData.push(["電話", issuer.phone || ""]);
            exportData.push(["聯絡人", issuer.contact || ""]);
            exportData.push(["匯款銀行", issuer.bank || ""]);
            exportData.push(["匯款帳號", issuer.bankAccount || ""]);
            exportData.push(["付款條件", issuer.paymentTerms || ""]);
            exportData.push([]);
            exportData.push(["報價單號", quote.id]);
            exportData.push(["客戶名稱", quote.clientName]);
            exportData.push(["客戶聯絡人", quote.customerContactName || '']);
            exportData.push(["客戶電話", quote.customerPhone || '']);
            exportData.push(["客戶 Email", quote.customerEmail || '']);
            exportData.push(["日期", quote.date]);
            exportData.push(["狀態", quote.status]);
            exportData.push(["備註", quote.note]);
            exportData.push([]); // 空行

            exportData.push(["報價內容與毛利分析"]);
            exportData.push([]);
            const headers = ["產品名稱", "規格", "成本單價", "報價單價", "數量", "成本總額", "報價總額", "毛利額", "毛利率"];
            exportData.push(headers);

            let totalCost = 0;
            let totalSales = 0;
            let totalProfit = 0;

            quote.items.forEach(item => {
                const costPrice = item.costPrice !== undefined ? item.costPrice : item.price || 0;
                const salesPrice = item.salesPrice !== undefined ? item.salesPrice : item.price || 0;
                const quantity = item.quantity || 0;
                const costTotal = costPrice * quantity;
                const salesTotal = salesPrice * quantity;
                const profit = salesTotal - costTotal;
                const margin = salesTotal > 0 ? `${((profit / salesTotal) * 100).toFixed(1)}%` : '0%';

                totalCost += costTotal;
                totalSales += salesTotal;
                totalProfit += profit;

                exportData.push([
                    item.prodName,
                    item.spec || '',
                    costPrice,
                    salesPrice,
                    quantity,
                    costTotal,
                    salesTotal,
                    profit,
                    margin
                ]);
            });

            exportData.push([]);
            const roundedCost = Math.round(totalCost);
            const roundedSales = Math.round(totalSales);
            const roundedProfit = roundedSales - roundedCost;
            exportData.push(["總成本", roundedCost]);
            exportData.push(["總報價", roundedSales]);
            exportData.push(["總毛利", roundedProfit]);
            exportData.push(["總毛利率", roundedSales > 0 ? `${((roundedProfit / roundedSales) * 100).toFixed(1)}%` : '0%']);

            saveAsExcel(exportData, "報價單", `報價單_${quote.clientName}_${quote.date}.xlsx`);
            showToast('已下載客戶報價 Excel（含公司資訊與毛利分析）', 'bg-green-600');
        }
