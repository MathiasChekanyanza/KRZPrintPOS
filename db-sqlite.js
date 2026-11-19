'use strict';
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

class KrzSqliteStore {
  constructor(dbFilePath) {
    this.dbFilePath = dbFilePath || path.join(__dirname, 'krz_print_pos.sqlite');
    this.sql = new DatabaseSync(this.dbFilePath);
    this.initSchema();
  }

  initSchema() {
    this.sql.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        pin TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'Cashier',
        active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY,
        sku TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'General',
        cost REAL NOT NULL DEFAULT 0,
        price REAL NOT NULL DEFAULT 0,
        qty INTEGER NOT NULL DEFAULT 0,
        reorder INTEGER NOT NULL DEFAULT 5,
        track_stock INTEGER NOT NULL DEFAULT 1,
        taxable INTEGER NOT NULL DEFAULT 1,
        active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT DEFAULT '',
        email TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY,
        receipt TEXT NOT NULL UNIQUE,
        date TEXT NOT NULL,
        subtotal REAL NOT NULL DEFAULT 0,
        discount REAL NOT NULL DEFAULT 0,
        tax REAL NOT NULL DEFAULT 0,
        tax_mode TEXT DEFAULT 'off',
        tax_rate REAL DEFAULT 15,
        total REAL NOT NULL DEFAULT 0,
        tendered REAL DEFAULT 0,
        change_due REAL DEFAULT 0,
        method TEXT NOT NULL,
        customer_id INTEGER,
        cashier TEXT DEFAULT 'Admin',
        status TEXT NOT NULL DEFAULT 'Completed',
        void_reason TEXT DEFAULT '',
        voided_at TEXT
      );

