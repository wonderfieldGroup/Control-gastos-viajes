/**
 * The Wonderfield Group - Datos de demostración y utilidades de comprobantes de prueba
 * Con divisas restringidas a Europa, Dólar (USD) y Australia (AUD).
 */

function generateReceiptSvg(title, amountStr, docType, dateStr) {
  const isInvoice = docType === 'factura';
  const color = isInvoice ? '#d93649' : '#4e407f';
  const badgeBg = isInvoice ? '#fbf1f5' : '#f4ebf8';
  const label = isInvoice ? 'FACTURA FISCAL' : 'TICKET / RECIBO';

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="400" height="560" viewBox="0 0 400 560" style="background:#faf9f7; font-family: 'Work Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
    <rect x="15" y="15" width="370" height="530" rx="16" fill="#ffffff" stroke="#ebd9e1" stroke-width="2" />
    <rect x="15" y="15" width="370" height="76" rx="16" fill="${color}" />
    
    <!-- Header SVG con Marca Wonderfield -->
    <text x="200" y="44" fill="#ffffff" font-size="12" font-weight="900" letter-spacing="2" text-anchor="middle">THE WONDERFIELD GROUP</text>
    <text x="200" y="66" fill="#faeef3" font-size="14" font-weight="bold" text-anchor="middle">${label}</text>
    
    <circle cx="200" cy="130" r="28" fill="${badgeBg}" />
    <text x="200" y="138" font-size="22" text-anchor="middle">${isInvoice ? '📄' : '🧾'}</text>
    
    <text x="200" y="185" fill="#231f38" font-size="16" font-weight="bold" text-anchor="middle">${title}</text>
    <text x="200" y="208" fill="#715c6b" font-size="12" text-anchor="middle">Fecha: ${dateStr}</text>
    
    <line x1="40" y1="230" x2="360" y2="230" stroke="#ebd9e1" stroke-dasharray="6,6" stroke-width="1.5"/>
    
    <text x="45" y="265" fill="#715c6b" font-size="12">Concepto / Proveedor</text>
    <text x="355" y="265" fill="#231f38" font-size="12" font-weight="600" text-anchor="end">${title}</text>
    
    <text x="45" y="295" fill="#715c6b" font-size="12">Estado en Wonderfield</text>
    <text x="355" y="295" fill="#16a34a" font-size="12" font-weight="bold" text-anchor="end">CONCILIADO</text>

    <text x="45" y="325" fill="#715c6b" font-size="12">Tipo Comprobante</text>
    <text x="355" y="325" fill="#231f38" font-size="12" font-weight="600" text-anchor="end">${isInvoice ? 'Factura Fiscal con IVA' : 'Ticket Simplificado'}</text>

    <line x1="40" y1="355" x2="360" y2="355" stroke="#ebd9e1" stroke-dasharray="6,6" stroke-width="1.5"/>

    <text x="45" y="395" fill="#231f38" font-size="14" font-weight="bold">TOTAL IMPORTE</text>
    <text x="355" y="395" fill="${color}" font-size="20" font-weight="900" text-anchor="end">${amountStr}</text>

    <rect x="40" y="430" width="320" height="65" rx="10" fill="#fbf1f5" stroke="#ebd9e1" />
    <text x="200" y="454" fill="#4e407f" font-size="11" font-weight="bold" text-anchor="middle">Wonderfield Group • Travel &amp; Expense</text>
    <text x="200" y="474" fill="#715c6b" font-size="10" font-family="monospace" text-anchor="middle">WON-REF: ${Math.random().toString(36).substr(2, 10).toUpperCase()}</text>
  </svg>
  `;

  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

const SAMPLE_EXPENSES = [
  {
    id: 'exp_demo_1',
    date: '2026-08-20',
    employee: 'Carlos Mendoza',
    trip: 'Revisión Kioscos Taiko Londres',
    reason: 'Alojamiento The Montcalm Hotel London (3 noches)',
    category: 'Alojamiento',
    docType: 'factura',
    currency: 'GBP',
    originalAmount: 650.00,
    rateToEUR: 1.1628,
    amountEUR: 755.82,
    hasIva: true,
    ivaRate: 20.0, // UK VAT
    baseEUR: 629.85,
    ivaEUR: 125.97,
    status: 'PAID',
    approvedBy: 'Director Roberto Gómez',
    approvedAt: '2026-08-21T11:00:00Z',
    paidBy: 'Lic. Laura Martínez',
    paidAt: '2026-08-22T15:30:00Z',
    paymentRef: 'TRANSF-849201',
    notes: 'Viaje técnico de inspección Taiko Londres.',
    receiptImage: generateReceiptSvg('The Montcalm Hotel London', '£650.00 GBP', 'factura', '2026-08-20'),
    createdAt: new Date('2026-08-20T10:30:00').toISOString()
  },
  {
    id: 'exp_demo_2',
    date: '2026-08-21',
    employee: 'Carlos Mendoza',
    trip: 'Revisión Kioscos Taiko Londres',
    reason: 'Cena de Trabajo Equipos Operativos YO! Sushi',
    category: 'Comidas y Dietas',
    docType: 'ticket',
    currency: 'GBP',
    originalAmount: 145.20,
    rateToEUR: 1.1628,
    amountEUR: 168.84,
    hasIva: false,
    ivaRate: 0,
    baseEUR: 168.84,
    ivaEUR: 0,
    status: 'APPROVED',
    approvedBy: 'Director Roberto Gómez',
    approvedAt: '2026-08-22T09:15:00Z',
    paidBy: null,
    paidAt: null,
    paymentRef: null,
    notes: 'Reunión de coordinación operativa.',
    receiptImage: generateReceiptSvg('Dishoom Covent Garden', '£145.20 GBP', 'ticket', '2026-08-21'),
    createdAt: new Date('2026-08-21T21:45:00').toISOString()
  },
  {
    id: 'exp_demo_3',
    date: '2026-08-22',
    employee: 'Elena Rostova',
    trip: 'Supervisión Bento & Sushi Izu Sydney',
    reason: 'Vuelo Intercity Melbourne - Sydney (Virgin Australia)',
    category: 'Transporte y Vuelos',
    docType: 'factura',
    currency: 'AUD',
    originalAmount: 380.00,
    rateToEUR: 0.6061,
    amountEUR: 230.32,
    hasIva: true,
    ivaRate: 10.0, // Australian GST
    baseEUR: 209.38,
    ivaEUR: 20.94,
    status: 'PENDING',
    approvedBy: null,
    approvedAt: null,
    paidBy: null,
    paidAt: null,
    paymentRef: null,
    notes: 'Desplazamiento para auditoría en plantas de Sushi Izu.',
    receiptImage: generateReceiptSvg('Virgin Australia Airlines', 'A$380.00 AUD', 'factura', '2026-08-22'),
    createdAt: new Date('2026-08-22T14:10:00').toISOString()
  },
  {
    id: 'exp_demo_4',
    date: '2026-08-23',
    employee: 'Elena Rostova',
    trip: 'Supervisión Bento & Sushi Izu Sydney',
    reason: 'Taxi Ejecutivo Aeropuerto Sydney a Sede Central',
    category: 'Taxi y Movilidad',
    docType: 'ticket',
    currency: 'AUD',
    originalAmount: 85.00,
    rateToEUR: 0.6061,
    amountEUR: 51.52,
    hasIva: false,
    ivaRate: 0,
    baseEUR: 51.52,
    ivaEUR: 0,
    status: 'PENDING',
    approvedBy: null,
    approvedAt: null,
    paidBy: null,
    paidAt: null,
    paymentRef: null,
    notes: 'Traslado con equipaje y muestras.',
    receiptImage: generateReceiptSvg('Sydney Premier Cabs', 'A$85.00 AUD', 'ticket', '2026-08-23'),
    createdAt: new Date('2026-08-23T08:30:00').toISOString()
  },
  {
    id: 'exp_demo_5',
    date: '2026-08-24',
    employee: 'Jean-Luc Dubois',
    trip: 'Aperturas Snowfox & Zenshi París',
    reason: 'Alojamiento Novotel Paris Centre (2 noches)',
    category: 'Alojamiento',
    docType: 'factura',
    currency: 'EUR',
    originalAmount: 420.00,
    rateToEUR: 1.0,
    amountEUR: 420.00,
    hasIva: true,
    ivaRate: 20.0, // TVA Francia
    baseEUR: 350.00,
    ivaEUR: 70.00,
    status: 'PAID',
    approvedBy: 'Director Roberto Gómez',
    approvedAt: '2026-08-24T18:00:00Z',
    paidBy: 'Lic. Laura Martínez',
    paidAt: '2026-08-25T10:00:00Z',
    paymentRef: 'TRANSF-102938',
    notes: 'Supervisión de nuevos córners comerciales.',
    receiptImage: generateReceiptSvg('Novotel Paris Tour Eiffel', '420,00 € EUR', 'factura', '2026-08-24'),
    createdAt: new Date('2026-08-24T16:00:00').toISOString()
  },
  {
    id: 'exp_demo_6',
    date: '2026-08-25',
    employee: 'Jean-Luc Dubois',
    trip: 'Aperturas Snowfox & Zenshi París',
    reason: 'Catering Presentación Lanzamiento Zenshi',
    category: 'Clientes y Comercial',
    docType: 'factura',
    currency: 'EUR',
    originalAmount: 290.00,
    rateToEUR: 1.0,
    amountEUR: 290.00,
    hasIva: true,
    ivaRate: 10.0,
    baseEUR: 263.64,
    ivaEUR: 26.36,
    status: 'REJECTED',
    approvedBy: 'Director Roberto Gómez',
    approvedAt: '2026-08-25T14:30:00Z',
    rejectionReason: 'Falta adjuntar la lista detallada de asistentes y la factura a nombre de The Wonderfield Group.',
    paidBy: null,
    paidAt: null,
    paymentRef: null,
    notes: 'Degustación de producto.',
    receiptImage: generateReceiptSvg('Le Gourmet Traiteur Paris', '290,00 € EUR', 'factura', '2026-08-25'),
    createdAt: new Date('2026-08-25T12:00:00').toISOString()
  }
];

if (typeof window !== 'undefined') {
  window.sampleExpenses = SAMPLE_EXPENSES;
  window.generateReceiptSvg = generateReceiptSvg;
}
