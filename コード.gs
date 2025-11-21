// ==========================================
//  KML式神 v24.1 (Syntax Fixed)
// ==========================================

function doGet() {
  var gemUrl = "https://gemini.google.com/";
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var configSheet = ss.getSheetByName('config');
    if (configSheet) {
      var values = configSheet.getDataRange().getValues();
      for (var i = 0; i < values.length; i++) {
        if (values[i][0] === 'GemURL') { gemUrl = values[i][1]; break; }
      }
    }
  } catch (e) {}

  var template = HtmlService.createTemplateFromFile('index');
  template.gemUrl = gemUrl; 
  return template.evaluate()
    .setTitle('KML式神 v24.1')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🗺️ KML式神メニュー')
    .addItem('選択行の地図を作成', 'generateKmlForSelectedRow')
    .addToUi();
}

function saveMapData(jsonString) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var logSheet = ss.getSheetByName('generate_log');
    var dataSheet = ss.getSheetByName('places_data');
    
    var schema = JSON.parse(jsonString);
    var mapId = 'map_' + new Date().getTime();
    
    logSheet.appendRow([
      mapId, new Date(), schema.title || '無題の地図', schema.description || '',
      'データ保存済', '', ''
    ]);
    
    if (schema.places && Array.isArray(schema.places)) {
      var rowsToAdd = schema.places.map(function(place) {
        var iconId = place.icon || 'pushpin-yellow';
        return [
          mapId, place.name || '名称なし', place.description || '',
          place.lat || 0, place.lng || 0, iconId
        ];
      });
      if (rowsToAdd.length > 0) {
        dataSheet.getRange(dataSheet.getLastRow() + 1, 1, rowsToAdd.length, rowsToAdd[0].length).setValues(rowsToAdd);
      }
    }
    return { success: true, mapId: mapId };
  } catch (e) {
    return { success: false, message: 'JSONエラー: ' + e.toString() };
  }
}