      CREATE TABLE IF NOT EXISTS sale_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id INTEGER NOT NULL,
        product_id INTEGER,
        name TEXT NOT NULL,
        price REAL NOT NULL DEFAULT 0,
        cost REAL NOT NULL DEFAULT 0,
        qty INTEGER NOT NULL DEFAULT 1,
        track_stock INTEGER NOT NULL DEFAULT 1,
        taxable INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY,
        job_no TEXT NOT NULL UNIQUE,
        customer_id INTEGER NOT NULL,
        description TEXT NOT NULL,
        spec_size TEXT DEFAULT '',
        spec_colour TEXT DEFAULT '',
        spec_finishing TEXT DEFAULT '',
        spec_artwork TEXT DEFAULT '',
        qty INTEGER NOT NULL DEFAULT 1,
        total REAL NOT NULL DEFAULT 0,
        paid REAL NOT NULL DEFAULT 0,
        due_date TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'Pending',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS job_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        method TEXT NOT NULL DEFAULT 'Cash',
        note TEXT DEFAULT '',
        recorded_by TEXT DEFAULT 'Admin',
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY,
        date TEXT NOT NULL,
        category TEXT NOT NULL,
        method TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        description TEXT NOT NULL,
        recorded_by TEXT DEFAULT 'Admin'
      );

      CREATE TABLE IF NOT EXISTS stock_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        product_id INTEGER NOT NULL,
        change_qty INTEGER NOT NULL,
        note TEXT DEFAULT ''
      );
    `);
  }

  isEmpty() {
    const pCount = this.sql.prepare('SELECT COUNT(*) AS c FROM products').get().c;
    const sCount = this.sql.prepare('SELECT COUNT(*) AS c FROM sales').get().c;
    const cCount = this.sql.prepare('SELECT COUNT(*) AS c FROM customers').get().c;
    const jCount = this.sql.prepare('SELECT COUNT(*) AS c FROM jobs').get().c;
    const uCount = this.sql.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    return (pCount + sCount + cCount + jCount + uCount) === 0;
  }

  loadState() {
    if (this.isEmpty()) return null;

    const settings = {
      shopName: 'KRZ PRINT',
      trn: '',
      phone: '',
      address: '',
      openingFloat: 0,
      receiptFooter: 'Thank you for your business!',
      taxMode: 'off',
      taxRate: 15,
      lastBackupAt: null
    };
    for (const row of this.sql.prepare('SELECT key, value FROM settings').all()) {
      try {
        settings[row.key] = JSON.parse(row.value);
      } catch {
        settings[row.key] = row.value;
      }
    }

    const users = this.sql.prepare('SELECT * FROM users ORDER BY id ASC').all().map(r => ({
      id: r.id,
      username: r.username,
      name: r.name,
      pin: r.pin,
      role: r.role,
      active: Boolean(r.active)
    }));

    const products = this.sql.prepare('SELECT * FROM products ORDER BY id ASC').all().map(r => ({
      id: r.id,
      sku: r.sku,
      name: r.name,
      category: r.category,
      cost: Number(r.cost) || 0,
      price: Number(r.price) || 0,
      qty: Number(r.qty) || 0,
      reorder: Number(r.reorder) || 0,
      trackStock: Boolean(r.track_stock),
      taxable: Boolean(r.taxable),
      active: Boolean(r.active)
    }));

    const customers = this.sql.prepare('SELECT * FROM customers ORDER BY id ASC').all().map(r => ({
      id: r.id,
      name: r.name,
      phone: r.phone || '',
      email: r.email || '',
      notes: r.notes || '',
      updatedAt: r.updated_at || ''
    }));

    const itemsBySale = new Map();
    for (const item of this.sql.prepare('SELECT * FROM sale_items ORDER BY id ASC').all()) {
      if (!itemsBySale.has(item.sale_id)) itemsBySale.set(item.sale_id, []);
      itemsBySale.get(item.sale_id).push({
        id: item.product_id,
        name: item.name,
        price: Number(item.price) || 0,
        cost: Number(item.cost) || 0,
        qty: Number(item.qty) || 1,
        trackStock: Boolean(item.track_stock),
        taxable: Boolean(item.taxable)
      });
    }

    const sales = this.sql.prepare('SELECT * FROM sales ORDER BY id ASC').all().map(r => ({
      id: r.id,
      receipt: r.receipt,
      date: r.date,
      subtotal: Number(r.subtotal) || 0,
      discount: Number(r.discount) || 0,
      tax: Number(r.tax) || 0,
      taxMode: r.tax_mode || 'off',
      taxRate: Number(r.tax_rate) || 15,
      total: Number(r.total) || 0,
      tendered: Number(r.tendered) || 0,
      change: Number(r.change_due) || 0,
      method: r.method,
      customerId: r.customer_id || null,
      cashier: r.cashier || 'Admin',
      status: r.status || 'Completed',
      voidReason: r.void_reason || '',
      voidedAt: r.voided_at || null,
      items: itemsBySale.get(r.id) || []
    }));

    const paymentsByJob = new Map();
    for (const p of this.sql.prepare('SELECT * FROM job_payments ORDER BY id ASC').all()) {
      if (!paymentsByJob.has(p.job_id)) paymentsByJob.set(p.job_id, []);
      paymentsByJob.get(p.job_id).push({
        date: p.date,
        amount: Number(p.amount) || 0,
        method: p.method,
        note: p.note || '',
        by: p.recorded_by || 'Admin'
      });
    }

    const jobs = this.sql.prepare('SELECT * FROM jobs ORDER BY id ASC').all().map(r => ({
      id: r.id,
      jobNo: r.job_no,
      customerId: r.customer_id,
      description: r.description,
      specs: {
        size: r.spec_size || '',
        colour: r.spec_colour || '',
        finishing: r.spec_finishing || '',
        artwork: r.spec_artwork || ''
      },
      qty: Number(r.qty) || 1,
      total: Number(r.total) || 0,
      paid: Number(r.paid) || 0,
      dueDate: r.due_date || '',
      status: r.status || 'Pending',
      payments: paymentsByJob.get(r.id) || [],
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));

    const expenses = this.sql.prepare('SELECT * FROM expenses ORDER BY id ASC').all().map(r => ({
      id: r.id,
      date: r.date,
      category: r.category,
      method: r.method,
      amount: Number(r.amount) || 0,
      description: r.description,
      by: r.recorded_by || 'Admin'
    }));

    const stockLog = this.sql.prepare('SELECT * FROM stock_log ORDER BY id ASC').all().map(r => ({
      date: r.date,
      productId: r.product_id,
      change: Number(r.change_qty) || 0,
      note: r.note || ''
    }));

    const maxId = arr => Math.max(0, ...arr.map(x => Number(x.id) || 0)) + 1;

    return {
      version: 3,
      singleStation: true,
      sqliteFile: path.basename(this.dbFilePath),
      settings,
      users,
      products,
      customers,
      sales,
      jobs,
      expenses,
      stockLog,
      nextProductId: maxId(products),
      nextSaleId: maxId(sales),
      nextCustomerId: maxId(customers),
      nextJobId: maxId(jobs),
      nextExpenseId: maxId(expenses),
      nextUserId: Math.max(2, maxId(users))
    };
  }

  saveState(db) {
    this.sql.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      // 1. Settings
      this.sql.exec('DELETE FROM settings');
      const insSetting = this.sql.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
      for (const [k, v] of Object.entries(db.settings || {})) {
        insSetting.run(String(k), JSON.stringify(v ?? null));
      }

      // 2. Users
      this.sql.exec('DELETE FROM users');
      const insUser = this.sql.prepare('INSERT INTO users (id, username, name, pin, role, active) VALUES (?, ?, ?, ?, ?, ?)');
      for (const u of (db.users || [])) {
        insUser.run(Number(u.id), String(u.username), String(u.name), String(u.pin), String(u.role || 'Cashier'), u.active === false ? 0 : 1);
      }

      // 3. Products
      this.sql.exec('DELETE FROM products');
      const insProd = this.sql.prepare('INSERT INTO products (id, sku, name, category, cost, price, qty, reorder, track_stock, taxable, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const p of (db.products || [])) {
        insProd.run(
          Number(p.id), String(p.sku), String(p.name), String(p.category || 'General'),
          Number(p.cost) || 0, Number(p.price) || 0, Number(p.qty) || 0, Number(p.reorder) || 0,
          p.trackStock === false ? 0 : 1, p.taxable === false ? 0 : 1, p.active === false ? 0 : 1
        );
      }

      // 4. Customers
      this.sql.exec('DELETE FROM customers');
      const insCust = this.sql.prepare('INSERT INTO customers (id, name, phone, email, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
      for (const c of (db.customers || [])) {
        insCust.run(Number(c.id), String(c.name), String(c.phone || ''), String(c.email || ''), String(c.notes || ''), String(c.updatedAt || ''));
      }

      // 5. Sales & Sale Items
      this.sql.exec('DELETE FROM sale_items');
      this.sql.exec('DELETE FROM sales');
      const insSale = this.sql.prepare('INSERT INTO sales (id, receipt, date, subtotal, discount, tax, tax_mode, tax_rate, total, tendered, change_due, method, customer_id, cashier, status, void_reason, voided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      const insSaleItem = this.sql.prepare('INSERT INTO sale_items (sale_id, product_id, name, price, cost, qty, track_stock, taxable) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (const s of (db.sales || [])) {
        insSale.run(
          Number(s.id), String(s.receipt), String(s.date),
          Number(s.subtotal) || 0, Number(s.discount) || 0, Number(s.tax) || 0,
          String(s.taxMode || 'off'), Number(s.taxRate) || 15, Number(s.total) || 0,
          Number(s.tendered) || 0, Number(s.change) || 0, String(s.method || 'Cash'),
          s.customerId ? Number(s.customerId) : null, String(s.cashier || 'Admin'),
          String(s.status || 'Completed'), String(s.voidReason || ''), s.voidedAt ? String(s.voidedAt) : null
        );
        for (const i of (s.items || [])) {
          insSaleItem.run(
            Number(s.id), i.id ? Number(i.id) : null, String(i.name),
            Number(i.price) || 0, Number(i.cost) || 0, Number(i.qty) || 1,
            i.trackStock === false ? 0 : 1, i.taxable === false ? 0 : 1
          );
        }
      }

      // 6. Jobs & Job Payments
      this.sql.exec('DELETE FROM job_payments');
      this.sql.exec('DELETE FROM jobs');
      const insJob = this.sql.prepare('INSERT INTO jobs (id, job_no, customer_id, description, spec_size, spec_colour, spec_finishing, spec_artwork, qty, total, paid, due_date, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      const insJobPay = this.sql.prepare('INSERT INTO job_payments (job_id, date, amount, method, note, recorded_by) VALUES (?, ?, ?, ?, ?, ?)');
      for (const j of (db.jobs || [])) {
        const sp = j.specs || {};
        insJob.run(
          Number(j.id), String(j.jobNo), Number(j.customerId), String(j.description),
          String(sp.size || ''), String(sp.colour || ''), String(sp.finishing || ''), String(sp.artwork || ''),
          Number(j.qty) || 1, Number(j.total) || 0, Number(j.paid) || 0,
          String(j.dueDate || ''), String(j.status || 'Pending'), String(j.createdAt), String(j.updatedAt || j.createdAt)
        );
        for (const p of (j.payments || [])) {
          insJobPay.run(Number(j.id), String(p.date), Number(p.amount) || 0, String(p.method || 'Cash'), String(p.note || ''), String(p.by || 'Admin'));
        }
      }

      // 7. Expenses
      this.sql.exec('DELETE FROM expenses');
      const insExp = this.sql.prepare('INSERT INTO expenses (id, date, category, method, amount, description, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const e of (db.expenses || [])) {
        insExp.run(Number(e.id), String(e.date), String(e.category), String(e.method), Number(e.amount) || 0, String(e.description), String(e.by || 'Admin'));
      }

      // 8. Stock Log
      this.sql.exec('DELETE FROM stock_log');
      const insLog = this.sql.prepare('INSERT INTO stock_log (date, product_id, change_qty, note) VALUES (?, ?, ?, ?)');
      for (const l of (db.stockLog || [])) {
        insLog.run(String(l.date), Number(l.productId), Number(l.change) || 0, String(l.note || ''));
      }

      this.sql.exec('COMMIT');
    } catch (err) {
      this.sql.exec('ROLLBACK');
      throw err;
    }
  }

  getStats() {
    const tables = ['products', 'sales', 'sale_items', 'customers', 'jobs', 'job_payments', 'expenses', 'stock_log', 'users'];
    const counts = {};
    for (const t of tables) {
      counts[t] = this.sql.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
    }
    return {
      engine: 'SQLite (node:sqlite)',
      file: this.dbFilePath,
      singleStation: true,
      counts
    };
  }
}

module.exports = { KrzSqliteStore };
