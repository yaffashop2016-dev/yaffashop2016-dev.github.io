        function reportEscape(value) {
            return String(value ?? '').replace(/[&<>'"]/g, character => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
            }[character]));
        }

        function reportMoney(value) {
            const amount = Math.round(Number(value) || 0);
            return amount < 0 ? `-$${Math.abs(amount).toLocaleString('zh-TW')}` : `$${amount.toLocaleString('zh-TW')}`;
        }

        function reportDateValue(move) {
            return move.sourceDate || (move.createdAt ? move.createdAt.slice(0, 10) : '');
        }

        function getReportMoves() {
            const start = document.getElementById('reportStartDate')?.value || '';
            const end = document.getElementById('reportEndDate')?.value || '';
            return (data.inventoryMovements || []).filter(move => {
                if (!['outbound', 'customer-return'].includes(move.type)) return false;
                const date = reportDateValue(move);
                return (!start || date >= start) && (!end || date <= end);
            });
        }

        function reportMoveValues(move) {
            const inventoryItem = data.inventory.find(item => item.id === move.inventoryId || (
                item.productId === move.productId && item.spec === move.spec
            ));
            const receivable = (data.accountsReceivable || []).find(item =>
                item.id === move.accountsDocumentId || item.id === move.salesNo || item.id === move.orderId
            );
            const returnTransaction = move.type === 'customer-return'
                ? (data.returnTransactions || []).find(item => item.id === move.returnId)
                : null;
            const receivableLine = (receivable?.lines || []).find(line =>
                line.inventoryId && line.inventoryId === move.inventoryId
            ) || (receivable?.lines || []).find(line => line.productId === move.productId);
            const movementQuantity = Number(move.quantity) || 0;
            const isCustomerReturn = move.type === 'customer-return';
            const quantity = isCustomerReturn ? -movementQuantity : movementQuantity;
            const salesPrice = Number.isFinite(Number(move.salesPrice)) ? Number(move.salesPrice) : (Number(move.unitCost) || 0);
            const costUnit = Number.isFinite(Number(move.costUnit)) ? Number(move.costUnit) : (Number(inventoryItem?.averageCost) || 0);
            const grossRevenue = Number.isFinite(Number(receivableLine?.amount))
                ? Number(receivableLine.amount)
                : salesPrice * movementQuantity;
            const revenue = isCustomerReturn
                ? -Math.abs(Number(move.totalCost) || grossRevenue)
                : move.returnId && move.type === 'outbound'
                    ? salesPrice * movementQuantity
                    : grossRevenue;
            const cost = isCustomerReturn ? -costUnit * movementQuantity : costUnit * movementQuantity;
            return {
                quantity,
                revenue,
                cost,
                profit: revenue - cost,
                receivableId: receivable?.id || '',
                documentDiscount: Math.max(0, Number(receivable?.discount) || 0),
                salesPrice,
                costUnit,
                productName: move.productName || move.productId || '未知產品',
                productId: move.productId || '',
                customerName: returnTransaction?.customerName || receivable?.counterpartyName || '未關聯客戶',
                channel: isCustomerReturn ? '客戶退貨' : move.channel || '未指定',
                warehouse: move.warehouse || '未指定',
                date: reportDateValue(move)
            };
        }

        function getReportSalesValues(moves) {
            const values = moves.map(reportMoveValues);
            const byReceivable = new Map();
            values.forEach((item, index) => {
                if (!item.receivableId) return;
                const group = byReceivable.get(item.receivableId) || { indexes: [], discount: item.documentDiscount };
                group.indexes.push(index);
                byReceivable.set(item.receivableId, group);
            });
            byReceivable.forEach(group => {
                const grossRevenue = group.indexes.reduce((sum, index) => sum + values[index].revenue, 0);
                let remainingDiscount = Math.min(group.discount, grossRevenue);
                if (grossRevenue <= 0 || remainingDiscount <= 0) return;
                group.indexes.forEach((index, position) => {
                    const item = values[index];
                    const discount = position === group.indexes.length - 1
                        ? remainingDiscount
                        : Math.min(remainingDiscount, group.discount * item.revenue / grossRevenue);
                    item.revenue -= discount;
                    item.profit = item.revenue - item.cost;
                    remainingDiscount -= discount;
                });
            });
            return values;
        }

        function reportTable(headers, rows, emptyText = '目前沒有符合條件的資料') {
            if (!rows.length) return `<div class="text-sm text-gray-400 py-4">${emptyText}</div>`;
            return `<table class="min-w-full text-left text-xs text-gray-700"><thead><tr class="bg-gray-100">${headers.map(header => `<th class="px-2 py-2 whitespace-nowrap">${header}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
        }

        function reportWeekKey(dateString) {
            const date = new Date(`${dateString}T00:00:00`);
            const day = date.getDay() || 7;
            date.setDate(date.getDate() - day + 1);
            return date.toISOString().slice(0, 10);
        }

        function reportPeriodKey(dateString, grouping) {
            if (grouping === 'month') return dateString.slice(0, 7);
            if (grouping === 'week') return reportWeekKey(dateString);
            return dateString;
        }

        function renderReports() {
            const moves = getReportMoves();
            const values = getReportSalesValues(moves);
            const totals = values.reduce((summary, item) => {
                summary.revenue += item.revenue;
                summary.cost += item.cost;
                summary.profit += item.profit;
                summary.quantity += item.quantity;
                return summary;
            }, { revenue: 0, cost: 0, profit: 0, quantity: 0 });

            document.getElementById('reportRevenue').textContent = reportMoney(totals.revenue);
            document.getElementById('reportCost').textContent = reportMoney(totals.cost);
            document.getElementById('reportProfit').textContent = reportMoney(totals.profit);
            document.getElementById('reportSoldQuantity').textContent = totals.quantity.toLocaleString('zh-TW');
            renderGrossProfitReport(values);
            renderCustomerProfitReport(values);
            renderProductPerformanceReport(values);
            renderOrderSummaryReport(values);
            renderProductSalesReport(values);
            renderInventorySummaryReports();
            renderFinanceAgingReports();
            renderProcurementReport();
            renderSlowMovingReport();
        }

        function reportMarginPercent(profit, revenue) {
            return revenue > 0 ? `${(profit / revenue * 100).toFixed(1)}%` : '0.0%';
        }

        function reportSalesGroups(values, getKey, getName) {
            const groups = new Map();
            values.forEach(item => {
                const key = getKey(item);
                const group = groups.get(key) || {
                    name: getName(item),
                    quantity: 0,
                    revenue: 0,
                    cost: 0,
                    profit: 0
                };
                group.quantity += item.quantity;
                group.revenue += item.revenue;
                group.cost += item.cost;
                group.profit += item.profit;
                groups.set(key, group);
            });
            return Array.from(groups.values()).sort((a, b) => b.profit - a.profit);
        }

        function getReportProductProfit(values) {
            return reportSalesGroups(
                values,
                item => item.productId || item.productName,
                item => item.productName
            );
        }

        function getReportCustomerProfit(values) {
            return reportSalesGroups(values, item => item.customerName, item => item.customerName);
        }

        function getReportPeriodProfit(values, grouping) {
            return reportSalesGroups(
                values,
                item => reportPeriodKey(item.date, grouping),
                item => reportPeriodKey(item.date, grouping)
            ).sort((a, b) => b.name.localeCompare(a.name));
        }

        function getReportInventoryGroups(dimension) {
            const groups = new Map();
            (data.inventory || []).forEach(item => {
                const product = (data.products || []).find(candidate => candidate.id === item.productId);
                const name = dimension === 'warehouse'
                    ? item.warehouse || '未指定'
                    : product?.category || '未分類';
                const group = groups.get(name) || {
                    name,
                    itemCount: 0,
                    quantity: 0,
                    availableQuantity: 0,
                    amount: 0
                };
                const quantity = Number(item.quantity) || 0;
                const amount = Number.isFinite(Number(item.totalCost))
                    ? Number(item.totalCost)
                    : quantity * (Number(item.averageCost) || 0);
                group.itemCount += 1;
                group.quantity += quantity;
                group.availableQuantity += Number(item.availableQuantity) || 0;
                group.amount += amount;
                groups.set(name, group);
            });
            return Array.from(groups.values()).sort((a, b) => b.amount - a.amount);
        }

        function getReportAgingGroups(documents, asOfDate) {
            const groups = new Map();
            const asOfTime = Date.parse(`${asOfDate}T00:00:00Z`);
            const bucketNames = ['未到期', '逾期 1-30 天', '逾期 31-60 天', '逾期 61-90 天', '逾期 90 天以上', '未設定到期日', '退貨折讓'];
            (documents || []).forEach(item => {
                if (item.status === 'void') return;
                const isSupplierCredit = item.returnKind === 'supplier-credit';
                const balance = isSupplierCredit
                    ? Math.min(0, Math.round(Number(item.totalAmount || 0)))
                    : Math.max(0, Math.round(Number(item.totalAmount || 0) - Number(item.paidAmount || 0)));
                if (balance === 0) return;
                const name = item.counterpartyName || '未指定往來對象';
                const group = groups.get(name) || {
                    name,
                    documentCount: 0,
                    buckets: Object.fromEntries(bucketNames.map(bucket => [bucket, 0])),
                    total: 0
                };
                let bucket;
                if (isSupplierCredit) {
                    bucket = '退貨折讓';
                } else if (!item.dueDate || !Number.isFinite(asOfTime) || !Number.isFinite(Date.parse(`${item.dueDate}T00:00:00Z`))) {
                    bucket = '未設定到期日';
                } else {
                    const daysOverdue = Math.floor((asOfTime - Date.parse(`${item.dueDate}T00:00:00Z`)) / 86400000);
                    if (daysOverdue <= 0) bucket = '未到期';
                    else if (daysOverdue <= 30) bucket = '逾期 1-30 天';
                    else if (daysOverdue <= 60) bucket = '逾期 31-60 天';
                    else if (daysOverdue <= 90) bucket = '逾期 61-90 天';
                    else bucket = '逾期 90 天以上';
                }
                group.documentCount += 1;
                group.buckets[bucket] += balance;
                group.total += balance;
                groups.set(name, group);
            });
            return Array.from(groups.values()).sort((a, b) => b.total - a.total);
        }

        function reportAgingRows(groups) {
            const buckets = ['未到期', '逾期 1-30 天', '逾期 31-60 天', '逾期 61-90 天', '逾期 90 天以上', '未設定到期日', '退貨折讓'];
            return [
                ['客戶／供應商', '未結單數', ...buckets, '未結餘額'],
                ...groups.map(group => [
                    group.name,
                    group.documentCount,
                    ...buckets.map(bucket => group.buckets[bucket]),
                    group.total
                ])
            ];
        }

        function reportInventoryRows(groups) {
            return [
                ['分類／倉別', '庫存項目數', '庫存數量', '可用數量', '庫存金額(NTD)'],
                ...groups.map(group => [group.name, group.itemCount, group.quantity, group.availableQuantity, group.amount])
            ];
        }

        function reportSalesRows(groups) {
            return [
                ['商品／客戶／期間', '銷售數量', '銷售收入(NTD)', '銷售成本(NTD)', '毛利(NTD)', '毛利率'],
                ...groups.map(group => [
                    group.name,
                    group.quantity,
                    group.revenue,
                    group.cost,
                    group.profit,
                    reportMarginPercent(group.profit, group.revenue)
                ])
            ];
        }

        function renderCustomerProfitReport(values) {
            const groups = getReportCustomerProfit(values);
            const rows = groups.map(item => `<tr class="border-b"><td class="px-2 py-2">${reportEscape(item.name)}</td><td class="px-2 py-2">${item.quantity}</td><td class="px-2 py-2">${reportMoney(item.revenue)}</td><td class="px-2 py-2">${reportMoney(item.cost)}</td><td class="px-2 py-2 font-bold">${reportMoney(item.profit)}</td><td class="px-2 py-2">${reportMarginPercent(item.profit, item.revenue)}</td></tr>`);
            document.getElementById('customerProfitReport').innerHTML = reportTable(['客戶', '銷售數量', '收入', '成本', '毛利', '毛利率'], rows);
        }

        function renderInventorySummaryReports() {
            const warehouseGroups = getReportInventoryGroups('warehouse');
            const categoryGroups = getReportInventoryGroups('category');
            const makeRows = groups => groups.map(item => `<tr class="border-b"><td class="px-2 py-2">${reportEscape(item.name)}</td><td class="px-2 py-2">${item.itemCount}</td><td class="px-2 py-2">${item.quantity}</td><td class="px-2 py-2">${item.availableQuantity}</td><td class="px-2 py-2 font-bold">${reportMoney(item.amount)}</td></tr>`);
            const headers = ['分類／倉別', '庫存項目數', '庫存數量', '可用數量', '庫存金額'];
            document.getElementById('inventoryWarehouseReport').innerHTML = reportTable(headers, makeRows(warehouseGroups));
            document.getElementById('inventoryCategoryReport').innerHTML = reportTable(headers, makeRows(categoryGroups));
        }

        function renderFinanceAgingReports() {
            const asOfDate = getFinanceToday();
            const receivables = getReportAgingGroups(data.accountsReceivable, asOfDate);
            const payables = getReportAgingGroups(data.accountsPayable, asOfDate);
            const headers = ['客戶／供應商', '未結單數', '未到期', '逾期 1-30 天', '逾期 31-60 天', '逾期 61-90 天', '逾期 90 天以上', '未設定到期日', '退貨折讓', '未結餘額'];
            const makeRows = groups => groups.map(item => `<tr class="border-b"><td class="px-2 py-2">${reportEscape(item.name)}</td><td class="px-2 py-2">${item.documentCount}</td><td class="px-2 py-2">${reportMoney(item.buckets['未到期'])}</td><td class="px-2 py-2">${reportMoney(item.buckets['逾期 1-30 天'])}</td><td class="px-2 py-2">${reportMoney(item.buckets['逾期 31-60 天'])}</td><td class="px-2 py-2">${reportMoney(item.buckets['逾期 61-90 天'])}</td><td class="px-2 py-2">${reportMoney(item.buckets['逾期 90 天以上'])}</td><td class="px-2 py-2">${reportMoney(item.buckets['未設定到期日'])}</td><td class="px-2 py-2">${reportMoney(item.buckets['退貨折讓'])}</td><td class="px-2 py-2 font-bold">${reportMoney(item.total)}</td></tr>`);
            document.getElementById('receivableAgingReport').innerHTML = reportTable(headers, makeRows(receivables));
            document.getElementById('payableAgingReport').innerHTML = reportTable(headers, makeRows(payables));
        }

        function getReportProcurementGroups() {
            const start = document.getElementById('reportStartDate')?.value || '';
            const end = document.getElementById('reportEndDate')?.value || '';
            const groups = new Map();
            (data.orders || []).forEach(order => {
                const date = order.date || '';
                if ((start && (!date || date < start)) || (end && (!date || date > end))) return;
                const period = date.slice(0, 7) || '未設定日期';
                const supplierName = order.supplierName || order.items?.[0]?.supplierName || '未指定供應商';
                const key = `${period}|${supplierName}`;
                const group = groups.get(key) || {
                    name: supplierName,
                    period,
                    orderCount: 0,
                    quantity: 0,
                    purchaseAmount: 0,
                    payableAmount: 0,
                    paidAmount: 0,
                    balance: 0
                };
                group.orderCount += 1;
                group.quantity += (order.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
                group.purchaseAmount += calculateOrderTotal(order);
                (data.accountsPayable || [])
                    .filter(document => document.sourceOrderId === order.id && document.status !== 'void')
                    .forEach(document => {
                        const payable = Number(document.totalAmount) || 0;
                        const paid = Number(document.paidAmount) || 0;
                        group.payableAmount += payable;
                        group.paidAmount += paid;
                        group.balance += document.returnKind === 'supplier-credit'
                            ? Math.min(0, payable)
                            : Math.max(0, payable - paid);
                    });
                groups.set(key, group);
            });
            return Array.from(groups.values()).sort((a, b) => b.period.localeCompare(a.period) || a.name.localeCompare(b.name));
        }

        function reportProcurementRows(groups) {
            return [
                ['月份', '供應商', '訂單數', '採購數量', '採購金額(NTD)', '已建應付(NTD)', '已付(NTD)', '應付餘額(NTD)'],
                ...groups.map(group => [
                    group.period,
                    group.name,
                    group.orderCount,
                    group.quantity,
                    group.purchaseAmount,
                    group.payableAmount,
                    group.paidAmount,
                    group.balance
                ])
            ];
        }

        function renderProcurementReport() {
            const groups = getReportProcurementGroups();
            const rows = groups.map(item => `<tr class="border-b"><td class="px-2 py-2">${reportEscape(item.period)}</td><td class="px-2 py-2">${reportEscape(item.name)}</td><td class="px-2 py-2">${item.orderCount}</td><td class="px-2 py-2">${item.quantity}</td><td class="px-2 py-2">${reportMoney(item.purchaseAmount)}</td><td class="px-2 py-2">${reportMoney(item.payableAmount)}</td><td class="px-2 py-2">${reportMoney(item.paidAmount)}</td><td class="px-2 py-2 font-bold">${reportMoney(item.balance)}</td></tr>`);
            document.getElementById('procurementReport').innerHTML = reportTable(['月份', '供應商', '訂單數', '採購數量', '採購金額', '已建應付', '已付', '應付餘額'], rows);
        }

        function exportAnalyticalReports() {
            if (typeof XLSX === 'undefined') {
                return showToast('Excel 匯出元件尚未載入，請重新整理後再試。', 'bg-red-500');
            }
            const values = getReportSalesValues(getReportMoves());
            const grouping = document.getElementById('reportGrouping')?.value || 'day';
            const sheets = [
                ['商品毛利', reportSalesRows(getReportProductProfit(values))],
                ['客戶毛利', reportSalesRows(getReportCustomerProfit(values))],
                ['期間毛利', reportSalesRows(getReportPeriodProfit(values, grouping))],
                ['庫存倉別', reportInventoryRows(getReportInventoryGroups('warehouse'))],
                ['庫存分類', reportInventoryRows(getReportInventoryGroups('category'))],
                ['應收帳齡', reportAgingRows(getReportAgingGroups(data.accountsReceivable, getFinanceToday()))],
                ['應付帳齡', reportAgingRows(getReportAgingGroups(data.accountsPayable, getFinanceToday()))],
                ['採購統計', reportProcurementRows(getReportProcurementGroups())]
            ];
            const workbook = XLSX.utils.book_new();
            sheets.forEach(([name, rows]) => {
                XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
            });
            const fileName = `營運分析報表_${getTodayStr()}.xlsx`;
            XLSX.writeFile(workbook, fileName);
            showToast('分析報表匯出成功', 'bg-green-600');
        }

        function renderGrossProfitReport(values) {
            const groups = getReportProductProfit(values);
            const rows = groups.map(item => `<tr class="border-b"><td class="px-2 py-2">${reportEscape(item.name)}</td><td class="px-2 py-2">${item.quantity}</td><td class="px-2 py-2">${reportMoney(item.revenue)}</td><td class="px-2 py-2">${reportMoney(item.cost)}</td><td class="px-2 py-2 font-bold">${reportMoney(item.profit)}</td><td class="px-2 py-2">${reportMarginPercent(item.profit, item.revenue)}</td></tr>`);
            document.getElementById('grossProfitReport').innerHTML = reportTable(['商品', '已售數量', '收入', '成本', '毛利', '毛利率'], rows);
        }

        function renderProductPerformanceReport(values) {
            const groups = {};
            values.forEach(item => {
                const group = groups[item.productId] || { name: item.productName, quantity: 0, revenue: 0, profit: 0, channels: {} };
                group.quantity += item.quantity;
                group.revenue += item.revenue;
                group.profit += item.profit;
                group.channels[item.channel] = (group.channels[item.channel] || 0) + item.quantity;
                groups[item.productId] = group;
            });
            const rows = Object.values(groups).sort((a, b) => b.profit - a.profit).map(item => {
                const bestChannel = Object.entries(item.channels).sort((a, b) => b[1] - a[1])[0]?.[0] || '未指定';
                return `<tr class="border-b"><td class="px-2 py-2">${reportEscape(item.name)}</td><td class="px-2 py-2">${item.quantity}</td><td class="px-2 py-2">${reportMoney(item.revenue)}</td><td class="px-2 py-2 font-bold">${reportMoney(item.profit)}</td><td class="px-2 py-2">${reportEscape(bestChannel)}</td></tr>`;
            });
            document.getElementById('productPerformanceReport').innerHTML = reportTable(['商品', '數量', '收入', '毛利', '最佳通路'], rows);
        }

        function renderOrderSummaryReport(values) {
            const grouping = document.getElementById('reportGrouping')?.value || 'day';
            const groups = getReportPeriodProfit(values, grouping);
            const rows = groups.map(item => `<tr class="border-b"><td class="px-2 py-2">${reportEscape(item.name)}</td><td class="px-2 py-2">${item.quantity}</td><td class="px-2 py-2">${reportMoney(item.revenue)}</td><td class="px-2 py-2">${reportMoney(item.cost)}</td><td class="px-2 py-2 font-bold">${reportMoney(item.profit)}</td><td class="px-2 py-2">${reportMarginPercent(item.profit, item.revenue)}</td></tr>`);
            document.getElementById('orderSummaryReport').innerHTML = reportTable(['期間', '已售數量', '銷售額', '成本', '毛利', '毛利率'], rows);
        }

        function renderProductSalesReport(values) {
            const groups = {};
            values.forEach(item => {
                const key = `${item.productId}|${item.channel}`;
                const group = groups[key] || { name: item.productName, productId: item.productId, channel: item.channel, quantity: 0, revenue: 0 };
                group.quantity += item.quantity;
                group.revenue += item.revenue;
                groups[key] = group;
            });
            const rows = Object.values(groups).sort((a, b) => b.quantity - a.quantity).map(item => {
                const stock = data.inventory.filter(inventoryItem => inventoryItem.productId === item.productId).reduce((total, inventoryItem) => total + (inventoryItem.availableQuantity || 0), 0);
                return `<tr class="border-b"><td class="px-2 py-2">${reportEscape(item.name)}</td><td class="px-2 py-2">${reportEscape(item.channel)}</td><td class="px-2 py-2">${stock}</td><td class="px-2 py-2">${item.quantity}</td><td class="px-2 py-2">${reportMoney(item.revenue)}</td></tr>`;
            });
            document.getElementById('productSalesReport').innerHTML = reportTable(['商品', '銷售通路', '目前可用庫存', '已售數量', '銷售額'], rows);
        }

        function renderSlowMovingReport() {
            const endDate = document.getElementById('reportEndDate')?.value || new Date().toISOString().slice(0, 10);
            const endTime = new Date(`${endDate}T23:59:59`).getTime();
            const rows = data.inventory.filter(item => (item.availableQuantity || 0) > 0).map(item => {
                const sales = (data.inventoryMovements || []).filter(move => move.type === 'outbound' && (move.inventoryId === item.id || (move.productId === item.productId && move.spec === item.spec)));
                const lastSale = sales.map(reportDateValue).filter(Boolean).sort().pop() || '';
                const days = lastSale ? Math.max(0, Math.floor((endTime - new Date(`${lastSale}T00:00:00`).getTime()) / 86400000)) : null;
                return { item, lastSale, days };
            }).filter(result => result.days === null || result.days >= 30).sort((a, b) => (b.days ?? 999999) - (a.days ?? 999999));
            const rowsHtml = rows.map(result => `<tr class="border-b"><td class="px-2 py-2">${reportEscape(result.item.productName)}</td><td class="px-2 py-2">${reportEscape(result.item.spec || '無規格')}</td><td class="px-2 py-2">${result.item.availableQuantity}</td><td class="px-2 py-2">${result.lastSale || '從未售出'}</td><td class="px-2 py-2 font-bold">${result.days === null ? '未售出' : `${result.days} 天`}</td></tr>`);
            document.getElementById('slowMovingReport').innerHTML = reportTable(['商品', '規格', '現有可用庫存', '最後售出日', '未售出天數'], rowsHtml, '目前沒有超過 30 天未售出的庫存');
        }
