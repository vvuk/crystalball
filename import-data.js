"use strict";
const csv = require('csv');
const fs = require('fs');
const zlib = require('zlib');
const util = require('util');
const EventEmitter = require('events');
const request = require('request');
const JSONStream = require('JSONStream');
const es = require('event-stream');
const Stream = require('stream');

let apikey = null;
try {
  apikey = require('./apikey.js').apikey;
} catch (e) {
}

let cacheDir = "cache";

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
    new es.mapSync(function (doc) {
      parse_version_into(doc, "v", doc['version']);
      parse_os_version_into(doc, doc['platform'], "pv", doc['platform_version']);
      parse_app_notes_into(doc, doc['platform'], doc['app_notes']);

      var docstr = doc['date'];
      doc['date'] = docstr.substr(0, 10).replace(/-/g, "");
      doc['channel'] = doc['release_channel'];
      delete doc['release_channel'];

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

function pad2(k) {
  if (k < 10) return "0" + k;
  return "" + k;
}

function
expandDateString(datearg)
{
  let datestrings = [];
  let m;

  m = datearg.match(/^([0-9][0-9][0-9][0-9])-([0-9][0-9])(-([0-9][0-9]))?(\:([0-9][0-9][0-9][0-9])-([0-9][0-9])(-([0-9][0-9]))?)?$/);
  if (m[5]) {
    // a range was given
    let starty = parseInt(m[1], 10);
    let startm = parseInt(m[2], 10);
    let startd = m[4] ? parseInt(m[4], 10) : 1;
    let endy = parseInt(m[6], 10);
    let endm = parseInt(m[7], 10);
    let endd = m[9];

    let d = new Date(starty + "-" + pad2(startm) + "-" + pad2(startd) + " PST");
    let endDate;
    if (endd) {
      endDate = new Date(endy + "-" + pad2(endm) + "-" + pad2(endd) + " PST");
      endDate.setDate(endDate.getDate() + 1);
    } else {
      endDate = new Date(endy + "-" + pad2(endm) + "-01 PST");
      endDate.setMonth(endDate.getMonth() + 1);
    }

    while (d < endDate) {
      datestrings.push(d.getFullYear() + "-" +
                       pad2(d.getMonth()+1) + "-" +
                       pad2(d.getDate()));
      d.setDate(d.getDate() + 1);
    }
  } else if (m[4]) {
    // a specific day was given
    datestrings.push(datearg);
  } else {
    // a month, loop through the dates
    let d = new Date(datearg + "-01 PST");
    let startMonth = d.getMonth();
    while (d.getMonth() == startMonth) {
      datestrings.push(d.getFullYear() + "-" +
                       pad2(d.getMonth()+1) + "-" +
                       pad2(d.getDate()));
      d.setDate(d.getDate() + 1);
    }
  }
  return datestrings;
}

function
loadDataCSVQueryDate(datearg, outputStream)
{
  let csvURLBase = "https://crash-stats.mozilla.com/graphics_report/?date=";
  let reqOpts = { url: csvURLBase + datearg,
                  gzip: true };
  if (apikey) {
    reqOpts['headers'] = { "Auth-Token": apikey };
  }

  if (cacheDir) {
    let path = cacheDir + "/" + datearg + ".csv.gz";
    try {
      fs.accessSync(path);
      // exists
      let s = fs.createReadStream(path);
      console.log(reqOpts.url + " (cached)");
      return loadDataCSVStream(s.pipe(zlib.createGunzip()));
    } catch (e) {
    }
  }

  console.log(reqOpts.url);
  let r = request(reqOpts);
  if (cacheDir) {
    let path = cacheDir + "/" + datearg + ".csv.gz";
    r.pipe(zlib.createGzip()).pipe(fs.createWriteStream(path));
  }
  return loadDataCSVStream(r);
}

function
loadDataCSV(csvfile)
{
  let csvStream = fs.createReadStream(csvfile);
  if (csvfile.indexOf(".gz") != -1) {
    let gunzip = zlib.createGunzip();
    csvStream = csvStream.pipe(gunzip);
  }

  return loadDataCSVStream(csvStream);
}

function
loadDataCSVStream(csvStream)
{
  console.time("loadDataCSV");

  let parser = csv.parse({delimiter: '\t'});

  parser.on('error', function(err) {
    console.log(err.message);
  });

  let col = null;
  let lineParser =
    new es.map(function(r, callback) {
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
        doc['uuid'] = r[col['crash_id']];
        doc['build_id'] = r[col['build']];

        let osname = r[col['os_name']];
        doc['platform'] = osname;
        doc['app_notes'] = r[col['app_notes']];
        parse_os_version_into(doc, osname, "pv", r[col['os_version']]);
        doc['version'] = r[col['version']];
        doc['date'] = r[col['date_processed']].substr(0, 8);
        doc['channel'] = r[col['release_channel']];

        parse_version_into(doc, "v", r[col['version']]);
        parse_os_version_into(doc, osname, "pv", r[col['os_version']]);
        parse_app_notes_into(doc, osname, r[col['app_notes']]);
      } catch (e) {
        console.error("Failed parsing crash with uuid ", r[col['crash_id']]);
        console.error(e);
        console.error(e.stack);
      }

      callback(null, doc);
    });

  return csvStream
         .pipe(parser)
         .pipe(lineParser)
         .on('end', function() {
           console.timeEnd("loadDataCSV");
           //lineParser.emit('end');
         });
}

let args = [];
let sinkStream = null;

function readNextStream() {
  let arg = args.shift();
  if (!arg) {
    if (sinkStream) {
      sinkStream.emit('end');
    }
    return;
  }

  let s;
  if (arg.indexOf("http") == 0) {
    s = loadDataSuperSearchURL(arg);
  } else if (arg.match(/^[0-9][0-9][0-9][0-9]-[0-9][0-9](-[0-9][0-9])?$/)) {
    s = loadDataCSVQueryDate(arg);
  } else {
    s = loadDataCSV(arg);
  }

  s.on('end', readNextStream);

  if (sinkStream) {
    // map just the data over
    s.pipe(sinkStream, {end: false});
  }
}

function expandSourceArgs(dataSources) {
  let expandedArgs = [];
  for (let arg of dataSources) {
    if (arg.match(/^[0-9][0-9][0-9][0-9]-[0-9][0-9](-[0-9][0-9])?$/) ||
        arg.match(/^[0-9][0-9][0-9][0-9]-[0-9][0-9](-[0-9][0-9])?\:[0-9][0-9][0-9][0-9]-[0-9][0-9](-[0-9][0-9])?$/)) {
      expandedArgs = expandedArgs.concat(expandDateString(arg));
    } else {
      expandedArgs.push(arg);
    }
  }
  return expandedArgs;
}

function loadAllData(dataSources, destStream, cacheDirArg) {
  args = expandSourceArgs(dataSources);
  sinkStream = destStream;
  cacheDir = cacheDirArg || cacheDir;
  readNextStream();
}

exports.expandSourceArgs = expandSourceArgs;
exports.loadAllData = loadAllData;

/*
 * For testing -- if this script is ran directly, it will just process
 * all args
 */
if (require.main === module) {
  let k = 0;
  let testSink = es.mapSync(function (d) {
                   if (d['channel'] == 'beta')
                     console.log(d);
                   k++;
                 });
  testSink.on('end', function() { console.log("Sinkstream end"); });

  let args = process.argv.slice(2);
  loadAllData(args, testSink);
}
