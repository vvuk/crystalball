"use strict";
const importData = require('./import-data.js');
const buckets = require('./buckets.js');
const sift = require('sift');
const es = require('event-stream');

let totalCount = 0;

function doQueries(recs) {
  let r;

  for (let bucket of buckets.buckets) {
    if (!bucket._sifter) {
      bucket._sifter = sift(bucket.query);
    }

    bucket._count = bucket._count || 0;
    bucket._count += recs.filter(bucket._sifter).length;
  }
  totalCount += recs.length;
}

function printReport() {
  console.log("Total records", totalCount);
  for (let bucket of buckets.buckets) {
    console.log(bucket.name, bucket._count, (bucket._count * 100 / totalCount).toFixed(2) + "%");
  }
}

let recordCount = 0;
let records = [];
const NUM_RECORDS = 5000;

let handlingStream = es.mapSync(
  function (d) {
    if (d['build_id'] != "20151029151421")
      return;
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
