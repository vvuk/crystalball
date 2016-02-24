"use strict";
const importData = require('./import-data.js');
const sift = require('sift');
const es = require('event-stream');
const cmdline = require('command-line-args');
const jsonfile = require('jsonfile');

let buckets = null;
let totalCount = 0;
let matchedCount = 0;
let outFile = null;
let outFileUpdate = false;
let channelSelector = null;

function doQueries(recs) {
  let r;

  for (let bucket of buckets) {
    if (!bucket._sifter) {
      bucket._sifter = sift(bucket.query);
    }

    bucket._count = bucket._count || 0;

    let c = recs.filter(bucket._sifter).length;
    bucket._count += c;
    matchedCount += c;
  }
  totalCount += recs.length;
}

function printReport() {
  console.log("Total records", totalCount);
  for (let bucket of buckets) {
    console.log(bucket.name, bucket._count, (bucket._count * 100 / totalCount).toFixed(2) + "%");
  }

  if (outFile) {
    let oldData;

    if (outFileUpdate) {
      var d = jsonfile.readFileSync(outFile, { "throws": false });
      if (d) {
        oldData = d;
      } else {
        console.error("Failed to load old data for update");
      }
    }

    let jsonData = {
      totalCount: totalCount,
      matchedCount: matchedCount,
      buckets: []
    };

    let bucketsByName = {};
    for (let bucket of buckets) {
      let c = bucket._count || 0;
      let b = {
        name: bucket.name,
        count: c,
        percent: c / totalCount,
        percentMatched: c / matchedCount
      };
      jsonData['buckets'].push(b);
      bucketsByName[bucket.name] = b;
    }

    if (oldData) {
      totalCount += oldData.totalCount;
      matchedCount += oldData.matchedCount;

      jsonData.totalCount = totalCount;
      jsonData.matchedCount = matchedCount;
      if (jsonData['buckets'].length != oldData['buckets'].length) {
        console.error("Mismatch in data update -- number of buckets isn't the same!");
        return;
      }

      for (let ob of oldData.buckets) {
        let nb = bucketsByName[ob.name];
        if (!nb) {
          console.error("Old bucket", ob.name, "doesn't exist in new data!");
          return;
        }
        nb.count += ob.count;
        nb.percent = nb.count / totalCount;
        nb.percentMatched = nb.count / matchedCount;
        nb._seen = true;
      }

      for (let i = 0; i < jsonData['buckets'].length; ++i) {
        let nb = jsonData['buckets'][i];
        if (!nb._seen) {
          console.error("New bucket", nb.name, "doesn't exist in old data!");
          return;
        }
        delete nb._seen;
      }
    }

    jsonfile.writeFile(outFile, jsonData, function(err) {
      if (err) {
        console.error("Failed to write", outFile, err);
      } else {
        console.log(oldData ? "Updated" : "Wrote", outFile);
      }
    });
  }
}

let recordCount = 0;
let records = [];
const NUM_RECORDS = 5000;

let handlingStream = es.mapSync(
  function (d) {
    if (channelSelector && d['channel'] != channelSelector)
      return;

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
    { name: 'out', alias: 'o', type: String },
    { name: 'update', alias: 'u', type: Boolean },
    { name: 'channel', alias: 'c', type: String },
    { name: 'buckets', alias: 'b', type: String },
    { name: 'in', ailas: 'i', type: String, multiple: true, defaultOption: true }
  ]);

  const opts = cli.parse();
  let args = opts["in"];
  outFile = opts["out"];
  outFileUpdate = opts["update"];
  channelSelector = opts["channel"];

  let bucketModule = opts["buckets"];
  if (bucketModule) {
    if (bucketModule.indexOf("/") == -1) {
      bucketModule = "./" + bucketModule;
    }
  } else {
    console.log("Using ./buckets.js");
    bucketModule = "./buckets.js";
  }

  buckets = require(bucketModule).buckets;

  if (!args || args.length == 0) {
    args = ["2016-01-01"];
  }

  importData.loadAllData(args, handlingStream);
}
