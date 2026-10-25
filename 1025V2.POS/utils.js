        function toggleMonthlyDays(selectElement, wrapperId) {
            const wrapper = document.getElementById(wrapperId);
            if (!wrapper) return;
            
            if (selectElement.value === '月結') {
                wrapper.style.display = 'block';
            } else {
                wrapper.style.display = 'none';
                // 清空輸入值以避免誤存
                const input = wrapper.querySelector('input');
                if(input) input.value = '';
            }
        }
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

        // 生成產品編號 (p_民國年月+流水號兩位數)
        function generateProductID() {
            const now = new Date();
            const rocYear = now.getFullYear() - 1911;
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const datePrefix = `p_${rocYear}${month}`;

            const maxSeq = data.products.reduce((max, product) => {
                const sequence = String(product.id || '').match(new RegExp(`^${datePrefix}(\\d+)$`));
                return sequence ? Math.max(max, Number(sequence[1])) : max;
            }, 0);
            const seq = String(maxSeq + 1).padStart(2, '0');

            return `${datePrefix}${seq}`;
        }

        function hasProductReferences(productId) {
            const containsReference = value => {
                if (Array.isArray(value)) return value.some(containsReference);
                if (!value || typeof value !== 'object') return false;
                return Object.entries(value).some(([key, nested]) =>
                    (key.toLocaleLowerCase().endsWith('productid') && nested === productId) ||
                    containsReference(nested)
                );
            };

            return Object.entries(data).some(([key, value]) => key === 'products'
                ? (value || []).some(product => product.id !== productId && containsReference(product))
                : containsReference(value)
            );
        }

        function generateQuoteID() {
            const now = new Date();
            const rocYear = now.getFullYear() - 1911;
            const month = String(now.getMonth() + 1).padStart(2, "0");
            const day = String(now.getDate()).padStart(2, "0");
            const datePrefix = `${rocYear}${month}${day}`;
            const existing = data.clientQuotes.filter(q => q.id && q.id.startsWith(`QT${datePrefix}`));
            const maxSeq = existing.length > 0 ? Math.max(...existing.map(q => parseInt(q.id.slice(-2)) || 0)) : 0;
            const seq = String(maxSeq + 1).padStart(2, "0");
            return `QT${datePrefix}${seq}`;
        }
        function renderWithFragment(container, renderFn) {
            if (!container) return;
            const fragment = document.createDocumentFragment();
            renderFn(fragment);
            container.innerHTML = '';
            container.appendChild(fragment);
        }

        function showToast(message, bgColor = 'bg-black') {
            const toast = document.getElementById('toast');
            if (!toast) return;
            toast.textContent = message;
            toast.className = `fixed bottom-5 right-5 px-6 py-3 rounded-lg shadow-lg text-white transition-opacity duration-300 z-50 ${bgColor}`;
            toast.classList.remove('hidden');
            toast.style.opacity = '1';
            setTimeout(() => {
                toast.style.opacity = '0';
                setTimeout(() => toast.classList.add('hidden'), 300);
            }, 2500);
        }

        function getInputValue(id) {
            return document.getElementById(id)?.value || '';
        }

        function renderList(containerId, items, itemRenderer, emptyHtml) {
            const container = document.getElementById(containerId);
            if (!container) return;

            const safeItems = Array.isArray(items) ? items : [];
            if (safeItems.length === 0) {
                container.innerHTML = emptyHtml || '';
                return;
            }

            renderWithFragment(container, (fragment) => {
                safeItems.forEach(item => itemRenderer(fragment, item));
            });
        }

        function filterSafe(array, predicate) {
            return (Array.isArray(array) ? array : []).filter(predicate);
        }

        function formatDateTime(value) {
            if (!value) return '-';
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return '-';
            return date.toLocaleString('zh-TW', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        }
        function calculateEstimatedArrival(orderDateStr, items) {
            if (!orderDateStr || !items || items.length === 0) return "未定";

            let maxDays = 0;
            let hasParsableData = false;

            items.forEach(item => {
                const p = data.products.find(prod => prod.id === item.productId);
                if (p && p.deliveryTime) {
                    let deliveryTime = p.deliveryTime.trim();
                    let val = 0;
                    
                    // 如果只是數字，自動當作天數
                    if (/^\d+$/.test(deliveryTime)) {
                        val = parseInt(deliveryTime);
                        hasParsableData = true;
                    } else {
                        // 解析包含單位的格式
                        const match = deliveryTime.match(/(\d+)\s*(天|日|day|週|周|week)/i);
                        if (match) {
                            val = parseInt(match[1]);
                            const unit = match[2].toLowerCase();
                            if (unit.includes('週') || unit.includes('周') || unit.includes('week')) {
                                val *= 7;
                            }
                            hasParsableData = true;
                        }
                    }
                    
                    if (val > maxDays) maxDays = val;
                }
            });

            if (!hasParsableData && maxDays === 0) return "--";

            const orderDate = new Date(orderDateStr);
            orderDate.setDate(orderDate.getDate() + maxDays);
            
            return orderDate.toISOString().split('T')[0];
        }

        function calculateMonthlyDueDate(orderDateStr, monthlyDays){
            if(!orderDateStr || !monthlyDays) return "";
            const orderDate = new Date(orderDateStr);
            const lastDay = new Date(orderDate.getFullYear(), orderDate.getMonth()+1, 0);
            lastDay.setDate(lastDay.getDate() + parseInt(monthlyDays));
            return lastDay.toISOString().split("T")[0];
        }
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
                order.status = status;
                saveData();
                renderOrders();
                showToast('訂單狀態已更新', 'bg-blue-500');
            }
        }
        function saveAsExcel(dataArray, sheetName, fileName) {
            const ws = XLSX.utils.aoa_to_sheet(dataArray);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, sheetName);
            XLSX.writeFile(wb, fileName);
        }
        function parseCSV(text) {
            const rows = [];
            let row = [];
            let col = "";
            let inQuotes = false;
            for (let i = 0; i < text.length; i++) {
                const char = text[i];
                const next = text[i+1];
                if (inQuotes) {
                    if (char === '"' && next === '"') { col += '"'; i++; }
                    else if (char === '"') { inQuotes = false; }
                    else { col += char; }
                } else {
                    if (char === '"') { inQuotes = true; }
                    else if (char === ',') { row.push(col.trim()); col = ""; }
                    else if (char === '\n' || char === '\r') {
                        if (col || row.length > 0) { row.push(col.trim()); rows.push(row); }
                        row = []; col = "";
                        if (char === '\r' && next === '\n') i++;
                    } else { col += char; }
                }
            }
            if (col || row.length > 0) { row.push(col.trim()); rows.push(row); }
            return rows;
        }

        function getTodayStr() {
            return new Date().toISOString().split('T')[0];
        }

        // v11.1 更新狀態翻譯
        function translateStatus(status) {
            const map = {
                'ordered': '已下單',
                'partial_shipped': '部分出貨',
                'partially_received': '部分收貨',
                'shipped': '全部出貨',
                'arrived': '已收貨',
                'completed': '已驗收完成',
                'cancelled': '已取消(退)',
                'pending': '已下單' // backward compatibility
            };
            return map[status] || status;
        }

        // v11.1 更新反向翻譯 (for import)
        function reverseStatus(text) {
            const map = {
                '已下單': 'ordered',
                '處理中': 'ordered', // backward compatibility
                '部分出貨': 'partial_shipped',
                '部分收貨': 'partially_received',
                '全部出貨': 'shipped',
                '已出貨': 'shipped', // backward compatibility
                '已收貨': 'arrived',
                '已驗收完成': 'completed',
                '已完成': 'completed', // backward compatibility
                '已取消(退)': 'cancelled'
            };
            return map[text] || 'ordered';
        }

        function translatePayment(status) {
            if (status === 'unpaid') return '未付款';
            if (status === 'partial') return '部分付款';
            if (status === 'paid') return '已付款';
            if (status === 'monthly') return '月結';
            if (status === '刷卡') return '刷卡';
            if (status === '匯款') return '匯款';
            if (status === '現金') return '現金';
            return '未付款';
        }

        function reversePayment(text) {
            if (text === '部分付款') return 'partial';
            if (text === '已付款') return 'paid';
            if (text === '月結') return 'monthly';
            if (text === '刷卡') return '刷卡';
            if (text === '匯款') return '匯款';
            if (text === '現金') return '現金';
            return 'unpaid';
        }
        function closeModal(modalId) {
            document.getElementById(modalId).classList.remove('modal-active');
        }
