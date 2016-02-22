"use strict";
const csv = require('csv');
const fs = require('fs');
const zlib = require('zlib');
const util = require('util');
const EventEmitter = require('events');
const request = require('request');
const JSONStream = require('JSONStream');
const es = require('event-stream');

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
  let gpu_count = 1;

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
      // fix up a missing space that would otherwise confuse things ("... AdapterDriverVersion2: 0xabcdD2D?" -> ".. 0xabcd | D2D?")
      appnotes = appnotes.replace(/x([0-9a-f][0-9a-f][0-9a-f][0-9a-f])D/i, 'x$1 | D');

      take_gpu_info_windows(1);
      gpu_count = 2;
    }
  } else if (ostype == "Mac OS X") {
    //console.log("skipping app notes for Mac OS X: " + origappnotes);
  } else {
    //console.log("skipping app notes for unknown OS: " + ostype);
  }

  doc["gpu_count"] = gpu_count;

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
loadDataSuperSearchURL(ssurl, offset, outputStream)
{
  offset = offset || 0;

  const size = 500;

  let requrl = ssurl;
  requrl += "&_results_offset=" + offset;
  requrl += "&_results_size=" + size;
  requrl += "&_facets_size=1";

  console.log(requrl, offset);
  console.time("loadDataSuperSearchURL " + requrl);

  outputStream = outputStream ||
    es.mapSync(function (doc) {
      parse_version_into(doc, "v", doc['version']);
      parse_os_version_into(doc, doc['platform'], "pv", doc['platform_version']);
      parse_app_notes_into(doc, doc['platform'], doc['app_notes']);

      var docstr = doc['date'];
      doc['crash_date'] = docstr.substr(0, 10).replace(/-/g, "");
      doc['crash_time'] = docstr.substr(11, 8).replace(/:/g, "");
      delete doc['date'];

      //console.log(doc);
      //console.log("====");

      return doc;
    });

  let count = 0;
  request({url: requrl})
    .pipe(JSONStream.parse('hits.*'))
    .on('end', function() {
      console.log(count, size);
      console.timeEnd("loadDataSuperSearchURL " + requrl);
      if (count == 0) {
        // we're done
        outputStream.emit('end');
      } else {
        offset += count;
        loadDataSuperSearchURL(ssurl, offset, outputStream);
      }
    })
    .pipe(outputStream);

  return outputStream;
}

function
loadDataCSV(csvfile)
{
  console.time("loadDataCSV " + csvfile);

  let csvStream = fs.createReadStream(csvfile);
  if (csvfile.indexOf(".gz") != -1) {
    let gunzip = zlib.createGunzip();
    csvStream = csvStream.pipe(gunzip);
  }

  let parser = csv.parse({delimiter: '\t'});

  parser.on('error', function(err) {
    console.log(err.message);
  });

  let col = null;
  let lineParser =
    es.map(function(r, callback) {
      // first row? headers, then skip
      if (col == null) {
        col = {};
        for (let i = 0; i < r.length; ++i) {
          col[r[i]] = i;
        }
        callback();
        return;
      }

      if (r[col['product']] != "Firefox") {
        callback();
        return;
      }

      let doc = {};

      try {
        doc['signature'] = r[col['signature']];
        doc['uuid'] = r[col['uuid_url']].substr(r[col['uuid_url']].lastIndexOf("/") + 1);
        doc['build_id'] = r[col['build']];

        let osname = r[col['os_name']];
        doc['platform'] = osname;
        doc['app_notes'] = r[col['app_notes']];
        doc['platform_version'] = r[col['os_version']];
        doc['version'] = r[col['version']];
        doc['crash_date'] = r[col['client_crash_date']].substr(0, 8);
        doc['crash_time'] = r[col['client_crash_date']].substr(8);

        parse_version_into(doc, "v", r[col['version']]);
        parse_os_version_into(doc, osname, "pv", r[col['os_version']]);
        parse_app_notes_into(doc, osname, r[col['app_notes']]);
      } catch (e) {
        console.error("Failed parsing crash with uuid_url ", r[col['uuid_url']]);
        console.error(e);
        console.error(e.stack);
      }

      callback(null, doc);
    });

  return csvStream
         .pipe(parser)
         .pipe(lineParser)
         .on('end', function() {
           console.timeEnd("loadDataCSV " + csvfile);
           //lineParser.emit('end');
         });
}

let args = [];
let curArg = 0;
let sinkStream = null;
function readNextStream() {
  if (curArg == args.length) {
    if (sinkStream) {
      sinkStream.emit('end');
    }
    return;
  }

  var arg = args[curArg++];
  console.log(arg);
  let s;
  if (arg.indexOf("http") == 0) {
    s = loadDataSuperSearchURL(arg).on('end', readNextStream);
  } else {
    s = loadDataCSV(arg).on('end', readNextStream);
  }
  if (sinkStream) {
    // map just the data over
    s.pipe(es.mapSync(function(r) {
             sinkStream.emit('data', r);
           }));
  }
}

function loadAllData(files, destStream) {
  args = files;
  sinkStream = destStream;
  readNextStream();
}

exports.loadAllData = loadAllData;

if (require.main === module) {
  let k = 0;
  let testSink = es.mapSync(function (data) {
                   //if (k == 2) console.log(data);
                   k++;
                 });
  testSink.on('end', function() { console.log("Sinkstream end"); });

  let args = process.argv.slice(2);
  loadAllData(args, testSink);
}
