/**
 * The Wonderfield Group - Servicio de Exportación a Excel (.xlsx)
 * Genera libros de Excel profesionales corporativos con desglose fiscal, estados de aprobación y liquidación.
 */

class ExcelExportService {
  /**
   * Exporta la lista de gastos a un archivo .xlsx completo
   */
  exportToExcel(expenses, tripName = '', filterLabel = 'Todos los registros') {
    if (!window.XLSX) {
      alert('La biblioteca de Excel (SheetJS) no se ha cargado. Por favor, verifica tu conexión a internet.');
      return;
    }

    if (!expenses || expenses.length === 0) {
      alert('No hay gastos disponibles para exportar en este momento.');
      return;
    }

    const wb = window.XLSX.utils.book_new();

    // 1. Preparar datos de la Hoja 1: "Detalle de Gastos"
    const detailRows = [];
    
    // Encabezados
    const headers = [
      'N°',
      'Fecha',
      'Area Manager / Empleado',
      'Viaje / Destino',
      'Motivo / Concepto',
      'Categoría',
      'Tipo Doc.',
      'Moneda Orig.',
      'Importe Orig.',
      'Tasa a EUR',
      'Total EUR (€)',
      '¿Aplica IVA?',
      '% IVA',
      'Base Imponible EUR (€)',
      'Cuota IVA EUR (€)',
      'Estado Aprobación',
      'Aprobado Por',
      'Fecha Aprobación',
      'Motivo Rechazo',
      'Estado de Pago',
      'Fecha de Pago',
      'Referencia de Pago',
      'Foto Comprobante'
    ];
    detailRows.push(headers);

    let totalEUR = 0;
    let totalBaseEUR = 0;
    let totalIvaEUR = 0;

    let totalPaidEUR = 0;
    let totalApprovedUnpaidEUR = 0;

    expenses.forEach((item, index) => {
      const isInvoice = item.docType === 'factura';
      const hasIva = isInvoice && item.hasIva;
      const ivaPercent = hasIva ? (parseFloat(item.ivaRate) || 0) : 0;
      
      const amountEUR = parseFloat(item.amountEUR) || 0;
      const baseEUR = parseFloat(item.baseEUR) || (hasIva ? amountEUR / (1 + (ivaPercent / 100)) : amountEUR);
      const ivaEUR = parseFloat(item.ivaEUR) || (hasIva ? amountEUR - baseEUR : 0);

      totalEUR += amountEUR;
      totalBaseEUR += baseEUR;
      totalIvaEUR += ivaEUR;

      const isPaid = item.status === 'PAID';
      const isApproved = item.status === 'APPROVED';
      if (isPaid) totalPaidEUR += amountEUR;
      if (isApproved) totalApprovedUnpaidEUR += amountEUR;

      let statusLabel = 'PENDIENTE DE APROBACIÓN';
      if (item.status === 'APPROVED') statusLabel = 'APROBADO POR JEFE';
      if (item.status === 'REJECTED') statusLabel = 'RECHAZADO';
      if (item.status === 'PAID') statusLabel = 'PAGADO / LIQUIDADO';

      detailRows.push([
        index + 1,
        item.date || '',
        item.employee || 'N/A',
        item.trip || 'General',
        item.reason || '',
        item.category || 'Otros',
        isInvoice ? 'FACTURA' : 'TICKET',
        item.currency || 'EUR',
        parseFloat(item.originalAmount) || 0,
        parseFloat(item.rateToEUR) || 1,
        amountEUR,
        hasIva ? 'SÍ' : 'NO',
        hasIva ? `${ivaPercent}%` : '0%',
        baseEUR,
        ivaEUR,
        statusLabel,
        item.approvedBy || '',
        item.approvedAt ? item.approvedAt.slice(0, 19).replace('T', ' ') : '',
        item.rejectionReason || '',
        isPaid ? 'PAGADO' : 'PENDIENTE',
        item.paidAt ? item.paidAt.slice(0, 19).replace('T', ' ') : '',
        item.paymentRef || '',
        item.receiptImage ? 'ADJUNTO (EN SISTEMA)' : 'SIN FOTO'
      ]);
    });

    // Fila de Totales
    detailRows.push([]);
    detailRows.push([
      'TOTALES GENERALES',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      Math.round(totalEUR * 100) / 100,
      '',
      '',
      Math.round(totalBaseEUR * 100) / 100,
      Math.round(totalIvaEUR * 100) / 100,
      '',
      '',
      '',
      '',
      `PAGADO: ${Math.round(totalPaidEUR * 100) / 100} €`,
      `POR PAGAR: ${Math.round(totalApprovedUnpaidEUR * 100) / 100} €`,
      '',
      ''
    ]);

    const wsDetail = window.XLSX.utils.aoa_to_sheet(detailRows);

    // Ajustar anchos de columnas
    const colWidths = [
      { wch: 6 },   // N°
      { wch: 12 },  // Fecha
      { wch: 22 },  // Empleado
      { wch: 26 },  // Viaje
      { wch: 34 },  // Motivo
      { wch: 20 },  // Categoría
      { wch: 12 },  // Tipo Doc
      { wch: 14 },  // Moneda
      { wch: 14 },  // Importe Orig
      { wch: 12 },  // Tasa
      { wch: 15 },  // Total EUR
      { wch: 14 },  // Aplica IVA
      { wch: 10 },  // % IVA
      { wch: 22 },  // Base Imponible
      { wch: 18 },  // Cuota IVA
      { wch: 24 },  // Estado Aprobación
      { wch: 22 },  // Aprobado Por
      { wch: 18 },  // Fecha Aprobación
      { wch: 28 },  // Motivo Rechazo
      { wch: 16 },  // Estado Pago
      { wch: 18 },  // Fecha Pago
      { wch: 18 },  // Ref Pago
      { wch: 20 }   // Foto
    ];
    wsDetail['!cols'] = colWidths;

    // 2. Preparar datos de la Hoja 2: "Resumen Financiero"
    const invoicesCount = expenses.filter(e => e.docType === 'factura').length;
    const ticketsCount = expenses.filter(e => e.docType !== 'factura').length;
    const withIvaCount = expenses.filter(e => e.docType === 'factura' && e.hasIva).length;
    const pendingCount = expenses.filter(e => e.status === 'PENDING').length;
    const approvedCount = expenses.filter(e => e.status === 'APPROVED').length;
    const paidCount = expenses.filter(e => e.status === 'PAID').length;
    const rejectedCount = expenses.filter(e => e.status === 'REJECTED').length;

    // Agrupación por categoría y divisa
    const categoryTotals = {};
    const currencyTotals = {};

    expenses.forEach(e => {
      const cat = e.category || 'Otros';
      const cur = e.currency || 'EUR';
      const eur = parseFloat(e.amountEUR) || 0;
      const orig = parseFloat(e.originalAmount) || 0;

      categoryTotals[cat] = (categoryTotals[cat] || 0) + eur;
      if (!currencyTotals[cur]) {
        currencyTotals[cur] = { origTotal: 0, eurTotal: 0, count: 0 };
      }
      currencyTotals[cur].origTotal += orig;
      currencyTotals[cur].eurTotal += eur;
      currencyTotals[cur].count += 1;
    });

    const summaryRows = [
      ['THE WONDERFIELD GROUP - INFORME CONTABLE DE GASTOS Y CONTROL FINANCIERO'],
      ['Slogan Corporativo:', 'Where good things come from.'],
      ['Fecha de generación:', new Date().toLocaleString('es-ES')],
      ['Filtro aplicado:', filterLabel],
      ['Viaje / Destino:', tripName || 'Todos los viajes'],
      [''],
      ['1. RESUMEN FINANCIERO Y LIQUIDACIONES', 'VALOR EUR (€)', 'CONTEO REGISTROS'],
      ['Total Global de Gastos Registrados', Math.round(totalEUR * 100) / 100, expenses.length],
      ['Total Gastos Ya Pagados / Liquidados', Math.round(totalPaidEUR * 100) / 100, paidCount],
      ['Total Aprobados Pendientes de Pago', Math.round(totalApprovedUnpaidEUR * 100) / 100, approvedCount],
      ['Total Gastos en Revisión (Pendientes)', expenses.filter(e => e.status === 'PENDING').reduce((acc, c) => acc + c.amountEUR, 0), pendingCount],
      ['Total Gastos Rechazados', expenses.filter(e => e.status === 'REJECTED').reduce((acc, c) => acc + c.amountEUR, 0), rejectedCount],
      ['Total Base Imponible', Math.round(totalBaseEUR * 100) / 100, '-'],
      ['Total IVA Deducible / Recuperable', Math.round(totalIvaEUR * 100) / 100, withIvaCount],
      ['Total Facturas Fiscales', expenses.filter(e => e.docType === 'factura').reduce((acc, c) => acc + c.amountEUR, 0), invoicesCount],
      ['Total Tickets de Caja', expenses.filter(e => e.docType !== 'factura').reduce((acc, c) => acc + c.amountEUR, 0), ticketsCount],
      [''],
      ['2. GASTOS POR CATEGORÍA', 'TOTAL EUR (€)', '% DEL TOTAL'],
    ];

    Object.entries(categoryTotals).forEach(([cat, catEur]) => {
      const pct = totalEUR > 0 ? ((catEur / totalEUR) * 100).toFixed(1) + '%' : '0%';
      summaryRows.push([cat, Math.round(catEur * 100) / 100, pct]);
    });

    summaryRows.push(['']);
    summaryRows.push(['3. DESGLOSE POR DIVISA ORIGINAL', 'N° REGISTROS', 'TOTAL MONEDA ORIG.', 'EQUIVALENTE EUR (€)']);

    Object.entries(currencyTotals).forEach(([cur, val]) => {
      summaryRows.push([
        cur,
        val.count,
        Math.round(val.origTotal * 100) / 100,
        Math.round(val.eurTotal * 100) / 100
      ]);
    });

    const wsSummary = window.XLSX.utils.aoa_to_sheet(summaryRows);
    wsSummary['!cols'] = [
      { wch: 45 },
      { wch: 22 },
      { wch: 22 },
      { wch: 22 }
    ];

    // Añadir hojas al libro
    window.XLSX.utils.book_append_sheet(wb, wsDetail, 'Detalle de Gastos');
    window.XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumen Financiero');

    // Generar nombre de archivo con fecha
    const today = new Date().toISOString().slice(0, 10);
    const cleanTrip = tripName ? '_' + tripName.replace(/[^a-zA-Z0-9]/g, '_') : '';
    const fileName = `Wonderfield_Gastos_Viajes${cleanTrip}_${today}.xlsx`;

    // Descargar archivo
    window.XLSX.writeFile(wb, fileName);
  }
}

window.excelExportService = new ExcelExportService();
