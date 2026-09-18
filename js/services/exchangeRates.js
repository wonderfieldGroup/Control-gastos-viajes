/**
 * Servicio de Tasas de Cambio Multidivisa
 * Monedas configuradas: Monedas de Europa, Dólar Estadounidense (USD) y Dólar Australiano (AUD).
 */

const CURRENCIES = [
  { code: 'EUR', name: 'Euro (€)', symbol: '€', flag: '🇪🇺', region: 'Europa' },
  { code: 'USD', name: 'Dólar Estadounidense ($)', symbol: '$', flag: '🇺🇸', region: 'América' },
  { code: 'GBP', name: 'Libra Esterlina (£)', symbol: '£', flag: '🇬🇧', region: 'Europa' },
  { code: 'CHF', name: 'Franco Suizo (CHF)', symbol: 'CHF', flag: '🇨🇭', region: 'Europa' },
  { code: 'AUD', name: 'Dólar Australiano (A$)', symbol: 'A$', flag: '🇦🇺', region: 'Australia' },
  { code: 'SEK', name: 'Corona Sueca (kr)', symbol: 'kr', flag: '🇸🇪', region: 'Europa' },
  { code: 'NOK', name: 'Corona Noruega (kr)', symbol: 'kr', flag: '🇳🇴', region: 'Europa' },
  { code: 'DKK', name: 'Corona Danesa (kr)', symbol: 'kr', flag: '🇩🇰', region: 'Europa' },
  { code: 'PLN', name: 'Zloty Polaco (zł)', symbol: 'zł', flag: '🇵🇱', region: 'Europa' },
  { code: 'CZK', name: 'Corona Checa (Kč)', symbol: 'Kč', flag: '🇨🇿', region: 'Europa' }
];

// Tasas de respaldo offline aproximadas por 1 EUR
const OFFLINE_RATES_EUR_BASE = {
  EUR: 1.0,
  USD: 1.08,
  GBP: 0.85,
  CHF: 0.96,
  AUD: 1.66,
  SEK: 11.45,
  NOK: 11.60,
  DKK: 7.46,
  PLN: 4.28,
  CZK: 25.20
};

class ExchangeRateService {
  constructor() {
    this.rates = { ...OFFLINE_RATES_EUR_BASE };
    this.lastFetched = null;
    this.isOnline = false;
    this.init();
  }

  async init() {
    const cached = localStorage.getItem('travel_expense_rates_filtered');
    if (cached) {
      try {
        const data = JSON.parse(cached);
        if (data.rates && data.timestamp) {
          this.rates = { ...OFFLINE_RATES_EUR_BASE, ...data.rates };
          this.lastFetched = new Date(data.timestamp);
        }
      } catch (e) {
        console.warn('Error leyendo cache de divisas', e);
      }
    }

    await this.fetchLiveRates();
  }

  async fetchLiveRates() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const response = await fetch('https://open.er-api.com/v6/latest/EUR', {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        if (data && data.rates) {
          this.rates = { ...this.rates, ...data.rates };
          this.lastFetched = new Date();
          this.isOnline = true;
          localStorage.setItem('travel_expense_rates_filtered', JSON.stringify({
            rates: this.rates,
            timestamp: this.lastFetched.toISOString()
          }));
          return true;
        }
      }
    } catch (err) {
      console.warn('Usando tasas de respaldo offline.', err);
      this.isOnline = false;
    }
    return false;
  }

  getRateToEUR(currencyCode) {
    const code = (currencyCode || 'EUR').toUpperCase();
    if (code === 'EUR') return 1.0;

    const rateInEURBase = this.rates[code] || OFFLINE_RATES_EUR_BASE[code] || 1.0;
    if (rateInEURBase <= 0) return 1.0;
    
    return 1 / rateInEURBase;
  }

  convertToEUR(amount, currencyCode, customRate = null) {
    const numericAmount = parseFloat(amount) || 0;
    const rate = customRate !== null && !isNaN(customRate) && customRate > 0 
      ? parseFloat(customRate) 
      : this.getRateToEUR(currencyCode);
    
    const amountEUR = numericAmount * rate;
    return {
      amountEUR: Math.round(amountEUR * 100) / 100,
      rateToEUR: rate,
      formattedEUR: amountEUR.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })
    };
  }

  getCurrencies() {
    return CURRENCIES;
  }

  getCurrencyInfo(code) {
    return CURRENCIES.find(c => c.code === code) || { code, name: code, symbol: code, flag: '🌐' };
  }
}

window.exchangeRateService = new ExchangeRateService();
