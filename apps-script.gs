// CONFIGURATION
// Paste your spreadsheet ID here (from the sheet URL: docs.google.com/spreadsheets/d/<THIS_PART>/edit)
// If left blank, the script uses the spreadsheet it is bound to.
const SPREADSHEET_ID = '';

function getSpreadsheet() {
  if (SPREADSHEET_ID) {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

function doPost(e) {
  if (!e || (!e.postData && !e.parameter)) {
    console.log('⚠️ No POST data received');
    return ContentService.createTextOutput('ERROR: No POST data received');
  }

  try {
    const ss = getSpreadsheet();
    if (!ss) return ContentService.createTextOutput('ERROR: No spreadsheet found - check SPREADSHEET_ID or bind the script');
    // Use the first sheet for data logging
    const sheet = ss.getSheets()[0];

    // --- 1. CLEAN KEY GENERATION ---
    const makeKey = (page, item) => {
      if (!page || !item) return 'unknown';
      return (page.toString() + '-' + item.toString())
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '')
        .trim();
    };

    // --- 2. SETUP HEADERS ---
    if (sheet.getLastRow() === 0) {
      const headers = [
        'Start_Time', 'End_Time', 'Checkup_Time', 'EMT', 'Shift',
        'Category', 'Item', 'Initial_Status', 'Final_Status',
        'Initial_Quantity', 'Final_Quantity', 'Required_Quantity'
      ];
      sheet.getRange(1, 1, 1, 12).setValues([headers]);
      sheet.getRange(1, 1, 1, 12)
        .setBackground('#c62828')
        .setFontColor('white')
        .setFontWeight('bold')
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle')
        .setBorder(true, true, true, true, true, true);
    }

    // --- 3. DATA PARSING ---
    // e.postData.contents is the most reliable source for large payloads.
    // e.parameter.data is used as fallback.
    let rawData = '';
    if (e.postData && e.postData.contents) {
      try {
        rawData = decodeURIComponent(e.postData.contents);
      } catch (err) {
        rawData = e.postData.contents;
      }
      if (rawData.startsWith('data=')) rawData = rawData.substring(5);
    }
    if (!rawData && e.parameter && e.parameter.data) {
      rawData = e.parameter.data;
    }

    let data;
    try {
      data = JSON.parse(rawData.trim());
    } catch (error) {
      console.error('❌ Parse error:', error.toString(), '| rawData:', rawData.slice(0, 200));
      return ContentService.createTextOutput('ERROR: Parse failed - ' + error.toString());
    }

    const phase = data[0].phase;
    const emt = data[0].emt;
    const car = data[0].car;
    const shift = data[0].shift || 'Unknown';
    const cacheKey = 'pending_' + emt + '_' + car;

    // --- 4. PHASE 1: INITIAL CHECKUP (Save to Cache Sheet) ---
    if (phase === 'INITIAL CHECKUP') {
      saveToCacheSheet(ss, cacheKey, JSON.stringify(data));
      console.log('💾 Initial state cached for ' + emt);
      return ContentService.createTextOutput('OK');
    }

    // --- 5. PHASE 2: FINAL RESTOCK ---
    const finalData = data;

    const validateDate = (dateStr) => {
      if (!dateStr || dateStr === "N/A" || dateStr === "undefined") return new Date();
      const d = new Date(dateStr);
      return isNaN(d.getTime()) ? new Date() : d;
    };

    const startTime = validateDate(finalData[0].start_time);
    const endTime = validateDate(finalData[0].end_time);
    const checkupTime = finalData[0].checkup_time || 'N/A';

    const pendingDataRaw = getFromCacheSheet(ss, cacheKey);
    const initialData = pendingDataRaw ? JSON.parse(pendingDataRaw) : [];

    // --- 6. REQUIRED QUANTITIES MAPPING ---
    const requiredQuantities = {
      // SOIN CLOSET
      'Serum': '4',
      'Silvederma': '4',
      'Yellow Burn Med': '4',
      'Sofratulle': '5',
      'Betadine': '2',
      'Band Aid Type 1 (pack)': '1 pack',
      'Band Aid Type 2 (pack)': '1 pack',
      'Wara2 akhdar': '20 sheets',
      'Gauze Bandage Medium': '2',
      'Gauze Bandage Large': '2',
      'Gauze Roll': '5',
      'Non-Alergic Tape': '6',
      'Gloves Medium': '3',
      'Gloves Small': '3',
      'Gloves Large': '3',
      'Gloves X Large': '3',
      'Face Mask': '6',
      'KN95': '12',
      'High risk gloves': '1 pack',
      'Sanitizer': '2',
      'Blue Pads': '3',
      'Trash Bag': '1',
      'Paper Towel (roll)': '3',
      'Descosept Sensitive': '3',
      'Descosept spezial': '3',

      // MINI WAREHOUSE
      'Elastic Bandage Small': '10',
      'Elastic Bandage Medium': '10',
      'Elastic Bandage Large': '10',
      'Compressive Bandage': '10',
      'Triangular Bandage': '4',
      'Nasal Adult': '10',
      'Oxygen Face Mask Adult': '10',
      'Oxygen NonRebr': '10',
      'Pediatric (each)': '3 each',
      'Glucometer Strips (pack)': '2 packs',
      'Gluco Meter Needles (pack)': '1 pack',
      'AED Patch': '10',
      'Thermometer Strips': '10',
      'Suction Tube (Green)': '4',
      'Suction Tube (Black)': '4',
      'Suction Tube (orange)': '4',
      'Suction tubes (thin & thick)': '3',
      'Hepa Filters': '3',
      'OPA (Yellow)': '3',
      'OPA (Red)': '3',
      'OPA (Pink)': '3',
      'OPA (Light Blue)': '3',
      'OPA (Dark Green)': '3',
      'OPA (White)': '4',
      'OPA (Black)': '3',
      'OPA (Dark Blue)': '3',
      'Ice Packs': '2',
      'Gowns': '4',
      'Disposables': '10',
      'Face Shields': '8'
    };

    // --- 7. ALL ITEMS LIST ---
    const allItems = [
      {page: 'Soin Closet', item: 'Serum'},
      {page: 'Soin Closet', item: 'Silvederma'},
      {page: 'Soin Closet', item: 'Yellow Burn Med'},
      {page: 'Soin Closet', item: 'Sofratulle'},
      {page: 'Soin Closet', item: 'Betadine'},
      {page: 'Soin Closet', item: 'Band Aid Type 1 (pack)'},
      {page: 'Soin Closet', item: 'Band Aid Type 2 (pack)'},
      {page: 'Soin Closet', item: 'Wara2 akhdar'},
      {page: 'Soin Closet', item: 'Gauze Bandage Medium'},
      {page: 'Soin Closet', item: 'Gauze Bandage Large'},
      {page: 'Soin Closet', item: 'Gauze Roll'},
      {page: 'Soin Closet', item: 'Non-Alergic Tape'},
      {page: 'Soin Closet', item: 'Gloves Medium'},
      {page: 'Soin Closet', item: 'Gloves Small'},
      {page: 'Soin Closet', item: 'Gloves Large'},
      {page: 'Soin Closet', item: 'Gloves X Large'},
      {page: 'Soin Closet', item: 'Face Mask'},
      {page: 'Soin Closet', item: 'KN95'},
      {page: 'Soin Closet', item: 'High risk gloves'},
      {page: 'Soin Closet', item: 'Sanitizer'},
      {page: 'Soin Closet', item: 'Blue Pads'},
      {page: 'Soin Closet', item: 'Trash Bag'},
      {page: 'Soin Closet', item: 'Paper Towel (roll)'},
      {page: 'Soin Closet', item: 'Descosept Sensitive'},
      {page: 'Soin Closet', item: 'Descosept spezial'},
      {page: 'Mini Warehouse', item: 'Elastic Bandage Small'},
      {page: 'Mini Warehouse', item: 'Elastic Bandage Medium'},
      {page: 'Mini Warehouse', item: 'Elastic Bandage Large'},
      {page: 'Mini Warehouse', item: 'Compressive Bandage'},
      {page: 'Mini Warehouse', item: 'Triangular Bandage'},
      {page: 'Mini Warehouse', item: 'Nasal Adult'},
      {page: 'Mini Warehouse', item: 'Oxygen Face Mask Adult'},
      {page: 'Mini Warehouse', item: 'Oxygen NonRebr'},
      {page: 'Mini Warehouse', item: 'Pediatric (each)'},
      {page: 'Mini Warehouse', item: 'Glucometer Strips (pack)'},
      {page: 'Mini Warehouse', item: 'Gluco Meter Needles (pack)'},
      {page: 'Mini Warehouse', item: 'AED Patch'},
      {page: 'Mini Warehouse', item: 'Thermometer Strips'},
      {page: 'Mini Warehouse', item: 'Suction Tube (Green)'},
      {page: 'Mini Warehouse', item: 'Suction Tube (Black)'},
      {page: 'Mini Warehouse', item: 'Suction Tube (orange)'},
      {page: 'Mini Warehouse', item: 'Suction tubes (thin & thick)'},
      {page: 'Mini Warehouse', item: 'Hepa Filters'},
      {page: 'Mini Warehouse', item: 'OPA (Yellow)'},
      {page: 'Mini Warehouse', item: 'OPA (Red)'},
      {page: 'Mini Warehouse', item: 'OPA (Pink)'},
      {page: 'Mini Warehouse', item: 'OPA (Light Blue)'},
      {page: 'Mini Warehouse', item: 'OPA (Dark Green)'},
      {page: 'Mini Warehouse', item: 'OPA (White)'},
      {page: 'Mini Warehouse', item: 'OPA (Black)'},
      {page: 'Mini Warehouse', item: 'OPA (Dark Blue)'},
      {page: 'Mini Warehouse', item: 'Ice Packs'},
      {page: 'Mini Warehouse', item: 'Gowns'},
      {page: 'Mini Warehouse', item: 'Disposables'},
      {page: 'Mini Warehouse', item: 'Face Shields'}
    ];


    const initialMap = {};
    initialData.forEach(r => { initialMap[makeKey(r.page, r.item)] = r; });

    const finalMap = {};
    finalData.forEach(r => { finalMap[makeKey(r.page, r.item)] = r; });

    function getNumericValue(qty) {
      if (!qty || qty === '0' || qty === '') return 0;

      let match = qty.toString().match(/\d+/);
      if (match) {
        return parseInt(match[0], 10);
      }
      return 0;
    }

    const finalRows = [];

    allItems.forEach(itemInfo => {
      const key = makeKey(itemInfo.page, itemInfo.item);
      const initialRow = initialMap[key];
      const finalRow = finalMap[key];
      const reqTxt = requiredQuantities[itemInfo.item] || '1';
      const reqNum = getNumericValue(reqTxt);

      const isPercent = reqTxt.includes('%');
      const isPsi = reqTxt.toLowerCase().includes('psi');

      // --- 1. GET INITIAL DATA ---
      let initQtyRaw = "0";
      let initIsChecked = false;
      if (initialRow) {
        initIsChecked = initialRow.checked === true || initialRow.checked === "true";
        initQtyRaw = initialRow.quantity ?? initialRow.psi_value ?? (initIsChecked ? "1" : "0");
      }
      let initNum = getNumericValue(initQtyRaw);

      let initStatus = (initNum >= reqNum || (initIsChecked && !isPercent && !isPsi)) ? '✅ PRESENT' : '❌ INSUFFICIENT';

      // --- 2. GET FINAL DATA ---
      let finNum = initNum;
      let finIsChecked = false;

      if (finalRow) {
        finIsChecked = finalRow.checked === true || finalRow.checked === "true";
        let finalValRaw = finalRow.quantity ?? finalRow.psi_value ?? (finIsChecked ? "1" : "0");
        finNum = getNumericValue(finalValRaw);
      }

      // --- 3. FINAL LOGIC ---
      let finStatus = '';

      if (initStatus === '✅ PRESENT') {
        finStatus = '✅ PRESENT';
      } else {
        const isNowFull = finNum >= (isPercent ? 100 : reqNum) || finIsChecked;

        if (isNowFull) {
          finStatus = '✅ RESTOCKED';
          if (isPercent) finNum = 100;
          else if (isPsi) finNum = 2000;
          else if (finNum < reqNum) finNum = reqNum;
        } else {
          finStatus = '⚠️ WAREHOUSE OUT OF STOCK';
        }
      }

      // --- 4. FORMAT DISPLAY ---
      let displayInit = initNum.toString() + (isPsi ? ' psi' : isPercent ? '%' : '');
      let displayFin = finNum.toString() + (isPsi ? ' psi' : isPercent ? '%' : '');

      finalRows.push([
        startTime,
        endTime,
        checkupTime,
        emt,
        shift,
        itemInfo.page,
        itemInfo.item,
        initStatus,
        finStatus,
        displayInit,
        displayFin,
        reqTxt
      ]);
    });

    // --- 9. FINAL SHEET WRITE ---
    // Leave 2 empty rows between each submission's table so they are easy to distinguish.
    // First submission starts right after the header; later ones start 2 rows below the last one.
    const firstDataRow = sheet.getLastRow() <= 1 ? 2 : sheet.getLastRow() + 3;
    const outputRange = sheet.getRange(firstDataRow, 1, finalRows.length, 12);
    outputRange.setValues(finalRows);

    // Show Start_Time and End_Time with full date (year-month-day) and 24-hour time.
    sheet.getRange(firstDataRow, 1, finalRows.length, 2).setNumberFormat('yyyy-mm-dd HH:mm');

    // Table borders around the whole submission block
    outputRange.setBorder(true, true, true, true, true, true);

    // Ensure every Start_Time / End_Time cell (old and new) shows full date + 24h time.
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, 2).setNumberFormat('yyyy-mm-dd HH:mm');
    }

    // Auto-size so nothing is hidden. This runs on the WHOLE sheet, so it also
    // fixes rows written by older versions.
    autoSizeColumns(sheet);

    deleteFromCacheSheet(ss, cacheKey);

    console.log('✅ Final report written successfully for ' + car);
    return ContentService.createTextOutput('OK');

  } catch (err) {
    console.error('❌ CRITICAL ERROR:', err.toString());
    return ContentService.createTextOutput('ERROR: ' + err.toString());
  }
}

