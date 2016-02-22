"use strict";
const importData = require('./import-data.js');
const sift = require('sift');
const es = require('event-stream');

let topCrashes = {};

function doQueries(recs) {
  for (let rec of recs) {
    let sig = rec['signature'];
    if (sig in topCrashes) {
      topCrashes[sig]++;
    } else {
      topCrashes[sig] = 1;
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

let args = process.argv.slice(2);
if (args.length == 0) {
  args = ["data/2015-12-01.csv.gz"];
}

importData.loadAllData(args, handlingStream);
