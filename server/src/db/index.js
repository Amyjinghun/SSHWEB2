const mysql = require('mysql2/promise');
const config = require('../config');

const pool = mysql.createPool(config.mysql);

async function ensureSchema() {
  try {
    await pool.execute('ALTER TABLE users ADD COLUMN token_version INT NOT NULL DEFAULT 0 AFTER status');
  } catch (err) {
    // ER_DUP_FIELDNAME: column already exists. ER_NO_SUCH_TABLE may happen before initial schema import.
    if (err.code !== 'ER_DUP_FIELDNAME' && err.code !== 'ER_NO_SUCH_TABLE') throw err;
  }
}

async function query(sql, params) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function queryOne(sql, params) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

async function insert(sql, params) {
  const [result] = await pool.execute(sql, params);
  return result.insertId;
}

async function update(sql, params) {
  const [result] = await pool.execute(sql, params);
  return result.affectedRows;
}

async function remove(sql, params) {
  const [result] = await pool.execute(sql, params);
  return result.affectedRows;
}

module.exports = { pool, query, queryOne, insert, update, remove, ensureSchema };