// Fixed column widths per column type - deterministic, tight, single-line.
// Status columns are extra wide so "⚠️ WAREHOUSE OUT OF STOCK" and "❌ INSUFFICIENT" fit fully on one line.
function autoSizeColumns(sheet) {
  const widths = [135, 135, 125, 95, 90, 100, 165, 140, 240, 125, 115, 145];
  for (let c = 0; c < widths.length; c++) {
    sheet.setColumnWidth(c + 1, widths[c]);
  }
  // No wrapping: every cell stays single-line, rows keep default height.
  // Center every cell horizontally and vertically (applies to the whole sheet,
  // so older rows get fixed too).
  sheet.getDataRange()
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(false);
}

function saveToCacheSheet(ss, key, value) {
  let cacheSheet = ss.getSheetByName('SYSTEM_CACHE');
  if (!cacheSheet) {
    cacheSheet = ss.insertSheet('SYSTEM_CACHE');
    cacheSheet.hideSheet();
  }
  deleteFromCacheSheet(ss, key);
  cacheSheet.appendRow([key, value, new Date()]);
}

function getFromCacheSheet(ss, key) {
  const cacheSheet = ss.getSheetByName('SYSTEM_CACHE');
  if (!cacheSheet) return null;
  const vals = cacheSheet.getDataRange().getValues();
  for (let i = 0; i < vals.length; i++) {
    if (vals[i][0] === key) return vals[i][1];
  }
  return null;
}