// --- KML生成 ---
function createKmlFromSheet(mapId, folderParam) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var logSheet = ss.getSheetByName('generate_log');
    var dataSheet = ss.getSheetByName('places_data');
    var configSheet = ss.getSheetByName('config');

    // --- 保存先フォルダ決定ロジック ---
    var folderId = null;

    if (folderParam === null) {
      // ケース1: OFF -> マイドライブ直下 (folderId = null)
    } else if (folderParam === "") {
      // ケース2: ON & 空欄 -> コンフィグシートから取得
      try { folderId = configSheet.getRange('B2').getValue(); } catch(e) {}
    } else {
      // ケース3: ON & URLあり -> URLからID抽出
      try { 
        var match = folderParam.match(/[-\w]{25,}/);
        if (match) folderId = match[0];
      } catch(e) {}
    }
    
    // フォルダオブジェクト取得
    var folder;
    try { 
      folder = folderId ? DriveApp.getFolderById(folderId) : DriveApp.getRootFolder(); 
    } catch(e) { 
      folder = DriveApp.getRootFolder(); 
    }

    var logs = logSheet.getDataRange().getValues();
    var targetLogIndex = -1;
    var mapTitle = "";
    var mapDesc = "";
    
    for (var i = 1; i < logs.length; i++) {
      if (logs[i][0] === mapId) {
        targetLogIndex = i; mapTitle = logs[i][2]; mapDesc = logs[i][3]; break;
      }
    }
    if (targetLogIndex === -1) return { success: false, message: "Map IDが見つかりません" };

    var allPlaces = dataSheet.getDataRange().getValues();
    var targetPlaces = allPlaces.filter(function(row) { return row[0] === mapId; });
    if (targetPlaces.length === 0) return { success: false, message: "スポットデータがありません" };

    var kml = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n  <Document>\n';
    kml += '    <name>' + escapeXml(mapTitle) + '</name>\n';
    kml += '    <description>' + escapeXml(mapDesc) + '</description>\n';

    // --- アイコンURL生成 (Google Earth公式パス) ---
    var resolveIconUrl = function(iconId) {
      if (!iconId) iconId = 'pushpin-yellow';
      var parts = iconId.split('-');
      var type = parts[0];
      var val = parts[1];

      var kmlBase = "http://maps.google.com/mapfiles/kml";

      // カラーコード変換
      var colorMap = { 'yellow':'ylw', 'red':'red', 'blue':'blue', 'green':'grn', 'purple':'purple', 'pink':'pink', 'white':'wht' };
      var cCode = colorMap[val] || 'ylw';

      if (type === 'pushpin') return kmlBase + "/pushpin/" + cCode + "-pushpin.png";
      
      if (type === 'paddle') {
        if (cCode === 'blue') cCode = 'blu'; 
        return kmlBase + "/paddle/" + cCode + "-blank.png";
      }
      
      if (type === 'shape' || type === 'japan') {
        return kmlBase + "/shapes/" + val + ".png";
      }

      return kmlBase + "/pushpin/ylw-pushpin.png";
    };

    targetPlaces.forEach(function(place) {
      var iconId = (place[5] || 'pushpin-yellow').toString();
      var iconUrl = resolveIconUrl(iconId);
      var scale = (iconId.indexOf('shape') !== -1 || iconId.indexOf('japan') !== -1) ? 1.2 : 1.1;

      kml += '    <Placemark>\n';
      kml += '      <name>' + escapeXml(place[1]) + '</name>\n';
      kml += '      <description>' + escapeXml(place[2]) + '</description>\n';
      kml += '      <Style><IconStyle>\n';
      kml += '        <scale>' + scale + '</scale><Icon><href>' + iconUrl + '</href></Icon>\n';
      kml += '      </IconStyle></Style>\n';
      kml += '      <Point>\n';
      kml += '        <coordinates>' + place[4] + ',' + place[3] + ',0</coordinates>\n';
      kml += '      </Point>\n';
      kml += '    </Placemark>\n';
    });
    kml += '  </Document>\n</kml>';

    var fileName = (mapTitle || 'map') + '.kml';
    var file = folder.createFile(fileName, kml, 'application/vnd.google-earth.kml+xml');
    
    logSheet.getRange(targetLogIndex + 1, 5).setValue("作成済"); 
    logSheet.getRange(targetLogIndex + 1, 6).setValue(file.getUrl());
    logSheet.getRange(targetLogIndex + 1, 7).setValue(file.getDownloadUrl());

    return { success: true, driveUrl: file.getUrl(), downloadUrl: file.getDownloadUrl(), folderName: folder.getName(), folderUrl: folder.getUrl() };
  } catch (e) {
    return { success: false, message: "保存エラー: " + e.toString() };
  }
}

function exportToNewSheet(jsonDataStr) {
  try {
    var data = JSON.parse(jsonDataStr);
    var ss = SpreadsheetApp.create('MapData: ' + (data.title || 'Untitled'));
    var sheet = ss.getActiveSheet();
    
    sheet.appendRow(['Name', 'Description', 'Latitude', 'Longitude', 'IconID']);
    sheet.getRange('A1:E1').setFontWeight('bold').setBackground('#eee');
    
    if (data.places && data.places.length > 0) {
      var rows = data.places.map(function(p) {
        return [ p.name, p.description, p.lat, p.lng, p.icon || 'pushpin-yellow' ];
      });
      sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
    }
    return { success: true, url: ss.getUrl() };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

function generateKmlForSelectedRow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  if (sheet.getName() !== 'generate_log') return;
  var row = sheet.getActiveCell().getRow();
  if (row <= 1) return;
  var mapId = sheet.getRange(row, 1).getValue();
  if (!mapId) return;
  createKmlFromSheet(mapId, null); // メニュー実行時はデフォルト保存
}

// ▼▼▼ 完全修正版エスケープ関数 ▼▼▼
function escapeXml(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/[<>&'"]/g, function (c) {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case "'": return '&apos;'; // ここを修正しました
      case '"': return '&quot;';
    }
    return c;
  });
}
