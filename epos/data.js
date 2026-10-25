        // 資料初始化
        function readStoredProcurementData(key) {
            try {
                const raw = localStorage.getItem(key);
                const parsed = raw ? JSON.parse(raw) : null;
                return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
            } catch (error) {
                console.error(`讀取本機資料 ${key} 失敗:`, error);
                return null;
            }
        }

        let data = readStoredProcurementData('procurementDataV2') || readStoredProcurementData('procurementData') || {
            suppliers: [],
            products: [],
            cart: [], // 採購清單暫存
            orders: [], // 歷史訂單
            clientQuotes: [], // 客戶報價單
            supplierInquiries: [], // 供應商詢價單
            inventory: [], // 庫存主檔
            inventoryMovements: [], // 庫存異動明細
            inventoryBatches: [], // 庫存批次
            returnTransactions: [] // 退換貨交易
        };
        if (!data.companyProfile || typeof data.companyProfile !== 'object' || Array.isArray(data.companyProfile)) {
            data.companyProfile = {};
        }

        const dataCollections = [
            'suppliers', 'products', 'cart', 'orders', 'clientQuotes', 'supplierInquiries',
            'inventory', 'inventoryMovements', 'inventoryBatches', 'goodsReceipts', 'accountsReceivable',
            'accountsPayable', 'financeCustomers', 'returnTransactions'
        ];
        dataCollections.forEach(key => {
            if (!Array.isArray(data[key])) data[key] = [];
        });

        function getProductPurchasePrice(product) {
            return Number(product?.purchasePrice ?? product?.price) || 0;
        }

        function getProductCurrency(product) {
            return product?.currency === 'RMB' ? 'RMB' : 'NTD';
        }

        function getProductExchangeRate(product) {
            if (getProductCurrency(product) === 'NTD') return 1;
            const rate = Number(product?.exchangeRate);
            return Number.isFinite(rate) && rate > 0 ? rate : 0;
        }

        function convertCurrencyToNtd(amount, currency, exchangeRate) {
            const value = Number(amount ?? 0);
            const rate = currency === 'NTD' ? 1 : Number(exchangeRate);
            if (!Number.isFinite(value) || !Number.isFinite(rate) || rate <= 0) return Number.NaN;
            return value * rate;
        }

        function getProductPurchasePriceNtd(product) {
            return convertCurrencyToNtd(
                getProductPurchasePrice(product),
                getProductCurrency(product),
                getProductExchangeRate(product)
            );
        }

        function getProductSalesPrice(product) {
            return product?.salesPrice === '' || product?.salesPrice === null || product?.salesPrice === undefined
                ? 0
                : Number(product.salesPrice) || 0;
        }

        function migrateFinanceData() {
            if (!Array.isArray(data.accountsReceivable)) data.accountsReceivable = [];
            if (!Array.isArray(data.accountsPayable)) data.accountsPayable = [];
            if (!Array.isArray(data.financeCustomers)) data.financeCustomers = [];
            data.accountsReceivable.forEach((document, index) => {
                const name = String(document.counterpartyName || '').trim();
                if (!name) return;
                const normalizedName = name.toLocaleLowerCase();
                let customer = data.financeCustomers.find(item =>
                    String(item.name || '').trim().toLocaleLowerCase() === normalizedName
                );
                if (!customer) {
                    customer = {
                        id: document.customerId || `fc_legacy_${index}`,
                        name
                    };
                    data.financeCustomers.push(customer);
                }
                customer.taxId ||= document.customerTaxId || '';
                customer.contactName ||= document.customerContactName || '';
                customer.phone ||= document.customerPhone || '';
                customer.email ||= document.customerEmail || '';
                customer.address ||= document.customerAddress || '';
                customer.closingDay ||= document.closingDay || '';
                customer.paymentDay ||= document.paymentDay || '';
            });
            const roundFinanceNtd = value => Math.round(Number(value) || 0);
            [...data.accountsReceivable, ...data.accountsPayable].forEach(document => {
                ['subtotal', 'shipping', 'discount', 'taxAmount', 'adjustmentAmount', 'totalAmount', 'paidAmount'].forEach(field => {
                    if (document[field] !== undefined) document[field] = roundFinanceNtd(document[field]);
                });
                (document.lines || []).forEach(line => {
                    ['amount', 'shippingAmount', 'totalAmount'].forEach(field => {
                        if (line[field] !== undefined) line[field] = roundFinanceNtd(line[field]);
                    });
                });
                (document.payments || []).forEach(payment => {
                    payment.amount = roundFinanceNtd(payment.amount);
                });
                if (document.payments?.length) {
                    document.paidAmount = roundFinanceNtd(document.payments.reduce((sum, payment) => sum + payment.amount, 0));
                }
            });
        }

        // 舊資料遷移檢查
        if (!data.orders) data.orders = [];
        if (!data.clientQuotes) data.clientQuotes = [];
        if (!data.supplierInquiries) data.supplierInquiries = [];
        migrateFinanceData();
        if (!data.inventory) data.inventory = [];
        if (!data.inventoryMovements) data.inventoryMovements = [];
        if (!data.inventoryBatches) data.inventoryBatches = [];
        (data.products || []).forEach(product => {
            if (!product.productType) product.productType = 'standard';
            if (['kit', 'sales-bundle'].includes(product.productType) && !Array.isArray(product.components)) product.components = [];
            if (product.purchasePrice === undefined) product.purchasePrice = Number(product.price) || 0;
            if (product.salesPrice === undefined || product.salesPrice === null) product.salesPrice = '';
            product.sku ??= '';
            product.barcode ??= '';
            product.category ??= '';
            product.unit ||= 'pcs';
            product.safetyStock = Math.max(0, Number(product.safetyStock) || 0);
            product.reorderPoint = Math.max(0, Number(product.reorderPoint) || 0);
            if (product.isActive === undefined) product.isActive = true;
            product.price = product.purchasePrice;
            product.currency = getProductCurrency(product);
            product.exchangeRate = product.currency === 'NTD' ? 1 : getProductExchangeRate(product);
            product.salesPriceHistory = Array.isArray(product.salesPriceHistory)
                ? product.salesPriceHistory.slice(-2)
                : [];
        });
        data.cart.forEach(item => {
            if (!item.currency) item.currency = 'NTD';
            if (item.currency === 'NTD') item.exchangeRate = 1;
        });

        // v11.9 新增：確保現有訂單有完整的屬性結構
        data.orders.forEach(order => {
            if (order.inventoryTransferred === undefined) {
                order.inventoryTransferred = false;
            }
            if (order.inventoryTransferAt === undefined) {
                order.inventoryTransferAt = '';
            }
        });
        function migrateReceivingData() {
            if (!Array.isArray(data.goodsReceipts)) data.goodsReceipts = [];
            (data.orders || []).forEach(order => {
                if (!Array.isArray(order.items)) order.items = [];
                order.items.forEach(item => {
                    const product = data.products.find(candidate => candidate.id === item.productId);
                    const quantity = Math.max(0, Number(item.quantity) || 0);
                    item.supplierId ||= product?.supplierId || order.supplierId || '';
                    item.supplierName ||= data.suppliers.find(supplier => supplier.id === item.supplierId)?.name || order.supplierName || '未指定供應商';
                    item.productName ||= product?.prodName || '';
                    item.spec ??= product?.spec || '';
                    item.sku ??= product?.sku || '';
                    item.unit ||= product?.unit || 'pcs';
                    const wasReceived = order.inventoryTransferred === true;
                    if (item.receivedQuantity === undefined) item.receivedQuantity = wasReceived ? quantity : 0;
                    if (item.rejectedQuantity === undefined) item.rejectedQuantity = 0;
                    if (item.acceptedQuantity === undefined) item.acceptedQuantity = wasReceived ? quantity : Math.max(0, item.receivedQuantity - item.rejectedQuantity);
                });
                if (!order.supplierId && order.items.length) order.supplierId = order.items[0].supplierId || '';
                if (!order.supplierName && order.items.length) order.supplierName = order.items[0].supplierName || '未指定供應商';
            });
        }
        migrateReceivingData();
        (data.inventory || []).forEach(item => {
            const product = data.products.find(candidate => candidate.id === item.productId);
            if (item.reorderPoint === undefined) item.reorderPoint = Number(product?.reorderPoint) || 0;
        });

        // 暫存變數
        let tempQuoteItems = [];
        let tempInquiryItems = [];
        let selectedCartItems = new Set(); // 儲存已選採購品項的 productId
        let inventoryModalCurrentId = null; // 庫存 modal 暫存 id

        // v11.5 詢價狀態定義
        const inquiryStatusMap = {
            'waiting': { label: '等回覆', class: 'bg-gray-100 text-gray-600 border-gray-300' },
            'replied': { label: '已回覆', class: 'bg-blue-100 text-blue-700 border-blue-300' },
            'price_high': { label: '價格高', class: 'bg-orange-100 text-orange-700 border-orange-300' },
            'no_stock': { label: '無供貨', class: 'bg-red-100 text-red-700 border-red-300' },
            'converted': { label: '已轉正式產品', class: 'bg-green-100 text-green-700 border-green-300' }
        };
        function exportToExcel(type) {
            let exportData = [];
            let fileName = "";
            let sheetName = "";
            
            if (type === 'suppliers') {
                sheetName = "供應商";
                exportData.push(["系統ID", "供應商名稱", "公司統編", "聯絡人", "電話", "網址", "地址", "備註", "付款方式", "月結天數", "關帳日", "指定付款日", "收款銀行", "分行", "匯款帳號"]);
                data.suppliers.forEach(s => {
                    exportData.push([s.id, s.name, s.taxId, s.contact, s.phone, s.website, s.address, s.note, s.paymentType || '', s.monthlyDays || '', s.closingDay || '', s.paymentDay || '', s.remittanceBank || '', s.remittanceBranch || '', s.remittanceAccount || '']);
                });
                fileName = `供應商清單_${getTodayStr()}.xlsx`;
            
            } else if (type === 'products') {
                sheetName = "產品";
                exportData.push(["系統ID", "供應商名稱", "產品名稱", "SKU", "條碼", "分類", "單位", "安全庫存", "補貨點", "狀態", "商品類型", "組合處理方式", "組合內容（JSON）", "品牌名稱", "規格", "交期", "進價", "售價", "進價稅務", "參考運費", "產品網址", "產品備註", "建檔時間", "最後異動時間", "幣別", "匯率（NTD／外幣）", "最近售價異動（JSON）", "包裝基礎產品編號", "每包基礎單位數"]);
                data.products.forEach(p => {
                    const supplier = data.suppliers.find(s => s.id === p.supplierId)?.name || '未知';
                    exportData.push([
                        p.id, 
                        supplier, 
                        p.prodName, 
                        p.sku || '',
                        p.barcode || '',
                        p.category || '',
                        p.unit || 'pcs',
                        p.safetyStock || 0,
                        p.reorderPoint || 0,
                        p.isActive === false ? '停用' : '啟用',
                        ['kit', 'sales-bundle'].includes(p.productType) ? '產品組合' : '一般單品',
                        p.productType === 'kit' ? '採購收貨時拆成單品' : p.productType === 'sales-bundle' ? '銷售時扣組成品' : '',
                        ['kit', 'sales-bundle'].includes(p.productType) ? JSON.stringify(p.components || []) : '',
                        p.brandName || '', 
                        p.spec, 
                        p.deliveryTime, 
                        getProductPurchasePrice(p),
                        p.salesPrice ?? '',
                        p.isTaxIncl, 
                        p.shipping, 
                        p.prodUrl, 
                        p.prodNote,
                        p.createdAt ? new Date(p.createdAt).toLocaleString('zh-TW') : '',
                        p.updatedAt ? new Date(p.updatedAt).toLocaleString('zh-TW') : '',
                        getProductCurrency(p),
                        getProductExchangeRate(p),
                        JSON.stringify((p.salesPriceHistory || []).slice(-2)),
                        p.packageBaseProductId || '',
                        p.packageUnitsPerPackage || ''
                    ]);
                });
                fileName = `產品報價單_${getTodayStr()}.xlsx`;
            
            } else if (type === 'orders') {
                sheetName = "訂單明細";
                exportData.push(["供應商編號", "供應商名稱", "下單日期", "產品編號", "SKU", "產品名稱", "規格", "單位", "訂購數量", "已收數量", "驗收合格數", "拒收數量", "成交單價(NTD)", "成交運費(NTD)", "總金額(NTD)", "稅別", "商品類型", "拆套BOM快照（JSON）", "項目備註", "報價單號", "訂單備註", "付款狀態", "付款日期", "刷卡認證碼", "發票號碼", "廠商發票日期", "供應商(訂單)單號", "狀態", "系統預計到貨日", "出貨日", "到貨日", "訂單折扣", "是否已轉入庫存", "轉入時間", "訂單編號", "建檔時間", "物流商", "物流單號", "原幣", "匯率（1 外幣 = NTD）", "原幣單價", "原幣運費"]);
                
                data.orders.forEach(order => {
                    const amounts = calculateFinanceDocumentAmounts(order.items.map(item => ({
                        unitPrice: item.customPrice || 0,
                        quantity: item.quantity || 1,
                        shipping: item.customShipping || 0,
                        taxStatus: item.taxStatus || '含稅'
                    })));
                    const finalTotal = Math.max(0, amounts.totalAmount - Math.round(order.discount || 0));

                    // 計算系統預計到貨日
                    const estimatedArrival = calculateEstimatedArrival(order.date, order.items);

                    order.items.forEach((item, itemIndex) => {
                        const p = data.products.find(prod => prod.id === item.productId);
                        const supplierName = item.supplierName || order.supplierName || (p ? data.suppliers.find(s=>s.id === p.supplierId)?.name : '未知');
                        const supplierId = item.supplierId || order.supplierId || p?.supplierId || '';
                        const prodName = item.productName || (p ? p.prodName : (item.kitSnapshot?.productName || '(已刪除)'));
                        const spec = item.spec || p?.spec || item.kitSnapshot?.spec || '';
                        
                        exportData.push([
                            supplierId,
                            supplierName,
                            order.date,
                            item.productId,
                            item.sku || p?.sku || '',
                            prodName, 
                            spec,
                            item.unit || p?.unit || 'pcs',
                            item.quantity,
                            item.receivedQuantity || 0,
                            item.acceptedQuantity ?? (order.inventoryTransferred ? item.quantity : 0),
                            item.rejectedQuantity || 0,
                            item.customPrice,
                            item.customShipping,
                            itemIndex === 0 ? finalTotal : '',
                            item.taxStatus || '含稅',
                            item.kitSnapshot || p?.productType === 'kit' ? '採購組合包' : '一般單品',
                            item.kitSnapshot ? JSON.stringify(item.kitSnapshot.components || []) : '',
                            item.customNote,
                            order.quotationNo || '',
                            order.orderNote || '',
                            translatePayment(getPurchaseOrderPaymentStatus(order)),
                            order.paymentDate || '',
                            order.cardAuthCode || '',
                            order.invoiceNumber || '',
                            order.supplierInvoiceDate || '',
                            order.originalOrderNo || '',
                            translateStatus(order.status),
                            estimatedArrival,
                            order.shipDate || '',
                            order.arrivalDate || '',
                            order.discount || 0,
                            order.inventoryTransferred ? '是' : '否',
                            order.inventoryTransferAt || '',
                            order.id,
                            order.createdAt || '',
                            order.logisticsProvider || '',
                            order.trackingNumber || '',
                            item.sourceCurrency || item.currency || 'NTD',
                            item.exchangeRate || 1,
                            item.sourceUnitPrice ?? item.customPrice,
                            item.sourceShipping ?? item.customShipping
                        ]);
                    });
                });
                fileName = `歷史訂單明細_${getTodayStr()}.xlsx`;
            } else if (type === 'inventory') {
                sheetName = "庫存清單";
                exportData.push(["庫存編號", "產品編號", "產品名稱", "規格", "供應商", "倉別", "單位", "庫存數量", "可用數量", "成本單價", "平均成本", "庫存金額", "狀態", "最後更新", "來源訂單"]);
                data.inventory.forEach(item => {
                    exportData.push([
                        item.id,
                        item.productId,
                        item.productName,
                        item.spec,
                        item.supplierName,
                        item.warehouse,
                        item.unit,
                        item.quantity,
                        item.availableQuantity,
                        item.lastCost,
                        item.averageCost,
                        item.totalCost,
                        item.status,
                        item.lastUpdated || '',
                        (item.relatedOrders || []).join(', ')
                    ]);
                });
                fileName = `庫存清單_${getTodayStr()}.xlsx`;
            } else if (type === 'inventoryMovements') {
                sheetName = "庫存異動記錄";
                exportData.push(["異動編號", "異動日期", "異動類型", "來源訂單", "產品編號", "產品名稱", "規格", "供應商", "倉別", "數量", "單位成本", "總成本", "來源日期", "到貨日期", "原組合包編號", "原組合包名稱", "組合包數量", "每組單品數", "成本分攤權重", "組合包採購單價", "每組運費", "單件分攤運費", "備註"]);
                data.inventoryMovements.forEach(move => {
                    exportData.push([
                        move.id,
                        move.createdAt || '',
                        move.type,
                        move.orderId,
                        move.productId,
                        move.productName,
                        move.spec,
                        move.supplierName,
                        move.warehouse,
                        move.quantity,
                        move.unitCost,
                        move.totalCost,
                        move.sourceDate || '',
                        move.arrivalDate || '',
                        move.sourceKitProductId || '',
                        move.sourceKitName || '',
                        move.sourceKitQuantity || '',
                        move.componentQuantityPerKit || '',
                        move.allocationWeight || '',
                        move.purchaseUnitCost || '',
                        move.purchaseShippingPerKit || '',
                        move.purchaseShippingPerUnit || '',
                        move.note || ''
                    ]);
                });
                fileName = `庫存異動記錄_${getTodayStr()}.xlsx`;
            } else if (type === 'goodsReceipts') {
                sheetName = '採購收貨';
                exportData.push(['收貨單號', '收貨日期', '採購單號', '供應商編號', '供應商名稱', '產品編號', 'SKU', '產品名稱', '單位', '實收數量', '合格數量', '拒收數量', '倉別', '備註']);
                (data.goodsReceipts || []).forEach(receipt => {
                    (receipt.items || []).forEach(line => exportData.push([
                        receipt.id,
                        receipt.receiptDate || '',
                        receipt.orderId || '',
                        receipt.supplierId || '',
                        receipt.supplierName || '',
                        line.productId || '',
                        line.sku || '',
                        line.productName || '',
                        line.unit || 'pcs',
                        line.receivedQuantity || 0,
                        line.acceptedQuantity || 0,
                        line.rejectedQuantity || 0,
                        receipt.warehouse || '',
                        receipt.note || ''
                    ]));
                });
                fileName = `採購收貨明細_${getTodayStr()}.xlsx`;
            }

            saveAsExcel(exportData, sheetName, fileName);
            showToast('匯出成功', 'bg-green-600');
        }

        function handleCSVImport(event) {
            const file = event.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = (e) => {
                const text = e.target.result;
                const rows = parseCSV(text);
                if (rows.length < 2) return showToast('CSV 檔案內容為空或格式錯誤', 'bg-red-500');
                
                const headers = rows[0];
                let type = '';
                
                if (headers.includes("公司統編") && headers.includes("供應商名稱")) type = 'suppliers';
                else if (headers.includes("產品名稱") && (headers.includes("進價") || headers.includes("單價"))) type = 'products';
                else if (headers.includes("訂單編號") && headers.includes("下單日期")) type = 'orders';
                
                if (!type) return showToast('無法識別 CSV 類型，請檢查標題欄位', 'bg-red-500');

                const previousData = JSON.parse(JSON.stringify(data));
                let count = 0;
                let invalidProductRows = 0;
                let invalidOrderExchangeRows = 0;
                if (type === 'suppliers') count = importSuppliers(rows);
                else if (type === 'products') {
                    const result = importProducts(rows);
                    count = result.count;
                    invalidProductRows = result.invalidRateRows;
                } else if (type === 'orders') {
                    const result = importOrders(rows);
                    count = result.count;
                    invalidOrderExchangeRows = result.invalidExchangeRateRows;
                }

                if (saveData() === false) {
                    data = previousData;
                    showToast('匯入未能儲存，資料已復原。', 'bg-red-500');
                    event.target.value = '';
                    return;
                }
                renderSuppliers();
                renderProducts();
                renderOrders();
                const importWarnings = [
                    invalidProductRows ? `${invalidProductRows} 筆產品資料格式或匯率無效而略過` : '',
                    invalidOrderExchangeRows ? `${invalidOrderExchangeRows} 筆訂單的原幣匯率無效，已保留新台幣金額並略過原幣資訊` : ''
                ].filter(Boolean);
                showToast(`成功匯入 ${count} 筆${type === 'suppliers'?'供應商':type==='products'?'產品':'訂單'}資料${importWarnings.length ? `；${importWarnings.join('；')}` : ''}`, importWarnings.length ? 'bg-amber-600' : 'bg-green-600');
                event.target.value = '';
            };
            reader.readAsText(file);
        }
        function importSuppliers(rows) {
            let count = 0;
            const headers = rows[0] || [];
            const fieldValue = (field, fallbackIndex, row) => {
                const index = headers.indexOf(field);
                return index >= 0 ? row[index] : row[fallbackIndex];
            };
            rows.slice(1).forEach(row => {
                if (!row[1]) return;
                const id = row[0] && row[0].startsWith('s_') ? row[0] : 's_' + Date.now() + Math.random().toString(36).substr(2,4);
                const existingSupplier = data.suppliers.find(supplier => supplier.id === id);
                
                const supplier = {
                    id: id,
                    name: row[1],
                    taxId: row[2] || '',
                    contact: row[3] || '',
                    phone: row[4] || '',
                    website: row[5] || '',
                    address: row[6] || '',
                    note: row[7] || '',
                    paymentType: row[8] || '現金',
                    monthlyDays: row[9] || '',
                    closingDay: row[10] || '',
                    paymentDay: row[11] || '',
                    remittanceBank: fieldValue('收款銀行', 12, row) ?? existingSupplier?.remittanceBank ?? '',
                    remittanceBranch: fieldValue('分行', 13, row) ?? existingSupplier?.remittanceBranch ?? '',
                    remittanceAccount: fieldValue('匯款帳號', 14, row) ?? existingSupplier?.remittanceAccount ?? ''
                };

                const existIdx = data.suppliers.findIndex(s => s.id === supplier.id);
                if (existIdx !== -1) data.suppliers[existIdx] = supplier;
                else data.suppliers.push(supplier);
                count++;
            });
            return count;
        }
        function importProducts(rows) {
            let count = 0;
            let invalidProductRows = 0;
            const headers = rows[0] || [];
            const fieldValue = (field, fallbackIndex, row) => {
                const index = headers.indexOf(field);
                return index >= 0 ? row[index] : row[fallbackIndex];
            };
            const getImportedProductType = row => {
                const typeValue = fieldValue('商品類型', -1, row);
                if (typeValue === '產品組合') {
                    const mode = fieldValue('組合處理方式', -1, row);
                    if (mode === '採購收貨時拆成單品') return 'kit';
                    if (mode === '銷售時扣組成品') return 'sales-bundle';
                    return null;
                }
                if (typeValue === '組合包') return 'kit';
                if (typeValue === '促銷銷售組合') return 'sales-bundle';
                if (typeValue === '一般單品') return 'standard';
                return null;
            };
            const importedProductRowsById = new Map(rows.slice(1)
                .map(row => [String(fieldValue('系統ID', 0, row) || '').trim(), row])
                .filter(([id]) => id));
            rows.slice(1).forEach(row => {
                if (!row[2]) return;
                
                let supplierId = '';
                const supplierName = row[1];
                if (supplierName) {
                    const s = data.suppliers.find(sup => sup.name === supplierName);
                    if (s) supplierId = s.id;
                }

                const csvId = String(fieldValue('系統ID', 0, row) || '').trim() || null;
                const prodName = row[2];
                const spec = fieldValue('規格', 3, row) || '';
                const importedProductTypeValue = fieldValue('商品類型', -1, row);
                const importedProductType = getImportedProductType(row);
                if (importedProductTypeValue === '產品組合' && !importedProductType) {
                    invalidProductRows++;
                    return;
                }
                const packageBaseProductIdValue = fieldValue('包裝基礎產品編號', -1, row);
                const packageUnitsValue = fieldValue('每包基礎單位數', -1, row);
                const hasPackageBaseProductId = String(packageBaseProductIdValue || '').trim() !== '';
                const hasPackageUnits = String(packageUnitsValue ?? '').trim() !== '';
                const packageUnitsPerPackage = hasPackageUnits ? Number(packageUnitsValue) : null;
                if (hasPackageBaseProductId !== hasPackageUnits ||
                    (hasPackageUnits && (!Number.isSafeInteger(packageUnitsPerPackage) || packageUnitsPerPackage <= 1))) {
                    invalidProductRows++;
                    return;
                }
                const packageBaseProductId = hasPackageBaseProductId
                    ? String(packageBaseProductIdValue).trim()
                    : '';
                if (packageBaseProductId && packageBaseProductId === csvId) {
                    invalidProductRows++;
                    return;
                }

                let existingProductIndex = -1;

                if (csvId) {
                    existingProductIndex = data.products.findIndex(p => p.id === csvId);
                }

                if (existingProductIndex === -1 && packageBaseProductId) {
                    existingProductIndex = data.products.findIndex(product =>
                        product.packageBaseProductId === packageBaseProductId &&
                        Number(product.packageUnitsPerPackage) === packageUnitsPerPackage
                    );
                }

                if (existingProductIndex === -1 && !packageBaseProductId) {
                    existingProductIndex = data.products.findIndex(p => 
                        p.prodName === prodName && 
                        p.spec === spec && 
                        p.supplierId === supplierId
                    );
                }

                const finalId = existingProductIndex !== -1 ? data.products[existingProductIndex].id : (csvId || generateProductID());
                const existingProduct = existingProductIndex === -1 ? {} : data.products[existingProductIndex];
                const packageBaseProduct = packageBaseProductId
                    ? data.products.find(product => product.id === packageBaseProductId)
                    : null;
                const importedBaseRow = packageBaseProductId
                    ? importedProductRowsById.get(packageBaseProductId)
                    : null;
                const importedBaseIsPackage = importedBaseRow &&
                    String(fieldValue('包裝基礎產品編號', -1, importedBaseRow) || '').trim() !== '';
                const importedBaseType = importedBaseRow ? getImportedProductType(importedBaseRow) : '';
                const importedBaseIsKit = ['kit', 'sales-bundle'].includes(importedBaseType);
                const changesPackageIdentity = existingProductIndex !== -1 && (
                    (existingProduct.packageBaseProductId || '') !== packageBaseProductId ||
                    (packageBaseProductId &&
                        Number(existingProduct.packageUnitsPerPackage) !== packageUnitsPerPackage)
                );
                if (packageBaseProductId && (
                    (!packageBaseProduct && !importedBaseRow) ||
                    packageBaseProduct?.packageBaseProductId ||
                    packageBaseProduct?.productType === 'kit' ||
                    packageBaseProduct?.productType === 'sales-bundle' ||
                    importedBaseIsPackage ||
                    importedBaseIsKit ||
                    packageBaseProductId === finalId ||
                    data.products.some(product => product.id !== finalId && product.packageBaseProductId === finalId) ||
                    ['kit', 'sales-bundle'].includes(importedProductType) ||
                    (existingProduct.packageBaseProductId &&
                        (existingProduct.packageBaseProductId !== packageBaseProductId ||
                            Number(existingProduct.packageUnitsPerPackage) !== packageUnitsPerPackage))
                )) {
                    invalidProductRows++;
                    return;
                }
                if (changesPackageIdentity && hasProductReferences(finalId)) {
                    invalidProductRows++;
                    return;
                }
                if (['kit', 'sales-bundle'].includes(importedProductType) &&
                    (existingProduct.packageBaseProductId ||
                        data.products.some(product => product.id !== finalId && product.packageBaseProductId === finalId))) {
                    invalidProductRows++;
                    return;
                }
                const productType = importedProductType || existingProduct.productType || 'standard';
                if (existingProductIndex !== -1 && productType !== (existingProduct.productType || 'standard') && hasProductReferences(finalId)) {
                    invalidProductRows++;
                    return;
                }
                const currencyValue = fieldValue('幣別', -1, row);
                if (currencyValue && !['NTD', 'RMB'].includes(currencyValue)) {
                    invalidProductRows++;
                    return;
                }
                const currency = currencyValue === 'RMB' ? 'RMB' : (currencyValue ? 'NTD' : existingProduct.currency || 'NTD');
                const exchangeRateValue = fieldValue('匯率（NTD／外幣）', -1, row);
                const exchangeRate = currency === 'NTD'
                    ? 1
                    : Number(exchangeRateValue ?? existingProduct.exchangeRate);
                if (currency === 'RMB' && (!Number.isFinite(exchangeRate) || exchangeRate <= 0)) {
                    invalidProductRows++;
                    return;
                }
                let salesPriceHistory = existingProduct.salesPriceHistory || [];
                const historyValue = fieldValue('最近售價異動（JSON）', -1, row);
                let importedHistory = false;
                if (historyValue) {
                    try {
                        const parsedHistory = JSON.parse(historyValue);
                        if (!Array.isArray(parsedHistory)) {
                            invalidProductRows++;
                            return;
                        }
                        salesPriceHistory = parsedHistory.slice(-2);
                        importedHistory = true;
                    } catch (error) {
                        invalidProductRows++;
                        return;
                    }
                }
                const salesPriceValue = fieldValue('售價', -1, row) ?? existingProduct.salesPrice ?? '';
                const salesPrice = salesPriceValue === '' ? '' : Number(salesPriceValue);
                if (!Number.isFinite(salesPrice === '' ? 0 : salesPrice)) {
                    invalidProductRows++;
                    return;
                }
                if (!importedHistory && existingProductIndex !== -1) {
                    salesPriceHistory = getSalesPriceHistory(existingProduct, salesPrice, new Date().toISOString());
                }
                const kitJson = fieldValue('組合內容（JSON）', -1, row);
                let components = existingProduct.components || [];
                if (kitJson) {
                    try {
                        components = JSON.parse(kitJson);
                    } catch (error) {
                        invalidProductRows++;
                        return;
                    }
                }
                if (['kit', 'sales-bundle'].includes(productType)) {
                    if (!Array.isArray(components) || components.length === 0) {
                        invalidProductRows++;
                        return;
                    }
                    const seenComponentIds = new Set();
                    const hasInvalidComponent = components.some(component => {
                        const componentId = String(component?.productId || '').trim();
                        const quantity = Number(component?.quantity);
                        const allocationWeight = Number(component?.allocationWeight);
                        const importedComponentRow = importedProductRowsById.get(componentId);
                        const importedComponentType = importedComponentRow
                            ? getImportedProductType(importedComponentRow)
                            : '';
                        const componentProduct = data.products.find(product => product.id === componentId);
                        const componentType = componentProduct?.productType || importedComponentType || 'standard';
                        const invalid = !componentId || componentId === finalId || seenComponentIds.has(componentId) ||
                            !Number.isSafeInteger(quantity) || quantity <= 0 ||
                            !importedComponentRow && !componentProduct ||
                            componentType === 'kit' || componentType === 'sales-bundle' ||
                            (productType === 'kit' && (!Number.isFinite(allocationWeight) || allocationWeight <= 0));
                        seenComponentIds.add(componentId);
                        return invalid;
                    });
                    if (hasInvalidComponent) {
                        invalidProductRows++;
                        return;
                    }
                }
                const purchasePrice = fieldValue('進價', fieldValue('單價', 5, row), row);
                const product = {
                    ...existingProduct,
                    id: finalId,
                    supplierId: supplierId,
                    prodName: prodName,
                    productType,
                    components,
                    packageBaseProductId: packageBaseProductId || existingProduct.packageBaseProductId || '',
                    packageUnitsPerPackage: packageUnitsPerPackage || existingProduct.packageUnitsPerPackage || '',
                    brandName: fieldValue('品牌名稱', -1, row) || existingProduct.brandName || '',
                    sku: fieldValue('SKU', -1, row) || existingProduct.sku || '',
                    barcode: fieldValue('條碼', -1, row) || existingProduct.barcode || '',
                    category: fieldValue('分類', -1, row) || existingProduct.category || '',
                    unit: fieldValue('單位', -1, row) || existingProduct.unit || 'pcs',
                    safetyStock: Number(fieldValue('安全庫存', -1, row) ?? existingProduct.safetyStock) || 0,
                    reorderPoint: Number(fieldValue('補貨點', -1, row) ?? existingProduct.reorderPoint) || 0,
                    isActive: fieldValue('狀態', -1, row) ? fieldValue('狀態', -1, row) !== '停用' : existingProduct.isActive !== false,
                    spec: spec,
                    deliveryTime: fieldValue('交期', 4, row) || '',
                    purchasePrice: parseFloat(purchasePrice) || 0,
                    salesPrice,
                    price: parseFloat(purchasePrice) || 0,
                    currency,
                    exchangeRate,
                    salesPriceHistory,
                    isTaxIncl: fieldValue('進價稅務', fieldValue('含稅', 6, row), row) || '含稅',
                    shipping: parseFloat(fieldValue('參考運費', 7, row)) || 0,
                    prodUrl: fieldValue('產品網址', 8, row) || '',
                    prodNote: fieldValue('產品備註', 9, row) || '',
                    createdAt: existingProductIndex === -1 ? new Date().toISOString() : (existingProduct.createdAt || new Date().toISOString()),
                    updatedAt: new Date().toISOString()                };

                if (existingProductIndex !== -1) {
                    data.products[existingProductIndex] = product;
                } else {
                    data.products.push(product);
                }
                count++;
            });
            return { count, invalidRateRows: invalidProductRows };
        }
        function importOrders(rows) {
            let count = 0;
            let invalidExchangeRateRows = 0;
            const tempOrders = {};
            const headers = rows[0]; 
            
            // 欄位索引對應
            const idxCreatedAt = headers.indexOf("建檔時間");
            const idxOriginalNo = headers.indexOf("供應商(訂單)單號");
            const idxOrderDate = headers.indexOf("下單日期");
            const idxStatus = headers.indexOf("狀態");
            const idxPaymentStatus = headers.indexOf("付款狀態");
            const idxInvoiceNum = headers.indexOf("發票號碼");
            const idxInvoiceDate = headers.indexOf("廠商發票日期");
            const idxLogistics = headers.indexOf("物流商");
            const idxTracking = headers.indexOf("物流單號");
            const idxShip = headers.indexOf("出貨日");
            const idxArrival = headers.indexOf("到貨日");
            const idxNote = headers.indexOf("訂單備註");
            const idxDiscount = headers.indexOf("訂單折扣"); 
            const idxTaxStatus = headers.indexOf("稅別"); 
            const idxQuoteNo = headers.indexOf("報價單號"); // v11.0
            const column = (name, fallback) => {
                const index = headers.indexOf(name);
                return index >= 0 ? index : fallback;
            };
            const idxOrderId = column('訂單編號', 0);
            const idxSupplierId = headers.indexOf('供應商編號');
            const idxSupplierName = headers.indexOf('供應商名稱');
            const idxProductId = headers.indexOf('產品編號');
            const idxSku = headers.indexOf('SKU');
            const idxProdName = column('產品名稱', 11);
            const idxSpec = headers.indexOf('規格');
            const idxUnit = headers.indexOf('單位');
            const idxQuantity = column('訂購數量', column('數量', idxProdName + 2));
            const idxPrice = column('成交單價(NTD)', column('成交單價', idxQuantity + 1));
            const idxShipping = column('成交運費(NTD)', column('成交運費', idxPrice + 1));
            const idxItemNote = headers.indexOf('項目備註');
            const idxReceived = headers.indexOf('已收數量');
            const idxAccepted = headers.indexOf('驗收合格數');
            const idxRejected = headers.indexOf('拒收數量');
            const idxSourceCurrency = headers.indexOf('原幣');
            const idxExchangeRate = headers.indexOf('匯率（1 外幣 = NTD）');
            const idxSourceUnitPrice = headers.indexOf('原幣單價');
            const idxSourceShipping = headers.indexOf('原幣運費');

            rows.slice(1).forEach(row => {
                const orderId = row[idxOrderId];
                if (!orderId) return;

                if (!tempOrders[orderId]) {
                    tempOrders[orderId] = {
                        id: orderId,
                        createdAt: idxCreatedAt > -1 ? row[idxCreatedAt] : '', 
                        date: idxOrderDate > -1 ? row[idxOrderDate] : row[2], 
                        status: idxStatus > -1 ? reverseStatus(row[idxStatus]) : reverseStatus(row[3]),
                        paymentStatus: idxPaymentStatus > -1 ? reversePayment(row[idxPaymentStatus]) : 'unpaid',
                        invoiceNumber: idxInvoiceNum > -1 ? row[idxInvoiceNum] : row[4],
                        supplierInvoiceDate: idxInvoiceDate > -1 ? row[idxInvoiceDate] : '', 
                        originalOrderNo: idxOriginalNo > -1 ? row[idxOriginalNo] : '',
                        quotationNo: idxQuoteNo > -1 ? row[idxQuoteNo] : '', // v11.0
                        logisticsProvider: idxLogistics > -1 ? row[idxLogistics] : '',
                        trackingNumber: idxTracking > -1 ? row[idxTracking] : '',
                        shipDate: idxShip > -1 ? row[idxShip] : '',
                        arrivalDate: idxArrival > -1 ? row[idxArrival] : '',
                        orderNote: idxNote > -1 ? row[idxNote] : '',
                        discount: idxDiscount > -1 ? (parseFloat(row[idxDiscount]) || 0) : 0,
                        supplierId: idxSupplierId > -1 ? row[idxSupplierId] : '',
                        supplierName: idxSupplierName > -1 ? row[idxSupplierName] : '',
                        inventoryTransferred: false,

                        items: [],
                        totalAmount: 0 
                    };
                }
                
                const prodName = row[idxProdName];
                const p = idxProductId > -1
                    ? data.products.find(prod => prod.id === row[idxProductId])
                    : data.products.find(prod => prod.prodName === prodName);
                const productId = row[idxProductId] || p?.id || 'unknown_' + Date.now();
                const sourceCurrencyValue = idxSourceCurrency > -1 ? row[idxSourceCurrency] : '';
                let sourceCurrency = ['NTD', 'RMB'].includes(sourceCurrencyValue) ? sourceCurrencyValue : 'NTD';
                if (sourceCurrencyValue && !['NTD', 'RMB'].includes(sourceCurrencyValue)) invalidExchangeRateRows++;
                const importedExchangeRate = idxExchangeRate > -1 ? Number(row[idxExchangeRate]) : 1;
                let exchangeRate = 1;
                if (sourceCurrency === 'RMB') {
                    if (Number.isFinite(importedExchangeRate) && importedExchangeRate > 0) {
                        exchangeRate = importedExchangeRate;
                    } else {
                        sourceCurrency = 'NTD';
                        invalidExchangeRateRows++;
                    }
                }
                const customPrice = parseFloat(row[idxPrice]) || 0;
                const customShipping = parseFloat(row[idxShipping]) || 0;

                tempOrders[orderId].items.push({
                    productId: productId,
                    productName: prodName || p?.prodName || '',
                    sku: (idxSku > -1 ? row[idxSku] : '') || p?.sku || '',
                    spec: (idxSpec > -1 ? row[idxSpec] : '') || p?.spec || '',
                    unit: (idxUnit > -1 ? row[idxUnit] : '') || p?.unit || 'pcs',
                    supplierId: idxSupplierId > -1 ? row[idxSupplierId] : p?.supplierId || '',
                    supplierName: idxSupplierName > -1 ? row[idxSupplierName] : '',
                    quantity: parseInt(row[idxQuantity]) || 1,
                    customPrice,
                    customShipping,
                    currency: sourceCurrency,
                    sourceCurrency,
                    exchangeRate,
                    sourceUnitPrice: sourceCurrency === 'RMB' && idxSourceUnitPrice > -1 ? Number(row[idxSourceUnitPrice]) || 0 : customPrice,
                    sourceShipping: sourceCurrency === 'RMB' && idxSourceShipping > -1 ? Number(row[idxSourceShipping]) || 0 : customShipping,
                    taxStatus: idxTaxStatus > -1 ? row[idxTaxStatus] : '含稅',
                    customNote: row[idxItemNote > -1 ? idxItemNote : idxShipping + 1] || '',
                    receivedQuantity: idxReceived > -1 ? Number(row[idxReceived]) || 0 : 0,
                    acceptedQuantity: idxAccepted > -1 ? Number(row[idxAccepted]) || 0 : 0,
                    rejectedQuantity: idxRejected > -1 ? Number(row[idxRejected]) || 0 : 0
                });
            });

            for (const oid in tempOrders) {
                const ord = tempOrders[oid];
                const amounts = calculateFinanceDocumentAmounts(ord.items.map(item => ({
                    unitPrice: item.customPrice || 0,
                    quantity: item.quantity || 1,
                    shipping: item.customShipping || 0,
                    taxStatus: item.taxStatus || '含稅'
                })));
                ord.totalAmount = Math.max(0, amounts.totalAmount - Math.round(ord.discount || 0));
                
                const existIdx = data.orders.findIndex(o => o.id === ord.id);
                if (existIdx !== -1) {
                    data.orders[existIdx] = ord;
                } else {
                    data.orders.push(ord);
                }
                count++;
            }
            return { count, invalidExchangeRateRows };
        }
        function saveData() {
            try {
                localStorage.setItem('procurementDataV2', JSON.stringify(data));
                return true;
            } catch (error) {
                console.error('儲存資料失敗:', error);
                return false;
            }
        }
        function exportData() {
            try {
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `採購追蹤系統備份_${getTodayStr()}.json`;
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (error) {
                console.error('匯出備份失敗:', error);
                showToast('備份失敗，請檢查瀏覽器下載權限。', 'bg-red-500');
            }
        }

        function importData(event) {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                const previousData = data;
                try {
                    const imported = JSON.parse(e.target.result);
                    if (!imported || typeof imported !== 'object' || Array.isArray(imported) ||
                        !Array.isArray(imported.suppliers) || !Array.isArray(imported.products)) {
                        throw new Error('備份檔缺少必要的供應商或產品資料。');
                    }
                    if (imported.companyProfile !== undefined &&
                        (!imported.companyProfile || typeof imported.companyProfile !== 'object' || Array.isArray(imported.companyProfile))) {
                        throw new Error('備份資料「companyProfile」格式錯誤。');
                    }
                    const collections = [
                        'suppliers', 'products', 'cart', 'orders', 'clientQuotes', 'supplierInquiries',
                        'inventory', 'inventoryMovements', 'inventoryBatches', 'goodsReceipts', 'accountsReceivable',
                        'accountsPayable', 'financeCustomers'
                    ];
                    collections.forEach(key => {
                        if (imported[key] !== undefined && !Array.isArray(imported[key])) {
                            throw new Error(`備份資料「${key}」格式錯誤。`);
                        }
                        if (imported[key]?.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
                            throw new Error(`備份資料「${key}」包含無效項目。`);
                        }
                    });
                    if (!confirm(`確定還原「${file.name}」嗎？目前瀏覽器內的全部資料將被備份內容取代。`)) return;

                    data = imported;
                    if (!data.companyProfile || typeof data.companyProfile !== 'object' || Array.isArray(data.companyProfile)) {
                        data.companyProfile = {};
                    }
                    collections.forEach(key => {
                        if (!Array.isArray(data[key])) data[key] = [];
                    });
                    migrateFinanceData();
                    (data.products || []).forEach(product => {
                        if (!product.productType) product.productType = 'standard';
                        if (['kit', 'sales-bundle'].includes(product.productType) && !Array.isArray(product.components)) product.components = [];
                        if (product.purchasePrice === undefined) product.purchasePrice = Number(product.price) || 0;
                        if (product.salesPrice === undefined || product.salesPrice === null) product.salesPrice = '';
                        product.sku ??= '';
                        product.barcode ??= '';
                        product.category ??= '';
                        product.unit ||= 'pcs';
                        product.safetyStock = Math.max(0, Number(product.safetyStock) || 0);
                        product.reorderPoint = Math.max(0, Number(product.reorderPoint) || 0);
                        if (product.isActive === undefined) product.isActive = true;
                        product.price = product.purchasePrice;
                    });
                    migrateReceivingData();
                    (data.inventory || []).forEach(item => {
                        const product = data.products.find(candidate => candidate.id === item.productId);
                        if (item.reorderPoint === undefined) item.reorderPoint = Number(product?.reorderPoint) || 0;
                    });
                    if (!saveData()) throw new Error('瀏覽器儲存空間不足或無法寫入，原資料未變更。');
                    window.location.reload();
                } catch (err) {
                    data = previousData;
                    console.error('還原備份失敗:', err);
                    showToast(`還原失敗：${err.message || '檔案格式錯誤'}`, 'bg-red-500');
                } finally {
                    event.target.value = '';
                }
            };
            reader.onerror = () => {
                event.target.value = '';
                showToast('讀取備份檔失敗，請重新選擇檔案。', 'bg-red-500');
            };
            reader.readAsText(file);
        }
