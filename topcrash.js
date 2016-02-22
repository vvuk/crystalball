"use strict";
const importData = require('./import-data.js');
const sift = require('sift');
const es = require('event-stream');
const cmdline = require('command-line-args');
const jsonfile = require('jsonfile');

let topCrashes = {};
let buckets = null;

function doQueries(recs) {
  if (buckets) {
    for (let bucket of buckets) {
      let matched = recs.filter(bucket._sifter);
      for (let m of matched) {
        m._weight = bucket._weight;
      }
    }
  }

  for (let rec of recs) {
    let sig = rec['signature'];
    let w = rec._weight;
    if (buckets) {
      if (!w)
        continue;
    } else {
      w = 1;
    }

    if (sig in topCrashes) {
      topCrashes[sig] += w;
    } else {
      topCrashes[sig] = w;
    }
  }
}

function printReport() {
  let crashArray = [];
  for (let sig in topCrashes) {
    crashArray.push({"sig": sig, "count": topCrashes[sig]});
  }

  crashArray.sort(function(a, b) {
    return b.count - a.count;
  });

  for (let i = 0; i < 15; ++i) {
    console.log(crashArray[i].count, crashArray[i].sig);
  }
}

let recordCount = 0;
let records = [];
const NUM_RECORDS = 5000;

let handlingStream = es.mapSync(
  function (d) {
    //if (d['build_id'] != "20151029151421")
    //  return;
    //if (d['release_channel'] != 'release')
    //  return;

    if (recordCount > 0 && (recordCount % NUM_RECORDS) == 0) {
      doQueries(records);
      records = [];
    }
    records.push(d);
    recordCount++;
  });
handlingStream.on('end', function() {
  doQueries(records);
  printReport();
});

if (require.main == module) {
  let cli = cmdline([
    { name: 'weights', alias: 'w', type: String },
    { name: 'buckets', alias: 'b', type: String },
    { name: 'src', ailas: 's', type: String, multiple: true, defaultOption: true }
  ]);

  const opts = cli.parse();
  let args = opts["src"];
  if (!args || args.length == 0) {
    args = ["data/2015-12-01.csv.gz"];
  }

  if (opts['weights'] && opts['buckets']) {
    let bdata = require(opts['buckets']);
    buckets = bdata.buckets;

    let weightData = jsonfile.readFileSync(opts['weights']);
    let weightsByName = {};
    for (let w of weightData) {
      weightsByName[w['name']] = w['weight'];
    }

    for (let bucket of buckets) {
      if (!bucket._sifter) {
        bucket._sifter = sift(bucket.query);
      }
      if (!(bucket['name'] in weightsByName)) {
        console.error("Can't find weight for bucket", bucket['name']);
        throw "Failed";
      }

      bucket._weight = weightsByName[bucket['name']];
    }
  }

  importData.loadAllData(args, handlingStream);
}

