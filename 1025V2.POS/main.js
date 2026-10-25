        // 初始化渲染
        window.onload = () => {
            renderCompanySettings();
            renderSuppliers();
            renderProducts();
            renderCart();
            renderOrders();
            renderClientQuotes();
            renderSupplierInquiries();
            updateSupplierSelect();
            updateSupplierDatalist(); // 初始化供應商建議清單
            renderDashboard();
            
            // 設定日期預設值
            const today = new Date().toISOString().split('T')[0];
            document.getElementById('quoteDate').value = today;
            document.getElementById('inquiryDate').value = today;
            document.getElementById('reportEndDate').value = today;
            document.getElementById('salesInvoiceDate').value = getFinanceToday();
            addSalesInvoiceLine();
            renderReports();
        };

        // 頁籤切換
        function switchTab(tabId) {
            document.querySelectorAll('.page-content').forEach(p => p.classList.add('hidden'));
            document.querySelectorAll('.tab-btn').forEach(b => {
                b.classList.remove('tab-active', 'text-blue-600', 'text-purple-600', 'text-indigo-600');
                b.classList.add('text-gray-500');
            });

            const page = document.getElementById(`page-${tabId}`);
            if (!page) return; // 不存在的 tabId 不做任何操作
            page.classList.remove('hidden');

            const activeBtn = document.getElementById(`tab-${tabId}`);
            if (!activeBtn) return; // 保險起見，避免壞 id 導致錯誤

            // 根據頁籤不同設定不同顏色
            if (tabId === 'client-quotes') {
                activeBtn.classList.add('tab-active', 'text-purple-600');
            } else if (tabId === 'supplier-inquiries') {
                activeBtn.classList.add('tab-active', 'text-indigo-600');
            } else {
                activeBtn.classList.add('tab-active', 'text-blue-600');
            }
            activeBtn.classList.remove('text-gray-500');
            
            if (tabId === 'dashboard') renderDashboard();
            if (tabId === 'dashboard') renderReports();
            if (tabId === 'counterparties') renderCounterparties();
            if (tabId === 'products') renderProducts();
            if (tabId === 'add') updateSupplierSelect();
            if (tabId === 'purchase') renderCart();
            if (tabId === 'orders') renderOrders();
            if (tabId === 'receiving') renderReceiving();
            if (tabId === 'inventory') renderInventory();
            if (tabId === 'pos') renderPos();
            if (tabId === 'shipping') renderShipping();
            if (tabId === 'finance') renderFinance();
            if (tabId === 'settings') renderCompanySettings();
            if (tabId === 'client-quotes') renderClientQuotes();
            if (tabId === 'supplier-inquiries') {
                renderSupplierInquiries();
                updateSupplierDatalist();
            }
        }

        function renderDashboard() {
            const supplierCount = data.suppliers?.length || 0;
            const productCount = data.products?.length || 0;
            const quoteCount = data.clientQuotes?.length || 0;
            // v11.9 修正：進行中採購項目應顯示尚未"已驗收完成"的訂單數量
            const inProgressOrderCount = (data.orders || []).filter(order => {
                const status = order.status || 'ordered';
                return status !== 'completed' && status !== 'cancelled';
            }).length;
            const orderCount = data.orders?.length || 0;
            const inquiryCount = data.supplierInquiries?.length || 0;

            document.getElementById('dashboardSupplierCount').textContent = supplierCount;
            document.getElementById('dashboardProductCount').textContent = productCount;
            document.getElementById('dashboardQuoteCount').textContent = quoteCount;
            document.getElementById('dashboardCartCount').textContent = inProgressOrderCount;
            document.getElementById('dashboardOrderCount').textContent = orderCount;
            document.getElementById('dashboardInquiryCount').textContent = inquiryCount;

            const quoteStatusCounts = {
                open: 0,
                quoted: 0,
                waiting: 0,
                lost: 0,
                converted: 0,
            };
            (data.clientQuotes || []).forEach(q => {
                if (quoteStatusCounts[q.status] !== undefined) quoteStatusCounts[q.status]++;
            });

            const inquiryStatusCounts = {};
            (data.supplierInquiries || []).forEach(inq => {
                const status = inq.status || 'waiting';
                inquiryStatusCounts[status] = (inquiryStatusCounts[status] || 0) + 1;
            });

            const quoteStatusElement = document.getElementById('dashboardQuoteStatus');
            quoteStatusElement.innerHTML = '';
            const quoteStatusMap = {
                open: '處理中',
                quoted: '已報價',
                waiting: '等回應',
                lost: '未成交',
                converted: '已成交'
            };
            Object.entries(quoteStatusCounts).forEach(([status, count]) => {
                const label = quoteStatusMap[status] || status;
                const row = document.createElement('div');
                row.textContent = `${label}: ${count}`;
                quoteStatusElement.appendChild(row);
            });

            const paymentStatusCounts = {};
            const logisticsStatusCounts = {};
            (data.orders || []).forEach(order => {
                const payStatus = getPurchaseOrderPaymentStatus(order);
                paymentStatusCounts[payStatus] = (paymentStatusCounts[payStatus] || 0) + 1;

                let orderStatus = order.status || 'ordered';
                if (orderStatus === 'pending') orderStatus = 'ordered';
                logisticsStatusCounts[orderStatus] = (logisticsStatusCounts[orderStatus] || 0) + 1;
            });

            const paymentStatusElement = document.getElementById('dashboardPaymentStatus');
            paymentStatusElement.innerHTML = '';
            const paymentStatusMap = {
                unpaid: '未付款',
                paid: '已付款',
                partial: '部分付款',
                monthly: '月結',
                '刷卡': '刷卡',
                '匯款': '匯款',
                '現金': '現金'
            };
            Object.entries(paymentStatusMap).forEach(([status, label]) => {
                const count = paymentStatusCounts[status] || 0;
                const row = document.createElement('div');
                row.textContent = `${label}: ${count}`;
                paymentStatusElement.appendChild(row);
            });

            const logisticsStatusElement = document.getElementById('dashboardLogisticsStatus');
            logisticsStatusElement.innerHTML = '';
            const logisticsStatusMap = {
                ordered: '已下單',
                partial_shipped: '部分出貨',
                partially_received: '部分收貨',
                shipped: '全部出貨',
                arrived: '已收貨',
                completed: '已驗收完成',
                cancelled: '已取消(退)'
            };
            Object.entries(logisticsStatusMap).forEach(([status, label]) => {
                const count = logisticsStatusCounts[status] || 0;
                const row = document.createElement('div');
                row.textContent = `${label}: ${count}`;
                logisticsStatusElement.appendChild(row);
            });

            const inquiryStatusElement = document.getElementById('dashboardInquiryStatus');
            inquiryStatusElement.innerHTML = '';
            Object.entries(inquiryStatusMap).forEach(([status, statusInfo]) => {
                const count = inquiryStatusCounts[status] || 0;
                const row = document.createElement('div');
                row.textContent = `${statusInfo.label}: ${count}`;
                inquiryStatusElement.appendChild(row);
            });
        }
