"use strict";
const csv = require('csv');
const fs = require('fs');
const zlib = require('zlib');
const ForerunnerDB = require("forerunnerdb");
const util = require('util');
const EventEmitter = require('events');

function
parse_version_into(doc, vbase, vstr)
{
  let v4;
  let m = vstr.search(/[^0-9.]/);
  if (m != -1) {
    v4 = vstr.substr(m).trim();
    vstr = vstr.substr(0, m);
  }
  let vsplit = vstr.split(".");
  doc[vbase + "_v0"] = parseInt(vsplit[0]);
  doc[vbase + "_v1"] = vsplit.length < 2 ? undefined : parseInt(vsplit[1]);
  doc[vbase + "_v2"] = vsplit.length < 3 ? undefined : parseInt(vsplit[2]);
  doc[vbase + "_v3"] = vsplit.length < 4 ? undefined : parseInt(vsplit[3]);
  doc[vbase + "_v4"] = v4;
}

function
parse_os_version_into(doc, ostype, vbase, vstr)
{
  if (ostype == "Windows NT") {
    parse_version_into(doc, vbase, vstr);
  }
}

function
parse_app_notes_into(doc, ostype, appnotes)
{
  // we never got any app notes
  if (!appnotes) {
    return;
  }

  // for errors
  let origappnotes = appnotes;

  function take_gpu_info_windows(gpuid) {
    let m;
    m = appnotes.match(new RegExp('AdapterVendorID' + (gpuid==1?"2":"") + ': ([0-9a-fx]+),? ?'));
    if (m) {
      doc["gpu" + gpuid + "_vendor"] = parseInt(m[1], 16);
      appnotes = appnotes.substr(0, m.index) + appnotes.substr(m.index + m[0].length);
    }
    m = appnotes.match(new RegExp('AdapterDeviceID' + (gpuid==1?"2":"") + ': ([0-9a-fx]+),? ?'));
    if (m) {
      doc["gpu" + gpuid + "_device"] = parseInt(m[1], 16);
      appnotes = appnotes.substr(0, m.index) + appnotes.substr(m.index + m[0].length);
    }
    m = appnotes.match(new RegExp('AdapterSubsysID' + (gpuid==1?"2":"") + ': ([0-9a-fx]+),? ?'));
    if (m) {
      doc["gpu" + gpuid + "_subsys"] = parseInt(m[1], 16);
      appnotes = appnotes.substr(0, m.index) + appnotes.substr(m.index + m[0].length);
    }
    m = appnotes.match(new RegExp('AdapterDriverVersion' + (gpuid==1?"2":"") + ': ([0-9.]+),? ?'));
    if (m) {
      parse_version_into(doc, "gpu" + gpuid + "_driver", m[1]);
      appnotes = appnotes.substr(0, m.index) + appnotes.substr(m.index + m[0].length);
    }
  }

  function fill_gpu_info_windows(gpuid, m) {
    doc["gpu" + gpuid + "_vendor"] = parseInt(m[1], 16);
    doc["gpu" + gpuid + "_vendor"] = parseInt(m[2], 16);
    doc["gpu" + gpuid + "_devsys"] = parseInt(m[3], 16);
    parse_version_into(doc, "gpu" + gpuid + "_driver", m[4]);
  }

  if (ostype == "Windows NT") {
    take_gpu_info_windows(0);

    if (appnotes.indexOf("Has dual GPUs") != -1) {
      // fix up a missing space that would otherwisse confuse things ("... AdapterDriverVersion2: 0xabcdD2D?" -> ".. 0xabcd | D2D?")
      appnotes = appnotes.replace(/x([0-9a-f][0-9a-f][0-9a-f][0-9a-f])D/i, 'x$1 | D');

      take_gpu_info_windows(1);
    }
  } else if (ostype == "Mac OS X") {
    //console.log("skipping app notes for Mac OS X: " + origappnotes);
  } else {
    //console.log("skipping app notes for unknown OS: " + ostype);
  }
  
  let knownFeatures = { "D2D": "app_d2d",
                        "D2D1.1": "app_d2d11",
                        "DWrite": "app_dwrite",
                        "D3D9 Layers": "app_d3d9layers",
                        "D3D10 Layers": "app_d3d10layers",
                        "D3D11 Layers": "app_d3d11layers",
                        "GL Layers": "app_gllayers",
                        "WebGL": "app_webgl",
                        "EGL": "app_egl",
                        "GL Context": "app_glcx" };
  for (let k in knownFeatures) {
    if (appnotes.indexOf(k+"?") != -1) doc[knownFeatures[k]] = -1;
    if (appnotes.indexOf(k+"-") != -1) doc[knownFeatures[k]] = 0;
    if (appnotes.indexOf(k+"+") != -1) doc[knownFeatures[k]] = 1;
  }
}

function
loadData(collection, dataurl)
{
  console.time("loadData " + dataurl);

  let csvStream = fs.createReadStream(csvfile);
  if (csvfile.indexOf(".gz") != -1) {
    let gunzip = zlib.createGunzip();
    csvStream = csvStream.pipe(gunzip);
  }

  let parser = csv.parse({delimiter: '\t'});

  parser.on('error', function(err) {
    console.log(err.message);
  });

  let count = 0;
  let col = null;
  parser.on('readable', function() {
    let r = parser.read();
    if (!r) {
      return;
    }

    // first row? headers, then skip
    if (col == null) {
      col = {};
      for (let i = 0; i < r.length; ++i) {
        col[r[i]] = i;
      }
      return;
    }

    if (r[col['product']] != "Firefox")
      return;

    try {
      let doc = {};
      doc['signature'] = r[col['signature']];
      doc['uuid'] = r[col['uuid_url']].substr(r[col['uuid_url']].lastIndexOf("/") + 1);
      doc['build'] = r[col['build']];

      let osname = r[col['os_name']];
      doc['os_name'] = osname;

      parse_version_into(doc, "v", r[col['version']]);
      parse_os_version_into(doc, osname, "osv", r[col['os_version']]);
      parse_app_notes_into(doc, osname, r[col['app_notes']]);

      // insert the doc
      collection.insert(doc);
      if (count == 1) {console.log(doc); }
      count++;
    } catch (e) {
      console.error("Failed parsing crash with uuid_url ", r[col['uuid_url']]);
      console.error(e);
      console.error(e.stack);
    }
  });

  parser.on('end', function() {
    console.log("Parsed", count, "records");
    console.timeEnd("loadData " + csvfile);
  });

  return csvStream.pipe(parser);
}

let fdb = new ForerunnerDB();
let db = fdb.db();
let collection = db.collection("crash_data", { primaryKey: "uuid" });

let args = [];
let curArg = 0;
let finishCallback = null;
function readNextStream() {
  if (curArg == args.length) {
    if (finishCallback)
      finishCallback(db, collection);
    return;
  }

  var url = args[curArg++];
  console.log(url);
  loadData(collection, url).on('end', readNextStream);
}

function loadAllData(files, callback) {
  args = files;
  finishCallback = callback;
  readNextStream();
}

exports.loadAllData = loadAllData;

if (require.main === module) {
  loadAllData(process.argv.slice(2));
}
