"use strict";
const importData = require('./import-data.js');
const buckets = require('./buckets.js');
const ForerunnerDB = require("forerunnerdb");
const es = require('event-stream');

let totalCount = 0;

function doQueries(coll) {
  let r;

  for (let bucket of buckets.buckets) {
    bucket.count = bucket.count || 0;
    bucket.count += coll.count(bucket.query);
  }
  totalCount += coll.count();
}

function printReport() {
  console.log("Total records", totalCount);
  for (let bucket of buckets.buckets) {
    console.log(bucket.name, bucket.count, (bucket.count * 100 / totalCount).toFixed(2) + "%");
  }
}

let fdb = new ForerunnerDB();
let db = fdb.db("crystalball");

let recordCount = 0;
let collection = db.collection("crash_data" /*, { primaryKey: "uuid" }*/);
const NUM_RECORDS = 500;

let handlingStream = es.mapSync(
  function (d) {
    console.log(d['release_channel']);
    //if (d['release_channel'] != 'release')
    //  return;

    if (recordCount > 0 && (recordCount % NUM_RECORDS) == 0) {
      doQueries(collection);
      collection.drop();
      collection = db.collection("crash_data" /*, { primaryKey: "uuid" }*/);
    }
    let result = collection.insert(d);
    if (result.failed.length > 0) {
      console.log(result);
    }
    recordCount++;
  });
handlingStream.on('end', function() {
  doQueries(collection);
  collection.drop();

  printReport();
});

let args = process.argv.slice(2);
if (args.length == 0) {
  args = ["data/2015-12-01.csv.gz"];
}

importData.loadAllData(args, handlingStream);
