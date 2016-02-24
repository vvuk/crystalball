"use strict";
const importData = require('./import-data.js');
const sift = require('sift');
const es = require('event-stream');
const cmdline = require('command-line-args');
const jsonfile = require('jsonfile');

let grandTotalRecords = 0;
let buckets = null;
let bucketResultsByChannel = {};
let outFile = null;
let outFileUpdate = false;
let verbose = false;

function doQueries(recsByChannel) {
  let r;

  for (let channel in recsByChannel) {
    let recs = recsByChannel[channel];
    let result =
      bucketResultsByChannel[channel] =
      bucketResultsByChannel[channel] || { totalCount: 0, matchedCount: 0, bucketCounts: {} };
    for (let bucket of buckets) {
      if (!bucket._sifter) {
        bucket._sifter = sift(bucket.query);
      }

      let resultBucket =
        result.bucketCounts[bucket.name] =
        result.bucketCounts[bucket.name] || { count: 0 };

      let c = recs.filter(bucket._sifter).length;
      resultBucket.count += c;
      result.matchedCount += c;
    }
    result.totalCount += recs.length;
    grandTotalRecords += recs.length;
  }
}

function printReport() {
  console.log("Processed", grandTotalRecords, "records");
  if (verbose) {
    console.log("---------------------");
    for (let channel in bucketResultsByChannel) {
      let r = bucketResultsByChannel[channel];
      console.log("Channel:", channel);
      console.log("Total records:", r.totalCount);
      for (let bucketName in r.bucketCounts) {
        let bucketCount = r.bucketCounts[bucketName];
        console.log(bucketName, bucketCount.count, (bucketCount.count * 100 / r.totalCount).toFixed(2) + "%");
      }
    }
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

    let channelJsonData = {};
    for (let channel in bucketResultsByChannel) {
      let r = bucketResultsByChannel[channel];
      let totalCount = r.totalCount;
      let matchedCount = r.matchedCount;

      let jsonData = {
        totalCount: totalCount,
        matchedCount: matchedCount,
        buckets: []
      };

      let bucketsByName = {};
      for (let bucketName in r.bucketCounts) {
        let bucketCount = r.bucketCounts[bucketName];
        let c = bucketCount.count;
        let b = {
          name: bucketName,
          count: c,
          percent: c / totalCount,
          percentMatched: c / matchedCount
        };
        jsonData['buckets'].push(b);
        bucketsByName[bucketName] = b;
      }

      if (oldData) {
        totalCount += oldData[channel].totalCount;
        matchedCount += oldData[channel].matchedCount;
        jsonData.totalCount = totalCount;
        jsonData.matchedCount = matchedCount;

        for (let ob of oldData[channel].buckets) {
          let nb = bucketsByName[ob.name];
          if (!nb) {
            continue;
          }
          nb.count += ob.count;
          nb.percent = nb.count / totalCount;
          nb.percentMatched = nb.count / matchedCount;
        }
      }

      channelJsonData[channel] = jsonData;
    }

    jsonfile.writeFile(outFile, channelJsonData, function(err) {
      if (err) {
        console.error("Failed to write", outFile, err);
      } else {
        console.log(oldData ? "Updated" : "Wrote", outFile);
      }
    });
  }
}

let recordCount = 0;
let recsByChannel = {};
const NUM_RECORDS = 5000;

let handlingStream = es.mapSync(
  function (d) {
    let channel = d['channel'];
    if (!channel) {
      // something ancient, likely Firefox 3.0 or 3.5
      return;
    }

    // every NUM_RECORDS, run the queries
    if (recordCount > 0 && (recordCount % NUM_RECORDS) == 0) {
      doQueries(recsByChannel);
      recsByChannel = {};
    }

    recsByChannel[channel] = recsByChannel[channel] || [];
    recsByChannel[channel].push(d);
    recordCount++;
  });
handlingStream.on('end', function() {
  doQueries(recsByChannel);
  printReport();
});

if (require.main == module) {
  let cli = cmdline([
    { name: 'out', alias: 'o', type: String },
    { name: 'update', alias: 'u', type: Boolean },
    { name: 'buckets', alias: 'b', type: String },
    { name: 'verbose', alias: 'v', type: Boolean },
    { name: 'in', ailas: 'i', type: String, multiple: true, defaultOption: true }
  ]);

  const opts = cli.parse();
  let args = opts["in"];
  outFile = opts["out"];
  outFileUpdate = opts["update"];
  verbose = opts["verbose"];

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
