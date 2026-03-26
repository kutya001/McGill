/**
 * KuApp Backend — Google Apps Script
 *
 * Этот скрипт служит бэкендом для платформы KuApp.
 * Все операции с Google Sheets проходят через него.
 *
 * Настройка:
 *   1. Создайте новый проект Google Apps Script (script.google.com)
 *   2. Вставьте этот код в Code.gs
 *   3. Добавьте Script Property:
 *        SPREADSHEET_ID = <ID вашей Google Таблицы>
 *      (Файл → Настройки проекта → Свойства скрипта)
 *   4. Разверните как веб-приложение:
 *        Развернуть → Новое развёртывание → Веб-приложение
 *        Выполнять как: Я
 *        Доступ:       Все
 *   5. Скопируйте URL развёртывания и вставьте в KuApp
 *
 * Если вы используете Service Account JSON:
 *   Сохраните его содержимое как Script Property SA_JSON
 *   (не требуется, если таблица доступна вашему аккаунту Google)
 */

/* ═══════════════════════════════════════════════════
 * HELPERS
 * ═══════════════════════════════════════════════════ */

function getSpreadsheet() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('SPREADSHEET_ID не настроен в Script Properties');
  return SpreadsheetApp.openById(id);
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function ok(data)  { return json({ ok: true, data: data }); }
function fail(msg) { return json({ ok: false, error: msg }); }

/** Разбирает диапазон "SheetName!A2:G100" → { sheet, range } */
function parseRange(rangeStr) {
  const idx = rangeStr.indexOf('!');
  if (idx === -1) return { sheet: rangeStr, range: null };
  return { sheet: rangeStr.substring(0, idx), range: rangeStr.substring(idx + 1) };
}

/** Буквенный столбец → номер (A=1, B=2, AA=27) */
function colLetterToNum(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return n;
}

/** Преобразует 2D-массив значений в строки (совместимость с Sheets API v4) */
function stringify2D(data) {
  return data.map(function(row) {
    return row.map(function(cell) {
      if (cell instanceof Date) return cell.toISOString();
      if (cell === null || cell === undefined) return '';
      return String(cell);
    });
  });
}

/* ═══════════════════════════════════════════════════
 * ENTRY POINTS
 * ═══════════════════════════════════════════════════ */

function doGet(e) {
  return ok({ service: 'KuApp Backend', version: '1.0' });
}

function doPost(e) {
  try {
    if (!e || !e.postData) throw new Error('Нет данных POST');
    var body   = JSON.parse(e.postData.contents);
    var action = body.action;
    var params = body.params || {};
    var ss     = getSpreadsheet();

    switch (action) {
      case 'read':         return ok(doRead(ss, params));
      case 'append':       return ok(doAppend(ss, params));
      case 'update':       return ok(doUpdate(ss, params));
      case 'batchValues':  return ok(doBatchValues(ss, params));
      case 'meta':         return ok(doMeta(ss));
      case 'addSheets':    return ok(doAddSheets(ss, params));
      case 'deleteSheet':  return ok(doDeleteSheet(ss, params));
      case 'deleteRows':   return ok(doDeleteRows(ss, params));
      default:             throw new Error('Неизвестное действие: ' + action);
    }
  } catch (err) {
    return fail(err.message);
  }
}

/* ═══════════════════════════════════════════════════
 * ACTIONS
 * ═══════════════════════════════════════════════════ */

/**
 * Чтение диапазона.
 * params: { range: "SheetName!A2:G5000" }
 * Возвращает: { values: [[...], ...] }
 */
function doRead(ss, params) {
  var p  = parseRange(params.range);
  var sh = ss.getSheetByName(p.sheet);
  if (!sh) return { values: [] };

  var lastRow = sh.getLastRow();
  if (lastRow === 0) return { values: [] };

  var ref      = sh.getRange(p.range);
  var startRow = ref.getRow();
  if (startRow > lastRow) return { values: [] };

  var endRow  = Math.min(ref.getLastRow(), lastRow);
  var numRows = endRow - startRow + 1;
  if (numRows <= 0) return { values: [] };

  var data = sh.getRange(startRow, ref.getColumn(), numRows, ref.getNumColumns()).getValues();
  return { values: stringify2D(data) };
}