function deleteFromCacheSheet(ss, key) {
  const cacheSheet = ss.getSheetByName('SYSTEM_CACHE');
  if (!cacheSheet) return;
  const vals = cacheSheet.getDataRange().getValues();
  for (let i = vals.length - 1; i >= 0; i--) {
    if (vals[i][0] === key) cacheSheet.deleteRow(i + 1);
  }
}

// TEST: open your /exec URL in a browser - it should show the deployment + spreadsheet info
// DATA: append ?action=data to the same URL to get the sheet as JSON
//       (used by the RC-Equipemnt desktop app to sync consumables).
function doGet(e) {
  const action = e && e.parameter ? (e.parameter.action || '') : '';

  if (action === 'data') {
    return dataEndpoint();
  }

  if (action === 'status') {
    return jsonOutput(statusPayload());
  }

  try {
    const ss = getSpreadsheet();
    return ContentService.createTextOutput(
      'DEPLOYMENT OK ✅ | VERSION: 10 (data endpoint) | Spreadsheet ID: ' + ss.getId() +
      ' | First sheet: ' + ss.getSheets()[0].getName() +
      ' | Rows: ' + ss.getSheets()[0].getLastRow()
    );
  } catch (err) {
    return ContentService.createTextOutput('ERROR: ' + err.toString());
  }
}

