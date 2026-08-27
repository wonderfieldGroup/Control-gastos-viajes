/**
 * Servicio de Base de Datos Local (IndexedDB)
 * Almacena gastos, comprobantes fotográficos y gestiona estados del flujo:
 * PENDING -> APPROVED / REJECTED -> PAID
 */

const DB_NAME = 'TravelExpenseDB_v2';
const DB_VERSION = 1;
const STORE_NAME = 'expenses';

class DatabaseService {
  constructor() {
    this.db = null;
    this.readyPromise = this.openDatabase();
  }

  openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('date', 'date', { unique: false });
          store.createIndex('employee', 'employee', { unique: false });
          store.createIndex('docType', 'docType', { unique: false });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('trip', 'trip', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('Error al inicializar IndexedDB:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  async ensureDb() {
    if (!this.db) {
      await this.readyPromise;
    }
    return this.db;
  }

  async getAll() {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const results = request.result || [];
        results.sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0));
        resolve(results);
      };

      request.onerror = (e) => reject(e.target.error);
    });
  }

  async getById(id) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async add(expense) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      
      const itemToSave = {
        ...expense,
        id: expense.id || 'exp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        status: expense.status || 'PENDING', // PENDING, APPROVED, REJECTED, PAID
        createdAt: expense.createdAt || new Date().toISOString()
      };

      const request = store.add(itemToSave);

      request.onsuccess = () => resolve(itemToSave);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async update(expense) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put({
        ...expense,
        updatedAt: new Date().toISOString()
      });

      request.onsuccess = () => resolve(expense);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async approve(id, managerName = 'Director') {
    const item = await this.getById(id);
    if (!item) throw new Error('Gasto no encontrado');

    item.status = 'APPROVED';
    item.approvedAt = new Date().toISOString();
    item.approvedBy = managerName;
    item.rejectionReason = null;

    return await this.update(item);
  }

  async reject(id, reason, managerName = 'Director') {
    const item = await this.getById(id);
    if (!item) throw new Error('Gasto no encontrado');

    item.status = 'REJECTED';
    item.rejectedAt = new Date().toISOString();
    item.approvedBy = managerName;
    item.rejectionReason = reason || 'No cumple con las políticas de viaje corporativo';

    return await this.update(item);
  }

  async markAsPaid(id, financeName = 'Tesorería', paymentRef = '') {
    const item = await this.getById(id);
    if (!item) throw new Error('Gasto no encontrado');

    item.status = 'PAID';
    item.paidAt = new Date().toISOString();
    item.paidBy = financeName;
    item.paymentRef = paymentRef || 'TRANSF-' + Date.now().toString().slice(-6);

    return await this.update(item);
  }

  async delete(id) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve(true);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async clear() {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve(true);
      request.onerror = (e) => reject(e.target.error);
    });
  }
}

window.databaseService = new DatabaseService();