/**
 * Добавление строк в конец листа.
 * params: { range: "SheetName!A:G", values: [[...], ...] }
 */
function doAppend(ss, params) {
  var p  = parseRange(params.range);
  var sh = ss.getSheetByName(p.sheet);
  if (!sh) throw new Error('Лист не найден: ' + p.sheet);

  var values = params.values;
  if (!values || !values.length) return { updatedRows: 0 };

  var lastRow  = sh.getLastRow();
  var startCol = 1;
  if (p.range) {
    var match = p.range.match(/([A-Z]+)/);
    if (match) startCol = colLetterToNum(match[1]);
  }

  sh.getRange(lastRow + 1, startCol, values.length, values[0].length).setValues(values);
  return { updatedRows: values.length };
}

/**
 * Обновление ячейки / диапазона.
 * params: { range: "SheetName!D5", values: "new_value" | ["a","b"] | [["a","b"]] }
 */
function doUpdate(ss, params) {
  var p  = parseRange(params.range);
  var sh = ss.getSheetByName(p.sheet);
  if (!sh) throw new Error('Лист не найден: ' + p.sheet);

  var values = params.values;
  if (!Array.isArray(values))         values = [[values]];
  else if (!Array.isArray(values[0])) values = [values];

  sh.getRange(p.range).setValues(values);
  return { updated: true };
}

/**
 * Пакетное обновление значений.
 * params: { data: [{ range: "Sheet!B2", values: [["val"]] }, ...] }
 */
function doBatchValues(ss, params) {
  var data = params.data;
  for (var i = 0; i < data.length; i++) {
    var item = data[i];
    var p  = parseRange(item.range);
    var sh = ss.getSheetByName(p.sheet);
    if (!sh) throw new Error('Лист не найден: ' + p.sheet);
    sh.getRange(p.range).setValues(item.values);
  }
  return { updated: data.length };
}

/**
 * Метаданные всех листов.
 * Возвращает: { sheets: [{ title, sheetId }, ...] }
 */
function doMeta(ss) {
  var sheets = ss.getSheets();
  return {
    sheets: sheets.map(function(sh) {
      return { title: sh.getName(), sheetId: sh.getSheetId() };
    })
  };
}

/**
 * Создание новых листов.
 * params: { titles: ["sheet1", "sheet2"] }
 */
function doAddSheets(ss, params) {
  var titles = params.titles;
  for (var i = 0; i < titles.length; i++) {
    ss.insertSheet(titles[i]);
  }
  return { created: titles.length };
}

/**
 * Удаление листа по sheetId.
 * params: { sheetId: 12345 }
 */
function doDeleteSheet(ss, params) {
  var sheetId = params.sheetId;
  var sheets  = ss.getSheets();
  var target  = null;
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === sheetId) { target = sheets[i]; break; }
  }
  if (!target) throw new Error('Лист с ID ' + sheetId + ' не найден');
  ss.deleteSheet(target);
  return { deleted: true };
}

/**
 * Удаление строк (0-based индексы, endIndex не включается).
 * params: { sheetId: 12345, startIndex: 4, endIndex: 5 }
 */
function doDeleteRows(ss, params) {
  var sheetId    = params.sheetId;
  var startIndex = params.startIndex;
  var endIndex   = params.endIndex;

  var sheets = ss.getSheets();
  var target = null;
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === sheetId) { target = sheets[i]; break; }
  }
  if (!target) throw new Error('Лист не найден');

  // Удаляем снизу вверх, чтобы индексы не сбивались
  for (var r = endIndex; r > startIndex; r--) {
    target.deleteRow(r); // deleteRow использует 1-based индекс
  }
  return { deleted: endIndex - startIndex };
}