// Returns every row of the first sheet, exactly as displayed, including the header.
// Shape: { ok: true, sheet: 'Sheet1', rows: [ ['Start_Time', ...], ... ] }
// On failure: { ok: false, error: '...' }
function dataEndpoint() {
  try {
    const ss = getSpreadsheet();
    if (!ss) {
      return jsonOutput({ ok: false, error: 'No spreadsheet found - check SPREADSHEET_ID or bind the script' });
    }

    const sheet = ss.getSheets()[0];
    const lastRow = sheet.getLastRow();
    const rows = lastRow > 0
      ? sheet.getRange(1, 1, lastRow, 12).getDisplayValues()
      : [];

    return jsonOutput({
      ok: true,
      sheet: sheet.getName(),
      rows: rows,
      rows_in_sheet: lastRow
    });
  } catch (err) {
    return jsonOutput({ ok: false, error: err.toString() });
  }
}

function statusPayload() {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheets()[0];
    return {
      ok: true,
      spreadsheet_id: ss.getId(),
      first_sheet: sheet.getName(),
      rows: sheet.getLastRow(),
      updated: new Date().toISOString()
    };
  } catch (err) {
    return { ok: false, error: err.toString() };
  }
}

function jsonOutput(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function doOptions(e) {
  return ContentService.createTextOutput(JSON.stringify({status: 'CORS_OK'}))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeaders({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
}
